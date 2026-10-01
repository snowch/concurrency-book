// Publishing a value through a flag (experiments/publication): a writer stores a value and then
// raises a flag; a reader waits for the flag and reads the value. The page counts the trials
// where the flag arrived before the value.

import { standardPanel } from "./panel.js";
import { programs } from "./programs.js";

const ORDERINGS = { volatile: 0, relaxed: 1, "release-acquire": 2, seq_cst: 3 };

export async function mount(shell) {
  standardPanel(shell, {
    hint: "Worker 0 writes, worker 1 reads, one trial after another; the stale count is the reader's.",
    workers: () => 2,
    args: (v) => [v.trials, ORDERINGS[v.ordering], 0],
    tiles: (v, r) => [
      { name: "trials", label: "Trials", value: r.results[0] },
      { name: "stale", label: "Stale reads", value: r.results[1], hint: r.results[1] === 0 ? "the data always arrived with the flag, this run" : `${((100 * r.results[1]) / Math.max(1, r.results[0])).toFixed(2)}% of trials saw the flag before the value`, className: r.results[1] === 0 ? "good" : "bad" },
    ],
    bar: (v, r) => ({ value: r.results[0] - r.results[1], of: r.results[0], label: "trials with the data" }),
    trace: {
      controls: [{ name: "reorder", label: "The writer's stores reach memory", options: ["flag first", "in order"], default: "flag first" }],
      program: (v, t) => programs.publication({ ordering: v.ordering, reorder: t.reorder === "flag first" }),
      caption: "A model with a store buffer per thread. Under volatile or relaxed the flag's store may reach memory before the data's; a release store lets nothing before it overtake it. The model does not reorder the reader's loads, which a weakly ordered processor also may. Not the compiled code.",
    },
    native: (v) => ({
      lines: ["make native KERNEL=publication", `native/build/publication 2 ${v.trials} ${ORDERINGS[v.ordering]}`],
      note: "result[0] is the trials completed and result[1] the stale reads. On x86-64 expect none under any ordering; on AArch64 expect some under volatile and relaxed.",
    }),
  });
}
