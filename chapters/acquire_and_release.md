---
title: Acquire and release
---

(acquire-and-release)=
# Acquire and release

## The question

How does one thread hand a finished piece of data to another, safely?

[ch07](#the-compiler-is-part-of-the-story) fixed a flag, and warned that a flag is rarely alone.
The reason to raise a flag is to say that something else is ready: a buffer filled, a record
written, a result computed. The flag is one word; the something else is other words. Part I made the flag itself reliable. Atomicity is a promise about one word. The handover needs a promise about two, and no operation on one word can make it alone. Nothing so far has said that the data arrives when the flag does,
and on most processors, and in some compilers, it need not. This chapter runs the simplest
version of the handover, a writer and a reader with one word of data and one flag, many thousand
times, and counts the times the flag arrived first.

## The smallest program

The writer stores the data, then the flag. The reader waits for the flag, then reads the data.
With a volatile flag, which [ch07](#the-compiler-is-part-of-the-story) showed is enough to make
the loop re-read, and nothing else:

```{literalinclude} ../experiments/publication/publication.c
:language: c
:start-at: /* The value being published
:end-before: /* The reader's acknowledgement
```

```{literalinclude} ../experiments/publication/publication.c
:language: c
:start-at: CM_NOINLINE void publish_volatile
:end-before: CM_NOINLINE void publish_relaxed
```

```{literalinclude} ../experiments/publication/publication.c
:language: c
:start-at: CM_NOINLINE int receive_volatile
:end-before: CM_NOINLINE int receive_relaxed
```

One trial is one handover. In trial `t` the writer stores `t` as the data and `t` as the flag;
the reader waits for the flag to read `t` and then reads the data. If the data still reads
`t - 1`, the flag arrived before the data: a **stale read**. The kernel runs the trials back to
back, with a sequentially consistent acknowledgement from the reader to the writer between them
so that a trial cannot overlap the next:

```{literalinclude} ../experiments/publication/publication.c
:language: c
:start-at: /* Two workers. Worker 0 writes
:end-before: CM_EXPORT("cm_reset")
```

## Run it

Two workers and a hundred thousand handovers.

```lab
experiment: publication
workers: 2
lock: workers
ordering: volatile
```

Try these, in order:

1. **Run it.** Watch *Stale reads*. On the WebAssembly build this book runs, the compiler itself
   placed the flag's store before the data's, so a stale read is possible on any device with more than one core, and this run's count is one observation of how often this device hit the window. *At the machine* shows the two stores in that order.
2. **Switch the ordering to *release-acquire*.** No stale reads, however many trials and however
   many times you run it. The store of the flag is a release, the load of the flag an acquire,
   and together they promise that everything the writer did before the release is visible to the
   reader after the acquire.
3. **Switch to *relaxed*.** The flag is atomic, but asks for no ordering. In this browser you
   will see no stale reads, and the chapter's last section says why that proves nothing.
4. **Open the deterministic trace.** Under *volatile*, with the writer's stores reaching memory
   *flag first*, set the schedule to *manual* and step: writer, reader, writer, reader, writer,
   reader, reader, reader. The reader sees the flag, reads the data, and gets zero. Switch the
   ordering to *release-acquire*: the flag's store now drains the data's store first, and no
   order of stepping produces a stale read.

## What the source hides

The writer's two stores go to two different addresses, and nothing in a plain or volatile store
ties them together. The compiler may emit them in either order, since to a single thread the
order of two stores to different variables is invisible. The processor may make them visible to
other cores in either order, for the same reason: a store buffer, a write-combining buffer, or
two cache lines arriving at different times. The reader's two loads are the same story
in mirror image: a weakly ordered processor may perform the load of the data before the load of
the flag, and return a value that was true before the flag was raised.

The trace shows the writer's half, with the flag's store reaching memory first:

```{include} _generated/publication-trace-reordered.md
```

The same handover with a release store, which lets nothing stored before it overtake it:

```{include} _generated/publication-trace-release.md
```

`memory_order_release` on a store means: every memory access this thread made before this store is
visible to any thread whose acquire load reads this store, after that load. `memory_order_acquire`
on a load means: every memory access this thread makes after this load happens after it, as far as
any other thread can tell. A release store read by an acquire load is the language's unit of
handover. The standard calls the relationship *synchronizes-with*, and the chain it creates, from
the writer's data store to the reader's data load, *happens-before*. The reader's load of the data
happens after the writer's store of it, so it sees the stored value. That is the whole guarantee,
and it is enough for every handover in this book.

## At the machine

The writer's four versions, in one fragment per target. Find the release:

::::{tab-set}
:::{tab-item} x86-64
:sync: x86-64
```{include} _generated/publication-publish-x86-64.md
```
:::
:::{tab-item} AArch64
:sync: aarch64
```{include} _generated/publication-publish-aarch64.md
```
:::
:::{tab-item} RISC-V
:sync: riscv64
```{include} _generated/publication-publish-riscv64.md
```
:::
:::{tab-item} WebAssembly
:sync: wasm
```{include} _generated/publication-publish-wasm.md
```
:::
::::

**AArch64** shows the release as an instruction: `stlr`, store-release, where the volatile and
relaxed versions use a plain `str`. **RISC-V** shows it as a `fence rw, w` before the store: every
earlier read and write is ordered before this write, as every other hart sees it. **x86-64** shows
nothing: the release store is the same `mov` as the relaxed one, because x86-64 never reorders a
store with an earlier store, so the ordering the C asked for is free. **WebAssembly** shows the
volatile version with the flag's store first, as the compiler scheduled it, and every atomic
version as the same `i32.atomic.store`, because every WebAssembly atomic is sequentially consistent
and there is no weaker atomic store to emit.

The reader's four versions:

::::{tab-set}
:::{tab-item} x86-64
:sync: x86-64
```{include} _generated/publication-receive-x86-64.md
```
:::
:::{tab-item} AArch64
:sync: aarch64
```{include} _generated/publication-receive-aarch64.md
```
:::
:::{tab-item} RISC-V
:sync: riscv64
```{include} _generated/publication-receive-riscv64.md
```
:::
:::{tab-item} WebAssembly
:sync: wasm
```{include} _generated/publication-receive-wasm.md
```
:::
::::

The acquire is `ldar` on AArch64, load-acquire, where the relaxed version spins on a plain `ldr`;
a `fence r, rw` after the load on RISC-V; a plain `mov` on x86-64, which never reorders a load
with a later load; and the same `i32.atomic.load` on WebAssembly for every atomic version.

## Fix one thing

The fix is the pair: release on the store, acquire on the load. This panel is locked to it, and
it never shows a stale read, on any device, because the language promised and every target
keeps the promise in its own way.

```lab
experiment: publication
workers: 2
lock: workers, ordering
ordering: release-acquire
```

Why not the volatile flag with the stores in the right order? Because the right order is not
yours to choose. The compiler may reorder plain stores; the fragments show it did. The processor
may reorder them; AArch64's `str` makes no promise. Only an ordering the language knows about
reaches both. That is the difference between `volatile` and `_Atomic` that ch07 could not show
with one variable.

## Break it again

Keep the flag atomic and take the ordering away: *relaxed*. The compiler now knows another thread
reads the flag, and will not fold the loop; but it has been asked for no order, and neither has the
processor. On AArch64 the relaxed fragments are the plain `str` and `ldr`, the same instructions as
the volatile version, and a stale read is allowed by the architecture; the harness on an AArch64
device shows it. In this browser, run it and you will see none, because the WebAssembly the kernel
runs has only sequentially consistent atomics, so the relaxed version got the strong store and the
strong load for free. That is the browser hiding a bug, not the bug's absence, and
[ch09](#relaxed-atomics) is about what relaxed does and does not promise.

## The mental model

:::{div}
:class: model

**A flag is not the data.** The flag is one word; the data is other words; nothing ties them
together unless the program says so.

**Release, then acquire.** A release store lets nothing before it be seen after it. An acquire
load lets nothing after it be seen before it. A release store read by an acquire load makes
everything before the store visible after the load: happens-before.

**Each target pays its own way.** `stlr` and `ldar`; a fence before the store and after the
load; nothing at all on x86-64; the one strong store WebAssembly has.
:::

## What this cannot tell you

**How often a stale read happens natively.** On x86-64 with these fragments, never: the compiler
kept the stores in order and the architecture keeps them in order. For volatile and relaxed another
compile may not, as the WebAssembly fragment shows. On AArch64, often, for volatile and relaxed.
The browser's count is for the WebAssembly build, whose stores the compiler reordered; it is a real
stale read with a different cause.

**What the reader's reordering looks like.** The trace reorders only the writer's stores. A
weakly ordered processor may also perform the reader's second load before its first, with the
same result. The acquire forbids that too.

**What relaxed is for.** If it promises so little, why does it exist? [ch09](#relaxed-atomics).

## Where to go next

- **The definitions.** ISO C, section 5.1.2.4, *synchronizes with* and *happens before*, and
  section 7.17.3, the memory orders.
- **The idea's origin.** Sarita Adve and Mark Hill, *Weak Ordering: A New Definition*, ISCA 1990,
  and Kourosh Gharachorloo and others, *Memory Consistency and Event Ordering in Scalable
  Shared-Memory Multiprocessors*, ISCA 1990, which introduced release consistency.
- **The instructions.** Arm Architecture Reference Manual for A-profile, `STLR` and `LDAR`; The
  RISC-V Instruction Set Manual, volume I, chapter on the RVWMO memory consistency model.
- **Next.** [ch09](#relaxed-atomics) takes the ordering away and sees what is left.
