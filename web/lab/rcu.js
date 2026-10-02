// Read-copy-update (experiments/rcu): readers never wait; the writer waits for a grace period.

import { standardPanel } from "./panel.js";
import { programs } from "./programs.js";

const GRACE = { "reuses at once": 0, "waits for a grace period": 1 };

export async function mount(shell) {
  standardPanel(shell, {
    hint: "Worker 0 writes; the others read until the writer is done.",
    workers: (v) => v.readers + 1,
    args: (v) => [v.updates, GRACE[v.grace], v.readers],
    tiles: (v, r) => [
      { name: "reads", label: "Reads", value: r.results[0] },
      { name: "poisoned", label: "Poisoned reads", value: r.results[1], className: r.results[1] === 0 ? "good" : "bad", hint: r.results[1] === 0 ? "no record was reused under a reader" : "a record was reused during a read" },
      { name: "waits", label: "Grace-period waits", value: r.results[3], hint: GRACE[v.grace] ? "spins until every reader passed a quiescent state" : "the writer never waits" },
    ],
    trace: {
      program: (v) => programs.rcu({ variant: v.grace }),
      caption: "A model of one writer and one reader. The reader notes the epoch between reads; the writer publishes, moves the epoch on, and waits until the reader has noted it before poisoning the old record. Not the compiled code.",
    },
    native: (v) => ({
      lines: ["make native KERNEL=rcu", `native/build/rcu ${v.readers + 1} ${v.updates} ${GRACE[v.grace]} ${v.readers}`],
      note: "result[1] is the poisoned reads and result[3] the grace-period waits.",
    }),
  });
}
