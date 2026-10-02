// What every experiment's panel has in common: a live run that maps the controls to the
// kernel's arguments and draws tiles from what it reports, a trace over a program built from
// the same controls, and the native commands. An experiment's module describes its own in a
// spec and lets this build the three panels; a module with something more to draw adds it in
// the spec's `after`.
//
//   standardPanel(shell, {
//     workers: (v) => number,                    how many workers to run; default v.workers
//     args: (v) => [a, b, c],                    the kernel's arguments
//     tiles: (v, r) => [{ name, label, value, text?, hint?, className? }],   the result tiles
//     bar?: (v, r) => { value, of, label },      a bar under the tiles
//     after?: (v, r, el) => void,                anything else to draw
//     hint?: string,                             what the Run button does
//     trace?: { program: (v, traceControls) => program, caption, controls?: [...] },
//     native: (v) => { lines: [...], note },
//   })

import { Runtime } from "./runtime.js";
import { TraceView } from "./trace-view.js";
import { el, fmt, ms } from "./shell.js";

export function standardPanel(shell, spec) {
  const { contract, config } = shell;
  const autorun = config.autorun !== "false";

  // -- live ----------------------------------------------------------------------------
  const live = shell.panel("live");
  const bar = el("div", "run-bar");
  const runButton = shell.button("Run", { primary: true, className: "run-live" });
  bar.append(runButton);
  bar.append(el("span", "run-hint", spec.hint || "Runs the kernel on fresh workers each time; the results are read from their shared memory."));
  live.append(bar);
  const out = el("div", "live-out");
  const bars = el("div", "bars");
  const extra = el("div", "live-extra");
  const workerTimes = el("p", "note");
  live.append(out, bars, extra, workerTimes);

  let runtime = null;
  const run = async () => {
    const v = shell.values();
    const workers = spec.workers ? spec.workers(v) : v.workers;
    shell.busy(true);
    shell.root.dataset.state = "running";
    try {
      runtime ||= await Runtime.for(contract.name);
      const r = await runtime.run({ workers, args: spec.args(v), timeoutMs: contract.timeout_ms || 20000, onStatus: (s) => shell.status(s) });
      r.v = v;
      const tiles = spec.tiles(v, r);
      tiles.push({ name: "elapsed", label: "Elapsed", value: Math.round(r.elapsedMs * 1000) / 1000, text: ms(r.elapsedMs), hint: "wall time, barrier to last worker" });
      shell.results(out, tiles);
      bars.replaceChildren();
      if (spec.bar) {
        const b = spec.bar(v, r);
        if (b) shell.bar(bars, b);
      }
      extra.replaceChildren();
      if (spec.after) spec.after(v, r, extra);
      const per = r.workerMs.map((t) => (t === null ? "?" : t.toFixed(1)));
      workerTimes.textContent = `Each worker, inside the kernel: ${per.join(" / ")} ms. ` +
        "A run is one observation on this device, not a measurement of the hardware; run it again and the numbers move.";
      for (const [k, val] of Object.entries(v)) shell.root.dataset[k] = String(val);
      shell.status(`done: ${tiles.slice(0, 2).map((t) => `${t.label.toLowerCase()} ${t.text !== undefined ? t.text : fmt(t.value)}`).join(", ")}`);
      shell.root.dataset.state = "done";
    } catch (error) {
      const timedOut = /did not finish/.test(error.message);
      out.replaceChildren(el("p", timedOut ? "lab-timeout" : "lab-error", timedOut
        ? `The run did not finish within ${(contract.timeout_ms || 20000) / 1000} s, and the workers were stopped. ` + (spec.onTimeout ? spec.onTimeout(shell.values()) : "")
        : `The run failed: ${error.message}`));
      bars.replaceChildren();
      extra.replaceChildren();
      workerTimes.textContent = "";
      shell.root.dataset.outcome = timedOut ? "timeout" : "error";
      for (const [k, val] of Object.entries(shell.values())) shell.root.dataset[k] = String(val);
      shell.status(timedOut ? "stopped: the run did not finish" : "failed");
      shell.root.dataset.state = timedOut ? "done" : "error";
    } finally {
      shell.busy(false);
    }
  };
  runButton.addEventListener("click", run);

  // -- trace ---------------------------------------------------------------------------
  const view = spec.trace && contract.modes.includes("trace") ? tracePanel(shell, spec.trace) : null;

  // -- native --------------------------------------------------------------------------
  const native = shell.panel("native");
  const drawNative = () => {
    const n = spec.native(shell.values());
    shell.commands(native, n.lines, n.note);
  };
  drawNative();

  shell.on("change", () => {
    if (view) view.reset();
    drawNative();
    if (shell.mode === "live" && autorun) run();
  });
  shell.on("mode", (m) => { if (m === "live" && !shell.root.dataset.state?.match(/done|running/) && autorun) run(); });
  if (shell.mode === "live" && autorun) run();
  return { run };
}

// The trace panel: its own controls, which the page's lab block cannot set, above the stepper
// over the model. `program(values, traceValues)` builds the program from the shell's controls
// and these. Returns the view, so a panel can reset it when a control changes.
export function tracePanel(shell, spec) {
  const trace = shell.panel("trace");
  const controls = el("div", "trace-controls");
  const traceControls = {};
  let view = null;
  for (const c of spec.controls || []) {
    const select = el("select");
    select.name = `trace-${c.name}`;
    for (const o of c.options) {
      const opt = el("option", "", String(o));
      opt.value = String(o);
      if (String(o) === String(c.default)) opt.selected = true;
      select.append(opt);
    }
    const label = el("label");
    label.append(el("span", "control-label", c.label), select);
    controls.append(label);
    traceControls[c.name] = () => (typeof c.options[0] === "number" ? Number(select.value) : select.value);
    select.addEventListener("change", () => view && view.reset());
  }
  if (controls.children.length) trace.append(controls);
  const stepper = el("div", "stepper");
  trace.append(stepper);
  view = new TraceView(stepper, {
    program: () => spec.program(shell.values(), Object.fromEntries(Object.entries(traceControls).map(([k, f]) => [k, f()]))),
    caption: spec.caption,
  });
  return view;
}

// The per-worker bars many panels draw: one row per worker, scaled to the largest.
export function perWorkerBars(container, values, label) {
  const most = Math.max(1, ...values);
  const box = el("div", "worker-bars");
  box.append(el("p", "control-label", label));
  values.forEach((val, i) => {
    const row = el("div", "bar-row");
    row.append(el("span", "bar-label", `worker ${i}`));
    const track = el("div", "bar");
    const fill = el("i");
    fill.style.width = `${((100 * val) / most).toFixed(1)}%`;
    track.append(fill);
    row.append(track, el("span", "bar-value", fmt(val)));
    box.append(row);
  });
  container.append(box);
}
