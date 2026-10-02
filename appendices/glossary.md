---
title: Glossary
---

(glossary)=
# Glossary

Each term is defined where a chapter first uses it; this is the list, with the chapter.

**ABA.** A compare-and-swap that succeeds because the word holds the value it held before, after it changed and changed back; for a pointer, a different object at the same address. [ch17](#the-aba-problem)

**Acquire.** An ordering on a load: nothing this thread does after the load may be seen before
it. Paired with a release, it completes a handover. [ch08](#acquire-and-release)

**Atomic operation.** An operation that other threads see as one indivisible step: either it has
not happened or it has, never half. [ch03](#atomic-operations)

**Cache line.** The unit a cache holds and the coherence protocol moves. Its size is the core's, not the instruction set's: sixty-four bytes on most processors the book runs on, a hundred and twenty-eight on some. [ch12](#cache-coherence)

**Check-then-act.** A decision made from a value read earlier, acted on after other threads may have changed it: the shape of the booking office's bug. [ch25](#diagnose-the-race)

**Coherence.** The property that every core sees the stores to one variable in one order, kept
by the protocol between the caches. [ch12](#cache-coherence)

**Compare-and-swap.** An atomic operation that stores a new value only if the word still holds
the value expected, and reports which happened. [ch04](#compare-and-swap)

**Cross-origin isolation.** The state a browser requires of a page before it will give it shared memory, set by two response headers; the book's service worker provides them. [ch22](#webassembly-threads)

**Data race.** Two threads making plain accesses to the same variable, at least one writing, with nothing to order them. In C it is undefined behaviour; in WebAssembly it has a defined but weak meaning.
[ch02](#two-threads-one-variable)

**False sharing.** Two variables on one cache line, written by different threads, which the
protocol moves between the cores as if the variables were shared. [ch13](#false-sharing)

**Fence.** An operation that orders this thread's accesses before it against those after it, as other threads see them, touching no variable; an instruction on some targets, nothing on others. [ch11](#fences)

**Grace period.** The wait, after a writer publishes a new record, until every reader that might have been reading the old one has finished. [ch20](#rcu)

**Happens-before.** The order the language guarantees between operations in different threads: everything before a release store happens before everything after the acquire load that reads it. [ch08](#acquire-and-release)

**Hazard pointer.** A word per reader naming the record it is about to read, which a writer checks before reusing a record. [ch18](#memory-reclamation)

**Lock-free.** A structure some thread always makes progress on, whatever the others do: no lock, and no thread can block the rest by stopping. [ch16](#lock-free-stack)

**Lost update.** An increment that another thread's store overwrote: both read the same old
value, both wrote the same new one. [ch02](#two-threads-one-variable)

**Lost wake-up.** A release that notifies before the waiter has gone to sleep, so the waiter
sleeps on a lock that is free. A wait that compares before sleeping prevents it.
[ch06](#from-spinlock-to-mutex)

**Mutex.** A lock whose waiters stop running until a release wakes one.
[ch06](#from-spinlock-to-mutex)

**Quiescent state.** A point where a reader holds no reference to any record, which it marks for the writer; a grace period ends when every reader has passed one. [ch20](#rcu)

**Read-modify-write.** An operation that reads a value, computes from it and writes the result.
Plain, it is three operations however many instructions it takes; atomic, it is one indivisible step. [ch01](#what-x-plus-plus-does)

**Relaxed.** The ordering that promises atomicity, the compiler's honesty and one order per
variable, and nothing about any other variable. [ch09](#relaxed-atomics)

**Release.** An ordering on a store: nothing this thread did before the store may be seen after
it. [ch08](#acquire-and-release)

**Ring buffer.** A fixed array of slots used as a queue, with a head and a tail that wrap around. [ch19](#lock-free-queue)

**Scalability.** How the rate of work changes as workers are added; a shared word's rate falls, a word per worker's holds. [ch21](#contention-and-scalability)

**Sequential consistency.** One order of every thread's operations, each in program order, every
load seeing the last store before it. The strongest ordering, and C's default when an atomic operation names no ordering.
[ch10](#sequential-consistency)

**Shared memory.** Memory more than one thread can read and write. In the laboratory, one
WebAssembly memory every worker's instance imports. [ch02](#two-threads-one-variable)

**Spinlock.** A lock whose waiters loop, on a load or an exchange, until the word reads free and an exchange takes it.
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
