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

// A stack of three nodes, 1 on top of 2 on top of 3, and two threads popping once each. cas: read
// the top and the node below, then swing the head only if the top is unchanged. broken: read,
// then store, in two steps, so both threads can take the same node.
export function stack({ variant = "cas" } = {}) {
  const pop = (got) => {
    const ops = [
      { op: "load", reg: "top", var: "head" },
      { op: "loadi", reg: "below", base: "next", index: "top" },
    ];
    if (variant === "cas") ops.push({ op: "cas", var: "head", expect: "top", reg: "below", out: "ok" }, { op: "jz", reg: "ok", to: 0 });
    else ops.push({ op: "store", var: "head", reg: "below" });
    ops.push({ op: "store", var: got, reg: "top" });
    return ops;
  };
  return {
    memory: { head: 1, next1: 2, next2: 3, next3: 0, gotA: 0, gotB: 0 },
    threads: [{ name: "A", ops: pop("gotA") }, { name: "B", ops: pop("gotB") }],
    expected: { head: 3 },
    outcome: (m) => (!m.gotA || !m.gotB ? "not finished" : m.gotA === m.gotB ? `both threads popped node ${m.gotA}: one node, two owners, and the head is ${m.head}` : `A popped node ${m.gotA} and B node ${m.gotB}; the head is ${m.head}`),
  };
}

// The ABA interleaving. Thread A begins a pop of node 1 and reads that node 2 is below it. Thread
// B pops 1, pops 2, and pushes 1 back, so the head is 1 again with 3 below it. A's
// compare-and-swap then finds the head it expected and swings it to 2, which B holds. With a
// tagged head, every swing adds one to the tag, and A's compare of head and tag fails.
export function aba({ variant = "plain" } = {}) {
  const tagged = variant === "tagged";
  const popA = tagged
    ? [
      { op: "load", reg: "top", var: "head" }, { op: "load", reg: "tag", var: "tag" },
      { op: "loadi", reg: "below", base: "next", index: "top" },
      // The swing moves the tag on by one, as every swing does; the compare is on both halves.
      { op: "add", reg: "newtag", from: "tag", imm: 1 },
      { op: "cas2", vars: ["head", "tag"], expect: ["top", "tag"], values: ["below", "newtag"], out: "ok" },
      { op: "jz", reg: "ok", to: 0 }, { op: "store", var: "gotA", reg: "top" },
    ]
    : [
      { op: "load", reg: "top", var: "head" },
      { op: "loadi", reg: "below", base: "next", index: "top" },
      { op: "cas", var: "head", expect: "top", reg: "below", out: "ok" },
      { op: "jz", reg: "ok", to: 0 }, { op: "store", var: "gotA", reg: "top" },
    ];
  const bump = (reg) => (tagged ? [{ op: "rmw_add", var: "tag", imm: 1 }] : []);
  const popB = [
    { op: "load", reg: "top", var: "head" }, { op: "loadi", reg: "below", base: "next", index: "top" },
    { op: "store", var: "head", reg: "below" }, ...bump(), { op: "note", text: "B holds the node it popped" },
  ];
  const pushB = [
    { op: "load", reg: "t", var: "head" }, { op: "store", var: "next1", reg: "t" },
    { op: "store", var: "head", imm: 1 }, ...bump(),
  ];
  return {
    memory: { head: 1, tag: 0, next1: 2, next2: 3, next3: 0, gotA: 0 },
    threads: [{ name: "A", ops: popA }, { name: "B", ops: [...popB, ...popB, ...pushB] }],
    expected: { head: 3 },
    outcome: (m) => (!m.gotA ? "A has not finished its pop" : m.head === 2 ? "A's compare-and-swap succeeded on a head that had left and returned: the head is node 2, which B holds" : `A popped node ${m.gotA}; the head is node ${m.head}`),
  };
}

// One writer and one reader. The writer publishes record 2 and retires record 1. Without
// protection it poisons record 1 at once; with a hazard pointer it waits while the reader's
// hazard names record 1.
export function reclamation({ variant = "none" } = {}) {
  const hazards = variant === "hazard pointers";
  const writer = [
    { op: "store", var: "value2", imm: 1002 },
    { op: "store", var: "current", imm: 2, release: true },
    { op: "drain" },
  ];
  if (hazards) writer.push({ op: "load", reg: "h", var: "hazard" }, { op: "jeq", reg: "h", imm: 1, to: 3 });
  writer.push({ op: "store", var: "value1", imm: -1 });
  const reader = hazards
    ? [
      { op: "load", reg: "idx", var: "current" }, { op: "store", var: "hazard", reg: "idx", seq_cst: true },
      { op: "load", reg: "check", var: "current" }, { op: "jeq", reg: "check", imm: 1, to: 5 }, { op: "jmp", to: 0 },
      { op: "loadi", reg: "v", base: "value", index: "idx" }, { op: "store", var: "hazard", imm: 0 }, { op: "store", var: "got", reg: "v" },
    ]
    : [
      { op: "load", reg: "idx", var: "current" }, { op: "loadi", reg: "v", base: "value", index: "idx" }, { op: "store", var: "got", reg: "v" },
    ];
  return {
    memory: { current: 1, value1: 1001, value2: -1, hazard: 0, got: 0 },
    threads: [{ name: "writer", ops: writer }, { name: "reader", ops: reader }],
    expected: { got: 1001 },
    outcome: (m) => (!m.got ? "the reader has not finished" : m.got === -1 ? "the reader read a poisoned record: reused while it was being read" : `the reader read ${m.got}, a live record`),
  };
}

