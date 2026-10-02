#!/usr/bin/env node
// Write the deterministic trace tables the chapters include, from the same model the page runs.
//
//     node tools/trace.mjs            # chapters/_generated/*-trace-*.md
//     node tools/trace.mjs --check    # fail if a committed table is not what the model computes
//
// One implementation of the model (web/lab/trace.js) serves the page and the build, so the table
// a chapter shows and the trace a reader steps through cannot disagree.

import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { run, table, schedules, listing } from "../web/lab/trace.js";
import { programs } from "../web/lab/programs.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const GENERATED = path.join(ROOT, "chapters", "_generated");

// Every table, with the conditions it was computed under, which the fragment states.
const TABLES = [
  {
    file: "counter-trace-alternate.md",
    program: programs.counter({ threads: 2, iterations: 2 }),
    schedule: "alternate",
    conditions: "Two threads, two plain increments each, one operation from each thread in turn.",
  },
  {
    file: "counter-trace-sequential.md",
    program: programs.counter({ threads: 2, iterations: 2 }),
    schedule: "sequential",
    conditions: "Two threads, two plain increments each, the first thread running to the end before the second starts.",
  },
  {
    file: "counter-trace-atomic.md",
    program: programs.counter({ threads: 2, iterations: 2, operation: "atomic" }),
    schedule: "alternate",
    conditions: "Two threads, two atomic increments each, one operation from each thread in turn.",
  },
  {
    file: "counter-trace-folded.md",
    program: programs.counter({ threads: 2, iterations: 1000, operation: "folded" }),
    schedule: "alternate",
    conditions: "Two threads, a thousand increments each folded into one add, one operation from each thread in turn.",
  },
  {
    file: "counter-trace-split.md",
    program: programs.counter({ threads: 2, iterations: 2, operation: "split" }),
    schedule: "alternate",
    conditions: "Two threads, two increments each as an atomic load and an atomic store, one operation from each thread in turn.",
  },
  {
    file: "cas-trace-alternate.md",
    program: programs.cas({ threads: 2, iterations: 1 }),
    schedule: "alternate",
    conditions: "Two threads, one increment each by compare-and-swap, one operation from each thread in turn; a failed compare goes back to the load.",
  },
  {
    file: "spinlock-trace-tas.md",
    program: programs.spinlock({ threads: 2, iterations: 1, variant: "tas" }),
    schedule: "alternate",
    conditions: "Two threads, one critical section each behind a test-and-set lock, one operation from each thread in turn; a thread that finds the lock held goes round again.",
  },
  {
    file: "spinlock-trace-broken.md",
    program: programs.spinlock({ threads: 2, iterations: 1, variant: "broken" }),
    schedule: "alternate",
    conditions: "Two threads, one critical section each behind a test-then-set that is not a lock, one operation from each thread in turn.",
  },
  {
    file: "mutex-trace-sleep.md",
    program: programs.mutex({ threads: 2, iterations: 1, variant: "sleep" }),
    schedule: "alternate",
    conditions: "Two threads, one critical section each behind the sleeping lock, one operation from each thread in turn; a sleeping thread takes no steps until woken.",
  },
  {
    file: "compiler-trace-plain.md",
    program: programs.compiler({ variant: "plain" }),
    schedule: "alternate",
    conditions: "The loop as the optimiser emitted it for a plain flag: one load before the loop, then a test of the register forever. Stopped after a few steps; it would not stop by itself.",
    maxSteps: 8,
  },
  {
    file: "publication-trace-reordered.md",
    program: programs.publication({ ordering: "volatile", reorder: true }),
    schedule: schedules.fixed([0, 1, 0, 1, 0, 1, 1, 1, 1, 0]),
    conditions: "A writer and a reader; nothing orders the writer's two stores, and the flag's store reaches memory before the data's, as a weakly ordered processor allows.",
  },
  {
    file: "publication-trace-release.md",
    program: programs.publication({ ordering: "release-acquire" }),
    schedule: "alternate",
    conditions: "A writer and a reader; the flag's store is a release, so the data's store reaches memory before it.",
  },
  {
    file: "store_buffer-trace-buffered.md",
    program: programs.store_buffer({ ordering: "volatile" }),
    schedule: "alternate",
    conditions: "Two threads with a store buffer each; a store waits in the buffer while the load after it reads memory.",
  },
  {
    file: "store_buffer-trace-fence.md",
    program: programs.store_buffer({ ordering: "fence" }),
    schedule: "alternate",
    conditions: "Two threads with a store buffer each, and a fence between each thread's store and its load, which drains the buffer.",
  },
  {
    file: "stack-trace-broken.md",
    program: programs.stack({ variant: "broken" }),
    schedule: "alternate",
    conditions: "A stack of three nodes and two threads popping once each, with a pop that reads then stores in two steps, one operation from each thread in turn.",
  },
  {
    file: "stack-trace-cas.md",
    program: programs.stack({ variant: "cas" }),
    schedule: "alternate",
    conditions: "A stack of three nodes and two threads popping once each by compare-and-swap, one operation from each thread in turn.",
  },
  {
    file: "aba-trace-plain.md",
    program: programs.aba({ variant: "plain" }),
    schedule: schedules.fixed([0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0]),
    conditions: "A begins a pop and reads the node below the top; B pops twice and pushes the first node back; A's compare-and-swap then runs.",
  },
  {
    file: "aba-trace-tagged.md",
    program: programs.aba({ variant: "tagged" }),
    schedule: schedules.fixed([0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0]),
    conditions: "The same interleaving with a tagged head, where every swing adds one to the tag.",
  },
  {
    file: "reclamation-trace-none.md",
    program: programs.reclamation({ variant: "none" }),
    schedule: schedules.fixed([1, 0, 0, 0, 0, 1, 1]),
    conditions: "The reader follows the pointer to record 1; the writer publishes record 2 and poisons record 1 at once; the reader then reads record 1.",
  },
  {
    file: "reclamation-trace-hazard.md",
    program: programs.reclamation({ variant: "hazard pointers" }),
    schedule: schedules.fixed([1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 1, 1, 1, 0, 0]),
    conditions: "The reader announces record 1 in its hazard pointer; the writer publishes record 2 and spins while the hazard names record 1; the reader finishes and clears it.",
  },
  {
    file: "rcu-trace-grace.md",
    program: programs.rcu({ variant: "waits for a grace period" }),
    schedule: schedules.fixed([1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0]),
    conditions: "The reader notes the epoch and follows the pointer; the writer publishes, moves the epoch on, and spins until the reader has noted the new epoch; only then does it poison record 1.",
  },
  {
    file: "challenge-trace-written.md",
    program: programs.challenge({ variant: "as written" }),
    schedule: "alternate",
    conditions: "One seat left and two workers, each checking, confirming and taking the seat with plain accesses, one operation from each worker in turn.",
  },
  {
    file: "challenge-trace-cas.md",
    program: programs.challenge({ variant: "compare-and-swap" }),
    schedule: "alternate",
    conditions: "One seat left and two workers, each taking the seat by compare-and-swap, one operation from each worker in turn.",
  },
  {
    file: "handshake-trace-sleep.md",
    program: programs.handshake({ variant: "sleep and wake" }),
    schedule: "alternate",
    conditions: "One round trip: A says ping and sleeps on pong; B sleeps on ping, wakes, says pong.",
  },
  {
    file: "compiler-trace-volatile.md",
    program: programs.compiler({ variant: "volatile" }),
    schedule: "alternate",
    conditions: "The loop as emitted for a volatile or atomic flag: a load every time round.",
  },
];

