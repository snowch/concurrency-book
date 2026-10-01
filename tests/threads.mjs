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

async function runKernel(bytes, { workers, args }) {
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
  await Promise.all(done);
  const elapsedMs = performance.now() - t0;
  const results = [];
  for (let i = 0; i < 64; i++) {
    const r = main.exports.cm_result(i);
    if (r === -1) break;
    results.push(r);
  }
  await Promise.all(pool.map((w) => w.terminate()));
  return { results, elapsedMs };
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
    const plain = await Promise.race([
      runKernel(compiler, { workers: 2, args: [100000, 0, 0] }).then(() => "ended"),
      new Promise((r) => setTimeout(() => r("hung"), 1500)),
    ]);
    check(plain === "hung", "compiler: the plain loop has not ended after 1.5 s: the compiler hoisted the load");
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

  console.log(failures ? `${failures} failure(s)` : "every kernel reports what its contract promises");
  process.exit(failures ? 1 : 0);
}
