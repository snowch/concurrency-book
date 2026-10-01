---
title: False sharing
---

(false-sharing)=
# False sharing

## The question

Why do two threads that never touch the same variable slow each other down?

[ch12](#cache-coherence) ended on a result that looked wrong: four workers with four counters of
their own, side by side in memory, ran as slowly as four workers on one counter. They shared
nothing in the program. They shared a cache line, and the protocol of ch12 does not know the
difference. This chapter is about the most common performance bug in multithreaded code that
is correct, and about the fix, which is empty space.

## The smallest program

The kernel from ch12. The layouts that matter here are *same line*, where worker `tid` owns word
`tid`, and *own line*, where it owns word `tid` times sixteen, which is sixty-four bytes along:

```{literalinclude} ../experiments/sharing/sharing.c
:language: c
:start-at: /* Where worker `tid`'s counter lives
:end-before: /* a: increments per worker
```

## Run it

```lab
experiment: sharing
workers: 4
layout: compare
```

Try these, in order:

1. **Run it and compare *same line* with *own line*.** The counts are the same, and the workers
   touched four different words in both. The *same line* run costs about what *same word* costs:
   the line bounced between the cores on every increment, as it did when the word was shared,
   because the protocol moves lines, not words.
2. **Try two workers.** The effect is there with two. It is not a crowding effect; it is the line.
3. **Pick *two lines apart*.** On most devices the same as *own line*. On some, including
   recent Apple processors and some Intel ones, it is faster still, because the cache fetches or
   tracks lines in pairs and sixty-four bytes apart is not far enough.
4. **Think about where this appears in a program you have written.** An array of per-thread
   counters. A struct with a mutex and the data it protects, where one thread holds the mutex
   and another spins on it. A ring buffer whose head and tail indices are adjacent. The pattern
   is "one hot word per thread, allocated together".

## What the source hides

The source says four variables. The cache sees one line. A write by any core takes the line from
every other core, as ch12 described, whether or not the other cores care about the word that
changed. Each worker's increment invalidates the other three's copies, each of them must fetch
the line back for their next increment, and the line circulates exactly as if the word were
shared. The sharing is real in the hardware and false in the program, which is the name.

The fix is alignment and padding. Put each hot variable on a line of its own, by placing it at
an address that is a multiple of the line size and leaving the rest of the line empty. In C that
is `_Alignas(64)` on the variable, or an array with a stride of sixty-four bytes, as the kernel's
*own line* layout does with a stride of sixteen words. The cost is memory: sixty bytes of
nothing per counter. The benefit is that each line lives in one cache and never moves, and the
increment costs what an increment costs.

## At the machine

The instruction, once more, because the point is that it does not change:

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

Every worker runs this with a different address in the register. In the *same line* layout the
addresses differ by four; in *own line* by sixty-four. The instruction does not know what a line
is. Only the address does, and only the cache reads the address that way. False sharing cannot be
found by reading the assembly; it is found by timing, or by a profiler that counts cache
misses, and it is fixed by changing a declaration that the assembly does not show either.

## Fix one thing

The fix is the stride, and this panel is locked to it:

```lab
experiment: sharing
workers: 4
layout: own line
lock: layout
```

Padding is the fix when the hot variables are known. When they are not, the usual tools are a
profiler that attributes cache misses to lines, and a rule of thumb: anything one thread writes
often should share a line with nothing another thread touches often. A read-only variable can
share a line with anything; a line that is only read is shared by every cache at once at no cost.

## Break it again

Remove the padding: *same line* again. Or, subtler, keep the padding and add one more hot
variable that nobody padded, next to the first worker's counter: the first worker's line is
shared again, and that one worker is slow while the others are fast, which is the version of this
bug that survives a benchmark. The kernel does not model that case; the lesson is that padding
is a property of every hot variable, not of the one you noticed.

## The mental model

:::{div}
:class: model

**The cache shares lines, not variables.** Two variables on one line are shared by the hardware
whether or not the program shares them.

**False sharing is coherence traffic for nothing.** The line bounces between cores because each
writes its own word; the cost is a round trip per write, as if the word were shared.

**Padding is the fix.** One hot variable per line, aligned to the line size. The assembly does not
change; the address does.
:::

## What this cannot tell you

**Whether sixty-four bytes is enough on your device.** The *two lines apart* layout is there
to find out.

**Which of your variables are false sharing.** The kernel shares by design. In a real program the
tool is a profiler that counts misses per line, and the symptom is a thread that is slow for no
reason the source shows.

**The cost in memory.** Padding a struct of a thousand counters to one line each is sixty-four
kilobytes for four. The trade is always memory for traffic.

## Where to go next

- **The measurement.** Ulrich Drepper, *What Every Programmer Should Know About Memory*, 2007,
  section 6.4.2 on false sharing, with the experiment this chapter's kernel repeats.
- **The language's tool.** ISO C, section 6.7.5, alignment specifiers, `_Alignas`; and C++'s
  `std::hardware_destructive_interference_size`, the standard's name for the line size.
- **The profiler.** Linux `perf c2c`, which finds false sharing by attributing cache-to-cache
  transfers to lines and to the code that caused them.
- **Next.** [ch14](#store-buffers-and-visibility) returns to the store buffer, which is where a
  store waits for the line.
