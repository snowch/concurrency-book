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

  console.log(failures ? `${failures} failure(s)` : "every kernel reports what its contract promises");
  process.exit(failures ? 1 : 0);
}
