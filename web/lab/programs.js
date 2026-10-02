// The programs the deterministic traces run: what each kernel's threads do, as the model's
// operations. Each is a function of the settings a chapter or a reader chooses, and each says
// what result to expect, so a trace can report what was lost.

const NAMES = ["A", "B", "C", "D", "E", "F", "G", "H"];
const threadsOf = (n, ops) => Array.from({ length: n }, (_, i) => ({ name: NAMES[i] || `T${i}`, ops: ops(i) }));

// The counter kernel. `operation` is the page's: plain (load, add, store, per increment),
// atomic (one indivisible add per increment), split (an atomic load, an add, an atomic store:
// three steps again) or folded (one load, one add of the whole count, one store per thread).
// The first operation of each group carries `src`, the line of counter.c the group mirrors, which
// the machine view and the chapters' listings show beside it. The model ignores it.
export function counter({ threads = 2, iterations = 2, operation = "plain" } = {}) {
  const ops = [];
  if (operation === "folded") {
    ops.push(
      { op: "load", reg: "r", var: "counter", src: "for (int i = 0; i < n; i++) counter++;" },
      { op: "add", reg: "r", imm: iterations },
      { op: "store", var: "counter", reg: "r" },
    );
  } else {
    for (let i = 0; i < iterations; i++) {
      if (operation === "atomic") ops.push({ op: "rmw_add", var: "counter", imm: 1, src: "atomic_fetch_add_explicit(&atomic_counter, 1, memory_order_relaxed);" });
      else if (operation === "split") ops.push(
        { op: "load", reg: "r", var: "counter", src: "int seen = atomic_load_explicit(&atomic_counter, memory_order_relaxed);" },
        { op: "add", reg: "r", imm: 1, src: "atomic_store_explicit(&atomic_counter, seen + 1, memory_order_relaxed);" },
        { op: "store", var: "counter", reg: "r" },
      );
      else ops.push({ op: "load", reg: "r", var: "counter", src: "counter++;" }, { op: "add", reg: "r", imm: 1 }, { op: "store", var: "counter", reg: "r" });
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
      { op: "load", reg: "seen", var: "counter", src: "int seen = atomic_load_explicit(&counter, memory_order_relaxed);" },
      { op: "add", reg: "next", from: "seen", imm: 1, src: "while (!atomic_compare_exchange_weak_explicit(&counter, &seen, seen + 1, memory_order_relaxed, memory_order_relaxed)) {" },
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
      ops.push({ op: "xchg", var: "lock", imm: 1, out: "got", src: "while (atomic_exchange_explicit(&lock, 1, memory_order_acquire) == 1) spun++;" }, { op: "jnz", reg: "got", to: at });
    } else if (variant === "ttas") {
      ops.push(
        { op: "load", reg: "seen", var: "lock", src: "while (atomic_load_explicit(&lock, memory_order_relaxed) == 1) spun++;" }, { op: "jnz", reg: "seen", to: at },
        { op: "xchg", var: "lock", imm: 1, out: "got", src: "if (atomic_exchange_explicit(&lock, 1, memory_order_acquire) == 0) return spun;" }, { op: "jnz", reg: "got", to: at },
      );
    } else {
      ops.push(
        { op: "load", reg: "seen", var: "lock", src: "while (atomic_load_explicit(&lock, memory_order_relaxed) == 1) spun++;" }, { op: "jnz", reg: "seen", to: at },
        { op: "store", var: "lock", imm: 1, src: "atomic_store_explicit(&lock, 1, memory_order_relaxed);" },
      );
    }
    ops.push(
      { op: "load", reg: "r", var: "counter", src: "counter++;" }, { op: "add", reg: "r", imm: 1 }, { op: "store", var: "counter", reg: "r" },
      { op: "store", var: "lock", imm: 0, src: "atomic_store_explicit(&lock, 0, memory_order_release);" },
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
      ops.push({ op: "xchg", var: "lock", imm: 1, out: "got", src: "while (atomic_exchange_explicit(&lock, 1, memory_order_acquire) != 0) spun++;" }, { op: "jnz", reg: "got", to: at });
    } else {
      ops.push(
        { op: "cas", var: "lock", expect: 0, reg: 1, out: "ok", src: "if (atomic_compare_exchange_strong_explicit(&lock, &seen, 1, memory_order_acquire, memory_order_relaxed)) {" },     // at
        { op: "jnz", reg: "ok", to: at + 6 },                          // at+1: got it
        { op: "xchg", var: "lock", imm: 2, out: "prev", src: "seen = atomic_exchange_explicit(&lock, 2, memory_order_acquire);" },              // at+2: say somebody waits
        { op: "jz", reg: "prev", to: at + 6, src: "while (seen != 0) {" },                         // at+3: it was free after all
        { op: "wait", var: "lock", expect: 2, src: "cm_wait(&lock, 2);" },                        // at+4: sleep while 2
        { op: "jmp", to: at + 2 },                                     // at+5: woken: try again
      );
    }
    ops.push(
      { op: "load", reg: "r", var: "counter", src: "counter++;" }, { op: "add", reg: "r", imm: 1 }, { op: "store", var: "counter", reg: "r" },
    );
    if (variant === "spin") ops.push({ op: "store", var: "lock", imm: 0, src: "atomic_store_explicit(&lock, 0, memory_order_release);" });
    else {
      const end = ops.length + 4;
      ops.push(
        { op: "rmw_add", var: "lock", imm: -1, out: "prev", src: "if (atomic_fetch_sub_explicit(&lock, 1, memory_order_release) != 1) {" },
        { op: "jeq", reg: "prev", imm: 1, to: end },
        { op: "store", var: "lock", imm: 0, src: "atomic_store_explicit(&lock, 0, memory_order_release);" },
        { op: "notify", var: "lock", one: true, src: "cm_notify_one(&lock);" },
      );
    }
  }
  return { memory: { lock: 0, counter: 0 }, threads: threadsOf(threads, () => [...ops]), expected: { counter: threads * iterations } };
}