// The programs a chapter shows beside the C they mirror, as the machine lists them before a
// run: one line per operation, with the line of the kernel the operation's group came from.
const LISTINGS = [
  {
    file: "counter-program-plain.md",
    program: programs.counter({ threads: 1, iterations: 1 }),
    conditions: "One thread, one plain increment.",
  },
];

function listingFragment(l) {
  const ops = l.program.threads[0].ops;
  const rows = ops.map((op, k) => `| ${k} | \`${listing(op)}\` | ${op.src ? "`" + op.src + "`" : ""} |`);
  return (
    "% Generated by tools/trace.mjs from web/lab/programs.js. Do not edit.\n" +
    "| # | Operation | Mirrors |\n| --- | --- | --- |\n" + rows.join("\n") + "\n\n" +
    `*A teaching program written by hand to mirror the C, as the model runs it: not the compiled code, and not compiler output. ${l.conditions}*\n`
  );
}

function fragment(t) {
  const m = run(t.program, t.schedule, t.maxSteps);
  const [name, expected] = Object.entries(t.program.expected)[0];
  const got = m.memory[name];
  const summary = t.program.outcome
    ? `Outcome: ${t.program.outcome(m.memory)}.`
    : m.done
    ? `Expected \`${name}\` = ${expected}; final \`${name}\` = ${got}; lost ${expected - got}.`
    : m.stuck
      ? `Every thread is asleep: the trace cannot go on. \`${name}\` = ${got}.`
      : `Stopped after ${m.steps.length} steps without finishing. \`${name}\` = ${got}.`;
  return (
    "% Generated by tools/trace.mjs from web/lab/trace.js. Do not edit.\n" +
    table(m) + "\n\n" + summary + "\n\n" +
    `*A model of each thread's operations, not the compiled code. ${t.conditions}*\n`
  );
}

const check = process.argv.includes("--check");
let bad = 0;
const made = new Map([...TABLES.map((t) => [t.file, fragment(t)]), ...LISTINGS.map((l) => [l.file, listingFragment(l)])]);
for (const [file, text] of made) {
  const target = path.join(GENERATED, file);
  if (check) {
    if (!existsSync(target)) { console.log(`  missing: chapters/_generated/${file} (run \`make traces\`)`); bad++; }
    else if (readFileSync(target, "utf8") !== text) { console.log(`  stale: chapters/_generated/${file} (run \`make traces\`)`); bad++; }
  } else {
    writeFileSync(target, text);
  }
}
if (check) {
  for (const f of readdirSync(GENERATED)) {
    if (f.endsWith(".md") && !made.has(f) && readFileSync(path.join(GENERATED, f), "utf8").startsWith("% Generated by tools/trace.mjs")) {
      console.log(`  orphan: chapters/_generated/${f} (no table asks for it)`); bad++;
    }
  }
  if (!bad) console.log(`  ${made.size} trace tables and listings are what the model computes`);
  process.exit(bad ? 1 : 0);
}
console.log(`  wrote ${made.size} trace tables and listings into chapters/_generated`);
