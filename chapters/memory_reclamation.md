---
title: Memory reclamation
---

(memory-reclamation)=
# Memory reclamation

## The question

Why does removing a lock create a problem about when memory may be reused?

With a lock, the answer is in the lock: a thread that holds it is the only one touching the
structure, so it may free a node it unlinks, and nobody can be reading it. Without a lock, every
other thread may be reading the structure at every moment, and a node unlinked by one thread may
be in another thread's hands, between a read of the pointer and a read of what it points to.
[ch17](#the-aba-problem) saw one consequence; this chapter sees the general one. A node freed
and reused while a reader holds it is a use after free, which in C is undefined and in practice
is a read of somebody else's data. The kernel makes it visible by poisoning every record it
retires, and then shows the oldest answer to the problem: a reader announces what it is reading,
and the writer waits.

## The smallest program

A writer publishes records through a pointer, one after another, and retires the old one each
time. A reader follows the pointer and reads the record. Without protection:

```{literalinclude} ../experiments/reclamation/reclamation.c
:language: c
:start-at: /* A reader with no protection
:end-before: /* A reader with a hazard pointer
```

The writer, which retires at once or waits:

```{literalinclude} ../experiments/reclamation/reclamation.c
:language: c
:start-at: /* The writer: fill the next record
:end-before: /* Worker 0 writes
```

## Run it

One writer and three readers. The writer updates a hundred thousand times; the readers read
until it has finished.

```lab
experiment: reclamation
readers: 3
protection: none
```

Try these, in order:

1. **Run it.** *Poisoned reads* is not zero. A reader followed the pointer to a record, the
   writer published a new one and poisoned the old, and the reader's read of the record came
   after the poison. In a real program the poison is whatever the allocator put there next.
2. **Add readers.** More readers, more poisoned reads: each is another thread that can be
   between the pointer and the record when the writer retires.
3. **Switch the protection to *hazard pointers*.** Zero poisoned reads. *Writer waits* is large:
   the writer found a reader's hazard pointer naming the record it wanted to retire, and
   spun until the reader was done. The readers never waited.
4. **Open the deterministic trace.** Without protection, the writer poisons record one while
   the reader is between its two loads. With a hazard pointer, step by hand: the reader announces
   record one, the writer publishes record two and spins on the hazard, the reader finishes and
   clears it, and only then does the writer poison.

## What the source hides

The reader's two loads, the pointer and then the record, are not one operation, and nothing
makes them one. Between them the writer may do anything, including free the record. The trace:

```{include} _generated/reclamation-trace-none.md
```

A hazard pointer is a word per reader that says "I am about to read this record". The reader
writes it after loading the pointer and then loads the pointer again: if the pointer still names
the record, the writer cannot have retired it yet, because the writer checks every hazard before
retiring; if it has moved, the reader starts over. The writer, before reusing a retired record,
reads every hazard and waits while any names it. The trace:

```{include} _generated/reclamation-trace-hazard.md
```

The hazard pointer's store is sequentially consistent and so is the writer's load of it, and
this is one of the places that strength is needed: the reader stores its hazard and then loads
the pointer; the writer stores the pointer and then loads the hazard. That is the store-buffer
test of [ch10](#sequential-consistency), and with weaker orderings both could miss each other,
the reader seeing the old pointer and the writer seeing no hazard.

## At the machine

The two readers, side by side:

::::{tab-set}
:::{tab-item} x86-64
:sync: x86-64
```{include} _generated/reclamation-read-x86-64.md
```
:::
:::{tab-item} AArch64
:sync: aarch64
```{include} _generated/reclamation-read-aarch64.md
```
:::
:::{tab-item} RISC-V
:sync: riscv64
```{include} _generated/reclamation-read-riscv64.md
```
:::
:::{tab-item} WebAssembly
:sync: wasm
```{include} _generated/reclamation-read-wasm.md
```
:::
::::

The unprotected reader is two loads: the pointer, then the record at an address computed from
it. On AArch64 the first is `ldar`, acquire, so that the second cannot be performed before it.
The protected reader adds the hazard's store and the second load of the pointer, and on x86-64
the sequentially consistent store of the hazard is the `xchg` of [ch10](#sequential-consistency),
which is what keeps the reader's store visible before its load. The writer's retire loop reads
the hazards and spins; it is in the kernel, and the native tabs show it:

::::{tab-set}
:::{tab-item} x86-64
:sync: x86-64
```{include} _generated/reclamation-update-x86-64.md
```
:::
:::{tab-item} AArch64
:sync: aarch64
```{include} _generated/reclamation-update-aarch64.md
```
:::
:::{tab-item} WebAssembly
:sync: wasm
```{include} _generated/reclamation-update-wasm.md
```
:::
::::

## Fix one thing

The fix is the hazard pointer, and this panel is locked to it:

```lab
experiment: reclamation
readers: 3
protection: hazard pointers
lock: protection
```

The cost is on the writer, which waits, and on every read, which is now three loads and a store,
the store sequentially consistent. A real implementation does not spin: it puts retired records
on a list and reclaims those no hazard names, in batches, so that the writer rarely waits and
the memory held back is bounded by the number of readers. The kernel spins to make the wait
visible.

The other family of fixes is to make readers announce not a record but a time: an epoch, which
the next chapters' read-copy-update does, at a lower cost per read and a higher cost in memory
held back.

## Break it again

Weaken the hazard pointer's store to a release, or the writer's load of it to an acquire. Both
are correct-looking and both are wrong, for the reason the trace cannot show and
[ch10](#sequential-consistency) could: the reader's store and load, and the writer's store and
load, are the store-buffer pattern, and only sequential consistency, or a fence, forbids the
outcome where each misses the other. The kernel keeps the strong orderings; the lesson is that
reclamation is where the weaker orderings of Part III stop being enough.

## The mental model

:::{div}
:class: model

**Without a lock, every reader may be mid-read at every moment.** Freeing a node a reader holds is
a use after free, and the reader has no way to know.

**A hazard pointer is a reader's announcement.** Store it, re-check the pointer, read; the writer
retires nothing a hazard names. Readers never wait; the writer does.

**The announcement needs sequential consistency.** A reader's store-then-load and a writer's
store-then-load must not both miss: the store-buffer test, with memory at stake.
:::

## What this cannot tell you

**The cost in a real structure.** Hazard pointers protect one record per reader per hazard; a
traversal of a list needs a hazard per node it holds, and the bookkeeping is the cost.

**What garbage collection changes.** A language with a collector has no reuse problem: a node a
reader holds is not freed. It has the ABA problem still, unless the collector ensures a popped
node is never the same object as a pushed one, which most do.

**The whole design space.** Epochs, quiescent states, reference counts with deferred frees, and
the schemes that combine them. [ch20](#rcu) is one; the sources below are the rest.

## Where to go next

- **Hazard pointers.** Maged Michael, *Hazard Pointers: Safe Memory Reclamation for Lock-Free
  Objects*, IEEE TPDS 2004.
- **The comparison.** Thomas Hart, Paul McKenney, Angela Demke Brown and Jonathan Walpole,
  *Performance of Memory Reclamation for Lockless Synchronization*, JPDC 2007.
- **The language.** C++26 adds `std::hazard_pointer` and `std::rcu_domain`, which standardise
  both families.
- **Next.** [ch19](#lock-free-queue) builds a queue, where the reuse is of slots rather than
  nodes, and then [ch20](#rcu) lets readers announce a time instead of a record.
