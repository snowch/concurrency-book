// A handshake (experiments/handshake): ping, pong, round after round, by sleeping and waking or
// by spinning; the cost of a wake-up per round trip.

import { standardPanel } from "./panel.js";
import { programs } from "./programs.js";
import { fmt } from "./shell.js";

const WAITING = { "sleep and wake": 0, spin: 1 };

export async function mount(shell) {
  standardPanel(shell, {
    hint: "Worker 0 says ping and waits for pong; worker 1 waits for ping and says pong.",
    workers: () => 2,
    args: (v) => [v.rounds, WAITING[v.waiting], 0],
    tiles: (v, r) => {
      const per = (1e6 * r.elapsedMs) / Math.max(1, r.results[0]);
      return [
        { name: "rounds", label: "Round trips", value: r.results[0], className: r.results[0] === v.rounds ? "good" : "bad" },
        { name: "sleeps", label: "Sleeps", value: r.results[1] },
        { name: "spins", label: "Spins", value: r.results[2] },
        { name: "per_round", label: "Per round trip", value: Math.round(per), text: per >= 1000 ? `${(per / 1000).toFixed(1)} µs` : `${Math.round(per)} ns`, hint: "wall time over round trips, on this device" },
      ];
    },
    trace: {
      program: (v) => programs.handshake({ variant: v.waiting }),
      caption: "A model of the two workers. With sleep and wake, a waiting worker takes no steps until the other's notify; with spinning it takes steps that change nothing. Not the compiled code.",
    },
    native: (v) => ({
      lines: ["make native KERNEL=handshake", `native/build/handshake 2 ${v.rounds} ${WAITING[v.waiting]}`],
      note: `On Linux the harness's wait and wake are futex calls. result[0] is the round trips, result[1] the sleeps, result[2] the spins; the time printed over ${fmt(v.rounds)} round trips is the cost per wake-up, times two.`,
    }),
  });
}
