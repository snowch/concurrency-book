// Counters on a cache line (experiments/sharing): every worker increments a counter of its own,
// in the same word as the others', beside them on one line, or on a line of its own. The
// counts agree; the times are shown side by side.

import { Runtime } from "./runtime.js";
import { el, fmt, ms } from "./shell.js";

const LAYOUTS = { "same word": 0, "same line": 1, "own line": 2, "two lines apart": 3 };
const COMPARED = ["same word", "same line", "own line"];

export async function mount(shell) {
  const { contract, config } = shell;
  const autorun = config.autorun !== "false";
  const live = shell.panel("live");
  const bar = el("div", "run-bar");
  const runButton = shell.button("Run", { primary: true, className: "run-live" });
  bar.append(runButton, el("span", "run-hint", "Runs each layout on fresh workers, one after another, with the same count."));
  live.append(bar);
  const out = el("div", "live-out");
  const bars = el("div", "bars");
  const note = el("p", "note");
  live.append(out, bars, note);

  let runtime = null;
  const run = async () => {
    const v = shell.values();
    const layouts = v.layout === "compare" ? COMPARED : [v.layout];
    const expected = v.workers * v.iterations;
    shell.busy(true);
    shell.root.dataset.state = "running";
    try {
      runtime ||= await Runtime.for(contract.name);
      const runs = [];
      for (const layout of layouts) {
        shell.status(`running: ${layout}`);
        const r = await runtime.run({ workers: v.workers, args: [v.iterations, LAYOUTS[layout], 0], onStatus: () => {} });
        runs.push({ layout, observed: r.results[0], elapsedMs: r.elapsedMs });
      }
      const tiles = [{ name: "expected", label: "Expected", value: expected, hint: `${fmt(v.workers)} × ${fmt(v.iterations)}` }];
      for (const r of runs) {
        const key = r.layout.replace(/[^a-z0-9]+/gi, "_").replace(/_+$/, "");
        tiles.push({ name: `elapsed_${key}`, label: r.layout, value: Math.round(r.elapsedMs * 1000) / 1000, text: ms(r.elapsedMs), hint: r.observed === expected ? `${(1e6 * r.elapsedMs / expected).toFixed(0)} ns per increment` : `count wrong: ${fmt(r.observed)}`, className: r.observed === expected ? "" : "bad" });
      }
      shell.results(out, tiles);
      bars.replaceChildren();
      const slowest = Math.max(...runs.map((r) => r.elapsedMs));
      for (const r of runs) shell.bar(bars, { value: r.elapsedMs, of: slowest, label: r.layout });
      shell.root.dataset.observed = String(runs.every((r) => r.observed === expected) ? expected : runs.find((r) => r.observed !== expected).observed);
      shell.root.dataset.layouts = runs.map((r) => r.layout).join(",");
      if (runs.length > 1) {
        const [a, , c] = runs;
        shell.root.dataset.ratio = (a.elapsedMs / Math.max(0.001, c.elapsedMs)).toFixed(2);
        note.textContent = `This run: sharing one word took ${(a.elapsedMs / Math.max(0.001, c.elapsedMs)).toFixed(1)} times as long as a line each. One observation on this device; the ratio depends on the cores, the caches and what else was running.`;
      } else note.textContent = "One observation on this device.";
      for (const [k, val] of Object.entries(v)) shell.root.dataset[k] = String(val);
      shell.status("done");
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

  const native = shell.panel("native");
  const drawNative = () => {
    const v = shell.values();
    shell.commands(native, ["make native KERNEL=sharing", ...COMPARED.map((l) => `native/build/sharing ${v.workers} ${v.iterations} ${LAYOUTS[l]}   # ${l}`)],
      "Each run prints the counters' total and the wall time. Compare the times across the three layouts.");
  };
  drawNative();
  shell.on("change", () => { drawNative(); if (shell.mode === "live" && autorun) run(); });
  shell.on("mode", (m) => { if (m === "live" && !shell.root.dataset.state?.match(/done|running/) && autorun) run(); });
  if (shell.mode === "live" && autorun) run();
}