// One writer and one reader under read-copy-update. The reader notes the epoch between reads;
// the writer publishes, moves the epoch on, and waits until the reader has noted the new epoch
// before poisoning the old record.
export function rcu({ variant = "waits for a grace period" } = {}) {
  const waits = variant === "waits for a grace period";
  const writer = [
    { op: "store", var: "value2", imm: 1002 },
    { op: "store", var: "current", imm: 2, release: true },
    { op: "drain" },
  ];
  if (waits) writer.push({ op: "rmw_add", var: "epoch", imm: 1 }, { op: "load", reg: "s", var: "seen" }, { op: "jeq", reg: "s", imm: 1, to: 7 }, { op: "jmp", to: 4 });
  writer.push({ op: "store", var: "value1", imm: -1 });
  const reader = [
    { op: "load", reg: "e", var: "epoch" }, { op: "store", var: "seen", reg: "e" },
    { op: "load", reg: "idx", var: "current" }, { op: "loadi", reg: "v", base: "value", index: "idx" }, { op: "store", var: "got", reg: "v" },
    { op: "load", reg: "e", var: "epoch" }, { op: "store", var: "seen", reg: "e" },
  ];
  return {
    memory: { current: 1, value1: 1001, value2: -1, epoch: 0, seen: 0, got: 0 },
    threads: [{ name: "writer", ops: writer }, { name: "reader", ops: reader }],
    expected: { got: 1001 },
    outcome: (m) => (!m.got ? "the reader has not finished" : m.got === -1 ? "the reader read a poisoned record: reused during its read" : `the reader read ${m.got}, a live record`),
  };
}

// The handshake: A says ping and waits for pong; B waits for ping and says pong. Sleeping, a
// waiter takes no steps until the notify; spinning, it takes steps that do nothing.
export function handshake({ variant = "sleep and wake" } = {}) {
  const sleeping = variant !== "spin";
  // Each wait is a loop: load the word; leave if it reads `want`; otherwise sleep on it (or
  // not) and go round again. The leaving jump lands just past the loop.
  const awaitWord = (word, want) => (sleeping
    ? [{ op: "load", reg: "seen", var: word }, { op: "jeq", reg: "seen", imm: want, to: 4 }, { op: "wait", var: word, expect: want - 1 }, { op: "jmp", to: 0 }]
    : [{ op: "load", reg: "seen", var: word }, { op: "jeq", reg: "seen", imm: want, to: 3 }, { op: "jmp", to: 0 }]);
  const fix = (ops, base) => ops.map((o) => ("to" in o ? { ...o, to: o.to + base } : o));
  const a = [{ op: "store", var: "ping", imm: 1 }, { op: "notify", var: "ping" }, ...fix(awaitWord("pong", 1), 2), { op: "store", var: "done", imm: 1 }];
  const b = [...awaitWord("ping", 1), { op: "store", var: "pong", imm: 1 }, { op: "notify", var: "pong" }];
  return {
    memory: { ping: 0, pong: 0, done: 0 },
    threads: [{ name: "A", ops: a }, { name: "B", ops: b }],
    expected: { done: 1 },
    outcome: (m) => (m.done ? "one round trip: ping, then pong" : "not finished"),
  };
}

// The booking office with one seat left and two workers. Each checks, confirms, and takes the
// seat; as written, both can pass the check. By compare-and-swap, the second one's swap fails
// and its loop reads the count again, which is now zero, so it is refused.
export function challenge({ variant = "as written" } = {}) {
  const cas = variant === "compare-and-swap";
  // A worker with no seat left jumps straight to "finished"; one that takes the seat records
  // its booking first. Either way every op is done at the end.
  const book = (mine) => (cas
    ? [
      { op: "load", reg: "left", var: "seats" }, { op: "jz", reg: "left", to: 7 },
      { op: "note", text: "confirming" }, { op: "add", reg: "next", from: "left", imm: -1 },
      { op: "cas", var: "seats", expect: "left", reg: "next", out: "ok" }, { op: "jz", reg: "ok", to: 0 },
      { op: "rmw_add", var: mine, imm: 1 }, { op: "note", text: "finished" },
    ]
    : [
      { op: "load", reg: "left", var: "seats" }, { op: "jz", reg: "left", to: 6 },
      { op: "note", text: "confirming" }, { op: "add", reg: "left", imm: -1 },
      { op: "store", var: "seats", reg: "left" }, { op: "rmw_add", var: mine, imm: 1 },
      { op: "note", text: "finished" },
    ]);
  const a = book("bookedA"), b = book("bookedB");
  return {
    memory: { seats: 1, bookedA: 0, bookedB: 0 },
    threads: [{ name: "A", ops: a }, { name: "B", ops: b }],
    expected: { seats: 0 },
    outcome: (m) => (m.bookedA + m.bookedB > 1 ? `one seat, ${m.bookedA + m.bookedB} bookings: oversold, and the count reads ${m.seats}` : m.bookedA + m.bookedB === 1 ? "one seat, one booking" : "nobody has booked yet"),
  };
}

export const programs = { counter, cas, spinlock, mutex, compiler, publication, store_buffer, stack, aba, reclamation, rcu, handshake, challenge };
