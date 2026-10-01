// The programs the deterministic traces run: what each kernel's threads do, as the model's
// operations. Each is a function of the settings a chapter or a reader chooses, and each says
// what result to expect, so a trace can report what was lost.

const NAMES = ["A", "B", "C", "D", "E", "F", "G", "H"];

// The counter kernel. `operation` is the page's: plain (load, add, store, per increment),
// atomic (one indivisible add per increment), split (an atomic load, an add, an atomic store:
// three steps again) or folded (one load, one add of the whole count, one store per thread).
export function counter({ threads = 2, iterations = 2, operation = "plain" } = {}) {
  const ops = [];
  if (operation === "folded") {
    ops.push({ op: "load", reg: "r", var: "counter" }, { op: "add", reg: "r", imm: iterations }, { op: "store", var: "counter", reg: "r" });
  } else {
    for (let i = 0; i < iterations; i++) {
      if (operation === "atomic") ops.push({ op: "rmw_add", var: "counter", imm: 1 });
      else ops.push({ op: "load", reg: "r", var: "counter" }, { op: "add", reg: "r", imm: 1 }, { op: "store", var: "counter", reg: "r" });
    }
  }
  return {
    memory: { counter: 0 },
    threads: Array.from({ length: threads }, (_, i) => ({ name: NAMES[i] || `T${i}`, ops: [...ops] })),
    expected: { counter: threads * iterations },
  };
}

export const programs = { counter };
