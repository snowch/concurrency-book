// The shared counter (experiments/counter): workers increment one variable, plainly or
// atomically, and the page compares the count with what it should be.

import { standardPanel } from "./panel.js";
import { programs } from "./programs.js";
import { fmt } from "./shell.js";

//: The kernel's `b` argument for each operation the page offers (counter.c, cm_run).
const OPERATIONS = { plain: 0, atomic: 1, folded: 2, split: 3 };

export async function mount(shell) {
  standardPanel(shell, {
    hint: "Runs the kernel on fresh workers each time; the counter is read from their shared memory.",
    args: (v) => [v.iterations, OPERATIONS[v.operation], 0],
    tiles: (v, r) => {
      const expected = v.workers * v.iterations;
      // The plain and folded increments count in `counter`; the atomic and split ones in
      // `atomic_counter`: result 0 and result 1 of the kernel.
      const observed = v.operation === "atomic" || v.operation === "split" ? r.results[1] : r.results[0];
      const lost = expected - observed;
      return [
        { name: "expected", label: "Expected", value: expected, hint: `${fmt(v.workers)} × ${fmt(v.iterations)}` },
        { name: "observed", label: "Observed", value: observed, hint: `the ${v.operation} counter` },
        { name: "lost", label: "Lost", value: lost, hint: lost === 0 ? "nothing lost" : `${((100 * lost) / expected).toFixed(1)}% of the increments`, className: lost === 0 ? "good" : "bad" },
      ];
    },
    bar: (v, r) => {
      const observed = v.operation === "atomic" || v.operation === "split" ? r.results[1] : r.results[0];
      return { value: observed, of: v.workers * v.iterations, label: "observed / expected" };
    },
    trace: {
      controls: [{ name: "iterations", label: "Increments per thread in the trace", options: [1, 2, 3, 4, 5], default: 2 }],
      program: (v, t) => programs.counter({ threads: Math.min(4, v.workers), iterations: t.iterations, operation: v.operation }),
      caption: "A model of the operations the source hides, interleaved as the schedule says. It is not the compiled code: the live run is. Threads beyond four are left out of the trace.",
    },
    native: (v) => ({
      lines: ["# the same kernel, on pthreads; Appendix A has what you need installed", "make native KERNEL=counter", `native/build/counter ${v.workers} ${v.iterations} ${OPERATIONS[v.operation]}`],
      note: "The harness prints result[0], the plain counter, and result[1], the atomic one, then the wall time. Run it more than once: a count that can be lost changes every time.",
    }),
  });
}
