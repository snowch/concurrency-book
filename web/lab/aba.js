// The ABA problem (experiments/aba): workers pop a node and push it back on a stack of three,
// so that the head leaves and returns while another worker is mid-pop.

import { standardPanel } from "./panel.js";
import { programs } from "./programs.js";

const HEADS = { plain: 0, tagged: 1 };

export async function mount(shell) {
  standardPanel(shell, {
    args: (v) => [v.rounds, HEADS[v.head], 0],
    tiles: (v, r) => [
      { name: "pops", label: "Pops", value: r.results[0] },
      { name: "corrupt", label: "Not in the stack", value: r.results[1], className: r.results[1] === 0 ? "good" : "bad", hint: r.results[1] === 0 ? "every pop returned a pushed node" : "the head was swung to a node somebody held" },
      { name: "in_stack", label: "In the stack at the end", value: r.results[2], hint: r.results[2] === 3 ? "the three it started with" : r.results[2] >= 8 ? "more than the pool holds: the stack loops" : "not the three it started with", className: r.results[2] === 3 ? "good" : "bad" },
    ],
    trace: {
      program: (v) => programs.aba({ variant: v.head }),
      caption: "The classic interleaving, as a model: A reads the head and the node below; B pops twice and pushes the first node back; A's compare-and-swap runs. Step it by hand in that order, or press Run to the end, which uses the alternate schedule and may not reproduce it. Not the compiled code.",
    },
    native: (v) => ({
      lines: ["make native KERNEL=aba", `native/build/aba ${v.workers} ${v.rounds} ${HEADS[v.head]}`],
      note: "result[1] is the pops of a node nobody had pushed; result[2] the nodes in the stack at the end, three if it is intact.",
    }),
  });
}
