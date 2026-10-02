// A lock-free stack (experiments/stack): every worker pushes its nodes and pops as many as it
// can; the page accounts for every node.

import { standardPanel } from "./panel.js";
import { programs } from "./programs.js";
import { fmt } from "./shell.js";

const OPERATIONS = { cas: 0, broken: 1 };

export async function mount(shell) {
  standardPanel(shell, {
    args: (v) => [v.nodes, OPERATIONS[v.operation], 0],
    tiles: (v, r) => {
      const pushed = v.workers * v.nodes;
      const [popped, remaining, twice, once] = r.results;
      const lost = pushed - once - twice - remaining;
      return [
        { name: "pushed", label: "Pushed", value: pushed, hint: `${fmt(v.workers)} × ${fmt(v.nodes)}` },
        { name: "popped", label: "Popped", value: popped, hint: `${fmt(r.results[4])} pops found the stack empty` },
        { name: "remaining", label: "Still in the stack", value: remaining },
        { name: "twice", label: "Popped twice", value: twice, className: twice === 0 ? "good" : "bad", hint: twice === 0 ? "every node to one owner" : "one node, two owners" },
        { name: "lost", label: "Lost", value: lost, className: lost === 0 ? "good" : "bad", hint: lost === 0 ? "every node accounted for" : "neither popped nor in the stack" },
      ];
    },
    trace: {
      program: (v) => programs.stack({ variant: v.operation }),
      caption: "A model of two threads popping once each from a stack of three nodes. The broken pop reads, then stores; the compare-and-swap pop swings the head only if the top is unchanged. Not the compiled code.",
    },
    native: (v) => ({
      lines: ["make native KERNEL=stack", `native/build/stack ${v.workers} ${v.nodes} ${OPERATIONS[v.operation]}`],
      note: "result[0] is the pops, result[1] the nodes still in the stack, result[2] nodes popped twice, result[3] nodes popped once, result[4] pops that found it empty.",
    }),
  });
}
