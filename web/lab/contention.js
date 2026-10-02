// Contention (experiments/contention): the same work on one shared word or on a word per worker,
// run with one worker, then two, then more. The page draws the rate against the worker count,
// one small chart per layout on a shared scale, so the three can be compared by eye.

import { Runtime } from "./runtime.js";
import { el, fmt, ms } from "./shell.js";

const LAYOUTS = { "one shared": 0, "one each": 1, "one each, plain": 2 };
const COMPARED = ["one shared", "one each", "one each, plain"];
const SVG = "http://www.w3.org/2000/svg";

// Axis ticks in a compact form; the table under the charts has every number in full.
const compact = (v) => (v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `${Math.round(v / 1e3)}k` : String(Math.round(v)));

function svg(name, attrs = {}) {
  const n = document.createElementNS(SVG, name);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
  return n;
}

// One small bar chart: increments per millisecond for each worker count, on a scale shared with
// its neighbours. Bars are thin and one hue; the first and last carry a label; every bar has a
// hover title. The table under the charts holds every number.
function chart(container, title, points, top) {
  const W = 300, H = 170, L = 50, R = 10, T = 26, B = 32;
  const box = el("figure", "chart");
  const s = svg("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": `${title}: increments per millisecond against workers` });
  s.appendChild(svg("text", { x: L, y: 16, class: "chart-title" })).textContent = title;
  const plotW = W - L - R, plotH = H - T - B;
  const x = (i) => L + (plotW * (i + 0.5)) / points.length;
  const y = (v) => T + plotH - (plotH * v) / top;
  // Two quiet gridlines and the axis.
  for (const f of [0.5, 1]) {
    s.append(svg("line", { x1: L, x2: W - R, y1: y(top * f), y2: y(top * f), class: "chart-grid" }));
    s.appendChild(svg("text", { x: L - 4, y: y(top * f) + 4, class: "chart-tick", "text-anchor": "end" })).textContent = compact(top * f);
  }
  s.append(svg("line", { x1: L, x2: W - R, y1: y(0), y2: y(0), class: "chart-axis" }));
  const bw = Math.min(18, (plotW / points.length) * 0.6);
  points.forEach((p, i) => {
    const bar = svg("rect", { x: x(i) - bw / 2, y: y(p.rate), width: bw, height: Math.max(0, y(0) - y(p.rate)), rx: 2, class: "chart-bar" });
    bar.appendChild(svg("title")).textContent = `${p.workers} worker${p.workers === 1 ? "" : "s"}: ${fmt(Math.round(p.rate))} increments per ms, ${ms(p.elapsedMs)}`;
    s.append(bar);
    s.appendChild(svg("text", { x: x(i), y: H - 12, class: "chart-tick", "text-anchor": "middle" })).textContent = String(p.workers);
    // The first and last bars carry a label, set in from the chart's edges so neither is cut off.
    if (i === 0 || i === points.length - 1) {
      const first = i === 0;
      s.appendChild(svg("text", { x: first ? x(i) - bw / 2 : x(i) + bw / 2, y: y(p.rate) - 5, class: "chart-label", "text-anchor": first ? "start" : "end" })).textContent = fmt(Math.round(p.rate));
    }
  });
  s.appendChild(svg("text", { x: W / 2, y: H - 1, class: "chart-tick", "text-anchor": "middle" })).textContent = "workers";
  box.append(s);
  container.append(box);
}

