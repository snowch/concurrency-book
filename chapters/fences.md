---
title: Fences
---

(fences)=
# Fences

## The question

What does a fence order, and why is it not a substitute for an atomic read-modify-write?

[ch10](#sequential-consistency) closed the store-buffer gap by making the store sequentially
consistent, and on x86-64 the compiler did it with an exchange. There is another way to say the
same thing: leave the store and the load as they are and put an instruction between them that
says "finish everything before this point before starting anything after it". That is a fence.
Fences are older than atomics in the language, they appear in every architecture manual, and they
are routinely confused with atomic operations, which they are not. This chapter runs the test
with a fence, reads the instruction on each target, and then shows a problem a fence cannot
solve.

## The smallest program

The volatile store and load from ch10, with a full fence between them:

```{literalinclude} ../experiments/store_buffer/store_buffer.c
:language: c
:start-at: CM_NOINLINE int sb_fence_a
:end-before: /* Worker 1's half
```

`atomic_thread_fence(memory_order_seq_cst)` orders every memory access before it against every
memory access after it, in this thread, as seen by any other thread. It touches no variable. It
is the only line in the kernel that compiles to an instruction with no operand.

## Run it

```lab
experiment: store_buffer
workers: 2
lock: workers
ordering: fence
```

Try these, in order:

1. **Run it.** *Both loaded zero* is zero. The volatile store and load are the same ones that
   produced the outcome in ch10; the fence between them is the whole difference.
2. **Switch to *volatile*.** The outcome returns. Switch back. The fence is doing on the volatile
   accesses what `seq_cst` did on the atomic ones.
3. **Open the deterministic trace.** Under *fence*, the fence step drains the thread's store
   buffer before the load runs, under every schedule. Under *volatile*, nothing drains it until
   after the load.
4. **Compare the fence with *seq_cst* in *At the machine*.** On x86-64 the fence version is
   `mov`, `mfence`, `mov`, and the sequentially consistent version is `xchg`, `mov`. Same effect,
   different instruction, and the exchange is the cheaper of the two.

## What the source hides

A fence orders; it does not touch. The trace's fence drains the buffer and changes no variable:

```{include} _generated/store_buffer-trace-fence.md
```

A fence has two halves on most targets, and the C standard's orderings name them. A release
fence orders every access before it against every store after it: nothing earlier may be seen
after a later store. An acquire fence orders every load before it against every access after:
nothing later may be seen before an earlier load. A sequentially consistent fence is both, and
also takes a place in the single order of ch10. Fences let a program pay for ordering once,
around a group of plain or relaxed accesses, instead of on every access; that is their reason to
exist beside the orderings on operations.

What a fence does not do is make anything atomic. A plain `counter++` with a fence before it and
a fence after it is still a load, an add and a store, and another thread's store still lands
between the load and the store. The fence says the load completes before the store; it says
nothing about what other threads do in between, because a fence is a statement about this
thread's accesses alone. [ch02](#two-threads-one-variable)'s trace with a fence in each thread
would lose exactly the same updates.

## At the machine

::::{tab-set}
:::{tab-item} x86-64
:sync: x86-64
```{include} _generated/store_buffer-fence-x86-64.md
```
:::
:::{tab-item} AArch64
:sync: aarch64
```{include} _generated/store_buffer-fence-aarch64.md
```
:::
:::{tab-item} RISC-V
:sync: riscv64
```{include} _generated/store_buffer-fence-riscv64.md
```
:::
:::{tab-item} WebAssembly
:sync: wasm
```{include} _generated/store_buffer-fence-wasm.md
```
:::
::::

**x86-64**: `mfence`, memory fence, which waits for the store buffer to drain before the next
load issues. It is the one explicit full fence x86-64 has, and it is slower than a locked
instruction doing the same job, which is why ch10's compiler chose `xchg` for the sequentially
consistent store and why some runtimes use a locked add to a stack slot as a fence.

**AArch64**: `dmb ish`, data memory barrier, inner shareable domain. Every memory access before
it completes before any after it, as observed by every core in the inner shareable domain, which
is the cores that share memory. AArch64 has lighter barriers too, `dmb ishst` for stores only
and `dmb ishld` for loads, and the acquire and release instructions of ch08 that order without
a barrier at all.

**RISC-V**: `fence rw, rw`. The two operands are the predecessor and successor sets: reads and
writes before, reads and writes after. `fence rw, w` was ch08's release and `fence r, rw` its
acquire; the full fence is both.

**WebAssembly**: `atomic.fence`, which orders every access, atomic or not, before it against
every access after it. It is the only ordering instruction WebAssembly has beyond the strong
atomics, and it is there for exactly this: ordering plain accesses without making them atomic.

The fragments show the asymmetry the chapter began with. An atomic operation names a variable
and changes it; a fence names nothing. On x86-64 a locked operation also acts as a full fence,
so the two coincide on that one target, which is the source of most of the confusion.

## Fix one thing

The fix for the store-buffer test is either ch10's sequentially consistent store or this
chapter's fence, and both are correct. This panel is locked to the fence:

```lab
experiment: store_buffer
workers: 2
lock: workers, ordering
ordering: fence
```

Choose by what the program needs ordered. One access: put the ordering on the access. A group of
accesses: a fence. On x86-64 prefer the ordering on the access, because the compiler will use a
locked instruction instead of `mfence`. On AArch64 prefer the ordering on the access, because
`stlr` and `ldar` are cheaper than `dmb`.

## Break it again

Try to fix [ch02](#two-threads-one-variable) with a fence. Put a full fence after the load and
another after the store in each thread's increment. The trace under *alternate* loses the same
update it always did: thread A loads, thread B loads, both add, both store. The fences ordered
each thread's load before its own store, which was never in doubt. They did nothing about the
other thread, because a fence cannot. The fix for ch02 was an atomic read-modify-write, which
excludes the other thread for the duration of the operation; the fix for ch10 was an ordering,
which a fence can provide. Two problems, two tools, and a fence is the right one for exactly one
of them.

## The mental model

:::{div}
:class: model

**A fence orders this thread's accesses as other threads see them.** Before the fence completes
before after the fence. A release fence protects earlier accesses from later stores; an acquire
fence protects later accesses from earlier loads; a full fence is both.

**A fence touches no variable and excludes no thread.** It cannot make a read-modify-write
atomic. Only an atomic operation can.

**On x86-64 a locked operation is also a full fence.** That coincidence is why the two are
confused. On AArch64 and RISC-V they are different instructions with different jobs.
:::

## What this cannot tell you

**The relative cost of a fence and a locked operation on your processor.** The live run's time
is dominated by the trial barrier, not the fence.

**What a fence costs on a weakly ordered core.** `dmb ish` can stall for every outstanding
access; the fragments show the instruction, not the stall.

**Compiler fences.** `atomic_signal_fence` orders the compiler's output without emitting a
processor instruction. It is a tool for signal handlers and for code that knows the hardware's
order already, and this book does not use it.

## Where to go next

- **The standard.** ISO C, section 7.17.4, fences, and the rules for a fence synchronising with
  an atomic operation.
- **The instructions.** Intel 64 and IA-32 Architectures Software Developer's Manual, volume 3,
  section 8.2, memory ordering, on `MFENCE`, `SFENCE` and `LFENCE` and on locked instructions as
  fences; Arm Architecture Reference Manual for A-profile, `DMB`, `DSB` and `ISB`; The RISC-V
  Instruction Set Manual, volume I, the `FENCE` instruction.
- **The Linux view.** The Linux kernel's `Documentation/memory-barriers.txt`, the most read
  document on fences, written for a kernel that targets every architecture here.
- **Next.** [ch12](#cache-coherence) goes below the fences to the hardware they order.
