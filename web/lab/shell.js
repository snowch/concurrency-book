// The shell every experiment sits in: a head with the title and the three modes, the controls
// its contract declares, one panel per mode, and a status line. An experiment's own module
// (counter.js, …) fills the panels; this file draws nothing that depends on the kernel.
//
// Three modes, because the result of a concurrent program depends on the machine:
//   live    the compiled kernel on real Web Workers, where the browser allows shared memory;
//   trace   a deterministic model of the operations, interleaved by a schedule the reader picks;
//   native  the commands that run the same kernel at a desk, on pthreads.
// The page's `lab` block may fix a control (`lock`), choose the starting mode (`mode`) and set
// any control's starting value; tools/render.py checked them against the contract.

const html = (s) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export const fmt = (n) => (typeof n === "number" ? n.toLocaleString("en-GB") : String(n));
export const ms = (n) => `${n < 10 ? n.toFixed(2) : n < 100 ? n.toFixed(1) : Math.round(n).toLocaleString("en-GB")} ms`;

export function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

const MODE_NAMES = { live: "Live run", trace: "Deterministic trace", native: "At a desk" };
const MODE_NOTES = {
  live: "the compiled kernel, on real threads in this browser",
  trace: "a model of the operations, one step at a time",
  native: "the same kernel on pthreads, on your own machine",
};

export class Shell {
  constructor(root, contract, config, capabilities) {
    this.root = root;
    this.contract = contract;
    this.config = config;
    this.capabilities = capabilities;
    this.locked = new Set((config.lock || "").split(",").map((s) => s.trim()).filter(Boolean));
    this.listeners = { change: [], mode: [] };
    this.panels = {};
    root.replaceChildren();
    this.#head();
    this.#controls();
    this.body = el("div", "lab-body");
    root.append(this.body);
    this.foot = el("div", "lab-foot");
    this.statusEl = el("span", "status");
    this.statusEl.setAttribute("role", "status");
    this.noteEl = el("span", "lab-caps");
    this.foot.append(this.statusEl, this.noteEl);
    root.append(this.foot);
    this.#capabilitiesNote();
    const wanted = config.mode && this.available(config.mode) ? config.mode : this.contract.modes.find((m) => this.available(m));
    this.setMode(wanted);
  }

  on(event, fn) { this.listeners[event].push(fn); }
  #emit(event, ...args) { for (const fn of this.listeners[event]) fn(...args); }

  // Whether a mode can run here: live needs shared memory, which the page may not have.
  available(mode) {
    if (!this.contract.modes.includes(mode)) return false;
    if (mode === "live" && this.contract.requires && this.contract.requires.threads) return this.capabilities.live;
    return true;
  }

