// The store-buffer test (experiments/store_buffer): two workers each store a one into their
// own word and then load the other's. The page counts how often both loaded a zero.

import { standardPanel } from "./panel.js";
import { programs } from "./programs.js";

const ORDERINGS = { volatile: 0, relaxed: 1, "release-acquire": 2, seq_cst: 3, fence: 4 };

export async function mount(shell) {
  standardPanel(shell, {
    hint: "Both workers begin each trial together behind a barrier; worker 0 tallies the pair of loads.",
    workers: () => 2,
    args: (v) => [v.trials, ORDERINGS[v.ordering], 0],
    tiles: (v, r) => {
      const both = r.results[1];
      return [
        { name: "trials", label: "Trials", value: r.results[0] },
        { name: "both_zero", label: "Both loaded zero", value: both, hint: both === 0 ? "never, this run" : `${((100 * both) / Math.max(1, r.results[0])).toFixed(2)}% of trials`, className: both === 0 ? "good" : "bad" },
        { name: "other", label: "Other outcomes", value: r.results[2] + r.results[3] + r.results[4], hint: `(0,1) ${r.results[2].toLocaleString("en-GB")} · (1,0) ${r.results[3].toLocaleString("en-GB")} · (1,1) ${r.results[4].toLocaleString("en-GB")}` },
      ];
    },
    bar: (v, r) => ({ value: r.results[1], of: r.results[0], label: "both zero / trials" }),
    trace: {
      program: (v) => programs.store_buffer({ ordering: v.ordering }),
      caption: "A model with a store buffer per thread: a store waits in the buffer while the load after it reads memory. A sequentially consistent store, or a fence, drains the buffer first; a release store does not wait for itself. Not the compiled code.",
    },
    native: (v) => ({
      lines: ["make native KERNEL=store_buffer", `native/build/store_buffer 2 ${v.trials} ${ORDERINGS[v.ordering]}`],
      note: "result[1] is the count of (0, 0). On x86-64 expect it to be non-zero for volatile, relaxed and release-acquire, and zero for seq_cst and fence.",
    }),
  });
}
