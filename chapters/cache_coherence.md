---
title: Cache coherence
---

(cache-coherence)=
# Cache coherence

## The question

If every core has its own cache, how does a write by one ever reach another?

Part III treated memory as one place that stores reach sooner or later. It is not one place. Each
core keeps copies of the memory it uses in caches of its own, a few tens of kilobytes close to
the core and a few megabytes further out, and reads and writes those copies, not the memory. A
counter that four workers increment is in four caches at once. The promise that every core sees
one order of stores to it, which [ch09](#relaxed-atomics) called coherence, is kept by a protocol
between the caches, and the protocol has a cost that the atomic increment of
[ch03](#atomic-operations) paid without saying so. This chapter measures it.

## The smallest program

Every worker increments a counter of its own with an atomic add. The kernel decides where each
worker's counter lives:

```{literalinclude} ../experiments/sharing/sharing.c
:language: c
:start-at: /* Enough words for sixteen workers
:end-before: /* a: increments per worker
```

The *same word* layout puts every worker on the first word: the counter of ch03, shared. The *own
line* layout puts each worker's word sixty-four bytes from the next. Between them, *same line*
gives each worker a word of its own, side by side with the others', which is
[ch13](#false-sharing)'s subject. The work is identical in every layout; only the addresses differ.

## Run it

```lab
experiment: sharing
workers: 4
layout: compare
```

Try these, in order:

1. **Run it.** The panel runs the three layouts one after the other with the same count, and
   shows each one's time. Every count is exact. The *same word* run takes many times as long as
   the *own line* run, on a device with more than one core, and the note under the bars says how
   many times on this one.
2. **Add workers.** The gap widens. More cores asking for the same word means the word's cache
   line spends more of its time in transit.
3. **One worker.** The gap closes: one core, one cache, the line stays put, and every layout costs
   the same.
4. **Pick *same line* alone.** As slow as *same word*, though no two workers touch the same
   variable. Hold that thought for ch13.

## What the source hides

A cache does not hold words; it holds lines, sixty-four bytes on most cores for the three
instruction sets, a hundred and twenty-eight on some; the size is the core's, not the instruction
set's, and it holds them in states. The simplest protocol worth describing has four: a line may be
*modified* in one cache and nowhere else, *exclusive* to one cache but unchanged, *shared* by
several caches for reading, or *invalid*. A core may read a line it holds in any state but invalid.
A core may write a line only when it holds it modified or exclusive, which means every other
cache's copy has been invalidated first.

So an atomic increment of a shared word, on a core whose cache holds the line in shared state,
costs this: ask the other caches to give up their copies, wait until they have, perform the add,
and hold the line modified. The next core to increment must take the line away in turn, and the
modified data travels with it. The line bounces between the cores, and every bounce is a round trip
across the chip, and the tile's nanoseconds per increment say what this device charged for it. That
is the time the panel measured. Nothing in the increment instruction mentions it, and the
instruction count is the same in every layout.

The protocol is also what makes [ch09](#relaxed-atomics)'s one order per variable true. There is
one modified copy at a time, every write goes to it, and every core that wants to read must get
the line from whoever holds it. Coherence is a property of a line.

## At the machine

The increment, which is the same instruction in every layout:

::::{tab-set}
:::{tab-item} x86-64
:sync: x86-64
```{include} _generated/sharing-bump-x86-64.md
```
:::
:::{tab-item} AArch64
:sync: aarch64
```{include} _generated/sharing-bump-aarch64.md
```
:::
:::{tab-item} RISC-V
:sync: riscv64
```{include} _generated/sharing-bump-riscv64.md
```
:::
:::{tab-item} WebAssembly
:sync: wasm
```{include} _generated/sharing-bump-wasm.md
```
:::
::::

One locked `inc`, one exclusive-load-and-store loop, one `amoadd.w`, one `i32.atomic.rmw.add`,
exactly as in [ch03](#atomic-operations), with the address in a register rather than a symbol
because the kernel passed it in. There is no instruction for the coherence traffic. The instruction
set describes what a core does to its own view of memory; the protocol that keeps the views
coherent is below it, in the microarchitecture, and the only way to see it from a program is to
time it. That is why this chapter's experiment has no trace: the model of operations in Part I has
nothing to say about where a line is.

The AArch64 loop shows one thing the others hide. `ldxr` marks the address and `stxr` stores only
if nothing else has written near it since; how near is the core's choice, and on most cores it is
the line. Under heavy sharing the loop can run several times per increment, which is the protocol's
cost appearing in the instruction stream.

## Fix one thing

The fix is to stop sharing the line. This panel is locked to *own line*: each worker's counter
sixty-four bytes from the next, so, where a line is sixty-four bytes, each line lives in one cache
and never moves.

```lab
experiment: sharing
workers: 4
layout: own line
lock: layout
```

The counts are the same. The time is the time of the add. If the program needs one total, it can
add the per-worker counters when the work is done, once, instead of paying a bounce per
increment. That design, counters per thread combined at the end, is the usual answer to a hot
shared counter, and [ch21](#contention-and-scalability) measures how far it scales.

## Break it again

Put the counters back on one line, each worker with a word of its own: *same line*. The time
returns to *same word*'s, and the next chapter is about why.

## The mental model

:::{div}
:class: model

**Memory is cached in lines, and a line is in one of a few states per cache.** Reading needs a
copy; writing needs the only copy. Every write to a line another cache holds invalidates that
copy first.

**Coherence is kept by a protocol, and the protocol is traffic.** A shared word that several cores
write bounces between their caches, and the bounce costs a round trip across the chip per write.

**Nothing in the instruction set shows it.** Same instruction, same count, different address,
different time. Timing is the only instrument.
:::

## What this cannot tell you

**Your processor's protocol.** MESI is the four-state model; real processors add states and
directories, and a browser does not say which processor it runs on. The panel measures the
effect, not the mechanism.

**The line size.** Sixty-four bytes on most cores, a hundred and twenty-eight on some, including
Apple's AArch64 cores. The *two lines apart* layout exists for them.

**The time of one bounce.** The live time is a whole run under the browser's scheduling. The
ratio between layouts is the result; the absolute time is not.

## Where to go next

- **The protocol.** Mark Papamarcos and Janak Patel, *A Low-Overhead Coherence Solution for
  Multiprocessors with Private Cache Memories*, ISCA 1984: MESI.
- **The textbook.** Daniel Sorin, Mark Hill and David Wood, *A Primer on Memory Consistency and
  Cache Coherence*, Morgan & Claypool, second edition 2020, which keeps coherence and consistency
  apart as this book does.
- **The measurements.** Ulrich Drepper, *What Every Programmer Should Know About Memory*, 2007,
  for the latencies.
- **Next.** [ch13](#false-sharing) shares a line by accident.
