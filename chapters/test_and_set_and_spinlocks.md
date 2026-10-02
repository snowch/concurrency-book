---
title: Test-and-set and spinlocks
---

(test-and-set-and-spinlocks)=
# Test-and-set and spinlocks

## The question

What does a thread do while it waits for a lock, and what does that cost the others?

[ch04](#compare-and-swap) built a lock from compare-and-swap and ran it, and the only thing it
said about the threads that failed to take it was that they "keep asking". This chapter is about
the asking. A thread that waits by asking again is spinning: it runs a loop that does no work
until the lock is free. Spinning is the simplest way to wait and often the right one, and it has
costs that are invisible in the source: the spinning thread burns a core, its asking slows the
holder, and nothing decides which waiter gets the lock next. The kernel here counts the spins
and shows who waited most.

## The smallest program

The simplest spinlock does not even need compare-and-swap. Test-and-set is an atomic exchange:
write a one into the word and get back what was there. A zero back means the lock was free and
is now ours; a one back means somebody holds it, and the exchange changed nothing, since the word
was already one.

```{literalinclude} ../experiments/spinlock/spinlock.c
:language: c
:start-at: /* Test-and-set.
:end-before: /* Test, then test-and-set.
```

The release is a store of zero, as ch04's was, and the critical section is an increment of a
plain counter plus some busy work whose length you set, so a critical section can be made long
enough for the waiting to matter:

```{literalinclude} ../experiments/spinlock/spinlock.c
:language: c
:start-at: /* Release: a plain store
:end-before: /* a: critical sections per worker
```

## Run it

Four workers, each entering the lock ten thousand times.

```lab
experiment: spinlock
workers: 4
operation: tas
```

Try these, in order:

1. **Run it.** *Observed* equals *Expected*: the lock works. *Spins* is the number of times a
   worker asked and was refused, added up, and the bars below the tiles show each worker's share.
   They are rarely equal. Nothing in a spinlock is fair: whoever's exchange lands first after a
   release wins, and the same worker can win many times in a row.
2. **Lengthen the critical section.** Set the busy steps to a thousand. *Elapsed* grows, and so
   do the spins: every microsecond the holder spends inside the lock is a microsecond every other
   worker spends asking.
3. **Add workers past your core count.** The foot of the panel says how many cores this device
   reports. With more workers than cores, a spinning worker may be occupying the core the holder
   needs to finish its critical section, and *Elapsed* can jump by far more than the extra work
   explains. That is the cost spinning cannot see, and it is why [ch06](#from-spinlock-to-mutex)
   exists.
4. **Switch the acquire to *ttas*.** Test, then test-and-set: the waiter spins on a plain load and
   attempts the exchange only when the load says the lock is free. The spin count rises, because
   a load is cheap and the loop goes round faster, and on a device with several cores *Elapsed*
   often falls. *At the machine* says why.
5. **Open the deterministic trace.** Under *alternate*, thread A's exchange gets a zero and thread
   B's gets a one. B goes round again while A runs the critical section: every one of B's steps
   until A's release is a spin, a step that changes nothing. Then B's exchange gets a zero.

## What the source hides

The exchange is an atomic read-modify-write like ch03's add: read the word, write a one, return
what was read, indivisibly. What the loop hides is that a failed attempt is not free. An exchange
is a write, and on a core with the usual coherent caches a write takes the cache line into the
writing core's cache in exclusive state, away from the holder. That is the microarchitecture, which
no instruction set promises and [ch12](#cache-coherence) measures. A spinning waiter that exchanges
in a tight loop is pulling the lock's line across the machine on every iteration, and the holder
has to pull it back to release. Many waiters make this worse than linearly.

Test-then-test-and-set changes what the waiter does while it waits. Reading does not take the
line away: every waiter can hold a shared copy and spin on it without disturbing the holder. Only
when the holder's release changes the word do the copies become stale, and only then do the
waiters try the exchange. The spin count goes up and the traffic goes down.
[ch12](#cache-coherence) measures the traffic itself.

The trace of the test-and-set lock, one critical section each:

```{include} _generated/spinlock-trace-tas.md
```

## At the machine

The acquire:

::::{tab-set}
:::{tab-item} x86-64
:sync: x86-64
```{include} _generated/spinlock-acquire-x86-64.md
```
:::
:::{tab-item} AArch64
:sync: aarch64
```{include} _generated/spinlock-acquire-aarch64.md
```
:::
:::{tab-item} AArch64 (LSE)
:sync: aarch64-lse
```{include} _generated/spinlock-acquire-aarch64-lse.md
```
:::
:::{tab-item} RISC-V
:sync: riscv64
```{include} _generated/spinlock-acquire-riscv64.md
```
:::
:::{tab-item} WebAssembly
:sync: wasm
```{include} _generated/spinlock-acquire-wasm.md
```
:::
::::

**x86-64**'s `xchg` with a memory operand is atomic without a `lock` prefix: the prefix is
implied, which is a historical accident of the instruction set and a frequent surprise. The loop
exchanges, compares what came out with one, and goes round. **AArch64** without LSE builds the
exchange from `ldaxr` and `stxr`, the exclusive pair, with the `a` in `ldaxr` making the load an
acquire; with **LSE** it is `swpa`, a single swap-with-acquire. **RISC-V** has `amoswap.w.aq`,
an atomic swap with the acquire bit set. **WebAssembly** has `i32.atomic.rmw.xchg`.

And the test-then-test-and-set, where the waiting load is visible as a plain load in a loop before
the exchange:

::::{tab-set}
:::{tab-item} x86-64
:sync: x86-64
```{include} _generated/spinlock-ttas-x86-64.md
```
:::
:::{tab-item} AArch64
:sync: aarch64
```{include} _generated/spinlock-ttas-aarch64.md
```
:::
:::{tab-item} RISC-V
:sync: riscv64
```{include} _generated/spinlock-ttas-riscv64.md
```
:::
:::{tab-item} WebAssembly
:sync: wasm
```{include} _generated/spinlock-ttas-wasm.md
```
:::
::::

For the relaxed atomic load the waiter spins on, the compiler emitted a plain `mov` on x86-64 and a
plain `ldr` on AArch64: an aligned word is read whole by those instructions already, so the
language's promise costs nothing extra. On a core with coherent caches, reading a word it already
holds costs nothing outside the core, which is the whole point. The exchange is attempted only
after the load reads zero.

One thing neither fragment shows: a real spinlock usually tells the processor it is spinning.
x86-64 has a `pause` instruction and AArch64 a `yield` hint for exactly this loop, which pause it
for a length the core chooses and save power and pipeline capacity; production spinlocks also back
off, waiting longer after each failure. The kernel leaves both out so the loop stays the book's
shape.

## Fix one thing

The fix for the traffic was the test before the test-and-set, and you ran it above. The fix for
the fairness has no one-line answer: a ticket lock hands out numbers and serves them in order,
a queue lock has each waiter spin on a word of its own, and both cost more than this chapter's
lock. The fix for the burned core is not to spin at all, which is the next chapter.

## Break it again

Test-and-set is one operation. Split it into a test and a set, a load that waits for zero and
then a store of one, and the lock is gone:

```{literalinclude} ../experiments/spinlock/spinlock.c
:language: c
:start-at: /* Not a lock.
:end-before: /* Release: a plain store
```

This panel is locked to it. Run it and *Observed* falls short: two workers saw the lock free at
the same moment, both stored a one, and both ran the critical section at once, losing increments
in exactly ch02's way.

```lab
experiment: spinlock
workers: 4
operation: broken
lock: operation
```

The trace makes it deterministic:

```{include} _generated/spinlock-trace-broken.md
```

Both threads test, both find zero, both set. The instructions on x86-64 are a `mov` to read and a
`mov` to write, with a window between them like every window in Part I:

```{include} _generated/spinlock-broken-x86-64.md
```

This is ch03's split increment again, in a lock's clothing: each operation atomic, the pair not.
Every lock needs its test and its set to be one operation, which is what test-and-set and
compare-and-swap are for.

## The mental model

:::{div}
:class: model

**A spinlock is an atomic exchange in a loop.** Zero out means ours; one out means ask again.
Release is a store of zero.

**Waiting by spinning costs three things the source does not show.** The waiter's core, which does
no work; the holder's speed, if the waiters' exchanges keep pulling the lock's cache line away;
and fairness, which nothing in the loop provides.

**Spin on a read, then exchange.** A waiter that reads until the lock looks free costs the holder almost nothing while it holds the lock, and tries the exchange only when it has a chance.
:::

## What this cannot tell you

**What spinning costs when the holder is not running.** The live run shows the jump when workers
outnumber cores, as one observation. The reason is the operating system's scheduler, which the
browser hides from the page; ch06 is about the lock that hands the problem to the scheduler on
purpose.

**How a production spinlock behaves.** It pauses, backs off, and often hands over to a sleeping
lock after a bounded spin. The shape is this chapter's; the tuning is not.

**What the acquire ordering is doing.** The `acquire` on the exchange and the `release` on the
store are what keep the critical section inside the lock. Part III.

## Where to go next

- **The classic measurement.** Thomas Anderson, *The Performance of Spin Lock Alternatives for
  Shared-Memory Multiprocessors*, IEEE TPDS 1990, which measured test-and-set against
  test-then-test-and-set and backoff and found what this chapter's panel finds.
- **Fair locks.** John Mellor-Crummey and Michael Scott, *Algorithms for Scalable Synchronization
  on Shared-Memory Multiprocessors*, ACM TOCS 1991: the queue lock named after them.
- **The hints.** Intel's `PAUSE` and Arm's `YIELD`, in their respective instruction set manuals.
- **Next.** [ch06](#from-spinlock-to-mutex) stops spinning.
