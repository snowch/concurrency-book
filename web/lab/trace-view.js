// The stepper over the deterministic model (trace.js): the reader picks a schedule, or steps
// the threads by hand, and watches each thread's registers and the shared memory change.

import { Machine, schedules, MAX_STEPS, listing } from "./trace.js";
import { el, fmt } from "./shell.js";

const SCHEDULES = [
  ["alternate", "one operation from each thread in turn"],
  ["sequential", "each thread runs to the end before the next"],
  ["random", "a pseudo-random order from a seed"],
  ["manual", "you choose which thread steps"],
];

// A program's operations in a few words, for the empty table.
function describe(ops) {
  const words = ops.map((o, i) => {
    switch (o.op) {
      case "load": return `load ${o.var}`;
      case "add": return `add ${o.imm}`;
      case "store": return `store ${o.var}${o.buffered ? " (buffered)" : ""}`;
      case "rmw_add": return `atomic add ${o.var}`;
      case "xchg": return `exchange ${o.var}`;
      case "cas": return `cas ${o.var}`;
      case "jz": case "jnz": case "jeq": return `go back if ${o.op === "jz" ? "zero" : o.op === "jnz" ? "not zero" : "equal"}`;
      case "jmp": return "go back";
      case "wait": return `sleep on ${o.var}`;
      case "notify": return `wake ${o.var}`;
      case "fence": return "fence";
      case "drain": return "drain";
      default: return o.text || o.op;
    }
  });
  return [...new Set(words)].join(", ") + ".";
}

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
    // The teaching machine: the same model, drawn as a machine a reader can look into. Every
    // step the bar takes advances this and the table below alike; there is one interpreter.
    this.machine_ = el("div", "machine");
    root.append(this.machine_);
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
    // By hand, "run to the end" alternates: a reader who wants another order steps it.
    const pick = this.pick === null ? schedules.alternate() : this.pick;
    while (!this.machine.done && this.machine.steps.length < MAX_STEPS) {
      const i = pick(this.machine);
      if (i < 0) break;
      this.machine.step(i);
    }
    this.#draw();
  }

  // The machine view: a card per thread with its program counter, registers, next operation
  // and store buffer; the shared memory; and the program, with each operation's C beside it.
  #drawMachine() {
    const m = this.machine;
    const last = m.steps[m.steps.length - 1];
    const before = m.steps[m.steps.length - 2];
    const buffered = m.program.threads.some((t) => t.ops.some((o) => o.op === "store" && (o.buffered || o.release)));
    const view = this.machine_;
    view.replaceChildren();
    const head = el("div", "machine-head");
    head.append(el("b", "", "Teaching machine"), el("span", "", "a microscope, not your processor"));
    view.append(head);
    const cpus = el("div", "cpus");
    m.threads.forEach((t, i) => {
      const card = el("div", `cpu t${i}` + (last && last.thread === i ? " stepped" : ""));
      card.dataset.thread = String(i);
      const title = el("div", "cpu-title");
      title.append(el("b", "", `Thread ${t.name}`), el("span", "", t.pc >= t.ops.length ? "finished" : `pc ${t.pc} of ${t.ops.length}`));
      card.append(title);
      const regs = el("div", "regs");
      const names = Object.keys(t.regs);
      if (!names.length) regs.append(el("span", "reg empty", "no register set yet"));
      for (const r of names) {
        const chip = el("span", "reg" + (last && last.thread === i && last.regs[r] !== (before ? before.regs[r] : undefined) && last.text.startsWith(`${r} =`) ? " changed" : ""));
        chip.append(el("i", "", r), el("code", "", String(t.regs[r])));
        regs.append(chip);
      }
      card.append(regs);
      if (m.lines) {
        const cache = el("div", "cache");
        cache.append(el("i", "", "cache"));
        const held = Object.entries(t.cache).filter(([, st]) => st !== "I");
        if (!held.length) cache.append(el("span", "empty", "no line"));
        for (const [l, st] of held) {
          const chip = el("code", `st-${st}` + (last && before && before.lines && before.lines[l][i] !== st ? " changed" : last && !before && st !== "I" ? " changed" : ""));
          chip.append(document.createTextNode(`${l} `), el("b", "", st === "M" ? "modified" : "shared"));
          cache.append(chip);
        }
        card.append(cache);
      }
      const next = el("div", "next");
      if (t.asleep !== null) next.append(el("span", "asleep", `asleep on ${t.asleep}`));
      else if (t.pc < t.ops.length) next.append(el("span", "", "next "), el("code", "", listing(t.ops[t.pc])));
      else if (t.buffer.length) next.append(el("span", "", "next: the buffer drains"));
      else next.append(el("span", "", "done"));
      card.append(next);
      if (buffered) {
        const buf = el("div", "buffer");
        buf.append(el("i", "", "store buffer"));
        if (!t.buffer.length) buf.append(el("span", "empty", "empty"));
        for (const w of t.buffer) buf.append(el("code", "", `${w.var} = ${w.value}`));
        card.append(buf);
      }
      cpus.append(card);
    });
    view.append(cpus);
    const changed = (name, value) => (last && before && last.memory[name] !== before.memory[name] ? " changed" : last && !before && value !== m.program.memory[name] ? " changed" : "");
    const STATES = { M: "modified", S: "shared", I: "no copy" };
    if (m.lines) {
      const lines = el("div", "lines");
      for (const [l, vars] of Object.entries(m.lines)) {
        const states = m.threads.map((t) => t.cache[l]);
        const moved = last && (before ? before.lines[l].some((st, i) => st !== states[i]) : states.some((st) => st !== "I"));
        const box = el("div", "line" + (moved ? " moved" : ""));
        box.dataset.line = l;
        const title = el("div", "line-title");
        title.append(el("b", "", `cache ${l}`), el("span", "", moved ? "moved this step" : ""));
        box.append(title);
        const cells = el("div", "cells");
        for (const name of vars) {
          const cell = el("span", "cell" + changed(name, m.memory[name]));
          cell.append(el("code", "", name), el("b", "", String(m.memory[name])));
          cells.append(cell);
        }
        box.append(cells);
        const holders = el("div", "holders");
        m.threads.forEach((t, i) => {
          const h = el("span", `holder t${i} st-${t.cache[l]}`);
          h.append(el("b", "", t.name), document.createTextNode(` ${STATES[t.cache[l]]}`));
          holders.append(h);
        });
        box.append(holders);
        lines.append(box);
      }
      view.append(lines);
    }
    const unlined = Object.entries(m.memory).filter(([name]) => !m.lines || !m.lineOf[name]);
    if (unlined.length) {
      const mem = el("div", "memory");
      mem.append(el("i", "", m.lines ? "memory, on no line" : "memory"));
      for (const [name, value] of unlined) {
        const cell = el("span", "cell" + changed(name, value));
        cell.append(el("code", "", name), el("b", "", String(value)));
        mem.append(cell);
      }
      view.append(mem);
    }
    // One listing per distinct program: threads that run the same operations share it, each
    // marking its own place.
    const distinct = [];
    m.threads.forEach((t, i) => {
      const key = JSON.stringify(t.ops);
      const found = distinct.find((d) => d.key === key);
      if (found) found.threads.push(i); else distinct.push({ key, ops: t.ops, threads: [i] });
    });
    // Programs that carry their C take the full width, so the line beside each operation shows.
    const programs = el("div", "programs" + (distinct.some((d) => d.ops.some((o) => o.src)) ? " with-src" : ""));
    for (const d of distinct) {
      const box = el("div", "program");
      const title = el("div", "program-title");
      title.append(el("b", "", distinct.length > 1 ? `Program of ${d.threads.map((i) => m.threads[i].name).join(" and ")}` : "Program"), el("span", "", "hand-written to mirror the C; not compiler output"));
      box.append(title);
      const ol = el("ol", "listing");
      d.ops.forEach((op, k) => {
        const li = el("li", d.threads.some((i) => m.threads[i].pc === k) ? "at" : "");
        const marks = d.threads.filter((i) => m.threads[i].pc === k).map((i) => m.threads[i].name).join("");
        li.append(el("span", "mark", marks ? `${marks} ▶` : ""), el("span", "num", String(k)), el("code", "", listing(op)));
        if (op.src) {
          const src = el("span", "src", op.src);
          src.title = op.src;
          li.append(src);
        }
        ol.append(li);
      });
      box.append(ol);
      programs.append(box);
    }
    view.append(programs);
    this.root.dataset.machineThreads = String(m.threads.length);
    this.root.dataset.machineRegisters = String(m.threads.reduce((n, t) => n + Object.keys(t.regs).length, 0));
    this.root.dataset.machineLines = String(m.lines ? Object.keys(m.lines).length : 0);
  }

  #draw() {
    this.#drawMachine();
    const m = this.machine;
    const [name, expected] = Object.entries(m.program.expected)[0];
    const value = m.memory[name];
    const lost = expected - value;
    const done = m.done;
    const capped = !done && m.steps.length >= MAX_STEPS;
    this.summary.innerHTML = "";
    const parts = m.program.outcome
      ? [["Outcome", m.program.outcome(m.memory)], ["Steps", String(m.steps.length)]]
      : [
        ["Expected", fmt(expected)],
        [`${name} now`, fmt(value)],
        [done ? "Lost" : "Lost so far", fmt(Math.max(0, lost))],
        ["Steps", m.stuck ? `${m.steps.length}: every thread asleep` : capped ? `${m.steps.length}: stopped, no end in sight` : String(m.steps.length)],
      ];
    if (m.lines) parts.push(["Round trips", String(m.roundTrips)]);
    this.root.dataset.traceOutcome = m.program.outcome ? m.program.outcome(m.memory) : "";
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
    this.root.dataset.traceStuck = String(m.stuck);
    this.root.dataset.traceRoundTrips = String(m.roundTrips);
    for (const b of this.threadButtons.querySelectorAll("button")) {
      const t = m.threads[Number(b.dataset.thread)];
      b.disabled = !m.runnable.includes(Number(b.dataset.thread));
      b.textContent = t.asleep !== null ? `${t.name} is asleep` : `Step ${t.name}`;
    }
    this.stepButton.disabled = done || m.stuck || capped;
    this.runButton.disabled = done || m.stuck || capped;
    const regs = [...new Set(m.threads.flatMap((t) => Object.keys(t.regs)))];
    const vars = Object.keys(m.program.memory);
    const buffered = m.program.threads.some((t) => t.ops.some((o) => o.op === "store" && o.buffered));
    const lines = m.lines ? Object.keys(m.lines) : [];
    const names = m.threads.map((t) => t.name).join("/");
    const table = el("table");
    const thead = el("thead");
    const hr = el("tr");
    for (const h of ["Step", "Thread", "Operation", ...regs.map((r) => `register ${r}`), ...(buffered ? m.threads.map((t) => `${t.name}'s buffer`) : []), ...vars,
      ...lines.map((l) => `${l} (${names})`), ...(lines.length ? ["round trips"] : [])]) hr.append(el("th", "", h));
    thead.append(hr);
    table.append(thead);
    const tbody = el("tbody");
    if (!m.steps.length) {
      const tr = el("tr", "empty");
      const td = el("td", "", "No step yet. " + m.threads.map((t) => `${t.name} will run: ` + describe(t.ops)).join(" "));
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
      if (buffered) for (const b of s.buffers) tr.append(el("td", "buf", b));
      for (const v of vars) tr.append(el("td", "num", String(s.memory[v])));
      for (const l of lines) tr.append(el("td", "states", s.lines[l].join("/")));
      if (lines.length) tr.append(el("td", "num", String(s.roundTrips)));
      tbody.append(tr);
    });
    table.append(tbody);
    this.tableWrap.replaceChildren(table);
    const current = this.tableWrap.querySelector("tr.current");
    if (current && this.tableWrap.scrollHeight > this.tableWrap.clientHeight) current.scrollIntoView({ block: "nearest" });
    if (done) this.onDone(m);
  }
}
