// The programs the deterministic traces run: what each kernel's threads do, as the model's
// operations. Each is a function of the settings a chapter or a reader chooses, and each says
// what result to expect, so a trace can report what was lost.

const NAMES = ["A", "B", "C", "D", "E", "F", "G", "H"];
const threadsOf = (n, ops) => Array.from({ length: n }, (_, i) => ({ name: NAMES[i] || `T${i}`, ops: ops(i) }));

// The counter kernel. `operation` is the page's: plain (load, add, store, per increment),
// atomic (one indivisible add per increment), split (an atomic load, an add, an atomic store:
// three steps again) or folded (one load, one add of the whole count, one store per thread).
export function counter({ threads = 2, iterations = 2, operation = "plain" } = {}) {
  const ops = [];
  if (operation === "folded") {
    ops.push({ op: "load", reg: "r", var: "counter" }, { op: "add", reg: "r", imm: iterations }, { op: "store", var: "counter", reg: "r" });
  } else {
    for (let i = 0; i < iterations; i++) {
      if (operation === "atomic") ops.push({ op: "rmw_add", var: "counter", imm: 1 });
      else ops.push({ op: "load", reg: "r", var: "counter" }, { op: "add", reg: "r", imm: 1 }, { op: "store", var: "counter", reg: "r" });
    }
  }
  return { memory: { counter: 0 }, threads: threadsOf(threads, () => [...ops]), expected: { counter: threads * iterations } };
}

// The compare-and-swap kernel: load, compute, and store only if the word is still what was
// loaded; otherwise go round again from the load.
export function cas({ threads = 2, iterations = 2 } = {}) {
  const ops = [];
  for (let i = 0; i < iterations; i++) {
    const at = ops.length;
    ops.push(
      { op: "load", reg: "seen", var: "counter" },
      { op: "add", reg: "next", from: "seen", imm: 1 },
      { op: "cas", var: "counter", expect: "seen", reg: "next", out: "ok" },
      { op: "jz", reg: "ok", to: at },
    );
  }
  return { memory: { counter: 0 }, threads: threadsOf(threads, () => [...ops]), expected: { counter: threads * iterations } };
}

// The spinlock kernel. tas: exchange a 1 in and spin while a 1 comes out. ttas: spin on a load,
// then exchange. broken: a load, then a store, which is not a lock. The critical section is one
// plain increment of the counter.
export function spinlock({ threads = 2, iterations = 1, variant = "tas" } = {}) {
  const ops = [];
  for (let i = 0; i < iterations; i++) {
    const at = ops.length;
    if (variant === "tas") {
      ops.push({ op: "xchg", var: "lock", imm: 1, out: "got" }, { op: "jnz", reg: "got", to: at });
    } else if (variant === "ttas") {
      ops.push(
        { op: "load", reg: "seen", var: "lock" }, { op: "jnz", reg: "seen", to: at },
        { op: "xchg", var: "lock", imm: 1, out: "got" }, { op: "jnz", reg: "got", to: at },
      );
    } else {
      ops.push({ op: "load", reg: "seen", var: "lock" }, { op: "jnz", reg: "seen", to: at }, { op: "store", var: "lock", imm: 1 });
    }
    ops.push(
      { op: "load", reg: "r", var: "counter" }, { op: "add", reg: "r", imm: 1 }, { op: "store", var: "counter", reg: "r" },
      { op: "store", var: "lock", imm: 0 },
    );
  }
  return { memory: { lock: 0, counter: 0 }, threads: threadsOf(threads, () => [...ops]), expected: { counter: threads * iterations } };
}

// The sleeping lock. Take it from 0 to 1 if free; otherwise mark it 2 and sleep until it is no
// longer 2. Release by counting down; if it was 2, set it to 0 and wake one sleeper. `spin`
// instead spins on the exchange, as ch05's lock does.
export function mutex({ threads = 2, iterations = 1, variant = "sleep" } = {}) {
  const ops = [];
  for (let i = 0; i < iterations; i++) {
    const at = ops.length;
    if (variant === "spin") {
      ops.push({ op: "xchg", var: "lock", imm: 1, out: "got" }, { op: "jnz", reg: "got", to: at });
    } else {
      ops.push(
        { op: "cas", var: "lock", expect: 0, reg: 1, out: "ok" },     // at
        { op: "jnz", reg: "ok", to: at + 6 },                          // at+1: got it
        { op: "xchg", var: "lock", imm: 2, out: "prev" },              // at+2: say somebody waits
        { op: "jz", reg: "prev", to: at + 6 },                         // at+3: it was free after all
        { op: "wait", var: "lock", expect: 2 },                        // at+4: sleep while 2
        { op: "jmp", to: at + 2 },                                     // at+5: woken: try again
      );
    }
    ops.push(
      { op: "load", reg: "r", var: "counter" }, { op: "add", reg: "r", imm: 1 }, { op: "store", var: "counter", reg: "r" },
    );
    if (variant === "spin") ops.push({ op: "store", var: "lock", imm: 0 });
    else {
      const end = ops.length + 4;
      ops.push(
        { op: "rmw_add", var: "lock", imm: -1, out: "prev" },
        { op: "jeq", reg: "prev", imm: 1, to: end },
        { op: "store", var: "lock", imm: 0 },
        { op: "notify", var: "lock", one: true },
      );
    }
  }
  return { memory: { lock: 0, counter: 0 }, threads: threadsOf(threads, () => [...ops]), expected: { counter: threads * iterations } };
}

