---
title: "Final challenge: diagnose the race"
---

(diagnose-the-race)=
# Final challenge: diagnose the race

## The question

Given a program that is wrong once in a thousand runs, can you say why?

Every chapter has handed you the mechanism and then the experiment. This one hands you the
experiment and keeps the mechanism back. The program is a booking office: a count of seats, and
workers that book until the office refuses. It is short, it reads correctly, and it sells seats
it does not have. Before reading past *Run it*, run it, read the kernel, and write down what is
wrong and which chapter's fix applies. The rest of the chapter is the answer, in the book's
usual order, and a second version of the office that looks fixed and is not.

## The smallest program

The office as written. If a seat is left, confirm the booking, which takes a moment, and take
the seat:

```{literalinclude} ../experiments/challenge/challenge.c
:language: c
:start-at: /* The seats on sale
:end-before: /* Every access atomic
```

Every worker books until refused, and the page compares the bookings with the seats on sale:

```{literalinclude} ../experiments/challenge/challenge.c
:language: c
:start-at: /* Every worker books until the office refuses
:end-before: CM_EXPORT("cm_reset")
```

## Run it

```lab
experiment: challenge
workers: 4
version: as written
```

Try these, in order, and stop after each to think:

1. **Run it.** *Oversold* is almost never zero on a device with more than one core; the trace in step 4
   is where it is certain. The office sold seats that did not exist: *Booked* is above *Seats on
   sale*, and *Seats left* reads zero, because each worker stored one less than the count it had
   read. One worker alone: exact.
   Which chapter is this?
2. **Set the busy steps to zero.** Oversold still, less often. The window is narrower; it is not
   gone. Which two operations is the window between?
3. **Switch the office to *with atomics*.** Every access is now atomic: an atomic check, an
   atomic decrement. Oversold still. Which chapter said this would happen?
4. **Open the deterministic trace** with the office as written: two workers and the last seat.
   Under *alternate*, both check, both find a seat, both confirm, both take it. Now say the fix,
   and only then read on.

## What the source hides

