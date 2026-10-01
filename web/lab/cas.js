// Compare-and-swap (experiments/cas): a counter incremented by a compare-and-swap loop, with
// every retry counted, or a plain counter under a lock built from the same instruction.

import { standardPanel } from "./panel.js";
import { programs } from "./programs.js";
import { fmt } from "./shell.js";

const OPERATIONS = { cas: 0, lock: 1 };

export async function mount(shell) {
  standardPanel(shell, {
    args: (v) => [v.iterations, OPERATIONS[v.operation], 0],
    tiles: (v, r) => {
      const expected = v.workers * v.iterations;
      const observed = v.operation === "lock" ? r.results[2] : r.results[0];
      const tiles = [
        { name: "expected", label: "Expected", value: expected, hint: `${fmt(v.workers)} × ${fmt(v.iterations)}` },
        { name: "observed", label: "Observed", value: observed, hint: v.operation === "lock" ? "the counter under the lock" : "the counter", className: observed === expected ? "good" : "bad" },
      ];
      if (v.operation === "cas") {
        tiles.push(
          { name: "retries", label: "Retries", value: r.results[1], hint: expected ? `${((100 * r.results[1]) / expected).toFixed(1)}% of the increments went round again` : "" },
          { name: "most", label: "Most by one worker", value: r.results[3], hint: "the worker that lost the most contests" },
        );
      }
      return tiles;
    },
    bar: (v, r) => (v.operation === "cas" ? { value: r.results[1], of: v.workers * v.iterations, label: "retries / increments" } : null),
    trace: {
      controls: [{ name: "iterations", label: "Increments per thread in the trace", options: [1, 2, 3], default: 1 }],
      program: (v, t) => programs.cas({ threads: Math.min(4, v.workers), iterations: t.iterations }),
      caption: "A model of each thread's load, add and compare-and-swap. A failed compare goes back to the load, which is the retry the live run counts. Not the compiled code.",
    },
    native: (v) => ({
      lines: ["make native KERNEL=cas", `native/build/cas ${v.workers} ${v.iterations} ${OPERATIONS[v.operation]}`],
      note: "result[0] is the counter, result[1] the retries in total, result[2] the counter under the lock, result[3] the most retries by one worker.",
    }),
  });
}
