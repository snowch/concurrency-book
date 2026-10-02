// The deterministic trace: a model of what each thread does, one operation at a time.
//
// A live run executes the compiled kernel, and its result depends on the scheduler, the cores
// and the moment. This model does not. It holds a few shared variables and, per thread, a few
// registers, a list of operations, a store buffer and a sleeping state, and runs the operations
// in whatever order a schedule chooses, so a chapter can force the interleaving that loses an
// update, spins, sleeps or reorders, and show every step of it. It is a model of the operations
// the source hides, not the compiled code: the pages say so wherever it appears. It runs in the
// page (trace-view.js) and under Node (tools/trace.mjs), which writes the static tables the
// chapters include.
//
// A program: { memory: {name: value}, threads: [{ name, ops: [op] }], expected: {name: value} }.
// An op is one of
//   { op: "load", reg, var }                 reg <- memory[var], or the thread's own buffered store
//   { op: "add", reg, imm, from? }           reg <- (from ?? reg) + imm
//   { op: "store", var, reg|imm, buffered?, release?, seq_cst? }
//                                            memory[var] <- value; buffered: into the store buffer;
//                                            release: earlier buffered stores drain first, then this
//                                            one is buffered; seq_cst: they drain and so does this one
//   { op: "drain", var? }                    the oldest buffered store (or the one to var) reaches memory
//   { op: "fence" }                          every buffered store reaches memory
//   { op: "rmw_add", var, imm, out? }        memory[var] += imm, in one step; out <- the old value
//   { op: "xchg", var, imm, out }            out <- memory[var]; memory[var] <- imm, in one step
//   { op: "cas", var, expect, reg, out }     if memory[var] == expect then memory[var] <- reg; out <- 1 else 0
//   { op: "jz" | "jnz", reg, to }            jump to op `to` if reg is zero / not zero
//   { op: "jeq", reg, imm, to }              jump to op `to` if reg == imm
//   { op: "jmp", to }                        jump to op `to`
//   { op: "wait", var, expect }              sleep while memory[var] == expect, until a notify
//   { op: "notify", var, one? }              wake every thread (or one) sleeping on var
//   { op: "loadi", reg, base, index }        reg <- memory[base + the number in register index]
//   { op: "storei", base, index, reg|imm }   memory[base + the number in register index] <- value
//   { op: "cas2", vars: [a, b], expect: [ea, eb], values: [va, vb], out }
//                                            compare two words and swap both, as one step
//   { op: "note", text }                     a step that changes nothing, for the reader
// An atomic operation (rmw_add, xchg, cas) drains the thread's own buffer first, as a locked
// instruction does on x86-64.

// One operation as the program listing shows it before it runs: the notation of the steps,
// without the outcome a step records. An op may carry `src`, the line of C it mirrors.
export function listing(op) {
  switch (op.op) {
    case "load": return `${op.reg} = load ${op.var}`;
    case "add": return `${op.reg} = ${op.from ?? op.reg} + ${op.imm}`;
    case "store": {
      const what = op.reg !== undefined ? op.reg : op.imm;
      const how = op.seq_cst ? " (seq_cst)" : op.release ? " (release)" : op.buffered ? " (into the buffer)" : "";
      return `store ${op.var} = ${what}${how}`;
    }
    case "drain": return op.var ? `drain ${op.var}` : "drain the buffer";
    case "fence": return "fence";
    case "rmw_add": return `atomic add ${op.var}, ${op.imm}` + (op.out ? ` -> ${op.out}` : "");
    case "xchg": return `${op.out} = exchange ${op.var}, ${op.imm}`;
    case "cas": return `${op.out} = cas ${op.var}: expect ${op.expect}, new ${op.reg}`;
    case "jz": return `if ${op.reg} == 0 go to ${op.to}`;
    case "jnz": return `if ${op.reg} != 0 go to ${op.to}`;
    case "jeq": return `if ${op.reg} == ${op.imm} go to ${op.to}`;
    case "jmp": return `go to ${op.to}`;
    case "wait": return `wait ${op.var} while it is ${op.expect}`;
    case "notify": return `notify ${op.var}${op.one ? " (one)" : ""}`;
    case "loadi": return `${op.reg} = load ${op.base}[${op.index}]`;
    case "storei": return `store ${op.base}[${op.index}] = ${op.reg !== undefined ? op.reg : op.imm}`;
    case "cas2": return `${op.out} = cas ${op.vars[0]},${op.vars[1]}: expect ${op.expect[0]},${op.expect[1]}, new ${op.values[0]},${op.values[1]}`;
    case "note": return op.text;
    default: return op.op;
  }
}

