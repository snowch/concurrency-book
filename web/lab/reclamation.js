// Reclaiming a record readers may hold (experiments/reclamation): a writer retires records while
// readers follow the pointer, with and without hazard pointers.

import { standardPanel } from "./panel.js";
import { programs } from "./programs.js";

const PROTECTION = { none: 0, "hazard pointers": 1 };

export async function mount(shell) {
  standardPanel(shell, {
    hint: "Worker 0 writes; the others read until the writer is done.",
    workers: (v) => v.readers + 1,
    args: (v) => [v.updates, PROTECTION[v.protection], v.readers],
    tiles: (v, r) => [
      { name: "reads", label: "Reads", value: r.results[0] },
      { name: "poisoned", label: "Poisoned reads", value: r.results[1], className: r.results[1] === 0 ? "good" : "bad", hint: r.results[1] === 0 ? "no record was reused under a reader" : "a record was reused while a reader held it" },
      { name: "waits", label: "Writer waits", value: r.results[3], hint: v.protection === "none" ? "the writer never waits" : "spins while a hazard named the old record" },
    ],
    trace: {
      program: (v) => programs.reclamation({ variant: v.protection }),
      caption: "A model of one writer and one reader. Without protection the writer poisons the old record as soon as it has published the new one; with a hazard pointer it spins while the reader's hazard names the old record. Not the compiled code.",
    },
    native: (v) => ({
      lines: ["make native KERNEL=reclamation", `native/build/reclamation ${v.readers + 1} ${v.updates} ${PROTECTION[v.protection]} ${v.readers}`],
      note: "result[1] is the poisoned reads and result[3] the writer's waits.",
    }),
  });
}
