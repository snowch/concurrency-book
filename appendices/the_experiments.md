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
| Controls | workers; increments per worker; operation (plain or atomic) |
| Arguments | `a` increments per worker; `b` 1 for the atomic increment, 0 for the plain one |
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

## The others

The experiments the later chapters use are listed here as each is written: a lock-free stack,
ABA, reclamation, a queue, RCU, contention, the wait-and-notify handshake, and the final
challenge.