  #head() {
    const head = el("div", "lab-head");
    head.append(el("span", "lab-title", this.config.title || this.contract.title));
    const modes = el("div", "lab-modes");
    modes.setAttribute("role", "tablist");
    modes.setAttribute("aria-label", "Mode");
    for (const m of this.contract.modes) {
      const b = el("button", "", MODE_NAMES[m]);
      b.type = "button";
      b.dataset.mode = m;
      b.setAttribute("role", "tab");
      if (!this.available(m)) {
        b.disabled = true;
        b.title = `Not available: ${this.capabilities.why}`;
      }
      b.addEventListener("click", () => this.setMode(m));
      modes.append(b);
    }
    head.append(modes);
    this.modeNote = el("span", "lab-note");
    head.append(this.modeNote);
    this.root.append(head);
  }

  #capabilitiesNote() {
    const c = this.capabilities;
    const bits = [];
    if (c.cores) bits.push(`this device reports ${c.cores} logical core${c.cores === 1 ? "" : "s"}`);
    if (!c.live && this.contract.requires && this.contract.requires.threads) bits.push(`no live run: ${c.why}`);
    this.noteEl.textContent = bits.join(" · ");
  }

  #controls() {
    const form = el("form", "controls");
    form.addEventListener("submit", (e) => e.preventDefault());
    this.inputs = {};
    for (const c of this.contract.controls) {
      const start = this.config[c.name] !== undefined ? this.config[c.name] : c.default;
      const field = el("div", "control");
      if (this.locked.has(c.name)) {
        field.classList.add("locked");
        field.innerHTML = `<span class="control-label">${html(c.label)}</span><span class="control-value">${html(String(start))}</span>`;
        this.inputs[c.name] = { value: String(start), kind: c.kind, locked: true };
        form.append(field);
        continue;
      }
      const label = el("label");
      label.append(el("span", "control-label", c.label));
      let input;
      if (c.kind === "range") {
        input = el("input");
        input.type = "range";
        input.min = c.min; input.max = c.max; input.step = c.step || 1; input.value = start;
        const out = el("output", "", String(start));
        input.addEventListener("input", () => { out.textContent = input.value; });
        label.append(input, out);
      } else if (c.kind === "select") {
        input = el("select");
        for (const o of c.options) {
          const opt = el("option", "", String(o));
          opt.value = String(o);
          if (String(o) === String(start)) opt.selected = true;
          input.append(opt);
        }
        label.append(input);
      } else {
        input = el("input");
        input.type = "checkbox";
        input.checked = String(start) === "true";
        label.append(input);
      }
      input.name = c.name;
      input.addEventListener("change", () => this.#emit("change", this.values()));
      this.inputs[c.name] = { input, kind: c.kind };
      field.append(label);
      if (c.hint) field.append(el("small", "control-hint", c.hint));
      form.append(field);
    }
    this.form = form;
    this.root.append(form);
  }

  // Every control's value, typed: numbers where the contract's options are numbers.
  values() {
    const out = {};
    for (const c of this.contract.controls) {
      const i = this.inputs[c.name];
      let v = i.locked ? i.value : c.kind === "toggle" ? i.input.checked : i.input.value;
      if (c.kind === "range" || (c.kind === "select" && typeof c.options[0] === "number")) v = Number(v);
      out[c.name] = v;
    }
    return out;
  }

  // The element an experiment fills for one mode. Made on first use; shown while its mode is on.
  panel(mode) {
    if (!this.panels[mode]) {
      const p = el("div", `lab-panel lab-panel-${mode}`);
      p.dataset.mode = mode;
      p.hidden = this.mode !== mode;
      this.panels[mode] = p;
      this.body.append(p);
    }
    return this.panels[mode];
  }

  setMode(mode) {
    if (!mode) return;
    this.mode = mode;
    this.root.dataset.mode = mode;
    for (const b of this.root.querySelectorAll(".lab-modes button")) b.setAttribute("aria-selected", String(b.dataset.mode === mode));
    for (const [m, p] of Object.entries(this.panels)) p.hidden = m !== mode;
    this.modeNote.textContent = MODE_NOTES[mode];
    this.status("");
    this.#emit("mode", mode);
  }

  status(text) { this.statusEl.textContent = text; }

  // Busy: the controls and the run buttons are disabled while a run is in flight.
  busy(on) {
    this.root.dataset.busy = on ? "true" : "false";
    for (const b of this.root.querySelectorAll("button.run")) b.disabled = on;
  }

  button(label, { primary = false, className = "" } = {}) {
    const b = el("button", `run ${primary ? "primary" : ""} ${className}`.trim(), label);
    b.type = "button";
    return b;
  }

  // A row of result tiles: a label, a value, and what it means. Each value is also written on
  // the mount element as data-<name>, where a test can read it.
  results(container, items) {
    const dl = el("dl", "results");
    for (const it of items) {
      const tile = el("div", `tile ${it.className || ""}`.trim());
      tile.append(el("dt", "", it.label));
      const dd = el("dd", "", it.text !== undefined ? it.text : fmt(it.value));
      tile.append(dd);
      if (it.hint) tile.append(el("small", "", it.hint));
      dl.append(tile);
      this.root.dataset[it.name] = String(it.value !== undefined ? it.value : it.text);
    }
    container.replaceChildren(dl);
    return dl;
  }

  // A bar showing one quantity against another: observed against expected.
  bar(container, { value, of, label }) {
    const wrap = el("div", "bar-row");
    wrap.append(el("span", "bar-label", label));
    const track = el("div", "bar");
    const fill = el("i");
    const share = of > 0 ? Math.max(0, Math.min(1, value / of)) : 0;
    fill.style.width = `${(share * 100).toFixed(2)}%`;
    if (share < 1) fill.classList.add("short");
    track.append(fill);
    wrap.append(track, el("span", "bar-value", `${(share * 100).toFixed(share >= 0.999 && share < 1 ? 2 : 1)}%`));
    container.append(wrap);
    return wrap;
  }

  // Native mode: the commands that run this kernel at a desk, from the contract.
  commands(container, lines, note) {
    const pre = el("pre");
    const code = el("code", "language-bash", lines.join("\n"));
    pre.append(code);
    container.replaceChildren(pre);
    if (note) container.append(el("p", "note", note));
  }
}
