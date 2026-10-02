// The booking office (experiments/challenge): workers book seats until refused; the office as
// written sells seats it does not have.

import { standardPanel } from "./panel.js";
import { programs } from "./programs.js";
import { fmt } from "./shell.js";

const VERSIONS = { "as written": 0, "with atomics": 1, "compare-and-swap": 2, "under a lock": 3 };

export async function mount(shell) {
  standardPanel(shell, {
    hint: "Every worker books until the office refuses; the page compares the bookings with the seats on sale.",
    args: (v) => [v.seats, VERSIONS[v.version], v.steps],
    tiles: (v, r) => {
      const [capacity, booked, left] = r.results;
      const oversold = booked - capacity;
      return [
        { name: "capacity", label: "Seats on sale", value: capacity },
        { name: "booked", label: "Booked", value: booked, className: booked === capacity ? "good" : "bad" },
        { name: "oversold", label: "Oversold", value: oversold, className: oversold === 0 ? "good" : "bad", hint: oversold === 0 ? "every seat sold once" : `${fmt(oversold)} seats sold that did not exist` },
        { name: "left", label: "Seats left", value: left, hint: left < 0 ? "below zero: the count went negative" : "" },
      ];
    },
    trace: {
      program: (v) => programs.challenge({ variant: v.version }),
      caption: "A model of two workers and the last seat. Each checks that a seat is left, confirms, and takes it. Not the compiled code.",
    },
    native: (v) => ({
      lines: ["make native KERNEL=challenge", `native/build/challenge ${v.workers} ${v.seats} ${VERSIONS[v.version]} ${v.steps}`],
      note: "result[0] is the seats on sale, result[1] the seats booked, result[2] the seats left; booked above the capacity, or seats left below zero, is the bug.",
    }),
  });
}
