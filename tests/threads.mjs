// Every kernel, on real threads under Node, held to what its contract promises.
//
//     node tests/threads.mjs [_build/html]
//
// The page runs a kernel on Web Workers sharing one memory (web/lab/runtime.js); this runs the
// same module the same way on Node's worker threads, with the same per-worker stacks. It checks
// what the page can only observe: that an atomic counter is exact, that a plain one is never
// more than exact, and that one worker alone is exact whatever the operation.

import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads";
import { readFileSync } from "node:fs";
import path from "node:path";

const STACK = 64 * 1024;

//: Runs that hit their timeout, which is a failure unless the check expected one.
let timeouts = 0;

async function runKernel(bytes, { workers, args, timeoutMs = 60000, expectTimeout = false }) {
  const module = await WebAssembly.compile(bytes);
  const memory = new WebAssembly.Memory({ initial: 64, maximum: 1024, shared: true });
  const main = await WebAssembly.instantiate(module, { env: { memory } });
  const heap = main.exports.__heap_base.value;
  main.exports.cm_reset();
  const done = [];
  const pool = [];
  for (let tid = 0; tid < workers; tid++) {
    const w = new Worker(new URL(import.meta.url), { workerData: { module, memory, tid, args, stackTop: heap + STACK * (tid + 1) } });
    pool.push(w);
    done.push(new Promise((res, rej) => {
      w.on("message", (m) => (m.type === "ready" ? null : res(m)));
      w.on("error", rej);
    }));
  }
  // Each worker is inside cm_run, asleep on the barrier, once it has said it is ready.
  await Promise.all(pool.map((w) => new Promise((res) => w.on("message", (m) => m.type === "ready" && res()))));
  const t0 = performance.now();
  main.exports.cm_go();
  // A kernel that never reports is a finding, not a reason for CI to wait: after the timeout
  // the workers are terminated and the run says it timed out. The page's runtime does the same.
  let timer;
  const timedOut = await Promise.race([
    Promise.all(done).then(() => false),
    new Promise((res) => { timer = setTimeout(() => res(true), timeoutMs); }),
  ]);
  clearTimeout(timer);
  if (timedOut && !expectTimeout) {
    timeouts++;
    console.log(`  FAIL a run of ${workers} workers with args ${JSON.stringify(args)} had not reported after ${timeoutMs} ms`);
  }
  const elapsedMs = performance.now() - t0;
  const results = [];
  if (!timedOut) {
    for (let i = 0; i < 64; i++) {
      const r = main.exports.cm_result(i);
      if (r === -1) break;
      results.push(r);
    }
  }
  await Promise.all(pool.map((w) => w.terminate()));
  return { results, elapsedMs, timedOut };
}

