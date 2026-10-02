---
title: Lock-free queue
---

(lock-free-queue)=
# Lock-free queue

## The question

How do many producers and many consumers share one queue without a lock?

A stack has one end, and [ch16](#lock-free-stack) kept it consistent with one compare-and-swap
on one word. A queue has two ends, a producer's and a consumer's, and an item must travel from
one to the other through memory both sides touch. The structure most programs want is a bounded
ring: a fixed array of slots, a tail the producers advance, a head the consumers advance. This
chapter builds it in three steps, running each, so that the design that works is the answer to
two designs that do not. The checks are the chapter's instrument: every item names its producer
and its number, so a consumer can tell when an item is missing, arrives twice, or arrives before
an earlier one from the same producer.

## The smallest program

Step one is the ring that works for one producer and one consumer. The tail belongs to the
producer and the head to the consumer, so each is written by one thread, and a release on the
write with an acquire on the other side's read is the handover of
[ch08](#acquire-and-release):

```{literalinclude} ../experiments/queue/queue.c
:language: c
:start-at: /* Step one
:end-before: /* Step two
```

Step two claims a position by compare-and-swap before using the slot, so two producers cannot
take one slot:

```{literalinclude} ../experiments/queue/queue.c
:language: c
:start-at: /* Step two
:end-before: /* Step three
```

Step three gives every slot a sequence number that says whose turn it is:

```{literalinclude} ../experiments/queue/queue.c
:language: c
:start-at: /* Step three
:end-before: /* a: items per producer
```

## Run it

Two producers and two consumers, fifty thousand items each, through the ring that works for one
of each.

```lab
experiment: queue
producers: 2
consumers: 2
step: one-to-one ring
```

Try these, in order:

1. **Run it.** The one-to-one ring, used by two of each, loses most of its items: *Dequeued* is
   far below *Enqueued*, *Unwritten slots* is large, and some items arrive out of order. Two
   producers both read the tail, both write the same slot, both store the same new tail: one
   item is overwritten and the tail advances once for two writes. The consumers do the same at
   the head.
2. **Switch the design to *claimed positions*.** Most items now arrive, but *Unwritten slots* is
   not zero: a consumer claimed a position by compare-and-swap before the producer that claimed
   it had written the item, and found the slot empty. The claims are atomic; the slot is not
   part of the claim.
3. **Switch to *sequenced slots*.** Every item arrives, once, in its producer's order. Add
   producers and consumers: still exact.
4. **Set one producer and one consumer and switch back to the one-to-one ring.** Exact. The
   first design was never wrong; it was wrong for more than one of each, and that is the usual
   way a queue is wrong.

## What the source hides

The first ring hides the assumption in its name: one writer per index. Two producers reading the
same tail is the lost update of [ch02](#two-threads-one-variable), applied to a position.

The second ring fixes the position and exposes the slot. A producer that has claimed position
`t` owns slot `t` until it has written the item, and nothing tells a consumer that. The consumer
claims position `t` as soon as the tail is past it, which happens the moment the producer's
compare-and-swap succeeds, before the write. The consumer then reads a slot that holds nothing
yet, or holds the previous lap's item.

The third ring puts the handover in the slot. Each slot carries a sequence number. A slot whose
sequence equals position `t` is ready for the producer at `t`; the producer claims `t`, writes
the item, and then stores `t + 1` into the sequence with a release. A consumer at position `t`
waits for the sequence to read `t + 1`, which it loads with an acquire, so the item is visible
when the sequence is, by [ch08](#acquire-and-release)'s rule. Having read, the consumer stores
`t + capacity` into the sequence, which is the position of the producer that will use this slot
on the next lap. The compare-and-swaps on the head and the tail decide who gets a position; the
sequence numbers decide when the slot is theirs to use. Each slot is, in effect, a tiny
one-to-one ring between the producer and the consumer of one position.

## At the machine

The sequenced enqueue:

::::{tab-set}
:::{tab-item} x86-64
:sync: x86-64
```{include} _generated/queue-enqueue-x86-64.md
```
:::
:::{tab-item} AArch64
:sync: aarch64
```{include} _generated/queue-enqueue-aarch64.md
```
:::
:::{tab-item} RISC-V
:sync: riscv64
```{include} _generated/queue-enqueue-riscv64.md
```
:::
:::{tab-item} WebAssembly
:sync: wasm
```{include} _generated/queue-enqueue-wasm.md
```
:::
::::

Find the three parts: the acquire load of the slot's sequence (`ldar` on AArch64), the
compare-and-swap on the tail (`lock cmpxchg`, the exclusive pair, `lr.w` and `sc.w`,
`i32.atomic.rmw.cmpxchg`), and the release store of the new sequence (`stlr`, or `fence rw, w`
before the store). The item's own store is a plain one between the claim and the release, which
is all it needs to be.

The one-to-one ring's enqueue and dequeue, for comparison, have no compare-and-swap at all:

::::{tab-set}
:::{tab-item} x86-64
:sync: x86-64
```{include} _generated/queue-spsc-x86-64.md
```
:::
:::{tab-item} AArch64
:sync: aarch64
```{include} _generated/queue-spsc-aarch64.md
```
:::
:::{tab-item} RISC-V
:sync: riscv64
```{include} _generated/queue-spsc-riscv64.md
```
:::
:::{tab-item} WebAssembly
:sync: wasm
```{include} _generated/queue-spsc-wasm.md
```
:::
::::

The whole difference between a queue for one of each and one for many of each is the
compare-and-swap on the index and the sequence in the slot. The one-to-one ring is the fastest
queue there is, and the right one when its assumption holds.

## Fix one thing

The fix is the sequence number, and this panel is locked to it:

```lab
experiment: queue
producers: 2
consumers: 2
step: sequenced slots
lock: step
```

A note on the ring's size. It is bounded, so a producer that finds every slot in use must wait,
and the kernel's producers give up after a long wait and drop the item, which the *Dropped* tile
counts, so that a broken design cannot hang the page. The sequenced design drops nothing unless
the consumers are starved of a core for longer than the wait, which on a device with few cores
and many workers can happen; the drop is the harness's choice, not the queue's.

## Break it again

The chapter already did, twice. The one worth adding is reuse: the sequenced ring reuses slots
every lap, and the sequence number is what keeps a slow consumer from reading an item two laps
old. Remove the lap from the sequence, comparing only the low bits, and ABA returns, in the
shape of [ch17](#the-aba-problem).

## The mental model

:::{div}
:class: model

**A queue is two handovers.** Producers hand positions to each other through the tail;
consumers through the head. Each is a compare-and-swap. The item crosses from producer to
consumer through the slot, and that handover needs its own flag: the sequence number.

**A claim is not a write.** Owning position `t` is not the same as having written slot `t`. The
slot must say when it is ready, with a release, and be read with an acquire.

**One of each needs none of this.** A single producer and a single consumer need only the
release and acquire on the two indices.
:::

## What this cannot tell you

**Throughput.** The live time includes the checks every consumer runs on every item. The
relative cost of the three designs is visible; the absolute rate is not a measurement.

**What a full queue should do.** Block, drop, or grow is a design choice above the structure.
The kernel drops after a long wait, for the page's sake.

**Unbounded queues.** A queue of linked nodes, which grows, meets the reclamation problem of
[ch18](#memory-reclamation) at every dequeue.

## Where to go next

- **The design.** Dmitry Vyukov's bounded multi-producer multi-consumer queue, described on his
  site 1024cores, which this chapter's third step follows.
- **The unbounded one.** Maged Michael and Michael Scott, *Simple, Fast, and Practical
  Non-Blocking and Blocking Concurrent Queue Algorithms*, PODC 1996.
- **The single-producer ring.** Leslie Lamport, *Proving the Correctness of Multiprocess
  Programs*, IEEE TSE 1977, where the one-to-one ring is proved correct.
- **Next.** [ch20](#rcu) lets readers never wait at all.
