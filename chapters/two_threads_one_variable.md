---
title: Two threads, one variable
---

(two-threads-one-variable)=
# Two threads, one variable

## The question

Why can two threads each increment a counter a million times and still lose increments?

[ch01](#what-x-plus-plus-does) showed that one increment is a load, an add and a store, and that
with one thread the three always happen in that order with nothing in between. A second thread
breaks the second half of that sentence. Each thread's own three steps still happen in order, but
nothing orders one thread's steps against the other's. Between a thread's load and its store,
the other thread may do anything at all, including store. This chapter puts two threads on the
counter from ch01, forces the bad interleaving in a trace where you control every step, and then
lets the real workers find it on their own.

## The smallest program

The kernel is the one from ch01, unchanged. Each worker runs the loop in `cm_run`, so with two
workers the function `increment` is called from two threads at once:

```{literalinclude} ../experiments/counter/counter.c
:language: c
:start-at: /* One increment of the plain counter
:end-before: /* The same increment, in a loop
```

Every worker waits at the barrier in `cm_run` until the page opens it, so the two loops start
together rather than one finishing before the other begins:

```{literalinclude} ../experiments/cm.h
:language: c
:start-at: /* The start barrier
:end-before: static inline void cm_barrier_reset
```

## Run it

Two workers, a million increments each, so the counter should end at two million. The two
workers are two Web Workers sharing one WebAssembly memory; the counter is one word in it.

```lab
experiment: counter
workers: 2
operation: plain
```

Try these, in order. The live run is one observation on your device, and the point of the
chapter is why it is one and not a rule.

1. **Run it as it is.** On a device with more than one core, *Observed* is less than *Expected*,
   often by a large fraction, and *Lost* says by how much. Run it again: a different number. On
   a device with one core the two workers take turns on the processor, the window is rarely hit,
   and the count may be exact every time. An exact count proves nothing; the trace below shows
   why.
2. **Add workers.** Four, eight, as many as the slider allows. More threads in the same window
   lose more, and *Elapsed* rises: the cores are fighting over one cache line, which
   [ch12](#cache-coherence) measures.
3. **Lower the increments to a thousand.** The loss may vanish. A thousand increments take so
   little time that the second worker has often not started when the first has finished. Nothing
   was fixed. The window closed by luck.
4. **Open the deterministic trace.** Leave the schedule on *alternate* and press *Run to the
   end*. Two threads, two increments each, and the model loses two of the four. Switch the
   schedule to *sequential*: nothing lost. Set it to *manual* and lose an update by hand: press
   *Step A*, then *Step B*, then alternate to the end. Every lost update you can make the model
   lose, the workers can lose too.

## What the source hides

The loop hides nothing new; the interleaving does. Here are the two schedules from the trace,
computed by the same model the panel runs. First, one operation from each thread in turn:

```{include} _generated/counter-trace-alternate.md
```

Both threads load the same value before either has stored. Each adds one to its own copy. Each
stores the same result. The second store does not add to the first; it overwrites it with an
equal value, and one increment is gone. The pattern repeats, and the model loses one increment
per round. That is a **lost update**: a store that overwrote a value it never saw.

Now the other extreme, each thread running to the end before the next begins:

```{include} _generated/counter-trace-sequential.md
```

Nothing lost, because every load saw the previous store. The real workers run somewhere between
the two schedules, decided by the operating system, the cores and the moment, and that is the
whole of why the live number changes every run. In C this is a **data race**: two threads
accessing one variable, at least one writing, with nothing to order them. The standard gives a
program with a data race no meaning at all, which is a stronger statement than "the count may be
wrong". Here the compiler happened to emit the three steps you expected, so the observable
behaviour is the model's; [ch07](#the-compiler-is-part-of-the-story) shows what else the compiler
may do with a race it is allowed to assume away.

## At the machine

Where the window is depends on the target. Pick one:

::::{tab-set}
:::{tab-item} x86-64
:sync: x86-64
```{include} _generated/counter-increment-x86-64.md
```
:::
:::{tab-item} AArch64
:sync: aarch64
```{include} _generated/counter-increment-aarch64.md
```
:::
:::{tab-item} RISC-V
:sync: riscv64
```{include} _generated/counter-increment-riscv64.md
```
:::
:::{tab-item} WebAssembly
:sync: wasm
```{include} _generated/counter-increment-wasm.md
```
:::
::::

On **AArch64** and **RISC-V** the window is between two instructions, the load and the store, and
another core can run anything it likes in it. On **WebAssembly** the window is between
`i32.load` and `i32.store`, and the browser's engine turns those into the host's own load and
store, so the window is the host's. On **x86-64** the window is inside one instruction. A
memory-destination `inc` is read, add, write in the processor, and without the `lock` prefix the
read and the write are two separate accesses to the cache; another core's write may land between
them. The instruction count was never the point. The two accesses are.

The kernel's loop, in WebAssembly, shows the barrier every worker sleeps on and the call it then
makes a million times. `memory.atomic.wait32` puts the worker to sleep until the page writes the
flag; `call increment` is the increment, out of line, as [ch01](#what-x-plus-plus-does) wanted:

```{include} _generated/counter-run-wasm.md
```

## Fix one thing

The smallest change that closes the window is to make the load, the add and the store one
indivisible step. The kernel has that function too, and the panel's operation switch selects it.
This panel is locked to it:

```lab
experiment: counter
workers: 2
operation: atomic
lock: operation
```

Run it with as many workers as you like: *Observed* equals *Expected*, every time, on every
device, because there is no window for the other thread to land in. What that one instruction
is, what it costs, and what it does not fix, is [ch03](#atomic-operations).

## Break it again

The loss has nothing to do with how many increments each thread makes, only with the two
accesses. The kernel's *folded* operation, from ch01, does each worker's whole count as one load,
one add and one store. In the trace, pick *folded* in the operation menu and *alternate* as the
schedule:

```{include} _generated/counter-trace-folded.md
```

One interleaving, and a whole thread's work is gone at once. The window is the same width in
operations, three steps, and a thousand times wider in consequence. The live run with *folded*
rarely shows it, because the window is open for one instruction per worker and a million times
shorter than before; but it can, and it does on a machine with enough cores and enough runs. A
race that rarely fires is still a race.

## The mental model

:::{div}
:class: model

**Two threads, one variable, nothing ordering them: a load may be stale by the time its store
lands.** A lost update is a store that overwrote a store it never saw. Both threads did exactly
what the program said; the program said nothing about each other.

**The window is between the load and the store, not between instructions.** On x86-64 it is
inside one instruction. On every target it is wide enough.

**An exact count is not evidence.** A race that did not fire this time is a race.
:::

## What this cannot tell you

**How often it happens on your machine.** The live count is one observation, under the
browser's scheduling and whatever else was running. Fewer cores, shorter loops and background
load all change it. It cannot tell you a rate, only that the loss is real.

**What the compiler would do with a less careful program.** This kernel kept the increment out of
line so that the loop stayed a loop. In C a data race is undefined behaviour, and a compiler may
assume there is none; ch07 shows a loop it rewrote on that assumption.

**What the trace is.** A model of the operations, interleaved by a schedule, not the compiled
code. It can lose nothing the real program cannot lose, because it has the same three steps; it
cannot show you the timings, the caches or the store buffers that decide which interleaving the
real program gets. Part IV is about those.

## Where to go next

- **The definition of a data race.** ISO C, section 5.1.2.4, and the same words in C++ section
  6.9.2, intro.races. Hans Boehm, *Threads Cannot be Implemented as a Library*, PLDI 2005, on why
  the language, not the threading library, must define this.
- **Lost updates in another world.** Jim Gray and Andreas Reuter, *Transaction Processing*, on
  the lost update anomaly in databases, where the same shape has the same name.
- **WebAssembly's data races.** The WebAssembly threads proposal and the ECMAScript memory model,
  which give racing non-atomic accesses a defined, weak meaning rather than none.
- **Next.** [ch03](#atomic-operations) reads the instruction that fixed it.
