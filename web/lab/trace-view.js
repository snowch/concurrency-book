// The stepper over the deterministic model (trace.js): the reader picks a schedule, or steps
// the threads by hand, and watches each thread's registers and the shared memory change.

import { Machine, schedules } from "./trace.js";
import { el, fmt } from "./shell.js";

const SCHEDULES = [
  ["alternate", "one operation from each thread in turn"],
  ["sequential", "each thread runs to the end before the next"],
  ["random", "a pseudo-random order from a seed"],
  ["manual", "you choose which thread steps"],
];

export class TraceView {
  /**
   * `program()` builds the program from the current settings; `onDone(machine)` is told when
   * a trace has run to the end. `expected` names the variable and value the program promises.
   */
  constructor(root, { program, caption, onDone = () => {} } = {}) {
    this.root = root;
    this.program = program;
    this.onDone = onDone;
    root.replaceChildren();
    const bar = el("div", "trace-bar");
    this.schedule = el("select");
    this.schedule.name = "schedule";
    for (const [k, what] of SCHEDULES) {
      const o = el("option", "", `${k}: ${what}`);
      o.value = k;
      this.schedule.append(o);
    }
    const label = el("label");
    label.append(el("span", "control-label", "Schedule"), this.schedule);
    bar.append(label);
    this.seed = el("input");
    this.seed.type = "number"; this.seed.min = 1; this.seed.max = 9999; this.seed.value = 1; this.seed.name = "seed";
    const seedLabel = el("label", "seed");
    seedLabel.append(el("span", "control-label", "Seed"), this.seed);
    bar.append(seedLabel);
    this.stepButton = this.#button(bar, "Step", () => this.step());
    this.runButton = this.#button(bar, "Run to the end", () => this.runAll(), true);
    this.resetButton = this.#button(bar, "Reset", () => this.reset());
    this.threadButtons = el("span", "thread-steps");
    bar.append(this.threadButtons);
    root.append(bar);
    this.summary = el("p", "trace-summary");
    root.append(this.summary);
    this.tableWrap = el("div", "trace-table");
    root.append(this.tableWrap);
    if (caption) root.append(el("p", "note", caption));
    this.schedule.addEventListener("change", () => this.reset());
    this.seed.addEventListener("change", () => this.reset());
    this.reset();
  }

  #button(parent, label, fn, primary = false) {
    const b = el("button", primary ? "run primary" : "run", label);
    b.type = "button";
    b.addEventListener("click", fn);
    parent.append(b);
    return b;
  }

  reset() {
    this.machine = new Machine(this.program());
    const kind = this.schedule.value;
    this.pick = kind === "manual" ? null : kind === "random" ? schedules.random(Number(this.seed.value) || 1) : schedules[kind]();
    this.seed.parentElement.hidden = kind !== "random";
    this.threadButtons.replaceChildren();
    if (kind === "manual") {
      this.machine.threads.forEach((t, i) => {
        const b = el("button", "run", `Step ${t.name}`);
        b.type = "button";
        b.dataset.thread = String(i);
        b.addEventListener("click", () => this.step(i));
        this.threadButtons.append(b);
      });
    }
    this.stepButton.hidden = kind === "manual";
    this.#draw();
  }

  step(thread) {
    if (this.machine.done) return;
    const i = thread !== undefined ? thread : this.pick(this.machine);
    if (i < 0) return;
    this.machine.step(i);
    this.#draw();
  }

  runAll() {
    if (this.pick === null) {
      // By hand, "run to the end" alternates: a reader who wants another order steps it.
      const alt = schedules.alternate();
      while (!this.machine.done) this.machine.step(alt(this.machine));
    } else {
      while (!this.machine.done) {
        const i = this.pick(this.machine);
        if (i < 0) break;
        this.machine.step(i);
      }
    }
    this.#draw();
  }

  #draw() {
    const m = this.machine;
    const [name, expected] = Object.entries(m.program.expected)[0];
    const value = m.memory[name];
    const lost = expected - value;
    const done = m.done;
    this.summary.innerHTML = "";
    const parts = [
      ["Expected", fmt(expected)],
      [`${name} now`, fmt(value)],
      [done ? "Lost" : "Lost so far", fmt(Math.max(0, lost))],
      ["Steps", `${m.steps.length} of ${m.threads.reduce((n, t) => n + t.ops.length, 0)}`],
    ];
    for (const [k, v] of parts) {
      const s = el("span", "trace-stat");
      s.append(el("b", "", v), el("small", "", k));
      this.summary.append(s);
    }
    this.root.dataset.traceExpected = String(expected);
    this.root.dataset.traceValue = String(value);
    this.root.dataset.traceLost = String(lost);
    this.root.dataset.traceDone = String(done);
    this.root.dataset.traceSteps = String(m.steps.length);
    for (const b of this.threadButtons.querySelectorAll("button")) b.disabled = m.threads[Number(b.dataset.thread)].pc >= m.threads[Number(b.dataset.thread)].ops.length;
    this.stepButton.disabled = done;
    this.runButton.disabled = done;
    const regs = [...new Set(m.threads.flatMap((t) => Object.keys(t.regs)))];
    const vars = Object.keys(m.program.memory);
    const table = el("table");
    const thead = el("thead");
    const hr = el("tr");
    for (const h of ["Step", "Thread", "Operation", ...regs.map((r) => `register ${r}`), ...vars]) hr.append(el("th", "", h));
    thead.append(hr);
    table.append(thead);
    const tbody = el("tbody");
    if (!m.steps.length) {
      const tr = el("tr", "empty");
      const td = el("td", "", "No step yet. Each thread will run: " + m.threads[0].ops.map((o) => o.op === "load" ? `load ${o.var}` : o.op === "add" ? `add ${o.imm}` : o.op === "store" ? `store ${o.var}` : o.op === "rmw_add" ? `atomic add ${o.var}` : o.op).join(", ") + ".");
      td.colSpan = hr.children.length;
      tr.append(td);
      tbody.append(tr);
    }
    m.steps.forEach((s, idx) => {
      const tr = el("tr", `t${s.thread}` + (idx === m.steps.length - 1 ? " current" : ""));
      tr.append(el("td", "num", String(s.n)), el("td", "", s.name));
      const op = el("td");
      op.append(el("code", "", s.text));
      tr.append(op);
      for (const r of regs) tr.append(el("td", "num", s.regs[r] === undefined ? "" : String(s.regs[r])));
      for (const v of vars) tr.append(el("td", "num", String(s.memory[v])));
      tbody.append(tr);
    });
    table.append(tbody);
    this.tableWrap.replaceChildren(table);
    const current = this.tableWrap.querySelector("tr.current");
    if (current && this.tableWrap.scrollHeight > this.tableWrap.clientHeight) current.scrollIntoView({ block: "nearest" });
    if (done) this.onDone(m);
  }
}