if (!isMainThread) {
  const { module, memory, tid, args, stackTop } = workerData;
  const inst = await WebAssembly.instantiate(module, { env: { memory } });
  inst.exports.__stack_pointer.value = stackTop;
  parentPort.postMessage({ type: "ready" });
  inst.exports.cm_run(tid, args[0], args[1], args[2]);
  parentPort.postMessage({ type: "done" });
} else {
  const site = path.resolve(process.argv[2] || "_build/html");
  const bytes = (name) => readFileSync(path.join(site, "lab", `${name}.wasm`));
  let failures = 0;
  const check = (ok, what) => { console.log(`${ok ? "  ok  " : "  FAIL"} ${what}`); if (!ok) failures++; };
  process.on("exit", () => { if (timeouts && !process.exitCode) process.exitCode = 1; });

  // counter: plain and atomic increments.
  {
    const counter = bytes("counter");
    const one = await runKernel(counter, { workers: 1, args: [100000, 0, 0] });
    check(one.results[0] === 100000, `counter: one worker, plain: ${one.results[0]} of 100000 (exact: nothing to race with)`);
    const plain = await runKernel(counter, { workers: 4, args: [500000, 0, 0] });
    check(plain.results[0] <= 2000000 && plain.results[0] > 0, `counter: four workers, plain: ${plain.results[0]} of 2000000 (never more than expected)`);
    const atomic = await runKernel(counter, { workers: 4, args: [500000, 1, 0] });
    check(atomic.results[1] === 2000000, `counter: four workers, atomic: ${atomic.results[1]} of 2000000 (exact)`);
    check(atomic.results[0] === 0, "counter: the plain counter stays at zero during an atomic run");
    console.log(`       (plain lost ${2000000 - plain.results[0]} on this machine; ${plain.elapsedMs.toFixed(1)} ms plain, ${atomic.elapsedMs.toFixed(1)} ms atomic)`);
  }

  // cas: exact by compare-and-swap, with retries counted; exact under the lock built from it.
  {
    const cas = bytes("cas");
    const loop = await runKernel(cas, { workers: 4, args: [100000, 0, 0] });
    check(loop.results[0] === 400000, `cas: four workers by compare-and-swap: ${loop.results[0]} of 400000 (exact; ${loop.results[1]} retries, most ${loop.results[3]})`);
    check(loop.results[3] <= loop.results[1], "cas: one worker's retries never exceed the total");
    const lock = await runKernel(cas, { workers: 4, args: [100000, 1, 0] });
    check(lock.results[2] === 400000, `cas: four workers under the compare-and-swap lock: ${lock.results[2]} of 400000 (exact)`);
  }

  // spinlock: test-and-set and test-then-test-and-set are exact; test-then-set is not a lock.
  {
    const spin = bytes("spinlock");
    const tas = await runKernel(spin, { workers: 4, args: [10000, 0, 10] });
    check(tas.results[0] === 40000, `spinlock: test-and-set: ${tas.results[0]} of 40000 (exact; ${tas.results[1]} spins)`);
    const ttas = await runKernel(spin, { workers: 4, args: [10000, 1, 10] });
    check(ttas.results[0] === 40000, `spinlock: test then test-and-set: ${ttas.results[0]} of 40000 (exact; ${ttas.results[1]} spins)`);
    const broken = await runKernel(spin, { workers: 4, args: [10000, 2, 10] });
    check(broken.results[0] <= 40000 && broken.results[0] > 0, `spinlock: test-then-set: ${broken.results[0]} of 40000 (never more; lost ${40000 - broken.results[0]} here)`);
    const one = await runKernel(spin, { workers: 1, args: [10000, 0, 0] });
    check(one.results[0] === 10000 && one.results[1] === 0, "spinlock: one worker never spins");
  }

  // mutex: every lock is exact; the sleeping lock sleeps and never spins.
  {
    const mutex = bytes("mutex");
    const spin = await runKernel(mutex, { workers: 8, args: [1000, 0, 1000] });
    check(spin.results[0] === 8000 && spin.results[2] === 0, `mutex: spinning: ${spin.results[0]} of 8000, ${spin.results[1]} spins, no sleeps`);
    const sleep = await runKernel(mutex, { workers: 8, args: [1000, 1, 1000] });
    check(sleep.results[0] === 8000 && sleep.results[1] === 0, `mutex: sleeping: ${sleep.results[0]} of 8000, ${sleep.results[2]} sleeps, no spins`);
    const both = await runKernel(mutex, { workers: 8, args: [1000, 2, 1000] });
    check(both.results[0] === 8000, `mutex: spin then sleep: ${both.results[0]} of 8000, ${both.results[1]} spins, ${both.results[2]} sleeps`);
  }

  // compiler: the volatile and atomic loops end on the flag; the plain loop never ends.
  {
    const compiler = bytes("compiler");
    const vol = await runKernel(compiler, { workers: 2, args: [100000, 1, 0] });
    check(vol.results[0] === 1 && vol.results[1] === 1, "compiler: the volatile loop ends on the flag");
    const atomic = await runKernel(compiler, { workers: 2, args: [100000, 2, 0] });
    check(atomic.results[0] === 1 && atomic.results[1] === 1, "compiler: the atomic loop ends on the flag");
    const plain = await runKernel(compiler, { workers: 2, args: [100000, 0, 0], timeoutMs: 1500, expectTimeout: true });
    check(plain.timedOut, "compiler: the plain loop has not ended after 1.5 s: the compiler hoisted the load");
  }

  // publication: with a release and an acquire, or sequential consistency, the data always arrives
  // with the flag, on every host; without them the count is the host's.
  {
    const pub = bytes("publication");
    for (const [name, b] of [["volatile", 0], ["relaxed", 1]]) {
      const r = await runKernel(pub, { workers: 2, args: [50000, b, 0] });
      check(r.results[0] === 50000 && r.results[1] >= 0, `publication ${name}: ${r.results[1]} stale reads of 50000 (whatever this host allows)`);
    }
    for (const [name, b] of [["release-acquire", 2], ["seq_cst", 3]]) {
      const r = await runKernel(pub, { workers: 2, args: [50000, b, 0] });
      check(r.results[0] === 50000 && r.results[1] === 0, `publication ${name}: no stale read in 50000 trials`);
    }
  }

  // store buffer: sequential consistency and a fence forbid both-zero; the others leave it to the host.
  {
    const sb = bytes("store_buffer");
    for (const [name, b] of [["volatile", 0], ["relaxed", 1], ["release-acquire", 2]]) {
      const r = await runKernel(sb, { workers: 2, args: [50000, b, 0] });
      check(r.results[0] === 50000 && r.results.slice(1).reduce((a, c) => a + c, 0) === 50000, `store buffer ${name}: ${r.results[1]} of 50000 trials loaded both zero (whatever this host allows)`);
    }
    for (const [name, b] of [["seq_cst", 3], ["fence", 4]]) {
      const r = await runKernel(sb, { workers: 2, args: [50000, b, 0] });
      check(r.results[0] === 50000 && r.results[1] === 0, `store buffer ${name}: never both zero in 50000 trials`);
    }
  }

  // sharing: every layout counts exactly; the time is the page's business.
  {
    const sharing = bytes("sharing");
    for (const layout of [0, 1, 2, 3]) {
      const r = await runKernel(sharing, { workers: 4, args: [200000, layout, 0] });
      check(r.results[0] === 800000, `sharing layout ${layout}: ${r.results[0]} of 800000 (exact; ${r.elapsedMs.toFixed(1)} ms)`);
    }
  }

  // stack: the compare-and-swap pop accounts for every node; the broken one need not.
  {
    const stack = bytes("stack");
    const cas = await runKernel(stack, { workers: 4, args: [4000, 0, 0] });
    const [popped, remaining, twice, once] = cas.results;
    check(twice === 0 && once + remaining === 16000 && popped === once, `stack cas: ${popped} popped, ${remaining} left, none twice, none lost`);
    const broken = await runKernel(stack, { workers: 4, args: [4000, 1, 0] });
    // A broken pop corrupts the links, so a walk of what is left may count nodes that were also
    // popped: the accounting can come out negative, which is itself the corruption showing. The
    // kernel promises nothing here beyond counts that are counts.
    const lost = 16000 - broken.results[3] - broken.results[2] - broken.results[1];
    const account = lost >= 0 ? `${lost} lost` : `a walk of the stack counted ${-lost} more nodes than were pushed: corrupted links`;
    check(broken.results.every((x) => x >= 0), `stack broken: ${broken.results[2]} popped twice, ${account} (whatever this host allows)`);
  }

  // aba: the tagged head never pops a node that was not in the stack and keeps its three nodes.
  {
    const aba = bytes("aba");
    const plain = await runKernel(aba, { workers: 4, args: [100000, 0, 0] });
    check(plain.results[0] > 0, `aba plain: ${plain.results[1]} pops of a node not in the stack in ${plain.results[0]} (whatever this host allows); ${plain.results[2]} in the stack at the end`);
    const tagged = await runKernel(aba, { workers: 4, args: [100000, 1, 0] });
    check(tagged.results[1] === 0 && tagged.results[2] === 3, `aba tagged: no pop of a node not in the stack in ${tagged.results[0]}; three nodes at the end`);
  }

  // reclamation and rcu: with protection, no reader ever reads a reused record.
  {
    const rec = bytes("reclamation");
    const none = await runKernel(rec, { workers: 4, args: [100000, 0, 3] });
    check(none.results[0] > 0 && none.results[2] === 100000, `reclamation none: ${none.results[1]} poisoned reads of ${none.results[0]} (whatever this host allows)`);
    const hazard = await runKernel(rec, { workers: 4, args: [100000, 1, 3] });
    check(hazard.results[1] === 0 && hazard.results[2] === 100000, `reclamation hazard pointers: no poisoned read in ${hazard.results[0]}; the writer waited ${hazard.results[3]} times`);
    const rcu = bytes("rcu");
    const now = await runKernel(rcu, { workers: 4, args: [100000, 0, 3] });
    check(now.results[2] === 100000, `rcu reuses at once: ${now.results[1]} poisoned reads of ${now.results[0]} (whatever this host allows)`);
    const grace = await runKernel(rcu, { workers: 4, args: [100000, 1, 3] });
    check(grace.results[1] === 0 && grace.results[2] === 100000, `rcu grace period: no poisoned read in ${grace.results[0]}; the writer waited ${grace.results[3]} times`);
  }

  // queue: sequenced slots deliver every item once and in order; the other designs need not.
  {
    const queue = bytes("queue");
    const good = await runKernel(queue, { workers: 4, args: [50000, 2, 2], timeoutMs: 60000 });
    const [enq, deq, unwritten, disordered, dup, dropped] = good.results;
    check(deq - unwritten + dropped === 100000 && unwritten === 0 && disordered === 0 && dup === 0 && enq + dropped === 100000,
      `queue sequenced: ${deq} dequeued of ${enq}, none unwritten, none out of order, none twice, ${dropped} dropped`);
    for (const [name, b] of [["one-to-one ring", 0], ["claimed positions", 1]]) {
      const r = await runKernel(queue, { workers: 4, args: [50000, b, 2], timeoutMs: 60000 });
      check(r.results.every((x) => x >= 0), `queue ${name}: ${r.results[2]} unwritten slots, ${r.results[3]} out of order, ${100000 - (r.results[1] - r.results[2]) - r.results[5]} lost (whatever this host allows)`);
    }
  }

  // contention: every layout counts exactly at every worker count.
  {
    const contention = bytes("contention");
    for (const layout of [0, 1, 2]) {
      for (const workers of [1, 4]) {
        const r = await runKernel(contention, { workers, args: [200000, layout, 0] });
        check(r.results[0] === workers * 200000, `contention layout ${layout}, ${workers} worker(s): ${r.results[0]} (exact; ${r.elapsedMs.toFixed(1)} ms)`);
      }
    }
  }

  // handshake: every round trip completes; sleeping never spins and spinning never sleeps.
  {
    const hs = bytes("handshake");
    const sleep = await runKernel(hs, { workers: 2, args: [2000, 0, 0], timeoutMs: 60000 });
    check(sleep.results[0] === 2000 && sleep.results[2] === 0, `handshake sleep and wake: 2000 round trips, ${sleep.results[1]} sleeps, no spins (${(1e6 * sleep.elapsedMs / 2000).toFixed(0)} ns per round trip)`);
    const spin = await runKernel(hs, { workers: 2, args: [2000, 1, 0] });
    check(spin.results[0] === 2000 && spin.results[1] === 0, `handshake spin: 2000 round trips, ${spin.results[2]} spins, no sleeps (${(1e6 * spin.elapsedMs / 2000).toFixed(0)} ns per round trip)`);
  }

  // challenge: compare-and-swap and the lock never oversell; the others are the host's.
  {
    const ch = bytes("challenge");
    for (const [name, b] of [["as written", 0], ["with atomics", 1]]) {
      const r = await runKernel(ch, { workers: 4, args: [100000, b, 100] });
      check(r.results[0] === 100000 && r.results[1] >= 100000, `challenge ${name}: ${r.results[1]} booked of 100000 (oversold by ${r.results[1] - 100000}; whatever this host allows)`);
    }
    for (const [name, b] of [["compare-and-swap", 2], ["under a lock", 3]]) {
      const r = await runKernel(ch, { workers: 4, args: [100000, b, 100] });
      check(r.results[1] === 100000 && r.results[2] === 0, `challenge ${name}: exactly 100000 booked, none left`);
    }
  }

  console.log(failures ? `${failures} failure(s)` : "every kernel reports what its contract promises");
  process.exit(failures ? 1 : 0);
}
