// A spinlock (experiments/spinlock): test-and-set, test then test-and-set, and a test-then-set
// that is not a lock, with the spins each worker made while waiting.

import { standardPanel, perWorkerBars } from "./panel.js";
import { programs } from "./programs.js";
import { fmt } from "./shell.js";

const OPERATIONS = { tas: 0, ttas: 1, broken: 2 };

export async function mount(shell) {
  standardPanel(shell, {
    args: (v) => [v.iterations, OPERATIONS[v.operation], v.work],
    tiles: (v, r) => {
      const expected = v.workers * v.iterations;
      const observed = r.results[0];
      return [
        { name: "expected", label: "Expected", value: expected, hint: `${fmt(v.workers)} × ${fmt(v.iterations)}` },
        { name: "observed", label: "Observed", value: observed, hint: observed === expected ? "every critical section counted" : `${fmt(expected - observed)} lost: two workers were inside at once`, className: observed === expected ? "good" : "bad" },
        { name: "spins", label: "Spins", value: r.results[1], hint: "iterations spent waiting, all workers" },
      ];
    },
    after: (v, r, box) => perWorkerBars(box, r.results.slice(2, 2 + v.workers), "Spins per worker: who waited most"),
    trace: {
      program: (v) => programs.spinlock({ threads: Math.min(4, v.workers), iterations: 1, variant: v.operation }),
      caption: "A model of each thread's acquire, critical section and release. A thread that finds the lock held takes a step that changes nothing: a spin. Not the compiled code.",
    },
    native: (v) => ({
      lines: ["make native KERNEL=spinlock", `native/build/spinlock ${v.workers} ${v.iterations} ${OPERATIONS[v.operation]} ${v.work}`],
      note: "result[0] is the counter, result[1] the spins in total, then each worker's spins.",
    }),
  });
}
