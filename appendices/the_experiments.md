---
title: The experiments
---

(the-experiments)=
# The experiments

Every experiment is a directory under `experiments/`: a kernel in freestanding C, a contract
(`experiment.json`) that declares its controls, its results, its modes and the functions the
chapters quote as assembly, and a panel under `web/lab/` that draws what the kernel reports.
The same kernel runs in the page, compiled to WebAssembly, and at a desk, on pthreads
([Appendix A](#reproducing-at-a-desk)).

Every kernel exports the same four functions, so one runtime runs them all:

```{literalinclude} ../experiments/cm.h
:language: c
:start-at: Every kernel exports
:end-before: #ifndef CM_H
```

## counter

*A shared counter.* Every worker increments one shared counter, with a plain increment or an
atomic one, and the page compares what the counter holds with what it should.
Used by [ch01](#what-x-plus-plus-does), [ch02](#two-threads-one-variable),
[ch03](#atomic-operations), [ch23](#build-a-concurrency-lab) and
[ch24](#from-wasm-to-machine-code).

| | |
|---|---|
| Controls | workers; increments per worker; operation (plain, atomic, split or folded) |
| Arguments | `a` increments per worker; `b` 0 plain, 1 atomic, 2 the loop the compiler sees whole, 3 an atomic load then an atomic store |
| Results | result 0 is the plain counter, result 1 the atomic counter |
| Modes | live, trace, at a desk |

## cas

*Compare-and-swap.* Every worker increments one counter by compare-and-swap, counting each
retry, or increments a plain counter under a lock built from the same instruction. Used by
[ch04](#compare-and-swap).

| | |
|---|---|
| Controls | workers; increments per worker; operation (cas or lock) |
| Arguments | `a` increments per worker; `b` 0 for the compare-and-swap loop, 1 for the lock |
| Results | result 0 is the counter, result 1 the retries in total, result 2 the counter under the lock, result 3 the most retries by one worker |
| Modes | live, trace, at a desk |

## spinlock

*A spinlock.* Every worker takes one lock, increments the counter inside it, does some busy work
and releases it; the page counts the increments and the spins each worker made. Used by
[ch05](#test-and-set-and-spinlocks).

| | |
|---|---|
| Controls | workers; critical sections per worker; busy steps inside the lock; acquire (tas, ttas or broken) |
| Arguments | `a` critical sections; `b` 0 test-and-set, 1 test then test-and-set, 2 the broken test-then-set; `c` busy steps |
| Results | result 0 is the counter, result 1 the spins in total, and the sixteen results after them each worker's spins |
| Modes | live, trace, at a desk |

## mutex

*A lock that sleeps.* Every worker takes one lock around a critical section: a spinlock, a lock
whose waiters sleep on the lock word, or one that spins a little before sleeping. Used by
[ch06](#from-spinlock-to-mutex).

| | |
|---|---|
| Controls | workers; critical sections per worker; busy steps inside the lock; lock (spin, sleep or spin-then-sleep) |
| Arguments | `a` critical sections; `b` 0 spin, 1 sleep, 2 spin then sleep; `c` busy steps |
| Results | result 0 is the counter, result 1 the spins in total, result 2 the sleeps in total |
| Modes | live, trace, at a desk |

## compiler

*A loop that waits for a flag.* One worker waits in a loop for a flag that another sets after
some busy work; the flag is plain, volatile or atomic. Used by
[ch07](#the-compiler-is-part-of-the-story).

| | |
|---|---|
| Controls | the setter's busy steps; the flag (plain, volatile or atomic) |
| Arguments | `a` busy steps; `b` 0 plain, 1 volatile, 2 atomic |
| Results | result 0 is the value the waiter's loop ended on, result 1 whether it ended, result 2 the setter's steps |
| Modes | live, trace, at a desk. The live run is stopped at a timeout when the loop does not end. |

## publication

*Publishing a value through a flag.* A writer stores a value and raises a flag; a reader waits
for the flag and reads the value, many times over; the page counts the trials where the flag
arrived first. Used by [ch08](#acquire-and-release), [ch09](#relaxed-atomics) and
[ch15](#x86-is-not-the-model).

| | |
|---|---|
| Controls | trials; ordering (volatile, relaxed, release-acquire or seq_cst) |
| Arguments | `a` trials; `b` 0 volatile, 1 relaxed, 2 release and acquire, 3 sequentially consistent |
| Results | result 0 is the trials completed, result 1 the stale reads |
| Modes | live, trace, at a desk |

## store_buffer

*The store-buffer test.* Two workers each store a one into their own word and then load the
other's, many times over; the page counts how often both loaded a zero. Used by
[ch10](#sequential-consistency), [ch11](#fences), [ch14](#store-buffers-and-visibility) and
[ch15](#x86-is-not-the-model).

| | |
|---|---|
| Controls | trials; ordering (volatile, relaxed, release-acquire, seq_cst or fence) |
| Arguments | `a` trials; `b` 0 volatile, 1 relaxed, 2 release and acquire, 3 sequentially consistent, 4 volatile with a fence |
| Results | result 0 is the trials; the four after it how often the pair of loads was (0, 0), (0, 1), (1, 0) and (1, 1) |
| Modes | live, trace, at a desk |

## sharing

*Counters on a cache line.* Every worker increments a counter of its own, in the same word as
the others', beside them on one line, or on a line of its own; the page compares the times.
Used by [ch12](#cache-coherence) and [ch13](#false-sharing).

| | |
|---|---|
| Controls | workers; increments per worker; layout (compare, same word, same line, own line, or two lines apart) |
| Arguments | `a` increments per worker; `b` 0 the same word, 1 adjacent words, 2 sixty-four bytes apart, 3 a hundred and twenty-eight bytes apart |
| Results | result 0 is every counter added up |
| Modes | live, at a desk |

## stack

*A lock-free stack.* Every worker pushes its own nodes and then pops as many as it can; the page
accounts for every node. Used by [ch16](#lock-free-stack).

| | |
|---|---|
| Controls | workers; nodes per worker; pop (cas or broken) |
| Arguments | `a` nodes per worker; `b` 0 the compare-and-swap pop, 1 the broken one |
| Results | result 0 is the pops, result 1 the nodes still in the stack, result 2 nodes popped twice, result 3 nodes popped once, result 4 pops that found it empty |
| Modes | live, trace, at a desk |

## aba

*The ABA problem.* Workers pop a node and push it back on a stack of three, round after round.
Used by [ch17](#the-aba-problem).

| | |
|---|---|
| Controls | workers; rounds per worker; the head (plain or tagged) |
| Arguments | `a` rounds; `b` 0 a plain head, 1 a tagged one |
| Results | result 0 is the pops, result 1 pops of a node not in the stack, result 2 nodes in the stack at the end |
| Modes | live, trace, at a desk |

## reclamation

*Reclaiming a record readers may hold.* A writer publishes new records and retires old ones
while readers follow the pointer. Used by [ch18](#memory-reclamation).

| | |
|---|---|
| Controls | readers; updates; protection (none or hazard pointers) |
| Arguments | `a` updates; `b` 0 none, 1 hazard pointers; `c` readers |
| Results | result 0 is the reads, result 1 the poisoned reads, result 2 the updates, result 3 the writer's waits |
| Modes | live, trace, at a desk |

## queue

*A bounded queue for many producers and consumers.* Producers enqueue numbered items and
consumers dequeue them through a ring of slots, in three designs. Used by
[ch19](#lock-free-queue).

| | |
|---|---|
| Controls | producers; consumers; items per producer; design (one-to-one ring, claimed positions or sequenced slots) |
| Arguments | `a` items per producer; `b` 0, 1 or 2 for the design; `c` producers |
| Results | result 0 is the items enqueued, result 1 the dequeues, result 2 unwritten slots read, result 3 out of order, result 4 seen twice, result 5 dropped |
| Modes | live, at a desk |

## rcu

*Read-copy-update.* Readers never wait; the writer waits for a grace period before reusing a
record. Used by [ch20](#rcu).

| | |
|---|---|
| Controls | readers; updates; before reuse, the writer reuses at once or waits for a grace period |
| Arguments | `a` updates; `b` 0 reuse at once, 1 wait; `c` readers |
| Results | result 0 is the reads, result 1 the poisoned reads, result 2 the updates, result 3 the grace-period waits |
| Modes | live, trace, at a desk |

## contention

*The same work, on one word or on many.* Every worker makes the same number of increments, on
one shared atomic counter or on a counter of its own; the page runs one worker, then two, then
more, and draws the rate. Used by [ch21](#contention-and-scalability).

| | |
|---|---|
| Controls | workers, up to; increments per worker; counters (compare, one shared, one each, or one each and plain) |
| Arguments | `a` increments per worker; `b` 0 one shared atomic counter, 1 an atomic counter each, 2 a plain counter each |
| Results | result 0 is every counter added up |
| Modes | live, at a desk |

## handshake

*A handshake: ping, pong.* Two workers take turns, waiting for each other by sleeping and waking
or by spinning. Used by [ch22](#webassembly-threads).

| | |
|---|---|
| Controls | round trips; waiting by (sleep and wake, or spin) |
| Arguments | `a` round trips; `b` 0 sleep and wake, 1 spin |
| Results | result 0 is the round trips, result 1 the sleeps, result 2 the spins |
| Modes | live, trace, at a desk |

## challenge

*The booking office.* Workers book seats from a shared count until the office refuses; the office
as written sells seats it does not have. Used by [ch25](#diagnose-the-race).

| | |
|---|---|
| Controls | workers; seats on sale; busy steps to confirm a booking; the office (as written, with atomics, compare-and-swap, or under a lock) |
| Arguments | `a` seats on sale; `b` 0 to 3 for the version; `c` busy steps |
| Results | result 0 is the seats on sale, result 1 the seats booked, result 2 the seats left |
| Modes | live, trace, at a desk |