// The compiler's loop. plain: the load was hoisted out of the loop, so the loop tests a register
// forever. volatile and atomic: a load every time round. Thread B sets the flag after a step
// of busy work.
export function compiler({ variant = "plain" } = {}) {
  const loop = variant === "plain" ? "while (flag == 0) {}" : variant === "atomic" ? "while (atomic_load_explicit(&atomic_flag_word, memory_order_relaxed) == 0) {}" : "while (volatile_flag == 0) {}";
  const ret = variant === "plain" ? "return flag;" : variant === "atomic" ? "return atomic_load_explicit(&atomic_flag_word, memory_order_relaxed);" : "return volatile_flag;";
  const set = variant === "plain" ? "flag = 1;" : variant === "atomic" ? "atomic_store_explicit(&atomic_flag_word, 1, memory_order_relaxed);" : "volatile_flag = 1;";
  const waiter = variant === "plain"
    ? [{ op: "load", reg: "r", var: "flag", src: loop }, { op: "jz", reg: "r", to: 1 }, { op: "note", text: "loop ended", src: ret }]
    : [{ op: "load", reg: "r", var: "flag", src: loop }, { op: "jz", reg: "r", to: 0 }, { op: "note", text: "loop ended", src: ret }];
  const setter = [{ op: "note", text: "busy work", src: "for (volatile int i = 0; i < steps; i++) n++;" }, { op: "store", var: "flag", imm: 1, src: set }];
  return { memory: { flag: 0 }, threads: [{ name: "waiter", ops: waiter }, { name: "setter", ops: setter }], expected: { flag: 1 } };
}

