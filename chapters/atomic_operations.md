---
title: Atomic operations
---

(atomic-operations)=
# Atomic operations

## The question

What does an atomic read-modify-write fix, and which concurrency problems does it leave?

[ch02](#two-threads-one-variable) lost increments in the window between a load and a store, and
closed the window by switching the kernel to an atomic increment. This chapter reads what that
switch changed. The answer is one instruction on three of the four targets and a short loop on
the fourth, and in every case the instruction set promises that the write lands only if no other core's write landed since the read. The second half of the question matters as much as the first. An atomic
operation is indivisible; two of them are not, and most concurrency problems involve two.

## The smallest program

The atomic counter is declared `_Atomic`, which changes what the compiler may emit for every
operation on it:

```{literalinclude} ../experiments/counter/counter.c
:language: c
:start-at: /* The same variable, declared atomic
:end-before: /* One increment of the plain counter
```

The increment is `atomic_fetch_add_explicit`: add one, as one indivisible read-modify-write, and
return the old value, which this function discards. The ordering argument, `memory_order_relaxed`,
asks for nothing beyond the atomicity of this one operation; Part III is about the other
orderings, and for a counter this one is enough:

```{literalinclude} ../experiments/counter/counter.c
:language: c
:start-at: /* One increment of the atomic counter
:end-before: /* Two atomic operations
```

:::{dropdown} The shape of an atomic operation's name
:class: library
`atomic_fetch_add_explicit` comes from C's `<stdatomic.h>`: *fetch_add* says what it does, add
and return the old value, and *explicit* says an ordering argument follows. The orderings,
`memory_order_relaxed` here, are [Part III](#part-memory-ordering)'s subject. Until then, read
every `memory_order_relaxed` in a kernel as "atomic, and nothing more".
:::

## Run it

Four workers this time, so the cost shows as well as the correctness.

```lab
experiment: counter
workers: 4
operation: atomic
```

Try these, in order:

1. **Run it.** *Observed* equals *Expected*, and *Lost* is zero. Run it again, with more workers,
   with fewer increments: always exact. Compare with the same settings and the *plain*
   operation, which loses.
2. **Compare the time.** Switch between *plain* and *atomic* with the same count and watch
   *Elapsed*. The atomic version is slower, and on a device with several cores it can be much
   slower, because a plain increment can hand its store to the core and move on, while an atomic one
   must own the line and finish both the read and the write before anything after it, so the
   cores take turns. That is the microarchitecture: [ch12](#cache-coherence) measures it, and
   [ch21](#contention-and-scalability) draws it against the number of workers.
3. **Open the deterministic trace.** With *atomic* selected, press *Run to the end* under any
   schedule. Each increment is one step in the model, so there is no window for another thread's
   step to fall into, and nothing is lost under any schedule.
4. **Switch the operation to *split*.** The loss is back, in the trace under *alternate* and in
   the live run. *Break it again*, below, says why.

## What the source hides

The atomic increment is still a read, an add and a write. What changed is that the processor
performs the three as one step that no other core can interleave with. The model shows it as a
single operation:

```{include} _generated/counter-trace-atomic.md
```

The instruction set promises the same thing on every target: no other core's write lands between
the read and the write that counts. The fragments below show two shapes for that promise, one
instruction that reads and writes as one access, or a load that marks the word and a store that
fails and retries if another write landed since; how a core keeps the promise is the
microarchitecture's and is not shown. Both arrive at the same guarantee: either the increment has
not happened or it has, never half.

Atomicity is a property of one operation. The variable's declaration makes every operation on it
atomic; it does not make a sequence of them atomic, and nothing can, short of a lock or a loop
that notices. That is the limit the rest of the chapter is about.

## At the machine

::::{tab-set}
:::{tab-item} x86-64
:sync: x86-64
```{include} _generated/counter-increment-atomic-x86-64.md
```
:::
:::{tab-item} AArch64
:sync: aarch64
```{include} _generated/counter-increment-atomic-aarch64.md
```
:::
:::{tab-item} AArch64 (LSE)
:sync: aarch64-lse
```{include} _generated/counter-increment-atomic-aarch64-lse.md
```
:::
:::{tab-item} RISC-V
:sync: riscv64
```{include} _generated/counter-increment-atomic-riscv64.md
```
:::
:::{tab-item} WebAssembly
:sync: wasm
```{include} _generated/counter-increment-atomic-wasm.md
```
:::
::::

**x86-64** adds one byte to the instruction from [ch01](#what-x-plus-plus-does): the `lock` prefix.
The `inc` is the same read, add, write; the prefix makes the read and the write one atomic access:
the instruction set promises that no other core's access to the word lands between them. How a core
keeps that promise, on most modern parts by holding the cache line for the instruction, is the
microarchitecture's business. On x86-64 the prefix also orders every earlier and later memory
access of this thread around it, which [ch15](#x86-is-not-the-model) returns to; the C asked for
*relaxed* and got more than it asked for.

**AArch64**, without extensions, has no single instruction that adds to memory. It uses a pair:
`ldxr` loads the word and marks the address as being watched, `add` adds one in the register, and
`stxr` stores only if nothing has written the address since the load, reporting failure in a
register. `cbnz` loops back on failure. This is load-linked and store-conditional: the processor
does not stop other cores touching the line, it notices if one did, and the thread tries again.
Under contention the loop can run several times.

**AArch64 with LSE**, the atomics extension that most AArch64 processors since the mid-tens have,
has `ldadd`: one instruction that adds to memory, as x86-64's does. The build asked for the
extension with a target flag, and the conditions line says so; a compiler told to target an older
core emits the loop above instead. Which one your program gets is a build decision, and
the two behave the same.

**RISC-V** has `amoadd.w`, an atomic memory operation: add the register to the word in memory,
as one instruction. The destination register is `zero`, so the old value is discarded, as the C
discarded it.

**WebAssembly** has `i32.atomic.rmw.add`: read-modify-write add, one instruction, whose result is
dropped. The engine in your browser lowers it to an atomic add of the host's own, which may or may
not be one of the above. The WebAssembly instruction promises atomicity; it does not say which host
instruction delivers it, and the book never claims to know.

## Fix one thing

The fix was ch02's: replace the three steps by one atomic read-modify-write. What is worth seeing
here is the cost of the fix, in the panel above: *atomic* against *plain* at the same count, on
your own device. The atomic increment is slower partly because the instruction costs more alone, on
x86-64 because the prefix is also a barrier, and mostly because its promise is expensive to keep
when another core wants the same line at the same moment. One worker alone pays little. Several pay
for each other. The price of an atomic operation is contention, and a design that puts every
thread's increment on one word pays it in full; [ch13](#false-sharing) and
[ch21](#contention-and-scalability) are about paying less.

## Break it again

An atomic variable makes every operation on it atomic, so an increment written as two operations
is still two. This function loads the counter atomically, then stores the sum atomically:

```{literalinclude} ../experiments/counter/counter.c
:language: c
:start-at: /* Two atomic operations
:end-before: /* a: increments per worker
```

Each access is indivisible. The pair has a window between them exactly as wide as ch02's, and
the model loses updates in it:

```{include} _generated/counter-trace-split.md
```

This panel is locked to the split increment. Run it: the loss is back, on real workers.

```lab
experiment: counter
workers: 4
operation: split
lock: operation
```

The instructions tell the same story:

::::{tab-set}
:::{tab-item} x86-64
:sync: x86-64
```{include} _generated/counter-split-x86-64.md
```
:::
:::{tab-item} AArch64
:sync: aarch64
```{include} _generated/counter-split-aarch64.md
```
:::
:::{tab-item} RISC-V
:sync: riscv64
```{include} _generated/counter-split-riscv64.md
```
:::
:::{tab-item} WebAssembly
:sync: wasm
```{include} _generated/counter-split-wasm.md
```
:::
::::

On AArch64 and RISC-V a relaxed atomic load and a relaxed atomic store are the same instructions as
a plain load and a plain store: `ldr` and `str`, `lw` and `sw`. An aligned word is read and written
whole by those instructions already, so the atomicity of each access costs nothing and the compiler
emits nothing extra. On x86-64 the compiler went further and merged the atomic load and the atomic
store into ch01's `inc` without a `lock` prefix: each access is still atomic on its own, and the
pair is still two accesses with the window between. What the `_Atomic` declaration bought here is a
promise about each access on its own, and a promise to the compiler that other threads exist, so it
may not fold or reorder them as it did in ch01. It did not buy a promise about the pair.
WebAssembly is the exception that proves it: `i32.atomic.load` and `i32.atomic.store` are distinct
instructions from the plain ones, because WebAssembly makes every atomic access sequentially
consistent, which [ch10](#sequential-consistency) explains, and it still loses the update, because
the window is between the two.

This is the shape of most concurrency bugs that survive a code review. Each operation was
atomic. The invariant needed two of them to be. The tool for that, an operation that changes a
value only if it is still what you last saw, is [ch04](#compare-and-swap).

## The mental model

:::{div}
:class: model

**An atomic read-modify-write is one step with no window.** The instruction set promises that no
other core's write lands between the read and the write that counts, in one instruction (x86-64's
`lock inc`, RISC-V's `amoadd`, AArch64's `ldadd`) or in a marked load and a store that fails and
retries (AArch64's `ldxr` and `stxr`). Either way, other cores see the operation whole or not at
all.

**Atomicity belongs to an operation, not a variable.** Declaring a variable atomic makes each
access indivisible. Two accesses have a window between them like any other two.

**The price of atomicity is contention.** One atomic increment costs little. Many cores
incrementing one word pay for each other.
:::

## What this cannot tell you

**Which instruction your browser ran.** The WebAssembly fragment is the instruction the kernel
executes; the native fragments are what clang emits for a native build of the same C, and one
concrete way the promise can be kept. The browser's engine chose its own, which may be any of
them. The count is the same either way; the time is not.

**What the ordering argument is for.** `memory_order_relaxed` was enough here because the counter
is the only thing the threads share. The moment one thread uses a value to tell another that
something else is ready, the ordering is the whole question. That is Part III.

**How much the atomic increment costs on your device.** The live time is one observation, under
the browser's scheduling. It shows that the atomic version is slower, and roughly by how much on
this run; the native commands in [Appendix A](#reproducing-at-a-desk) are where to measure.

## Where to go next

- **The language's atomics.** ISO C, section 7.17, atomics, in particular `atomic_fetch_add` and
  the definition of `memory_order_relaxed`.
- **The instructions.** Intel 64 and IA-32 Architectures Software Developer's Manual, volume 3,
  section 8.1, locked atomic operations; Arm Architecture Reference Manual for A-profile, the
  load-exclusive and store-exclusive instructions, and the Large System Extensions (`LDADD`); The
  RISC-V Instruction Set Manual, volume I, the "A" standard extension for atomic instructions.
- **WebAssembly's atomics.** The WebAssembly threads proposal, atomic memory instructions.
- **Next.** [ch04](#compare-and-swap) makes an atomic operation out of two values: change this
  word, but only if it still holds that.