The bug is check-then-act: a decision made from a value read earlier and acted on after other
workers may have changed it. `seats > 0` is the check; `seats--` is the act; the confirmation
between them is the window, and the window would exist with no confirmation at all, because the
check and the act are two accesses. Two workers both read one seat left, both pass the check,
both decrement. That is [ch02](#two-threads-one-variable)'s lost update with a decision in the
middle, and the trace shows it:

```{include} _generated/challenge-trace-written.md
```

The atomic version is [ch03](#atomic-operations)'s split increment: each access indivisible, the
pair not. The check reads one seat; the decrement subtracts one, atomically, from whatever the
count holds by then, which may be zero. Atomicity belongs to an operation, and the decision
needs two.

The compare-and-swap version:

```{literalinclude} ../experiments/challenge/challenge.c
:language: c
:start-at: /* By compare-and-swap
:end-before: /* Under a lock
```

The fix is to make the decision part of the act: take the seat only if the count is still what the check saw, which is [ch04](#compare-and-swap)'s loop. A failed compare-and-swap means the count
changed in the window or, with the weak form the kernel uses, that the attempt must be made again;
the loop reads the new count and decides again, and when the count reads zero it refuses. Or, with
a lock, make the check and the act one critical section, as in [ch05](#test-and-set-and-spinlocks),
at the cost of every worker waiting through every confirmation. The compare-and-swap version
confirms outside the atomic step and pays only on a contest:

```{include} _generated/challenge-trace-cas.md
```

## At the machine

The office as written and with atomics, side by side:

::::{tab-set}
:::{tab-item} x86-64
:sync: x86-64
```{include} _generated/challenge-check-x86-64.md
```
:::
:::{tab-item} AArch64
:sync: aarch64
```{include} _generated/challenge-check-aarch64.md
```
:::
:::{tab-item} RISC-V
:sync: riscv64
```{include} _generated/challenge-check-riscv64.md
```
:::
:::{tab-item} WebAssembly
:sync: wasm
```{include} _generated/challenge-check-wasm.md
```
:::
::::

The two have the same shape: a load and a compare, the busy loop, and a decrement, which in the
atomic version is a `lock dec`, an exclusive pair, or an `amoadd` of minus one, and in the written
version a plain load, subtract and store. The window is the busy loop in both, and no instruction
in either closes it. Compare with the compare-and-swap version, whose decrement is conditional on
the count being what the check saw:

::::{tab-set}
:::{tab-item} x86-64
:sync: x86-64
```{include} _generated/challenge-cas-x86-64.md
```
:::
:::{tab-item} AArch64
:sync: aarch64
```{include} _generated/challenge-cas-aarch64.md
```
:::
:::{tab-item} RISC-V
:sync: riscv64
```{include} _generated/challenge-cas-riscv64.md
```
:::
:::{tab-item} WebAssembly
:sync: wasm
```{include} _generated/challenge-cas-wasm.md
```
:::
::::

## Fix one thing

The fix is the compare-and-swap, and this panel is locked to it. Run it with as many workers as
you like, and with the longest confirmation: nothing oversold, every seat sold once.

```lab
experiment: challenge
workers: 4
version: compare-and-swap
lock: version
```

The lock would also fix it, and the panel offers it. Compare the times: the lock serialises every
confirmation, so the office sells at the speed of one clerk; the compare-and-swap lets every worker
confirm at once and pays, with a fresh confirmation, whenever another worker took a seat during its
own.

## Break it again

Here it is, the version most code reviews pass:

```{literalinclude} ../experiments/challenge/challenge.c
:language: c
:start-at: /* Every access atomic
:end-before: /* By compare-and-swap
```

The atomic version is the broken one that looks fixed, and it is the version most code reviews pass. Every access is atomic, there is no data race in the language's sense, a thread sanitiser
reports nothing, and the office oversells. The book's model says why in one sentence: atomicity
is a property of one operation, and a decision spans two. Then the second break, which the
kernel does not include and the model predicts: fix the count with compare-and-swap and record
each booking in a plain array indexed by a plain counter, and the array has the lost updates
instead. A program is correct when every shared decision is one atomic step or inside a lock,
and the office has two shared things, not one.

## The mental model

:::{div}
:class: model

**Check-then-act is a window.** A decision from an earlier read, acted on later, is wrong whenever
the value changed in between; atomic accesses on either side do not close it.

**The decision must be in the act.** Compare-and-swap, which acts only if the value is still the
one decided on; or a lock, which keeps everyone else out between the check and the act.

**The whole book, in order.** Find the shared word; find the operations on it; find the window
between them; close it with the smallest mechanism that closes it; then ask whether the
mechanism's ordering carries the data the decision needs.
:::

## What this cannot tell you

**How often it fails in production.** The kernel's confirmation makes the window wide so that the
page shows it; a real office with a narrow window fails rarely, which is worse.

**Whether your fix is complete.** The compare-and-swap closes the window on the count. A program
with more shared state has more windows, and each needs its own look.

**What a sanitiser would say.** The atomic version has no data race by the language's definition
and oversells anyway. Tools find races; they do not find wrong decisions.

## Where to go next

- **The pattern's name.** Time-of-check to time-of-use, TOCTOU, in the security literature, where
  the same shape is a vulnerability.
- **The reviewers' checklist.** Brian Goetz and others, *Java Concurrency in Practice*, on
  check-then-act and read-modify-write as the two shapes of a compound action.
- **The whole book again.** [ch01](#what-x-plus-plus-does) to [ch24](#from-wasm-to-machine-code),
  which this program needed, in order: the operations, the race, the atomic, the compare-and-swap,
  the lock, the compiler, the orderings, the hardware, the structures, and the boundary.
- **Your own program.** Find its shared words.
