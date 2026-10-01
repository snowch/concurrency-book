// A lock that sleeps (experiments/mutex): the spinlock beside a lock whose waiters sleep on the
// lock word, and one that spins a little first.

import { standardPanel } from "./panel.js";
import { programs } from "./programs.js";
import { fmt } from "./shell.js";

const OPERATIONS = { spin: 0, sleep: 1, "spin-then-sleep": 2 };

export async function mount(shell) {
  standardPanel(shell, {
    args: (v) => [v.iterations, OPERATIONS[v.operation], v.work],
    tiles: (v, r) => {
      const expected = v.workers * v.iterations;
      return [
        { name: "expected", label: "Expected", value: expected, hint: `${fmt(v.workers)} × ${fmt(v.iterations)}` },
        { name: "observed", label: "Observed", value: r.results[0], className: r.results[0] === expected ? "good" : "bad" },
        { name: "spins", label: "Spins", value: r.results[1], hint: "iterations spent spinning, all workers" },
        { name: "sleeps", label: "Sleeps", value: r.results[2], hint: "times a worker slept on the lock word" },
      ];
    },
    trace: {
      program: (v) => programs.mutex({ threads: Math.min(3, v.workers), iterations: 1, variant: v.operation === "spin" ? "spin" : "sleep" }),
      caption: "A model of the lock. A spinning thread takes steps that do nothing; a sleeping thread takes none until a release wakes it. Not the compiled code.",
    },
    native: (v) => ({
      lines: ["make native KERNEL=mutex", `native/build/mutex ${v.workers} ${v.iterations} ${OPERATIONS[v.operation]} ${v.work}`],
      note: "On Linux the harness's wait and notify are futex calls, as a C library's mutex uses. result[0] is the counter, result[1] the spins, result[2] the sleeps.",
    }),
  });
}
