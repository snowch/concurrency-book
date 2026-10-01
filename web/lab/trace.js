// The deterministic trace: a model of what each thread does, one operation at a time.
//
// A live run executes the compiled kernel, and its result depends on the scheduler, the cores
// and the moment. This model does not. It holds a few shared variables and, per thread, a few
// registers and a list of operations, and runs them in whatever order a schedule chooses, so a
// chapter can force the interleaving that loses an update and show every step of it. It is a
// model of the operations the source hides, not the compiled code: the pages say so wherever it
// appears. It runs in the page (trace-view.js) and under Node (tools/trace.mjs), which writes
// the static tables the chapters include.
//
// A program: { memory: {name: value}, threads: [{ name, ops: [op] }] }. An op is one of
//   { op: "load", reg, var }            reg <- memory[var]
//   { op: "add", reg, imm }             reg <- reg + imm
//   { op: "store", var, reg }           memory[var] <- reg
//   { op: "rmw_add", var, imm }         memory[var] <- memory[var] + imm, in one step
//   { op: "cas", var, expect, reg, out } if memory[var] == expect(reg) then memory[var] <- reg; out <- 1 else 0
//   { op: "note", text }                a step that changes nothing, for the reader

export class Machine {
  constructor(program) {
    this.program = program;
    this.memory = { ...program.memory };
    this.threads = program.threads.map((t) => ({ name: t.name, ops: t.ops, pc: 0, regs: {} }));
    this.steps = [];
  }

  get done() {
    return this.threads.every((t) => t.pc >= t.ops.length);
  }

  // The threads that still have an operation to run.
  get runnable() {
    return this.threads.map((t, i) => (t.pc < t.ops.length ? i : -1)).filter((i) => i >= 0);
  }

  // Run thread `i`'s next operation. Returns the step record, or null if it has none left.
  step(i) {
    const t = this.threads[i];
    if (!t || t.pc >= t.ops.length) return null;
    const op = t.ops[t.pc];
    let text;
    switch (op.op) {
      case "load":
        t.regs[op.reg] = this.memory[op.var];
        text = `${op.reg} = load ${op.var}`;
        break;
      case "add":
        t.regs[op.reg] = (t.regs[op.reg] ?? 0) + op.imm;
        text = `${op.reg} = ${op.reg} + ${op.imm}`;
        break;
      case "store":
        this.memory[op.var] = t.regs[op.reg] ?? 0;
        text = `store ${op.var} = ${op.reg}`;
        break;
      case "rmw_add":
        this.memory[op.var] = this.memory[op.var] + op.imm;
        text = `atomic add ${op.var}, ${op.imm}`;
        break;
      case "cas": {
        const expect = typeof op.expect === "string" ? t.regs[op.expect] : op.expect;
        const ok = this.memory[op.var] === expect;
        if (ok) this.memory[op.var] = t.regs[op.reg];
        t.regs[op.out] = ok ? 1 : 0;
        text = `cas ${op.var}: expect ${expect}, new ${t.regs[op.reg]} -> ${ok ? "ok" : "failed"}`;
        break;
      }
      case "note":
        text = op.text;
        break;
      default:
        throw new Error(`unknown op ${op.op}`);
    }
    t.pc += 1;
    const record = {
      n: this.steps.length + 1,
      thread: i,
      name: t.name,
      text,
      regs: { ...t.regs },
      memory: { ...this.memory },
    };
    this.steps.push(record);
    return record;
  }
}

// A schedule chooses which runnable thread steps next. Each returns an index or -1 when done.
export const schedules = {
  // One operation from each thread in turn: the interleaving that loses the most.
  alternate: () => {
    let last = -1;
    return (m) => {
      const r = m.runnable;
      if (!r.length) return -1;
      const next = r.find((i) => i > last);
      last = next === undefined ? r[0] : next;
      return last;
    };
  },
  // Each thread runs to the end before the next starts: no interleaving, nothing lost.
  sequential: () => (m) => (m.runnable.length ? m.runnable[0] : -1),
  // A pseudo-random choice from a seed, so the same seed gives the same trace every time.
  random: (seed = 1) => {
    let s = (seed >>> 0) || 1;
    const next = () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
    return (m) => {
      const r = m.runnable;
      return r.length ? r[Math.floor(next() * r.length)] : -1;
    };
  },
};

// Run a program to the end under a schedule, and return the machine.
export function run(program, schedule) {
  const m = new Machine(program);
  const pick = typeof schedule === "function" ? schedule : schedules[schedule]();
  for (let guard = 0; guard < 100000; guard++) {
    const i = pick(m);
    if (i < 0) break;
    m.step(i);
  }
  return m;
}

// The steps as a markdown table, for the fragments the chapters include.
export function table(machine, variables = Object.keys(machine.program.memory)) {
  const regs = [...new Set(machine.threads.flatMap((t) => Object.keys(t.regs)))];
  const head = ["Step", "Thread", "Operation", ...regs.map((r) => `${r}`), ...variables];
  const rows = machine.steps.map((s) => [
    String(s.n), s.name, `\`${s.text}\``,
    ...regs.map((r) => (s.regs[r] === undefined ? "" : String(s.regs[r]))),
    ...variables.map((v) => String(s.memory[v])),
  ]);
  const line = (cells) => `| ${cells.join(" | ")} |`;
  return [line(head), line(head.map(() => "---")), ...rows.map(line)].join("\n");
}
