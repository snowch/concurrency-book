---
title: Sequential consistency
---

(sequential-consistency)=
# Sequential consistency

## The question

What is the strongest ordering, and what does asking for it change in the code?

[ch08](#acquire-and-release) and [ch09](#relaxed-atomics) ordered a handover: a store, then a
flag; a flag, then a load. Release and acquire were enough, because the handover has a direction.
Some programs have none. Two threads each announce themselves and then check whether the other
has: a store, then a load, in both threads, with no flag between them. Release and acquire say
nothing about a store followed by a load of a different variable, and this chapter shows that
on x86-64 the two threads can each miss the other's announcement, an outcome no interleaving of
the four operations allows. The ordering that forbids it is the strongest one the language has,
and what it costs is visible in one instruction.

## The smallest program

Each thread stores a one into its own word and then loads the other's. Relaxed:

```{literalinclude} ../experiments/store_buffer/store_buffer.c
:language: c
:start-at: CM_NOINLINE int sb_relaxed_a
:end-before: CM_NOINLINE int sb_release_acquire_a
```

and sequentially consistent:

```{literalinclude} ../experiments/store_buffer/store_buffer.c
:language: c
:start-at: CM_NOINLINE int sb_seq_cst_a
:end-before: CM_NOINLINE int sb_fence_a
```

Thread B runs the mirror image. A trial begins with both threads at a barrier, so neither can
finish before the other starts; thread A tallies the pair of loaded values:

```{literalinclude} ../experiments/store_buffer/store_buffer.c
:language: c
:start-at: /* Two workers. a: trials
:end-before: CM_EXPORT("cm_reset")
```

Four outcomes are possible by interleaving. If A's store came first, B's load sees it; if B's
store came first, A's load sees it; both stores can come before both loads, and both loads see
a one. The outcome where both loads see a zero needs each thread's load to run before the other
thread's store, and each thread's store before its own load, which no interleaving provides.
That is the outcome the panel counts.

## Run it

```lab
experiment: store_buffer
workers: 2
lock: workers
ordering: volatile
```

Try these, in order:

1. **Run it with *volatile*.** On an x86-64 device with more than one core, expect *Both loaded zero* above zero. How far above is this run's observation, not a rate. Nothing
   interleaved those four operations; the processor did something else, which
   [ch14](#store-buffers-and-visibility) names. On an AArch64 device the count is there too.
2. **Switch to *seq_cst*.** Zero, every run. Each thread's store is now visible before its own
   load, and the outcome is gone.
3. **Switch to *relaxed*, then *release-acquire*.** In this browser both show zero as well, and
   the chapter's last section says why that is the browser and not the ordering: natively, on
   x86-64, both show the outcome freely, as the native commands under *At a desk* let you check.
4. **Open the deterministic trace.** Under *volatile* the model gives each thread a store buffer,
   and under *alternate* both stores wait in their buffers while both loads read zero from
   memory. Switch to *seq_cst*: the store goes to memory before the load, and the outcome cannot
   happen under any schedule.

## What the source hides

Sequential consistency is the ordering every programmer assumes without knowing it has a name:
there is one order of all the operations of all the threads, each thread's operations appear in it
in program order, and every load sees the last store before it in that order. Under it, the
four-operation test has exactly the three outcomes interleaving allows. Most processors do not
provide it, because providing it means a store must be visible to every other core before this core
may run its next load, and a store takes time to become visible. The model's store buffer is where
the store waits:

```{include} _generated/store_buffer-trace-buffered.md
```

`memory_order_seq_cst` asks for the single order. Every sequentially consistent operation in the
program takes its place in that one order, and a sequentially consistent store is not only a
release and a sequentially consistent load not only an acquire: the store must also become
visible before the same thread's later sequentially consistent loads. That last promise is the
one release and acquire do not make, and it is what the test needs. On x86-64 keeping it means
the store cannot wait in the buffer while the load runs.

## At the machine

The four versions of thread A's half:

::::{tab-set}
:::{tab-item} x86-64
:sync: x86-64
```{include} _generated/store_buffer-a-x86-64.md
```
:::
:::{tab-item} AArch64
:sync: aarch64
```{include} _generated/store_buffer-a-aarch64.md
```
:::
:::{tab-item} RISC-V
:sync: riscv64
```{include} _generated/store_buffer-a-riscv64.md
```
:::
:::{tab-item} WebAssembly
:sync: wasm
```{include} _generated/store_buffer-a-wasm.md
```
:::
::::

**x86-64** is the one to read first. The volatile, relaxed and release-acquire versions are the
same two instructions: `mov` to store, `mov` to load. The sequentially consistent version stores
with `xchg`, an atomic exchange, whose implicit lock the architecture defines as a full barrier: the store is visible before anything after it runs. On the cores the book knows, that means draining the store buffer. One instruction changed, and the
outcome disappears. The compiler could have emitted a `mov` followed by `mfence`; on current cores `xchg` is cheaper, and for ordinary stores and loads it orders the same.

**AArch64** charges `stlr` and `ldar` for release-acquire and the same two for sequentially
consistent: on AArch64 a store-release followed by a load-acquire is already ordered, which is a
property of those instructions and not of the language, so the strongest ordering costs no more
than the pair. **RISC-V** spells out the difference: the release-acquire version fences before
the store and after the load; the sequentially consistent version adds a `fence rw, rw` between
them, a full fence, which is the promise in one instruction. **WebAssembly** has only strong
atomics, so the relaxed, release-acquire and sequentially consistent versions are the same
`i32.atomic.store` and `i32.atomic.load`, and only the volatile version differs.

## Fix one thing

The fix is `memory_order_seq_cst` on the store and the load, and this panel is locked to it:

```lab
experiment: store_buffer
workers: 2
lock: workers, ordering
ordering: seq_cst
```

The default ordering in C and C++, when none is written, is sequentially consistent. That is a
sensible default: it is the one whose programs can be reasoned about as interleavings, and the
fragments show its cost is one exchange per store on x86-64, and a fence per access on RISC-V. The
weaker orderings exist for programs that know they do not need the single order, such as every
handover in [ch08](#acquire-and-release), and every counter in [ch03](#atomic-operations).

## Break it again

Weaken the store to a release and the load to an acquire. On the native x86-64 build the outcome
returns, as the harness shows, because the release-acquire fragment is the plain `mov` pair: the
ordering promised everything about other variables around a flag, and this test has no flag. In
this browser it does not return, because the WebAssembly build has no weaker atomic to emit.
Here is the honest statement of what the browser can and cannot show. It can show that volatile
accesses let the outcome happen on your device and that sequentially consistent atomics forbid
it. It cannot show that release-acquire is too weak, because the engine gave release-acquire the
strong instructions. The native fragments and the harness can, and
[ch15](#x86-is-not-the-model) returns to the gap.

## The mental model

:::{div}
:class: model

**Sequential consistency is one order of everything.** Each thread's operations in program order,
every load seeing the last store before it. Interleaving reasoning is valid under it and under
nothing weaker.

**Release and acquire order around a flag; they do not order a store before this thread's own
later load of another variable.** That is the gap, and the store-buffer test is the program that
lives in it.

**The cost is one instruction.** `xchg` instead of `mov` on x86-64; a full fence on RISC-V;
nothing extra on AArch64 for this pair.
:::

## What this cannot tell you

**Whether release-acquire is enough for your program.** The test is whether any thread stores
and then loads a different variable and needs the two ordered. Most programs do not; locks and
handovers do not. The ones that do are usually implementing a lock.

**What the browser's host does with a relaxed atomic.** The engine emits the strong instruction,
whichever host. The native fragments are the only view.

**Why the outcome happens.** The model's store buffer is a model. The hardware's is
[ch14](#store-buffers-and-visibility).

## Where to go next

- **The definition.** Leslie Lamport, *How to Make a Multiprocessor Computer That Correctly
  Executes Multiprocess Programs*, IEEE Transactions on Computers, 1979, the paper that named
  sequential consistency.
- **The test.** The store-buffer litmus test, known as SB, in Peter Sewell and others, *x86-TSO:
  A Rigorous and Usable Programmer's Model for x86 Multiprocessors*, CACM 2010.
- **The standard.** ISO C, section 7.17.3, `memory_order_seq_cst`, and the single total order of
  all sequentially consistent operations.
- **Next.** [ch11](#fences) separates a fence from an atomic operation.
