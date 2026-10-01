// The shared counter (experiments/counter): workers increment one variable, plainly or
// atomically, and the page compares the count with what it should be.
//
// Live: the compiled kernel on real workers; the result is the kernel's, read from its memory.
// Trace: a model of each worker's load, add and store under a schedule the reader chooses.
// Native: the commands for the same kernel on pthreads.

import { Runtime } from "./runtime.js";
import { TraceView } from "./trace-view.js";
import { programs } from "./programs.js";
import { el, fmt, ms } from "./shell.js";

//: The kernel's `b` argument for each operation the page offers (counter.c, cm_run).
const OPERATIONS = { plain: 0, atomic: 1, folded: 2, split: 3 };

export async function mount(shell) {
  const { contract, config } = shell;

  // -- live ----------------------------------------------------------------------------
  const live = shell.panel("live");
  const bar = el("div", "run-bar");
  const runButton = shell.button("Run", { primary: true });
  bar.append(runButton);
  const hint = el("span", "run-hint", "Runs the kernel on fresh workers each time; the counter is read from their shared memory.");
  bar.append(hint);
  live.append(bar);
  const out = el("div", "live-out");
  live.append(out);
  const bars = el("div", "bars");
  live.append(bars);
  const workerTimes = el("p", "note");
  live.append(workerTimes);

  let runtime = null;
  const run = async () => {
    const v = shell.values();
    const expected = v.workers * v.iterations;
    shell.busy(true);
    shell.root.dataset.state = "running";
    try {
      runtime ||= await Runtime.for(contract.name);
      const r = await runtime.run({ workers: v.workers, args: [v.iterations, OPERATIONS[v.operation], 0], onStatus: (s) => shell.status(s) });
      // The plain and folded increments count in `counter`; the atomic and split ones in
      // `atomic_counter`: result 0 and result 1 of the kernel.
      const observed = v.operation === "atomic" || v.operation === "split" ? r.results[1] : r.results[0];
      const lost = expected - observed;
      shell.results(out, [
        { name: "expected", label: "Expected", value: expected, hint: `${fmt(v.workers)} × ${fmt(v.iterations)}` },
        { name: "observed", label: "Observed", value: observed, hint: `the ${v.operation} counter` },
        { name: "lost", label: "Lost", value: lost, hint: lost === 0 ? "nothing lost" : `${((100 * lost) / expected).toFixed(1)}% of the increments`, className: lost === 0 ? "good" : "bad" },
        { name: "elapsed", label: "Elapsed", value: Math.round(r.elapsedMs * 1000) / 1000, text: ms(r.elapsedMs), hint: "wall time, barrier to last worker" },
      ]);
      bars.replaceChildren();
      shell.bar(bars, { value: observed, of: expected, label: "observed / expected" });
      const per = r.workerMs.map((t) => (t === null ? "?" : t.toFixed(1)));
      workerTimes.textContent = `Each worker, inside the kernel: ${per.join(" / ")} ms. ` +
        `A run is one observation on this device, not a measurement of the hardware; run it again and the numbers move.`;
      shell.root.dataset.operation = v.operation;
      shell.root.dataset.workers = String(v.workers);
      shell.status(`done: ${fmt(observed)} of ${fmt(expected)}`);
      shell.root.dataset.state = "done";
    } catch (error) {
      out.replaceChildren(el("p", "lab-error", `The run failed: ${error.message}`));
      shell.status("failed");
      shell.root.dataset.state = "error";
    } finally {
      shell.busy(false);
    }
  };
  runButton.addEventListener("click", run);

  // -- trace ---------------------------------------------------------------------------
  const trace = shell.panel("trace");
  const traceControls = el("div", "trace-controls");
  const perThread = el("select");
  perThread.name = "trace-iterations";
  for (const n of [1, 2, 3, 4, 5]) {
    const o = el("option", "", String(n));
    o.value = String(n);
    if (n === 2) o.selected = true;
    perThread.append(o);
  }
  const perLabel = el("label");
  perLabel.append(el("span", "control-label", "Increments per thread in the trace"), perThread);
  traceControls.append(perLabel);
  trace.append(traceControls);
  const stepper = el("div", "stepper");
  trace.append(stepper);
  const view = new TraceView(stepper, {
    program: () => {
      const v = shell.values();
      return programs.counter({ threads: Math.min(4, v.workers), iterations: Number(perThread.value), operation: v.operation });
    },
    caption: "A model of the operations the source hides, interleaved as the schedule says. It is not the compiled code: the live run is. Threads beyond four are left out of the trace.",
  });
  perThread.addEventListener("change", () => view.reset());

  // -- native --------------------------------------------------------------------------
  const native = shell.panel("native");
  const drawNative = () => {
    const v = shell.values();
    shell.commands(native, [
      "# the same kernel, on pthreads; Appendix A has what you need installed",
      "make native KERNEL=counter",
      `native/build/counter ${v.workers} ${v.iterations} ${OPERATIONS[v.operation]}`,
    ], "The harness prints result[0], the plain counter, and result[1], the atomic one, then the wall time. Run it more than once: a count that can be lost changes every time.");
  };
  drawNative();

  shell.on("change", () => {
    view.reset();
    drawNative();
    if (shell.mode === "live" && config.autorun !== "false") run();
  });
  shell.on("mode", (m) => { if (m === "live" && !shell.root.dataset.observed && config.autorun !== "false") run(); });
  if (shell.mode === "live" && config.autorun !== "false") run();
}
