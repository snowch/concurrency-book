// One worker: one instance of the kernel's module on the shared memory, with a stack of its own.
//
// Every instance of the module starts with the same stack pointer, because the pointer is a
// global in the module and each instantiation copies it. Two workers on one stack would corrupt
// each other, so the linker exports the global and this worker sets it before calling anything.
// The kernel's data is laid out by the module's start function the first time the memory is
// used, which the main instance did; later instances find it done.

self.onmessage = async ({ data }) => {
  const { module, memory, tid, args, stackTop } = data;
  try {
    const instance = await WebAssembly.instantiate(module, { env: { memory } });
    instance.exports.__stack_pointer.value = stackTop;
    self.postMessage({ type: "ready", tid });
    const t0 = performance.now();
    // Blocks on the kernel's barrier until the page calls cm_go, then does the worker's whole job.
    instance.exports.cm_run(tid, args[0], args[1], args[2]);
    self.postMessage({ type: "done", tid, ms: performance.now() - t0 });
  } catch (error) {
    self.postMessage({ type: "error", tid, message: String(error && error.message || error) });
  }
};
