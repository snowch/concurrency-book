---
title: Glossary
---

(glossary)=
# Glossary

Each term is defined where a chapter first uses it; this is the list, with the chapter.

**ABA.** A compare-and-swap that succeeds because the word holds the value it held before, after it
changed and changed back; for a pointer, the same address with something different behind it. Why
it matters here: It is the one failure a compare-and-swap cannot see, and the reason Part V needs
tags and reclamation. [ch17](#the-aba-problem)

**Acquire.** An ordering on a load: nothing this thread does after the load may be seen before it.
Paired with a release, it completes a handover. Why it matters here: it is the reader's half of
every handover in the book, from a flag to a lock to a published record.
[ch08](#acquire-and-release)

**Atomic operation.** An operation that other threads see as one indivisible step: either it has
not happened or it has, never half. Why it matters here: every fix in Part I is one, and every bug
in Part V is two of them with a window between. [ch03](#atomic-operations)

**Cache line.** The unit a cache holds and the coherence protocol moves. Its size is the core's,
not the instruction set's: sixty-four bytes on most processors the book runs on, a hundred and
twenty-eight on some. Why it matters here: it is the unit the cores fight over, and the reason an
atomic increment costs what ch12 measures. [ch12](#cache-coherence)

**Check-then-act.** A decision made from a value read earlier, acted on after other threads may
have changed it: the shape of the booking office's bug. Why it matters here: it is the shape of the
final challenge, and the bug that making each access atomic cannot fix. [ch25](#diagnose-the-race)

**Coherence.** The property that every core sees the stores to one variable in one order, kept by
the protocol between the caches. Why it matters here: it is why every core agrees about one
variable, and why that agreement says nothing about two. [ch12](#cache-coherence)

**Compare-and-swap.** An atomic operation that stores a new value only if the word still holds the
value expected, and reports which happened. Why it matters here: it is the instruction every lock
and every lock-free structure in the book is built from. [ch04](#compare-and-swap)

**Cross-origin isolation.** The state a browser requires of a page before it will give it shared
memory, set by two response headers; the book's service worker provides them. Why it matters here:
Without it the browser withholds shared memory, and a page offers only its trace and its desk
commands. [ch22](#webassembly-threads)

**Data race.** Two threads accessing the same variable, at least one writing and at least one of them plain, with nothing to order them. In C it is undefined behaviour; in WebAssembly it has a defined but weak
meaning. Why it matters here: it is what the language declines to define, so the compiler may
assume it never happens. [ch02](#two-threads-one-variable)

**False sharing.** Two variables on one cache line, written by different threads, which the
protocol moves between the cores as if the variables were shared. Why it matters here: it is the
cost of coherence paid for nothing, and the reason the kernels pad their counters.
[ch13](#false-sharing)

**Fence.** An operation that orders this thread's accesses before it against those after it, as
other threads see them, touching no variable; an instruction on some targets; on others, for the weaker orderings, a constraint on the compiler alone.
Why it matters here: it is how a group of accesses is ordered at once, where putting the ordering
on each access will not do. [ch11](#fences)

**Grace period.** The wait, after a writer publishes a new record, until every reader that might
have been reading the old one has finished. Why it matters here: it is how RCU's writer knows every
reader of the old record has gone, without any reader saying so. [ch20](#rcu)

**Happens-before.** The order the language guarantees between operations in different threads:
everything before a release store happens before everything after the acquire load that reads it.
Why it matters here: it is the language's only word for the data arriving with the flag, and the
thing a race lacks. [ch08](#acquire-and-release)

**Hazard pointer.** A word per reader naming the record it is about to read, which a writer checks
before reusing a record. Why it matters here: it is how a reader stops a writer from freeing what
it holds, at the price of a sequentially consistent store and a second load per read. [ch18](#memory-reclamation)

**Lock-free.** A structure some thread always makes progress on, whatever the others do: no lock,
and no thread can block the rest by stopping. Why it matters here: it is the promise ch16's stack
keeps and ch19's ring does not, whatever its title says. [ch16](#lock-free-stack)

**Lost update.** An increment that another thread's store overwrote: both read the same old value,
both wrote the same new one. Why it matters here: it is the first bug in the book, and the one
every atomic read-modify-write exists to prevent. [ch02](#two-threads-one-variable)

**Lost wake-up.** A release that notifies before the waiter has gone to sleep, so the waiter sleeps
on a lock that is free. A wait that compares and sleeps in one step prevents it. Why it matters here: it
is why a sleeping lock must compare and sleep in one step, which ch06 and ch22 show.
[ch06](#from-spinlock-to-mutex)

**Mutex.** A lock whose waiters stop running until a release wakes one. Why it matters here: it is
what every spinlock becomes once waiting by spinning costs more than waking.
[ch06](#from-spinlock-to-mutex)

**Quiescent state.** A point where a reader holds no reference to any record, which it marks for
the writer; a grace period ends when every reader has passed one. Why it matters here: it is the
moment a reader reports to RCU's writer, and the grace period is only as sound as where it is
placed. [ch20](#rcu)

**Read-modify-write.** An operation that reads a value, computes from it and writes the result.
Plain, it is three operations however many instructions it takes; atomic, it is one indivisible
step. Why it matters here: it is what x++ is, and the window inside it is where every lost update
happens. [ch01](#what-x-plus-plus-does)

**Relaxed.** The ordering that promises atomicity, the compiler's honesty (every access in the source is an access in the code) and one order per variable, and nothing about any other variable. Why it matters here: it is the cheapest atomic and
the one most often chosen by mistake, because it promises nothing about other variables.
[ch09](#relaxed-atomics)

**Release.** An ordering on a store: nothing this thread did before the store may be seen after it.
Why it matters here: it is the writer's half of every handover, pairing with an acquire to carry
the data with the flag. [ch08](#acquire-and-release)

**Ring buffer.** A fixed array of slots used as a queue, with a head and a tail that wrap around.
Why it matters here: it is the queue Part V builds, and the structure in which a claim and a write
come apart. [ch19](#lock-free-queue)

**Scalability.** How the rate of work changes as workers are added; a shared word's rate falls, a
word per worker's holds. Why it matters here: it is the shape the contention chapter draws, and the
reason to share nothing on the hot path. [ch21](#contention-and-scalability)

**Sequential consistency.** One order of every sequentially consistent operation, in each thread's program order, every such load seeing the last such store before it. The strongest ordering, and C's default when an atomic
operation names no ordering. Why it matters here: it is the ordering that makes the store-buffer
outcome impossible, and the one WebAssembly's atomics always use. [ch10](#sequential-consistency)

**Shared memory.** Memory more than one thread can read and write. In the laboratory, one
WebAssembly memory every worker's instance imports. Why it matters here: it is the whole subject of
the book: the thing threads have by default and processes only by arrangement. [ch02](#two-threads-one-variable)

**Spinlock.** A lock whose waiters loop, on a load or an exchange, until the word reads free and an
exchange takes it. Why it matters here: it is the first lock in the book, built from one exchange,
and the thing the mutex improves on. [ch05](#test-and-set-and-spinlocks)

**Store buffer.** The queue beside a core's cache where a store waits for its line, invisible to
other cores and visible to this one. Why it matters here: it is the piece of the microarchitecture
behind x86-64's one reordering, and the reason ch10's outcome is possible.
[ch14](#store-buffers-and-visibility)

**Teaching machine.** The deterministic model as the page draws it: a few registers, a program counter and a store buffer per thread, a shared memory, a program written by hand to mirror a kernel, and, from [ch12](#cache-coherence), the cache line each word sits on with the copy each thread holds, stepped one operation at a time. An executable model of selected instruction and microarchitectural behaviour, not an implementation of any real instruction set or processor. Why it matters here: it is the microscope the book controls completely, where a race is constructed rather than waited for. [ch01](#what-x-plus-plus-does)

**Test-and-set.** An atomic exchange that writes a one and returns what was there. Why it matters
here: It is the atomic that takes a lock and reports whether it was free, in one step.
[ch05](#test-and-set-and-spinlocks)

**Total store order.** x86-64's memory model: stores in order, loads in order, and a load may pass
an earlier store to a different address. Why it matters here: it is why x86-64 hides most ordering
bugs, and why a program correct there can be wrong on a phone. [ch15](#x86-is-not-the-model)

**Volatile.** A promise that every access in the source is an access in the code, in order with
other volatile accesses, and nothing about other threads. Why it matters here: it is the keyword
readers reach for first, and the one that fixes ch07's loop and nothing after it.
[ch07](#the-compiler-is-part-of-the-story)

**Weak ordering.** AArch64's and RISC-V's memory model: any two accesses to different addresses may be reordered unless an instruction, or a dependency on an earlier load, orders them. Why it matters here: it is why the publication test
fails on Arm devices, and why Part III's orderings are not optional. [ch15](#x86-is-not-the-model)

**Worker.** A thread in the laboratory: a Web Worker running the kernel on the shared memory. Why
it matters here: It is the thread the laboratory runs a kernel on, which is why the counts come
from real threads. [ch02](#two-threads-one-variable)