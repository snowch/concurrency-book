---
title: Compare-and-swap
---

(compare-and-swap)=
# Compare-and-swap

## The question

How can one instruction let a thread change a value only if nobody else has?

[ch03](#atomic-operations) ended on a bug that an atomic variable cannot fix: a value read, a
decision made from it, and a value written back, with another thread's write landing between.
An atomic add solves the case where the decision is "add one". It cannot solve "set the lock if
it is free", "pop the head if it is still the head" or "replace the record if nobody replaced it
first", because those decisions depend on what was read. What is needed is one atomic operation
that carries the decision inside it: store the new value only if the word still holds the value
I read. Every architecture has one, and the rest of this book is built on it.

## The smallest program

Compare-and-swap takes three things: the word, the value you expect it to hold, and the value
you want it to hold. It compares, and swaps only on a match. In C the operation is
`atomic_compare_exchange_weak_explicit`, and it reports whether it swapped; when it did not, it
writes what the word held instead into `seen`, so the next attempt starts from the truth. The
counter from ch03, incremented by it:

```{literalinclude} ../experiments/cas/cas.c
:language: c
:start-at: /* One increment by compare-and-swap
:end-before: /* Take the lock
```

Read the loop as a conversation with the memory. "I saw zero; make it one." Either "done" or
"it is three now". "I saw three; make it four." Every retry is a contest this thread lost: another
thread's compare-and-swap landed between this thread's load and its attempt. The function counts
the retries, because the count is the chapter's second result.

The same instruction, used on a different word with a different intent, is a lock. The lock is
one word, zero when free. To take it: "I saw zero; make it one." If that fails, somebody holds
it, and the thread asks again until the answer is yes. To release it, store zero; no compare is
needed, because only the holder may release.

```{literalinclude} ../experiments/cas/cas.c
:language: c
:start-at: /* Take the lock
:end-before: /* a: increments per worker
```

The orderings on the lock, `acquire` and `release`, are [Part III](#part-memory-ordering)'s.
Until then, read them as the promise that the critical section stays inside the lock: nothing the
holder does leaks out before the acquire or after the release.

## Run it

Four workers, each incrementing the counter by compare-and-swap.

```lab
experiment: cas
workers: 4
operation: cas
```

Try these, in order:

1. **Run it.** *Observed* equals *Expected*: every increment landed, as in ch03's atomic run. Now
   look at *Retries*. Thousands of compare-and-swaps failed and went round again, and the count
   changes every run. Nothing was lost, because a failure is not a loss: it is a decision to
   look again.
2. **Add workers.** More workers, more lost contests: *Retries* grows faster than the work does.
   *Most by one worker* shows how unevenly the contests fall. Some workers lose far more than
   their share, which is the first hint of the fairness question [ch05](#test-and-set-and-spinlocks)
   measures.
3. **One worker.** No retries at all: a compare-and-swap with nobody to contest it always
   succeeds on the first try, and costs about what an atomic add costs.
4. **Open the deterministic trace.** Under *alternate*, two threads load the same value, both
   compute from it, the first compare-and-swap succeeds, the second fails and the trace shows the
   loser going back to the load, seeing the new value and succeeding on the next attempt. Nothing
   lost, and one retry.
5. **Switch the operation to *lock*.** Each worker now takes the lock, increments a plain
   counter, releases. Exact again, and slower: every increment is now at least two atomic
   operations and a round trip through a word every worker wants.

## What the source hides

The compare-and-swap is one operation with four parts inside: load the word, compare it with the
expected value, store the new value if they matched, and report which happened. The whole thing
is indivisible with respect to other cores, exactly as ch03's atomic add was, and for the same
reasons. What the loop around it hides is that a retry restarts from the load. The trace shows
one contest:

```{include} _generated/cas-trace-alternate.md
```

Step six is the whole idea. Thread B's compare-and-swap expected zero, found one, and declined to
store. B did not lose an update; it lost a race and knew it. The knowledge is the difference
between this loop and [ch02](#two-threads-one-variable)'s plain increment, which stored over the
other thread's work without ever finding out.

The lock hides the same shape. "Change the lock from zero to one" fails for every thread but one,
and the ones that fail keep asking. That is the whole of a spinlock, and what the asking costs
is the next chapter's subject.

## At the machine

::::{tab-set}
:::{tab-item} x86-64
:sync: x86-64
```{include} _generated/cas-increment-x86-64.md
```
:::
:::{tab-item} AArch64
:sync: aarch64
```{include} _generated/cas-increment-aarch64.md
```
:::
:::{tab-item} AArch64 (LSE)
:sync: aarch64-lse
```{include} _generated/cas-increment-aarch64-lse.md
```
:::
:::{tab-item} RISC-V
:sync: riscv64
```{include} _generated/cas-increment-riscv64.md
```
:::
:::{tab-item} WebAssembly
:sync: wasm
```{include} _generated/cas-increment-wasm.md
```
:::
::::

**x86-64** has `cmpxchg`, with the `lock` prefix from ch03. The expected value goes in `eax` by
convention; the instruction compares it with the word, stores the new value from the other
register on a match, and on a mismatch loads the word's current value into `eax`, which is why
the C's `seen` is up to date after a failure without another load. The compiler emitted the
first attempt and the retry loop as two copies of the same instruction, one for the common case
of no contest.

**AArch64** has no single compare-and-swap in its base instruction set, so the compiler builds
one from the exclusive pair you met in ch03: `ldxr` loads and watches the word, `cmp` and `b.ne`
leave if it is not what was expected, `stxr` stores only if nothing touched the word since the
load. `clrex` on the failure path drops the watch. The loop labelled `.LBB1_6` is the retry. With
**LSE** the whole thing is one instruction, `cas`, which compares and swaps in memory as x86-64's
does; the fragment is in the LSE tab.

**RISC-V** builds it from `lr.w` and `sc.w`, load-reserved and store-conditional: the same idea
as AArch64's exclusives, with `bne` leaving on a mismatch and `bnez` retrying when the store
conditional failed.

**WebAssembly** has `i32.atomic.rmw.cmpxchg`: compare and exchange, one instruction, which
returns the value the word held. The browser's engine lowers it to whichever of the above the
host has.

Two kinds of failure appear in these fragments, and the C hides the distinction. A
compare-and-swap can fail because the value differed, which is the contest the loop expects. On
AArch64 and RISC-V it can also fail because the store-conditional lost its reservation for a
reason that has nothing to do with the value, an interrupt or another core touching the same
cache line. That is why the C says `weak`: a weak compare-and-swap may fail spuriously, and the
loop around it must tolerate that, which it does, because it retries on any failure. The
`strong` form hides a loop inside itself.

## Fix one thing

The loop fixed ch03's split increment: the decision now travels with the store. The lock is the
same fix applied to a whole critical section, and this panel is locked to it:

```lab
experiment: cas
workers: 4
operation: lock
lock: operation
```

The acquire and release, at the machine:

::::{tab-set}
:::{tab-item} x86-64
:sync: x86-64
```{include} _generated/cas-acquire-x86-64.md
```
```{include} _generated/cas-release-x86-64.md
```
:::
:::{tab-item} AArch64
:sync: aarch64
```{include} _generated/cas-acquire-aarch64.md
```
```{include} _generated/cas-release-aarch64.md
```
:::
:::{tab-item} RISC-V
:sync: riscv64
```{include} _generated/cas-acquire-riscv64.md
```
```{include} _generated/cas-release-riscv64.md
```
:::
:::{tab-item} WebAssembly
:sync: wasm
```{include} _generated/cas-acquire-wasm.md
```
```{include} _generated/cas-release-wasm.md
```
:::
::::

The acquire is the compare-and-swap of zero to one in a loop, and the release is a store of zero.
Notice the release on each target. On x86-64 it is a plain `mov`. On AArch64 it is `stlr`, a
store with release semantics, and on RISC-V a `fence` before the store; on WebAssembly an atomic
store. The C asked for `memory_order_release` on every target and each paid for it in its own
way, including by paying nothing. What that ordering buys is [ch08](#acquire-and-release).

## Break it again

The compare-and-swap decides on the value, and only on the value. If the value is the same, the
compare passes, even when the world has changed and changed back. For a counter that cannot
matter: a counter that reads five means five increments happened, whatever else did. For a word
that holds a pointer it is a different story. The pointer can be freed and the same address
reused for a different object, and the compare-and-swap will say "nothing changed" and swap in a
stale successor. The trace cannot show this yet, because the counter has no identity to lose.
[ch17](#the-aba-problem) builds the structure that does, and breaks it.

## The mental model

:::{div}
:class: model

**Compare-and-swap is "change it only if it is still what I saw".** One indivisible operation
that loads, compares, conditionally stores and reports. A failure is information, not a loss:
the thread learns the current value and decides again.

**A retry loop turns any read-decide-write into an atomic step.** Read, compute the new value,
compare-and-swap; on failure, read again. Every lock, lock-free stack and queue in this book is
that loop with a different decision inside.

**It compares values, not histories.** Same value, same outcome, whatever happened in between.
:::

## What this cannot tell you

**How often a retry happens on your hardware.** *Retries* is one observation under the browser's
scheduling. It shows that contests are frequent and uneven; it does not give a rate.

**What the lock's orderings do.** The acquire and release are correct and necessary, and this
chapter has not said why. Part III does.

**Whether a retry was a contest or a spurious failure.** The C and the WebAssembly cannot tell
them apart, and on the browser's host the loop may be seeing either. The native fragments show
where each kind can arise.

## Where to go next

- **The language's operation.** ISO C, section 7.17.7.4, `atomic_compare_exchange`, including the
  weak form's permission to fail spuriously.
- **The instructions.** Intel 64 and IA-32 Architectures Software Developer's Manual, volume 2,
  `CMPXCHG`; Arm Architecture Reference Manual for A-profile, `LDXR`, `STXR`, `CLREX` and `CAS`;
  The RISC-V Instruction Set Manual, volume I, the "A" extension's load-reserved and
  store-conditional instructions and their forward-progress constraints.
- **The origin.** Maurice Herlihy, *Wait-Free Synchronization*, ACM TOPLAS 1991, on why
  compare-and-swap is universal: any shared object can be built from it.
- **Next.** [ch05](#test-and-set-and-spinlocks) measures what the threads that lose the contest
  for a lock are doing while they wait.
