// The laboratory's runtime: a kernel compiled to WebAssembly, run on real threads.
//
// Every experiment's kernel (experiments/<name>/<name>.c) exports the same four functions
// (experiments/cm.h). This file loads a kernel's module once, and for each run creates one
// shared memory, instantiates the module in as many Web Workers as the reader asked for, gives
// each worker a stack of its own, opens the kernel's start barrier, and collects what the
// kernel reports. The workers run the compiled C; nothing here computes a result.
//
// A page can only create shared memory when it is cross-origin isolated. `capabilities()` says
// whether this one is; the shell offers the deterministic trace instead when it is not.

//: Bytes of stack each worker's instance gets, carved from the shared memory above the kernel's
//: data. A kernel keeps nothing large on its stack.
const STACK_BYTES = 64 * 1024;
//: The shared memory's size in 64 KiB pages: enough for every kernel's data and sixteen stacks.
//: The maximum must match what tools/lower.py told the linker (--max-memory), or the import fails.
const INITIAL_PAGES = 64;
const MAX_PAGES = 1024;

export function capabilities() {
  const sharedMemory = typeof SharedArrayBuffer !== "undefined";
  const isolated = globalThis.crossOriginIsolated === true;
  const workers = typeof Worker !== "undefined";
  const cores = (typeof navigator !== "undefined" && navigator.hardwareConcurrency) || 0;
  // A browser that is not isolated hides SharedArrayBuffer altogether, so isolation is checked
  // first: it is the reason, and the missing constructor is the consequence.
  let why = "";
  if (!workers) why = "this browser has no Web Workers";
  else if (!isolated) why = "this page is not cross-origin isolated, so the browser withholds shared memory";
  else if (!sharedMemory) why = "this browser does not offer shared memory";
  return { live: !why, why, sharedMemory, isolated, cores };
}

const modules = new Map();

export class Runtime {
  constructor(name, module) {
    this.name = name;
    this.module = module;
  }

  // The kernel's module, compiled once per page and shared by every run.
  static async for(name) {
    if (!modules.has(name)) {
      const url = new URL(`${name}.wasm`, import.meta.url);
      modules.set(name, (async () => {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`could not fetch ${name}.wasm: ${response.status}`);
        const module = await WebAssembly.compile(await response.arrayBuffer());
        return new Runtime(name, module);
      })());
    }
    return modules.get(name);
  }

  /**
   * One run: `workers` instances of the kernel on `workers` Web Workers, each calling
   * `cm_run(tid, a, b, c)`, started together by the kernel's own barrier. Resolves with the
   * results the kernel reports, the wall time from the barrier opening to the last worker
   * finishing, and each worker's own time inside cm_run. Rejects if a worker fails or the run
   * exceeds `timeoutMs`, after terminating every worker.
   */
  async run({ workers, args = [0, 0, 0], timeoutMs = 20000, onStatus = () => {} }) {
    const caps = capabilities();
    if (!caps.live) throw new Error(`cannot run live: ${caps.why}`);
    const count = Math.max(1, Math.min(64, workers | 0));
    const memory = new WebAssembly.Memory({ initial: INITIAL_PAGES, maximum: MAX_PAGES, shared: true });
    // The main instance runs the module's start function, which lays out the kernel's data, and
    // is the one the results are read from. It never calls cm_run: a page's main thread may not
    // block, and a worker that has not reached the barrier would make it.
    const main = await WebAssembly.instantiate(this.module, { env: { memory } });
    const heap = main.exports.__heap_base.value;
    if (heap + (count + 1) * STACK_BYTES > memory.buffer.byteLength) {
      throw new Error("not enough shared memory for that many workers");
    }
    main.exports.cm_reset();
    const pool = [];
    const stop = () => { for (const w of pool) w.terminate(); };
    try {
      onStatus(`starting ${count} worker${count === 1 ? "" : "s"}`);
      const ready = [];
      const finished = [];
      const times = new Array(count).fill(null);
      for (let tid = 0; tid < count; tid++) {
        const worker = new Worker(new URL("worker.js", import.meta.url), { type: "module" });
        pool.push(worker);
        let onReady, onDone, onFail;
        ready.push(new Promise((res, rej) => { onReady = res; onFail = rej; }));
        finished.push(new Promise((res, rej) => { onDone = res; worker.addEventListener("error", (e) => rej(new Error(e.message || "a worker failed"))); }));
        worker.addEventListener("message", ({ data }) => {
          if (data.type === "ready") onReady();
          else if (data.type === "done") { times[tid] = data.ms; onDone(); }
          else if (data.type === "error") { onFail(new Error(data.message)); onDone(); }
        });
        worker.addEventListener("error", (e) => onFail(new Error(e.message || "a worker failed")));
        const [a = 0, b = 0, c = 0] = args;
        worker.postMessage({ module: this.module, memory, tid, args: [a | 0, b | 0, c | 0], stackTop: heap + (tid + 1) * STACK_BYTES });
      }
      await Promise.all(ready);
      onStatus("running");
      // Every worker is inside cm_run, asleep on the barrier. Open it, and time until the last
      // one reports back; the report crosses a message port, so this includes a little of the
      // page's own latency, which the chapter says.
      const t0 = performance.now();
      main.exports.cm_go();
      let timer;
      const timeout = new Promise((_, rej) => { timer = setTimeout(() => rej(new Error(`the run did not finish within ${timeoutMs / 1000} s`)), timeoutMs); });
      try {
        await Promise.race([Promise.all(finished), timeout]);
      } finally {
        clearTimeout(timer);
      }
      const elapsedMs = performance.now() - t0;
      const results = [];
      for (let i = 0; i < 64; i++) {
        const r = main.exports.cm_result(i);
        if (r === -1) break;
        results.push(r);
      }
      return { results, elapsedMs, workerMs: times, workers: count, cores: caps.cores };
    } finally {
      stop();
    }
  }
}
