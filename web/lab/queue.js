// A bounded queue (experiments/queue): producers and consumers through a ring of slots, in three
// designs. The page checks that every item arrived once and in order.

import { standardPanel } from "./panel.js";
import { fmt } from "./shell.js";

const STEPS = { "one-to-one ring": 0, "claimed positions": 1, "sequenced slots": 2 };

export async function mount(shell) {
  standardPanel(shell, {
    hint: "The first workers produce, the rest consume; a producer that finds the queue full for too long drops the item.",
    workers: (v) => v.producers + v.consumers,
    args: (v) => [v.items, STEPS[v.step], v.producers],
    tiles: (v, r) => {
      const [enqueued, dequeued, unwritten, disordered, duplicated, dropped] = r.results;
      const lost = enqueued - (dequeued - unwritten);
      return [
        { name: "enqueued", label: "Enqueued", value: enqueued, hint: dropped ? `${fmt(dropped)} dropped by producers` : `${fmt(v.producers)} × ${fmt(v.items)}` },
        { name: "dequeued", label: "Dequeued", value: dequeued - unwritten, hint: lost === 0 ? "every item came out" : `${fmt(lost)} items never came out`, className: lost === 0 ? "good" : "bad" },
        { name: "unwritten", label: "Unwritten slots", value: unwritten, className: unwritten === 0 ? "good" : "bad", hint: unwritten === 0 ? "" : "a consumer claimed a slot before its producer filled it" },
        { name: "disordered", label: "Out of order", value: disordered, className: disordered === 0 ? "good" : "bad" },
        { name: "duplicated", label: "Seen twice", value: duplicated, className: duplicated === 0 ? "good" : "bad" },
        { name: "dropped", label: "Dropped", value: dropped, className: dropped === 0 ? "good" : "" },
      ];
    },
    native: (v) => ({
      lines: ["make native KERNEL=queue", `native/build/queue ${v.producers + v.consumers} ${v.items} ${STEPS[v.step]} ${v.producers}`],
      note: "result[0] is the items enqueued, result[1] the dequeues, result[2] the unwritten slots read, result[3] out of order, result[4] seen twice, result[5] dropped.",
    }),
  });
}