// Publication: the writer stores the data, then the flag; the reader waits for the flag, then
// reads the data and keeps what it saw. Under volatile or relaxed, nothing orders the writer's
// two stores, and the model lets the flag's store reach memory first, as a weakly ordered
// processor may. A release store lets nothing before it overtake it.
export function publication({ ordering = "volatile", reorder = true } = {}) {
  const ordered = ordering === "release-acquire" || ordering === "seq_cst";
  const raise = ordering === "volatile" ? "volatile_ready = t;"
    : `atomic_store_explicit(&ready, t, memory_order_${ordering === "release-acquire" ? "release" : ordering});`;
  const poll = ordering === "volatile" ? "while (volatile_ready != t) {}"
    : `while (atomic_load_explicit(&ready, memory_order_${ordering === "release-acquire" ? "acquire" : ordering}) != t) {}`;
  const writer = [{ op: "store", var: "data", imm: 1, buffered: true, src: "data = t;" }];
  if (ordered) writer.push({ op: "store", var: "ready", imm: 1, release: true, seq_cst: ordering === "seq_cst", src: raise }, { op: "drain" });
  else if (reorder) writer.push({ op: "store", var: "ready", imm: 1, buffered: true, src: raise }, { op: "drain", var: "ready" }, { op: "drain", var: "data" });
  else writer.push({ op: "store", var: "ready", imm: 1, buffered: true, src: raise }, { op: "drain" }, { op: "drain" });
  const reader = [
    { op: "load", reg: "r", var: "ready", src: poll },
    { op: "jz", reg: "r", to: 0 },
    { op: "load", reg: "d", var: "data", src: "return data;" },
    { op: "store", var: "seen", reg: "d", src: "if (value != t) seen_stale++;" },
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
export function store_buffer({ ordering = "volatile", lines = false } = {}) {
  const half = (mine, theirs, reg) => {
    const ops = [];
    const plain = ordering === "volatile" || ordering === "fence";
    const order = ordering === "release-acquire" ? ["release", "acquire"] : [ordering, ordering];
    const store = plain ? `volatile_${mine} = 1;` : `atomic_store_explicit(&${mine}, 1, memory_order_${order[0]});`;
    const load = plain ? `return volatile_${theirs};` : `return atomic_load_explicit(&${theirs}, memory_order_${order[1]});`;
    if (ordering === "seq_cst") ops.push({ op: "store", var: mine, imm: 1, seq_cst: true, src: store });
    else if (ordering === "release-acquire") ops.push({ op: "store", var: mine, imm: 1, release: true, src: store });
    else ops.push({ op: "store", var: mine, imm: 1, buffered: true, src: store });
    if (ordering === "fence") ops.push({ op: "fence", src: "atomic_thread_fence(memory_order_seq_cst);" });
    ops.push({ op: "load", reg, var: theirs, src: load }, { op: "store", var: reg, reg });
    return ops;
  };
  return {
    memory: { x: 0, y: 0, r1: -1, r2: -1 },
    // With lines, each word sits on a line of its own, so the machine shows a store taking its
    // line when the buffer drains, and a load fetching the other's.
    ...(lines ? { lines: { lineX: ["x"], lineY: ["y"] } } : {}),
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
      { op: "load", reg: "top", var: "head", src: "int top = atomic_load_explicit(&head, memory_order_acquire);" },
      { op: "loadi", reg: "below", base: "next", index: "top", src: "int below = atomic_load_explicit(&nodes[top].next, memory_order_relaxed);" },
    ];
    if (variant === "cas") ops.push({ op: "cas", var: "head", expect: "top", reg: "below", out: "ok", src: "if (atomic_compare_exchange_weak_explicit(&head, &top, below, memory_order_acquire, memory_order_acquire)) {" }, { op: "jz", reg: "ok", to: 0 });
    else ops.push({ op: "store", var: "head", reg: "below", src: "atomic_store_explicit(&head, below, memory_order_release);" });
    ops.push({ op: "store", var: got, reg: "top", src: "return top;" });
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
  // The 64-bit head with its version is two words in the model, loaded by two operations and
  // compared and swapped together by one; the C does each with one.
  const popA = tagged
    ? [
      { op: "load", reg: "top", var: "head", src: "int64_t top = atomic_load_explicit(&tagged_head, memory_order_acquire);" }, { op: "load", reg: "tag", var: "tag" },
      { op: "loadi", reg: "below", base: "next", index: "top", src: "int below = atomic_load_explicit(&nodes[INDEX(top)].next, memory_order_relaxed);" },
      // The swing moves the tag on by one, as every swing does; the compare is on both halves.
      { op: "add", reg: "newtag", from: "tag", imm: 1, src: "if (atomic_compare_exchange_weak_explicit(&tagged_head, &top, MAKE(below, TAG(top) + 1), memory_order_acquire, memory_order_acquire)) {" },
      { op: "cas2", vars: ["head", "tag"], expect: ["top", "tag"], values: ["below", "newtag"], out: "ok" },
      { op: "jz", reg: "ok", to: 0 }, { op: "store", var: "gotA", reg: "top", src: "return INDEX(top);" },
    ]
    : [
      { op: "load", reg: "top", var: "head", src: "int top = atomic_load_explicit(&head, memory_order_acquire);" },
      { op: "loadi", reg: "below", base: "next", index: "top", src: "int below = atomic_load_explicit(&nodes[top].next, memory_order_relaxed);" },
      { op: "cas", var: "head", expect: "top", reg: "below", out: "ok", src: "if (atomic_compare_exchange_weak_explicit(&head, &top, below, memory_order_acquire, memory_order_acquire)) {" },
      { op: "jz", reg: "ok", to: 0 }, { op: "store", var: "gotA", reg: "top", src: "return top;" },
    ];
  // B is alone at the head whenever it swings it, so the model writes B's swings as stores:
  // each mirrors a compare-and-swap in the C that cannot fail.
  const bump = (reg) => (tagged ? [{ op: "rmw_add", var: "tag", imm: 1 }] : []);
  const swing = tagged
    ? "if (atomic_compare_exchange_weak_explicit(&tagged_head, &top, MAKE(below, TAG(top) + 1), memory_order_acquire, memory_order_acquire)) {"
    : "if (atomic_compare_exchange_weak_explicit(&head, &top, below, memory_order_acquire, memory_order_acquire)) {";
  const popB = [
    { op: "load", reg: "top", var: "head", src: tagged ? "int64_t top = atomic_load_explicit(&tagged_head, memory_order_acquire);" : "int top = atomic_load_explicit(&head, memory_order_acquire);" },
    { op: "loadi", reg: "below", base: "next", index: "top", src: tagged ? "int below = atomic_load_explicit(&nodes[INDEX(top)].next, memory_order_relaxed);" : "int below = atomic_load_explicit(&nodes[top].next, memory_order_relaxed);" },
    { op: "store", var: "head", reg: "below", src: swing }, ...bump(), { op: "note", text: "B holds the node it popped", src: "if (atomic_exchange_explicit(&nodes[n].in_stack, 0, memory_order_relaxed) == 0) bad++;" },
  ];
  const pushB = [
    { op: "load", reg: "t", var: "head", src: tagged ? "int64_t top = atomic_load_explicit(&tagged_head, memory_order_relaxed);" : "int top = atomic_load_explicit(&head, memory_order_relaxed);" },
    { op: "store", var: "next1", reg: "t", src: tagged ? "atomic_store_explicit(&nodes[n].next, INDEX(top), memory_order_relaxed);" : "atomic_store_explicit(&nodes[n].next, top, memory_order_relaxed);" },
    { op: "store", var: "head", imm: 1, src: tagged ? "} while (!atomic_compare_exchange_weak_explicit(&tagged_head, &top, MAKE(n, TAG(top) + 1), memory_order_release, memory_order_relaxed));" : "} while (!atomic_compare_exchange_weak_explicit(&head, &top, n, memory_order_release, memory_order_relaxed));" }, ...bump(),
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
  // The exchange that publishes is a release store and a drain in the model: the old index it
  // returns is known to the writer already, since it is alone in writing `current`.
  const writer = [
    { op: "store", var: "value2", imm: 1002, src: "atomic_store_explicit(&values[next], 1000 + next, memory_order_relaxed);" },
    { op: "store", var: "current", imm: 2, release: true, src: "int old = atomic_exchange_explicit(&current, next, memory_order_seq_cst);" },
    { op: "drain" },
  ];
  if (hazards) writer.push({ op: "load", reg: "h", var: "hazard", src: "while (atomic_load_explicit(&hazard[r], memory_order_seq_cst) == old) {" }, { op: "jeq", reg: "h", imm: 1, to: 3 });
  writer.push({ op: "store", var: "value1", imm: -1, src: "atomic_store_explicit(&values[old], POISON, memory_order_relaxed);" });
  const reader = hazards
    ? [
      { op: "load", reg: "idx", var: "current", src: "idx = atomic_load_explicit(&current, memory_order_acquire);" }, { op: "store", var: "hazard", reg: "idx", seq_cst: true, src: "atomic_store_explicit(&hazard[r], idx, memory_order_seq_cst);" },
      { op: "load", reg: "check", var: "current", src: "if (atomic_load_explicit(&current, memory_order_seq_cst) == idx) break;" }, { op: "jeq", reg: "check", imm: 1, to: 5 }, { op: "jmp", to: 0 },
      { op: "loadi", reg: "v", base: "value", index: "idx", src: "int ok = atomic_load_explicit(&values[idx], memory_order_relaxed) == 1000 + idx;" }, { op: "store", var: "hazard", imm: 0, src: "atomic_store_explicit(&hazard[r], 0, memory_order_release);" }, { op: "store", var: "got", reg: "v", src: "return ok;" },
    ]
    : [
      { op: "load", reg: "idx", var: "current", src: "int idx = atomic_load_explicit(&current, memory_order_acquire);" }, { op: "loadi", reg: "v", base: "value", index: "idx", src: "return atomic_load_explicit(&values[idx], memory_order_relaxed) == 1000 + idx;" }, { op: "store", var: "got", reg: "v" },
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
    { op: "store", var: "value2", imm: 1002, src: "atomic_store_explicit(&values[next], 1000 + next, memory_order_relaxed);" },
    { op: "store", var: "current", imm: 2, release: true, src: "int old = atomic_exchange_explicit(&current, next, memory_order_acq_rel);" },
    { op: "drain" },
  ];
  if (waits) writer.push({ op: "rmw_add", var: "epoch", imm: 1, src: "int e = atomic_fetch_add_explicit(&epoch, 1, memory_order_seq_cst) + 1;" }, { op: "load", reg: "s", var: "seen", src: "while (atomic_load_explicit(&seen[r], memory_order_seq_cst) < e) {" }, { op: "jeq", reg: "s", imm: 1, to: 7 }, { op: "jmp", to: 4 });
  writer.push({ op: "store", var: "value1", imm: -1, src: "atomic_store_explicit(&values[old], POISON, memory_order_relaxed);" });
  const quiescent = "atomic_store_explicit(&seen[r], atomic_load_explicit(&epoch, memory_order_seq_cst), memory_order_seq_cst);";
  const reader = [
    { op: "load", reg: "e", var: "epoch", src: quiescent }, { op: "store", var: "seen", reg: "e" },
    { op: "load", reg: "idx", var: "current", src: "int idx = atomic_load_explicit(&current, memory_order_acquire);" }, { op: "loadi", reg: "v", base: "value", index: "idx", src: "return atomic_load_explicit(&values[idx], memory_order_relaxed) == 1000 + idx;" }, { op: "store", var: "got", reg: "v" },
    { op: "load", reg: "e", var: "epoch", src: quiescent }, { op: "store", var: "seen", reg: "e" },
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
    ? [{ op: "load", reg: "seen", var: word, src: "while ((seen = atomic_load_explicit(word, memory_order_acquire)) < want) {" }, { op: "jeq", reg: "seen", imm: want, to: 4 }, { op: "wait", var: word, expect: want - 1, src: "cm_wait(word, seen);" }, { op: "jmp", to: 0 }]
    : [{ op: "load", reg: "seen", var: word, src: "while (atomic_load_explicit(word, memory_order_acquire) < want) {" }, { op: "jeq", reg: "seen", imm: want, to: 3 }, { op: "jmp", to: 0 }]);
  const fix = (ops, base) => ops.map((o) => ("to" in o ? { ...o, to: o.to + base } : o));
  const say = { store: "atomic_store_explicit(word, round, memory_order_release);", notify: "cm_notify(word);" };
  const a = [{ op: "store", var: "ping", imm: 1, src: say.store }, { op: "notify", var: "ping", src: say.notify }, ...fix(awaitWord("pong", 1), 2), { op: "store", var: "done", imm: 1, src: "if (tid == 0) atomic_store_explicit(&rounds_done, a, memory_order_relaxed);" }];
  const b = [...awaitWord("ping", 1), { op: "store", var: "pong", imm: 1, src: say.store }, { op: "notify", var: "pong", src: say.notify }];
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
      { op: "load", reg: "left", var: "seats", src: "int left = atomic_load_explicit(&atomic_seats, memory_order_relaxed);" }, { op: "jz", reg: "left", to: 7, src: "while (left > 0) {" },
      { op: "note", text: "confirming", src: "confirm(steps);" }, { op: "add", reg: "next", from: "left", imm: -1, src: "if (atomic_compare_exchange_weak_explicit(&atomic_seats, &left, left - 1, memory_order_relaxed, memory_order_relaxed)) {" },
      { op: "cas", var: "seats", expect: "left", reg: "next", out: "ok" }, { op: "jz", reg: "ok", to: 0 },
      { op: "rmw_add", var: mine, imm: 1, src: "mine++;" }, { op: "note", text: "finished", src: "if (!ok) break;" },
    ]
    : [
      { op: "load", reg: "left", var: "seats", src: "if (seats > 0) {" }, { op: "jz", reg: "left", to: 6 },
      { op: "note", text: "confirming", src: "confirm(steps);" }, { op: "add", reg: "left", imm: -1, src: "seats--;" },
      { op: "store", var: "seats", reg: "left" }, { op: "rmw_add", var: mine, imm: 1, src: "mine++;" },
      { op: "note", text: "finished", src: "if (!ok) break;" },
    ]);
  const a = book("bookedA"), b = book("bookedB");
  return {
    memory: { seats: 1, bookedA: 0, bookedB: 0 },
    threads: [{ name: "A", ops: a }, { name: "B", ops: b }],
    expected: { seats: 0 },
    outcome: (m) => (m.bookedA + m.bookedB > 1 ? `one seat, ${m.bookedA + m.bookedB} bookings: oversold, and the count reads ${m.seats}` : m.bookedA + m.bookedB === 1 ? "one seat, one booking" : "nobody has booked yet"),
  };
}

// Counters on a cache line. Each thread adds to a counter of its own with an atomic add, as the
// kernel's `bump` does, and the layout says where the counters live: all in one word, side by
// side in one line (sixteen words to a line, as in the kernel's own-line stride), or one per
// line. The words are named as the kernel's slots are: worker 0's counter is slot0, and in the
// own-line layout worker 1's is slot16. The counts cannot be lost; what the model shows is the
// line each add needs, and the round trips that moving it costs.
export function sharing({ threads = 2, iterations = 2, layout = "same line" } = {}) {
  const slot = (i) => (layout === "same word" ? 0 : layout === "own line" ? i * 16 : i);
  const memory = {};
  const lines = {};
  for (let i = 0; i < threads; i++) {
    const name = `slot${slot(i)}`;
    memory[name] = 0;
    const line = `line${Math.floor(slot(i) / 16)}`;
    (lines[line] ||= []).includes(name) || lines[line].push(name);
  }
  const ops = (i) => Array.from({ length: iterations }, () => ({ op: "rmw_add", var: `slot${slot(i)}`, imm: 1, src: "atomic_fetch_add_explicit(slot, 1, memory_order_relaxed);" }));
  return {
    memory,
    lines,
    threads: threadsOf(threads, ops),
    expected: { slot0: layout === "same word" ? threads * iterations : iterations },
  };
}

export const programs = { counter, cas, spinlock, mutex, compiler, publication, store_buffer, stack, aba, reclamation, rcu, handshake, challenge, sharing };
