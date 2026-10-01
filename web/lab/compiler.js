// The compiler's loop (experiments/compiler): one worker waits for a flag another sets. Whether
// the waiter ever sees it depends on what the compiler emitted for the loop.

import { standardPanel } from "./panel.js";
import { programs } from "./programs.js";

const FLAGS = { plain: 0, volatile: 1, atomic: 2 };

export async function mount(shell) {
  standardPanel(shell, {
    hint: "Worker 0 waits in the loop; worker 1 sets the flag after its busy steps. A loop that never reads the flag again never ends, and the run is stopped at the timeout.",
    workers: () => 2,
    args: (v) => [v.delay, FLAGS[v.flag], 0],
    tiles: (v, r) => {
      const seen = r.results[0];
      const returned = r.results[1] === 1;
      shell.root.dataset.outcome = returned ? "returned" : "hung";
      return [
        { name: "outcomeText", label: "Outcome", value: returned ? "the loop ended" : "the loop did not end", text: returned ? "the loop ended" : "did not end", className: returned && seen === 1 ? "good" : "bad" },
        { name: "seen", label: "Value the loop ended on", value: seen, hint: seen === 1 ? "the flag, as set" : seen === 0 ? "zero: it stopped without seeing the flag" : "" },
      ];
    },
    onTimeout: (v) => `With a ${v.flag} flag the loop the compiler emitted never reads the flag again: see the fragment under At the machine.`,
    trace: {
      program: (v) => programs.compiler({ variant: v.flag }),
      caption: "A model of the loop as the compiler emitted it, not the source: for a plain flag, one load before the loop and a test of the register forever; for a volatile or atomic flag, a load every time round. The trace stops after a few hundred steps if the loop does not.",
    },
    native: (v) => ({
      lines: ["make native KERNEL=compiler", `timeout 5 native/build/compiler 2 ${v.delay} ${FLAGS[v.flag]}`],
      note: "result[0] is the value the waiter's loop ended on and result[1] whether it ended. With the plain flag the harness is killed by the timeout, which is the result.",
    }),
  });
}
