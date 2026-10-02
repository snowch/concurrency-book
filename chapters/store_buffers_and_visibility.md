---
title: Store buffers and visibility
---

(store-buffers-and-visibility)=
# Store buffers and visibility

## The question

Why does another core not see a store the moment it happens?

[ch12](#cache-coherence) explained what a write costs: the line must be taken from every other
cache first, and that is a round trip across the chip. A core that waited for the round trip on
every store would spend most of its time waiting. So it does not wait. It writes the store into a
small queue beside the cache, the store buffer, and goes on to the next instruction while the
buffer takes care of getting the line and writing the value. The store has happened as far as this
core is concerned: its own later loads see the value, by looking in the buffer. It has not
happened as far as any other core is concerned, because the value is not in any cache yet. That
gap is the store-buffer test's outcome in [ch10](#sequential-consistency), and this chapter runs
the test on the processor most readers have and names the thing that produced it.

## The smallest program

Thread A's half of the test, with plain volatile accesses, nothing ordering them:

```{literalinclude} ../experiments/store_buffer/store_buffer.c
:language: c
:start-at: CM_NOINLINE int sb_volatile_a
:end-before: CM_NOINLINE int sb_relaxed_a
```

Thread B's half mirrors it: store `y`, load `x`. Both loads returning zero means both stores
were still in their buffers when the loads ran.

## Run it

```lab
experiment: store_buffer
workers: 2
lock: workers
ordering: volatile
```

Try these, in order:

1. **Run it on an x86-64 device.** *Both loaded zero* is above zero, and the tile says by how much on this device.
   That is the store buffer: each thread's store was in its buffer, invisible to the other core,
   while the thread's load read the other word from the cache. x86-64 reorders nothing else, and
   it reorders this.
2. **Run it on an AArch64 device**, a phone or a recent Mac, if you have one. The outcome appears there
   too. This test has one store and one load per thread, so the other reorderings AArch64
   allows have nothing to act on here; [ch15](#x86-is-not-the-model) lists them.
3. **Raise the trials to a million.** The count grows with the trials. The fraction is this
   device's and this run's; the last section says why it is not a rate.
4. **Switch to *fence*.** Zero. The fence waits for the buffer to drain before the load.
5. **Open the deterministic trace** and step *alternate*: both stores enter their buffers, both
   loads read memory, both get zero, and only then do the buffers drain. The model and the hardware agree on every outcome this test can tell apart; the model is still a model.

## What the source hides

The store buffer is why a store is not an event. It is a process: the store enters the buffer,
the buffer requests the line, the line arrives in exclusive state, the value is written to the
cache, and from that moment other cores can see it. The load that followed the store in program
order ran during that process, and read the other core's word from its own cache, where the
other core's store had likewise not yet arrived.

Two more facts about the buffer explain two things seen earlier. First, a core's own loads look in
the buffer before the cache, which is called store forwarding and is why a single thread never
notices the buffer exists: [ch01](#what-x-plus-plus-does)'s single worker was always exact. Second,
on x86-64 the buffer drains in order, so a store never overtakes an earlier store; a separate rule
of the architecture keeps loads in order too; the only reordering x86-64 permits is the one in this
test, a load overtaking an earlier store to a different address. That one permission is the whole
of the difference between x86-64 and sequential consistency. The model, once more:

```{include} _generated/store_buffer-trace-buffered.md
```

## At the machine

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

Look at the volatile version on **x86-64**: `mov` to memory, `mov` from memory. Nothing in the two
instructions says that the first may still be pending when the second completes. The instruction
set's ordering rules, which the manual states in prose, say it; the instructions do not. The
sequentially consistent version's `xchg` is the instruction that waits: a locked operation is a
full barrier, which on these cores means the store buffer drains before it completes, and so
everything after it sees a buffer that is empty.

On **AArch64** the plain `str` and `ldr` carry even fewer promises, and `stlr` and `ldar` carry
them back. The volatile and relaxed versions are indistinguishable on every native target, and
on this one point WebAssembly, whose volatile version is the plain `i32.store` and `i32.load`,
is like the others.

The browser's own result comes from this WebAssembly as the engine compiled it for the host. The
engine added no fence, because the WebAssembly asked for none, so the host's own reordering
applies. That is why the browser shows the outcome on x86-64 for *volatile* and never for the
atomic orderings.

## Fix one thing

The fix is anything that drains the buffer before the load: the fence of [ch11](#fences) or the
sequentially consistent store of [ch10](#sequential-consistency). This panel is locked to the
sequentially consistent version:

```lab
experiment: store_buffer
workers: 2
lock: workers, ordering
ordering: seq_cst
```

The fix is also the reason sequentially consistent stores cost what they cost. A store that must
be visible before the next load cannot be buffered past it, and the core waits for the round trip
that the buffer exists to hide. On x86-64 the price is paid per store; a program that makes every
store sequentially consistent runs at the speed of its cache misses.

## Break it again

Keep the fence and move the load before it. The fence then orders the store against the
instructions after the load, which is nobody's concern, and the outcome returns. A fence is a
position in the instruction stream, and a fence in the wrong position is a fence around nothing.
The kernel does not offer this variant, because its only lesson is that the order of the three
lines matters, which is the order the trace shows.

## The mental model

:::{div}
:class: model

**A store is a process, not an event.** It enters the buffer, waits for the line, and becomes
visible when written to the cache. The core continues meanwhile.

**The core sees its own buffered stores; other cores do not.** Store forwarding keeps a single
thread consistent and hides the buffer from it entirely.

**x86-64's one reordering is the buffered store overtaken by a later load.** Draining the buffer
before the load, with a fence or a locked operation, restores sequential consistency.
:::

## What this cannot tell you

**The buffer's size and drain time on your processor.** The fraction of trials that hit the
window is one observation and depends on both.

**Why the fraction is what it is.** The trial barrier, the engine, the cores' clocks and what
else is running all move it. The result is "it happens", not "how often".

**What happens on the browser's host when it is not x86-64.** The engine emits the host's plain
loads and stores for the volatile version, and the host's own reorderings apply.
[ch15](#x86-is-not-the-model) is about those.

## Where to go next

- **The model.** Peter Sewell, Susmit Sarkar, Scott Owens, Francesco Zappa Nardelli and Magnus
  Myreen, *x86-TSO: A Rigorous and Usable Programmer's Model for x86 Multiprocessors*, CACM 2010.
  The store buffer is the model.
- **The manual.** Intel 64 and IA-32 Architectures Software Developer's Manual, volume 3,
  section 8.2.3, examples illustrating the memory-ordering principles, which includes this test
  as "loads may be reordered with earlier stores to different locations".
- **The hardware.** John Hennessy and David Patterson, *Computer Architecture: A Quantitative
  Approach*, on write buffers and memory consistency.
- **Next.** [ch15](#x86-is-not-the-model) puts the three architectures side by side.
