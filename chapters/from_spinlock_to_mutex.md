---
title: From spinlock to mutex
---

(from-spinlock-to-mutex)=
# From spinlock to mutex

## The question

Why is a production mutex more than an atomic variable and a loop?

[ch05](#test-and-set-and-spinlocks) left a cost on the table: a waiting thread that spins
occupies a core, and when there are more threads than cores it may be occupying the very core
the holder needs. The fix is for the waiter to stop running until the lock is free. A thread
cannot stop itself from running; only the operating system, or in a browser the engine, can take
a core away and give it back. So a sleeping lock needs something a spinlock does not: a way to
say "put me to sleep until this word changes" and a way to say "wake whoever is asleep on this
word". That pair, and the bookkeeping that keeps it from losing a wake-up, is what separates a
mutex from an atomic variable with a loop around it.

## The smallest program

The laboratory's kernels can sleep. `cm_wait` puts the calling worker to sleep if a word still
holds a given value, until a notify on that word, and `cm_notify_one` wakes one worker asleep on
it; in WebAssembly these are two instructions, which [ch22](#webassembly-threads) is about, and
natively, on Linux, they are the futex system call; on a desk without futexes the harness spins
instead. The lock word now has three states, because a release must know whether anybody is asleep:

```{literalinclude} ../experiments/mutex/mutex.c
:language: c
:start-at: /* The lock word.
:end-before: /* The counter the lock protects
```

Taking the lock:

```{literalinclude} ../experiments/mutex/mutex.c
:language: c
:start-at: /* The sleeping lock.
:end-before: /* Release. Count the word down
```

The fast path is the compare-and-swap from ch04: zero to one, done. The slow path marks the word
two, "somebody is waiting", and sleeps while it stays two. A woken worker does not know whether
other sleepers remain, so it marks the word two again when it takes the lock, which is cheap and
safe. Releasing:

```{literalinclude} ../experiments/mutex/mutex.c
:language: c
:start-at: /* Release. Count the word down
:end-before: /* Spin a bounded number
```

If the word was one, nobody was waiting and the release is one atomic subtraction. If it was two,
the release stores zero and wakes one sleeper. The wake costs a call into the engine or the
operating system, and the three-state word is there to avoid paying it when there is nobody to
wake.

## Run it

Eight workers, more than most devices have cores, and a critical section long enough to matter.

```lab
experiment: mutex
workers: 8
operation: spin
```

Try these, in order:

1. **Run it as it is, then switch the lock to *sleep*.** Both are exact. Compare the tiles:
   the spinlock spins and never sleeps; the sleeping lock sleeps and never spins, and your device says how many of each. Compare *Elapsed* on your device. On some the sleeping lock is faster, because
   the holder had its core to itself; on some the spinlock is, because the critical section was
   shorter than the cost of a sleep and a wake. Both are right. The chapter is the trade-off,
   not the winner.
2. **Lengthen the critical section.** With ten thousand busy steps inside the lock, sleeping
   usually wins and by more with every worker you add past the core count: a spinner's core is
   wasted for the whole critical section, a sleeper's is free.
3. **Shorten it to ten steps.** Now the lock is likely held for less time than a wake-up takes, and spinning usually wins: the sleeper is woken after the lock has already been taken and released
   several times by workers that never slept.
4. **Switch to *spin-then-sleep*.** A hundred tries, then sleep. Spins and sleeps both appear,
   and *Elapsed* is near the better of the two. This is what production mutexes do.
5. **Open the deterministic trace.** Thread A takes the lock on the fast path; thread B fails,
   marks the word two, and sleeps. B takes no steps at all until A's release stores zero and
   notifies it. Switch the trace's operation to *spin* and watch B take a step for every one of
   A's, doing nothing.

## What the source hides

Sleeping is not a loop. A sleeping worker is not running, and the trace draws it that way:

```{include} _generated/mutex-trace-sleep.md
```

The step the whole design turns on is the one before thread B sleeps. B sets the word to two and
then calls wait with the expectation that the word is still two. If A released between those two
steps, the word is zero, the wait returns at once without sleeping, and B tries again. The wait
instruction compares the word with the expected value and sleeps only if they match, atomically
with respect to a notify. Without that check, a release could land between B's decision to sleep
and B's falling asleep, the wake would find nobody to wake, and B would sleep forever on a lock
that is free. That is the **lost wake-up**, and every sleeping lock is designed around it.

The three states hide a second idea. A release that stores zero and always notifies would be
correct, and would pay for a wake on every release, including the common case where nobody is
waiting. Counting down from one costs an atomic operation the holder was going to pay anyway;
only a word that was two pays the notify.

## At the machine

The lock and the unlock, in WebAssembly, where the wait and the notify are instructions:

::::{tab-set}
:::{tab-item} WebAssembly
:sync: wasm
```{include} _generated/mutex-lock-wasm.md
```
```{include} _generated/mutex-unlock-wasm.md
```
:::
:::{tab-item} x86-64
:sync: x86-64
```{include} _generated/mutex-spin-x86-64.md
```
:::
:::{tab-item} AArch64
:sync: aarch64
```{include} _generated/mutex-spin-aarch64.md
```
:::
:::{tab-item} RISC-V
:sync: riscv64
```{include} _generated/mutex-spin-riscv64.md
```
:::
::::

In `mutex_lock`, find `memory.atomic.wait32`: it takes the address, the expected value and a
timeout of minus one, meaning forever, and returns a code the kernel drops. The engine suspends
the worker until a `memory.atomic.notify` on the same address, which `mutex_unlock` issues with a
count of one. The native tabs show the spinlock for comparison, because on a native target the
wait and the wake are not instructions at all. They are calls into the operating system, the
futex system call on Linux, and a fragment of a system call is a fragment of nothing; the
harness makes those calls, and [Appendix A](#reproducing-at-a-desk) runs it.

That is the honest boundary. A spinlock is entirely an instruction sequence, which is why it can
be shown on four targets. A mutex is an instruction sequence plus a scheduler, and the scheduler
is the operating system's or the engine's, not the processor's.

## Fix one thing

The fix for the burned core is to sleep, and this panel is locked to the sleeping lock:

```lab
experiment: mutex
workers: 8
operation: sleep
lock: operation
```

The fix for the wake-up's cost on a short critical section is to spin first, which you ran above as
*spin-then-sleep*. Production mutexes add more: some spin only while the holder is running on
another core, some back off, and some queue waiters so the longest wait is served first. Each
addition pays for a case this kernel does not measure.

## Break it again

Remove the check that the word is still two before sleeping, and the lost wake-up is back. The
kernel keeps the check, because the wait instruction does it for free, and a run that loses a
wake-up would not end. In the trace you can see the window where it would happen: between
thread B's exchange that marks the word two and B's wait. Set the schedule to *manual* and step
A through its release in that window. B's wait then finds the word zero and does not sleep. A
wait that did not compare would have slept with nobody left to wake it.

## The mental model

:::{div}
:class: model

**A mutex is a spinlock whose waiters can stop running.** Taking it is ch04's compare-and-swap.
Waiting is a request to the scheduler: if this word still holds this value, sleep until someone notifies on it.

**Sleeping needs the compare.** Wait sleeps only if the word still holds what the waiter expects,
atomically against the wake; otherwise a release can land in the gap and the wake-up is lost.

**Three states avoid paying for a wake nobody needs.** Zero free, one held, two held with waiters.
A release from one costs nothing extra; a release from two wakes one sleeper.

**Spin a little, then sleep.** A short critical section is cheaper to wait out than to sleep
through; a long one is not.
:::

## What this cannot tell you

**Which lock is faster for your program.** The live times are one observation each on a device
whose scheduler the page cannot see. They show the trade-off's two sides; they cannot rank them
for a critical section you have not measured.

**What the engine does on a wait.** A WebAssembly wait suspends the worker in the browser's
engine, which may itself spin, sleep or do both. The native futex does its own version. The
kernel's promise is only that a sleeping worker takes no steps.

**Fairness.** Which sleeper a notify wakes is the engine's or the operating system's choice.
Nothing here orders them.

## Where to go next

- **The design this kernel follows.** Ulrich Drepper, *Futexes Are Tricky*, 2011, which derives
  the three-state lock and the lost wake-up it avoids.
- **The system call.** The Linux `futex(2)` manual page, and Hubertus Franke, Rusty Russell and
  Matthew Kirkwood, *Fuss, Futexes and Furwocks*, Ottawa Linux Symposium 2002.
- **The WebAssembly instructions.** The WebAssembly threads proposal, `memory.atomic.wait32` and
  `memory.atomic.notify`, and [ch22](#webassembly-threads).
- **Next.** [ch07](#the-compiler-is-part-of-the-story) turns to the compiler, which can make a
  waiting loop wait forever.
