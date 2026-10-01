---
title: Glossary
---

(glossary)=
# Glossary

Each term is defined where a chapter first uses it; this is the list, with the chapter.

**Acquire.** An ordering on a load: nothing this thread does after the load may be seen before
it. Paired with a release, it completes a handover. [ch08](#acquire-and-release)

**Atomic operation.** An operation that other threads see as one indivisible step: either it has
not happened or it has, never half. [ch03](#atomic-operations)

**Cache line.** The unit a cache holds and the coherence protocol moves: sixty-four bytes on
every target the book names. [ch12](#cache-coherence)

**Coherence.** The property that every core sees the stores to one variable in one order, kept
by the protocol between the caches. [ch12](#cache-coherence)

**Compare-and-swap.** An atomic operation that stores a new value only if the word still holds
the value expected, and reports which happened. [ch04](#compare-and-swap)

**Data race.** Two threads accessing the same variable, at least one writing, with nothing to
order them. In C it is undefined behaviour; in WebAssembly it has a defined but weak meaning.
[ch02](#two-threads-one-variable)

**False sharing.** Two variables on one cache line, written by different threads, which the
protocol moves between the cores as if the variables were shared. [ch13](#false-sharing)

**Fence.** An instruction that orders this thread's accesses before it against those after it,
as other threads see them, touching no variable. [ch11](#fences)

**Happens-before.** The relationship between a store and a load that is guaranteed to see it,
created by a release store read by an acquire load. [ch08](#acquire-and-release)

**Lost update.** An increment that another thread's store overwrote: both read the same old
value, both wrote the same new one. [ch02](#two-threads-one-variable)

**Lost wake-up.** A release that notifies before the waiter has gone to sleep, so the waiter
sleeps on a lock that is free. A wait that compares before sleeping prevents it.
[ch06](#from-spinlock-to-mutex)

**Mutex.** A lock whose waiters stop running until a release wakes one.
[ch06](#from-spinlock-to-mutex)

**Read-modify-write.** An operation that reads a value, computes from it and writes the result.
Plain, it is three steps; atomic, it is one. [ch01](#what-x-plus-plus-does)

**Relaxed.** The ordering that promises atomicity, the compiler's honesty and one order per
variable, and nothing about any other variable. [ch09](#relaxed-atomics)

**Release.** An ordering on a store: nothing this thread did before the store may be seen after
it. [ch08](#acquire-and-release)

**Sequential consistency.** One order of every thread's operations, each in program order, every
load seeing the last store before it. The strongest ordering, and the default.
[ch10](#sequential-consistency)

**Shared memory.** Memory more than one thread can read and write. In the laboratory, one
WebAssembly memory every worker's instance imports. [ch02](#two-threads-one-variable)

**Spinlock.** A lock whose waiters loop on an atomic exchange until it returns zero.
[ch05](#test-and-set-and-spinlocks)

**Store buffer.** The queue beside a core's cache where a store waits for its line, invisible
to other cores and visible to this one. [ch14](#store-buffers-and-visibility)

**Test-and-set.** An atomic exchange that writes a one and returns what was there.
[ch05](#test-and-set-and-spinlocks)

**Total store order.** x86-64's memory model: stores in order, loads in order, and a load may
pass an earlier store to a different address. [ch15](#x86-is-not-the-model)

**Volatile.** A promise that every access in the source is an access in the code, in order
with other volatile accesses, and nothing about other threads. [ch07](#the-compiler-is-part-of-the-story)

**Weak ordering.** AArch64's and RISC-V's memory model: any two accesses to different addresses
may be reordered unless an instruction orders them. [ch15](#x86-is-not-the-model)

**Worker.** A thread in the laboratory: a Web Worker running the kernel on the shared memory.
[ch02](#two-threads-one-variable)