// The compiler's loop. plain: the load was hoisted out of the loop, so the loop tests a register
// forever. volatile and atomic: a load every time round. Thread B sets the flag after a step
// of busy work.
export function compiler({ variant = "plain" } = {}) {
  const waiter = variant === "plain"
    ? [{ op: "load", reg: "r", var: "flag" }, { op: "jz", reg: "r", to: 1 }, { op: "note", text: "loop ended" }]
    : [{ op: "load", reg: "r", var: "flag" }, { op: "jz", reg: "r", to: 0 }, { op: "note", text: "loop ended" }];
  const setter = [{ op: "note", text: "busy work" }, { op: "store", var: "flag", imm: 1 }];
  return { memory: { flag: 0 }, threads: [{ name: "waiter", ops: waiter }, { name: "setter", ops: setter }], expected: { flag: 1 } };
}

// Publication: the writer stores the data, then the flag; the reader waits for the flag, then
// reads the data and keeps what it saw. Under volatile or relaxed, nothing orders the writer's
// two stores, and the model lets the flag's store reach memory first, as a weakly ordered
// processor may. A release store lets nothing before it overtake it.
export function publication({ ordering = "volatile", reorder = true } = {}) {
  const ordered = ordering === "release-acquire" || ordering === "seq_cst";
  const writer = [{ op: "store", var: "data", imm: 1, buffered: true }];
  if (ordered) writer.push({ op: "store", var: "ready", imm: 1, release: true, seq_cst: ordering === "seq_cst" }, { op: "drain" });
  else if (reorder) writer.push({ op: "store", var: "ready", imm: 1, buffered: true }, { op: "drain", var: "ready" }, { op: "drain", var: "data" });
  else writer.push({ op: "store", var: "ready", imm: 1, buffered: true }, { op: "drain" }, { op: "drain" });
  const reader = [
    { op: "load", reg: "r", var: "ready" },
    { op: "jz", reg: "r", to: 0 },
    { op: "load", reg: "d", var: "data" },
    { op: "store", var: "seen", reg: "d" },
  ];
  return {
    memory: { data: 0, ready: 0, seen: -1 },
    threads: [{ name: "writer", ops: writer }, { name: "reader", ops: reader }],
    expected: { seen: 1 },
    outcome: (m) => (m.seen === 1 ? "the reader saw the flag and the data: published" : m.seen === 0 ? "the reader saw the flag but not the data: a stale read" : "the reader has not finished"),
  };
}

// The store-buffer test. Each thread stores a one into its own word, which waits in its buffer,
// then loads the other's word from memory. seq_cst stores and fences drain the buffer first.
export function store_buffer({ ordering = "volatile" } = {}) {
  const half = (mine, theirs, reg) => {
    const ops = [];
    if (ordering === "seq_cst") ops.push({ op: "store", var: mine, imm: 1, seq_cst: true });
    else if (ordering === "release-acquire") ops.push({ op: "store", var: mine, imm: 1, release: true });
    else ops.push({ op: "store", var: mine, imm: 1, buffered: true });
    if (ordering === "fence") ops.push({ op: "fence" });
    ops.push({ op: "load", reg, var: theirs }, { op: "store", var: reg, reg });
    return ops;
  };
  return {
    memory: { x: 0, y: 0, r1: -1, r2: -1 },
    threads: [{ name: "A", ops: half("x", "y", "r1") }, { name: "B", ops: half("y", "x", "r2") }],
    expected: { r1: 1 },
    outcome: (m) => (m.r1 < 0 || m.r2 < 0 ? "not finished" : m.r1 === 0 && m.r2 === 0 ? "both loaded zero: the outcome no interleaving allows" : `(r1, r2) = (${m.r1}, ${m.r2}): an interleaving explains it`),
  };
}

export const programs = { counter, cas, spinlock, mutex, compiler, publication, store_buffer };