export class Machine {
  constructor(program) {
    this.program = program;
    this.memory = { ...program.memory };
    this.threads = program.threads.map((t) => ({ name: t.name, ops: t.ops, pc: 0, regs: {}, buffer: [], asleep: null }));
    this.steps = [];
  }

  // Finished: every thread past its last operation, with nothing left in any buffer.
  get done() {
    return this.threads.every((t) => t.pc >= t.ops.length && t.buffer.length === 0);
  }

  // The threads that can take a step: not asleep, and with an operation or a buffered store left.
  get runnable() {
    return this.threads
      .map((t, i) => (t.asleep === null && (t.pc < t.ops.length || t.buffer.length) ? i : -1))
      .filter((i) => i >= 0);
  }

  // Nothing can move and the trace is not finished: every thread is asleep. A lost wake-up.
  get stuck() {
    return !this.done && this.runnable.length === 0;
  }

  #drainOne(t) {
    const w = t.buffer.shift();
    this.memory[w.var] = w.value;
    return w;
  }

  // Run thread `i`'s next operation. Returns the step record, or null if it cannot step.
  step(i) {
    const t = this.threads[i];
    if (!t || t.asleep !== null) return null;
    let text;
    let advance = true;
    if (t.pc >= t.ops.length) {
      if (!t.buffer.length) return null;
      const w = this.#drainOne(t);
      text = `buffer drains: ${w.var} = ${w.value}`;
      advance = false;
    } else {
      const op = t.ops[t.pc];
      const value = (v) => (typeof v === "string" ? (t.regs[v] ?? 0) : v);
      switch (op.op) {
        case "load": {
          const own = [...t.buffer].reverse().find((w) => w.var === op.var);
          t.regs[op.reg] = own ? own.value : this.memory[op.var];
          text = `${op.reg} = load ${op.var}` + (own ? " (from own buffer)" : "");
          break;
        }
        case "add":
          t.regs[op.reg] = (t.regs[op.from ?? op.reg] ?? 0) + op.imm;
          text = `${op.reg} = ${op.from ?? op.reg} + ${op.imm}`;
          break;
        case "store": {
          const v = value(op.reg !== undefined ? op.reg : op.imm);
          // A release store lets nothing stored before it overtake it: the buffer drains first.
          // A sequentially consistent store also waits for itself: it goes straight to memory.
          const drained = op.release || op.seq_cst ? t.buffer.length : 0;
          if (op.release || op.seq_cst) while (t.buffer.length) this.#drainOne(t);
          const before = drained ? ` (${drained} buffered store${drained === 1 ? "" : "s"} drained first)` : "";
          if (op.buffered || (op.release && !op.seq_cst)) {
            t.buffer.push({ var: op.var, value: v });
            text = `store ${op.var} = ${v} (into the buffer)${before}`;
          } else {
            this.memory[op.var] = v;
            text = `store ${op.var} = ${v}${before}`;
          }
          break;
        }
        case "drain": {
          const at = op.var ? t.buffer.findIndex((w) => w.var === op.var) : 0;
          if (t.buffer.length && at >= 0) {
            const [w] = t.buffer.splice(at, 1);
            this.memory[w.var] = w.value;
            text = `buffer drains: ${w.var} = ${w.value}`;
          } else text = "buffer empty";
          break;
        }
        case "fence": {
          const n = t.buffer.length;
          while (t.buffer.length) this.#drainOne(t);
          text = n ? `fence: ${n} buffered store${n === 1 ? " reaches" : "s reach"} memory` : "fence: nothing buffered";
          break;
        }
        case "rmw_add": {
          while (t.buffer.length) this.#drainOne(t);
          const old = this.memory[op.var];
          this.memory[op.var] = old + op.imm;
          if (op.out) t.regs[op.out] = old;
          text = `atomic add ${op.var}, ${op.imm}` + (op.out ? ` -> ${op.out} = ${old}` : "");
          break;
        }
        case "xchg": {
          while (t.buffer.length) this.#drainOne(t);
          t.regs[op.out] = this.memory[op.var];
          this.memory[op.var] = op.imm;
          text = `${op.out} = exchange ${op.var}, ${op.imm} -> got ${t.regs[op.out]}`;
          break;
        }
        case "cas": {
          while (t.buffer.length) this.#drainOne(t);
          const expect = value(op.expect);
          const ok = this.memory[op.var] === expect;
          if (ok) this.memory[op.var] = value(op.reg);
          t.regs[op.out] = ok ? 1 : 0;
          text = `cas ${op.var}: expect ${expect}, new ${value(op.reg)} -> ${ok ? "ok" : "failed"}`;
          break;
        }
        case "jz":
        case "jnz": {
          const r = t.regs[op.reg] ?? 0;
          const taken = op.op === "jz" ? r === 0 : r !== 0;
          text = `if ${op.reg} ${op.op === "jz" ? "==" : "!="} 0 go to ${op.to}: ${taken ? "taken" : "not taken"}`;
          if (taken) { t.pc = op.to; advance = false; }
          break;
        }
        case "jeq": {
          const taken = (t.regs[op.reg] ?? 0) === op.imm;
          text = `if ${op.reg} == ${op.imm} go to ${op.to}: ${taken ? "taken" : "not taken"}`;
          if (taken) { t.pc = op.to; advance = false; }
          break;
        }
        case "jmp":
          text = `go to ${op.to}`;
          t.pc = op.to;
          advance = false;
          break;
        case "wait":
          if (this.memory[op.var] === op.expect) {
            t.asleep = op.var;
            text = `wait ${op.var} while it is ${op.expect}: asleep`;
          } else text = `wait ${op.var} while it is ${op.expect}: it is ${this.memory[op.var]}, not asleep`;
          break;
        case "notify": {
          const sleepers = this.threads.filter((o) => o.asleep === op.var);
          const woken = op.one ? sleepers.slice(0, 1) : sleepers;
          for (const o of woken) o.asleep = null;
          text = `notify ${op.var}: ${woken.length ? woken.map((o) => o.name).join(", ") + " woken" : "nobody asleep"}`;
          break;
        }
        case "loadi": {
          const name = op.base + (t.regs[op.index] ?? 0);
          t.regs[op.reg] = this.memory[name] ?? 0;
          text = `${op.reg} = load ${name}`;
          break;
        }
        case "storei": {
          const name = op.base + (t.regs[op.index] ?? 0);
          const v = value(op.reg !== undefined ? op.reg : op.imm);
          this.memory[name] = v;
          text = `store ${name} = ${v}`;
          break;
        }
        case "cas2": {
          while (t.buffer.length) this.#drainOne(t);
          const [a, b] = op.vars;
          const [ea, eb] = op.expect.map(value);
          const ok = this.memory[a] === ea && this.memory[b] === eb;
          const [va, vb] = op.values.map(value);
          if (ok) { this.memory[a] = va; this.memory[b] = vb; }
          t.regs[op.out] = ok ? 1 : 0;
          text = `cas ${a},${b}: expect ${ea},${eb}, new ${va},${vb} -> ${ok ? "ok" : "failed"}`;
          break;
        }
        case "note":
          text = op.text;
          break;
        default:
          throw new Error(`unknown op ${op.op}`);
      }
      if (advance) t.pc += 1;
    }
    const record = {
      n: this.steps.length + 1,
      thread: i,
      name: t.name,
      text,
      regs: { ...t.regs },
      memory: { ...this.memory },
      buffers: this.threads.map((o) => o.buffer.map((w) => `${w.var}=${w.value}`).join(" ")),
      asleep: this.threads.map((o) => o.asleep !== null),
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
  // A fixed sequence of thread indices, then alternate: for a table that must show one path.
  fixed: (sequence) => {
    let at = 0;
    const rest = schedules.alternate();
    return (m) => {
      while (at < sequence.length) {
        const i = sequence[at++];
        if (m.runnable.includes(i)) return i;
      }
      return rest(m);
    };
  },
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

//: A trace stops here even if the program has not: a loop that never ends is itself a result.
export const MAX_STEPS = 400;

// Run a program under a schedule until it finishes, sticks, or reaches MAX_STEPS; return the machine.
export function run(program, schedule, maxSteps = MAX_STEPS) {
  const m = new Machine(program);
  const pick = typeof schedule === "function" ? schedule : schedules[schedule]();
  while (m.steps.length < maxSteps) {
    const i = pick(m);
    if (i < 0) break;
    m.step(i);
  }
  return m;
}

// The steps as a markdown table, for the fragments the chapters include.
export function table(machine, variables = Object.keys(machine.program.memory)) {
  const regs = [...new Set(machine.threads.flatMap((t) => Object.keys(t.regs)))];
  const buffered = machine.steps.some((s) => s.buffers.some((b) => b));
  const names = machine.threads.map((t) => t.name);
  const head = ["Step", "Thread", "Operation", ...regs, ...(buffered ? names.map((n) => `${n}'s buffer`) : []), ...variables];
  const rows = machine.steps.map((s) => [
    String(s.n), s.name, `\`${s.text}\``,
    ...regs.map((r) => (s.regs[r] === undefined ? "" : String(s.regs[r]))),
    ...(buffered ? s.buffers.map((b) => (b ? `\`${b}\`` : "")) : []),
    ...variables.map((v) => String(s.memory[v])),
  ]);
  const line = (cells) => `| ${cells.join(" | ")} |`;
  return [line(head), line(head.map(() => "---")), ...rows.map(line)].join("\n");
}
