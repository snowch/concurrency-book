---
title: Contention and scalability
---

(contention-and-scalability)=
# Contention and scalability

## The question

Why does adding workers to a shared counter make it slower, not faster?

[ch03](#atomic-operations) made a counter exact and slower; [ch12](#cache-coherence) said why:
every atomic increment takes the line from whoever had it. Neither chapter asked the question a
designer asks, which is what happens to the total rate as workers are added. Twice the workers
should mean twice the increments per second, or at least not fewer. This chapter runs the same
work with one worker, then two, then more, on three layouts, and draws the rate. One of the three
curves falls as workers are added. The other two do not, and the difference between them is the
price of atomicity when nobody is contending for it.

## The smallest program

Three ways to count. One atomic counter every worker shares; an atomic counter per worker, each
on a line of its own; and a plain counter per worker, likewise alone on its line:

```{literalinclude} ../experiments/contention/contention.c
:language: c
:start-at: CM_NOINLINE void bump_shared
:end-before: /* a: increments per worker
```

The per-worker counters are correct because nobody else touches them; a program that needs the
total adds them when the work is done.

## Run it

The panel runs each layout with one worker, then two, three and four, then doubling up to the
number you set up to the number you set, and draws increments per millisecond against workers, one
small chart per layout on one scale. The table under the charts has every number.

```lab
experiment: contention
workers: 8
layout: compare
```

Try these, in order:

1. **Run it and read the three charts left to right.** *One shared*: the rate falls as workers are
   added, often to a small fraction of one worker's rate by the time the cores are all busy.
   *One each*: the rate rises with the workers, about linearly while there are cores to run them.
   *One each, plain*: the same shape, and higher by the cost of an uncontended atomic.
2. **Note where the curves bend.** The foot of the panel says how many logical cores the device
   reports; two of them may be one core, so a curve may bend before that count. Past it, workers
   share cores outright, and every curve flattens or falls, for a reason that
   has nothing to do with contention: the scheduler is time-slicing. Read the curves only up to
   the core count.
3. **Compare the one-worker rates.** With one worker there is no contention, and the shared
   counter costs what a counter of one's own costs. Contention is a property of the number of
   writers, not of the instruction.
4. **Raise the increments** if the one-worker runs are too short to measure well. A run of a few
   milliseconds is dominated by the wake-up from the barrier and the message that reports each
   worker's result; the ratios steady as the runs lengthen.

## What the source hides

The shared counter's curve is the cost of coherence, from [ch12](#cache-coherence), as a
function of the number of cores pulling on one line. With two writers the line goes back and
forth; with four it goes round; the time per increment grows with the number of other cores that
want the line, and the total rate, which is the increments per time, falls. The work did not get
harder. The line got busier, and the line is one place that every increment must visit.

The counter-per-worker curves are what the hardware can do when nobody shares: each core keeps its
own line, nothing moves, and the rate is the sum of the cores' rates. The plain counter is faster
than the atomic one by the cost of a locked instruction that locks nothing anyone else wants: on
x86-64 the `lock inc` the fragment shows is a full barrier by the instruction set's rules, and a
core that keeps that promise by draining its store buffer makes it many times the cost of the plain
`inc` beside it. That cost is the microarchitecture's, and the two per-worker curves are its
measure.

The lesson is the one every scalable design follows: share nothing on the hot path, and combine
at the end. A statistics counter per thread, summed when read. A per-core free list. A reduction
tree instead of a global accumulator. The shared word is where the rate goes to die, and the
remedy is not a faster atomic but fewer threads on the same word.

## At the machine

The three increments:

::::{tab-set}
:::{tab-item} x86-64
:sync: x86-64
```{include} _generated/contention-bump-x86-64.md
```
:::
:::{tab-item} AArch64
:sync: aarch64
```{include} _generated/contention-bump-aarch64.md
```
:::
:::{tab-item} RISC-V
:sync: riscv64
```{include} _generated/contention-bump-riscv64.md
```
:::
:::{tab-item} WebAssembly
:sync: wasm
```{include} _generated/contention-bump-wasm.md
```
:::
::::

The shared and the per-worker atomic increments are the same instruction with a different address,
as [ch13](#false-sharing) said: nothing in the instruction knows how many cores want the line. The
plain increment is [ch01](#what-x-plus-plus-does)'s, with no lock prefix, no exclusive pair and no
atomic memory operation, which is why it is faster even with nobody to contend with.

## Fix one thing

The fix is a counter per worker, and this panel is locked to it, so that you can watch the rate
climb with the workers:

```lab
experiment: contention
workers: 8
layout: one each
lock: layout
```

The cost of the fix is memory, one line per worker, and a sum at the end, which is a read of as
many lines as there are workers, once. For a counter that is read rarely and written constantly
that is the right trade every time. For a value every thread must read often, there is no
layout that makes writes cheap, and the design question becomes how rarely it can be written.

## Break it again

Put the counters back on one line, in [ch13](#false-sharing)'s panel, and the curve is close to the
shared word's. Or share the word with a plain increment, in [ch02](#two-threads-one-variable)'s
panel: faster and wrong. The curve that falls is the price of being right on one word; the curve
that rises is the price of being right on many.

## The mental model

:::{div}
:class: model

**A shared word's rate falls as writers are added.** Each write must take the line; the time per
write grows with the number of cores that want it; the total rate goes down.

**A word per writer scales with the cores.** Nothing moves between caches, and the rate is the sum
of the cores' rates, up to the core count.

**Share nothing on the hot path; combine at the end.** The remedy for contention is fewer
writers on the word, not a faster atomic.
:::

## What this cannot tell you

**The shape past the core count.** With more workers than cores, the scheduler decides, and the
curve is its behaviour, not the hardware's. Read the charts up to the core count.

**The rate in units you can trust.** Increments per millisecond on this device, this run, with the barrier's wake-up and the result messages inside the time. The ratios between the layouts and the shape of each curve are the result; the numbers are not a benchmark.

**What else moved the number.** The engine may have compiled the kernel twice during the run, first quickly and then well; the cores may have changed frequency as they warmed; other tabs and processes shared them. None of that is in the kernel, and all of it is in the time.

**Reads.** The chapter counts writes. A word written by one thread and read by many has a
different curve: the readers' caches keep shared copies of it, cheap until the writer writes.

## Where to go next

- **The law.** Neil Gunther, *A Simple Capacity Model of Massively Parallel Transaction Systems*,
  CMG 1993: the universal scalability law, which models exactly these curves with two parameters,
  contention and coherence.
- **The measurement.** Ulrich Drepper, *What Every Programmer Should Know About Memory*, on the
  cost of atomic operations under contention.
- **The remedy in practice.** Paul McKenney, *Is Parallel Programming Hard, And, If So, What Can
  You Do About It?*, the chapter on counting, which builds the per-thread counter in five
  designs.
- **Next.** [ch22](#webassembly-threads) explains how the laboratory has been running threads at
  all.