export async function mount(shell) {
  const { contract, config } = shell;
  const autorun = config.autorun !== "false";
  const live = shell.panel("live");
  const bar = el("div", "run-bar");
  const runButton = shell.button("Run", { primary: true, className: "run-live" });
  bar.append(runButton, el("span", "run-hint", "Runs each layout with one worker, then two, and so on, on fresh workers each time."));
  live.append(bar);
  const out = el("div", "live-out");
  const charts = el("div", "charts");
  const tableWrap = el("div", "table-wrap chart-table");
  const note = el("p", "note");
  live.append(out, charts, tableWrap, note);

  let runtime = null;
  const run = async () => {
    const v = shell.values();
    const layouts = v.layout === "compare" ? COMPARED : [v.layout];
    const counts = [];
    for (let w = 1; w <= v.workers; w = w < 4 ? w + 1 : w * 2) counts.push(w);
    if (counts[counts.length - 1] !== v.workers) counts.push(v.workers);
    shell.busy(true);
    shell.root.dataset.state = "running";
    try {
      runtime ||= await Runtime.for(contract.name);
      const series = [];
      for (const layout of layouts) {
        const points = [];
        for (const workers of counts) {
          shell.status(`running: ${layout}, ${workers} worker${workers === 1 ? "" : "s"}`);
          const r = await runtime.run({ workers, args: [v.iterations, LAYOUTS[layout], 0], onStatus: () => {} });
          points.push({ workers, observed: r.results[0], expected: workers * v.iterations, elapsedMs: r.elapsedMs, rate: (workers * v.iterations) / r.elapsedMs });
        }
        series.push({ layout, points });
      }
      const top = Math.max(...series.flatMap((s) => s.points.map((p) => p.rate))) * 1.1;
      charts.replaceChildren();
      for (const s of series) chart(charts, s.layout, s.points, top);
      const last = series[0].points[series[0].points.length - 1];
      shell.results(out, [
        { name: "observed", label: "Observed", value: last.observed, hint: `${series[0].layout}, ${fmt(last.workers)} workers`, className: last.observed === last.expected ? "good" : "bad" },
        { name: "rate", label: "Increments per ms", value: Math.round(last.rate), hint: `${series[0].layout}, ${fmt(last.workers)} workers` },
        { name: "elapsed", label: "Elapsed", value: Math.round(last.elapsedMs * 1000) / 1000, text: ms(last.elapsedMs), hint: `${series[0].layout}, ${fmt(last.workers)} workers` },
      ]);
      // Every number, as a table: the chart's view, for a reader who wants the figures.
      const table = el("table");
      const thead = el("thead"); const hr = el("tr");
      for (const h of ["Workers", ...series.map((s) => `${s.layout}: per ms`)]) hr.append(el("th", "", h));
      thead.append(hr); table.append(thead);
      const tbody = el("tbody");
      counts.forEach((w, i) => {
        const tr = el("tr");
        tr.append(el("td", "num", String(w)));
        for (const s of series) tr.append(el("td", "num", fmt(Math.round(s.points[i].rate))));
        tbody.append(tr);
      });
      table.append(tbody);
      tableWrap.replaceChildren(table);
      const exact = series.every((s) => s.points.every((p) => p.observed === p.expected));
      shell.root.dataset.exact = String(exact);
      shell.root.dataset.counts = counts.join(",");
      shell.root.dataset.layouts = series.map((s) => s.layout).join(";");
      const shared = series.find((s) => s.layout === "one shared");
      if (shared) shell.root.dataset.sharedRatio = (shared.points[0].rate / shared.points[shared.points.length - 1].rate).toFixed(2);
      note.textContent = `One observation per point on this device, which reports ${shell.capabilities.cores || "an unknown number of"} cores. More workers than cores share them; the curve past that point is the scheduler's.`;
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
    shell.commands(native, ["make native KERNEL=contention", ...[1, 2, 4, v.workers].filter((w, i, a) => a.indexOf(w) === i && w <= v.workers).map((w) => `native/build/contention ${w} ${v.iterations} ${LAYOUTS[v.layout === "compare" ? "one shared" : v.layout]}`)],
      "Each run prints the total and the wall time; the rate is the total over the time. Repeat with the second argument's last value 0, 1 and 2 for the three layouts.");
  };
  drawNative();
  shell.on("change", () => { drawNative(); if (shell.mode === "live" && autorun) run(); });
  shell.on("mode", (m) => { if (m === "live" && !shell.root.dataset.state?.match(/done|running/) && autorun) run(); });
  if (shell.mode === "live" && autorun) run();
}
