---
title: RCU
---

(rcu)=
# RCU

## The question

How can readers never wait, if a writer must still replace what they read?

[ch18](#memory-reclamation) made readers announce the record they hold, and made every read pay
for it: a sequentially consistent store and a second load of the pointer. For a structure read a
million times for every update, that is the wrong trade. Read-copy-update makes the other one.
A reader follows a pointer and reads, with nothing extra on the path; a writer copies the
record, updates the copy, publishes it with one store, and then waits, not for any particular
reader, but for a period after which no reader can still be reading the old one: the grace
period. The cost of reclamation moves entirely to the writer, and the writer pays it with time.

## The smallest program

The read side is two loads, the pointer and the record:

```{literalinclude} ../experiments/rcu/rcu.c
:language: c
:start-at: /* The read side
:end-before: /* Between reads
```

Between reads, a reader notes the epoch it has seen. That note is the only thing it does for the
writer, and it does it outside any read:

```{literalinclude} ../experiments/rcu/rcu.c
:language: c
:start-at: /* Between reads
:end-before: /* The write side
```

The writer publishes, moves the epoch on, and waits until every reader has noted the new epoch:

```{literalinclude} ../experiments/rcu/rcu.c
:language: c
:start-at: /* The write side
:end-before: /* Worker 0 writes
```

## Run it

```lab
experiment: rcu
readers: 3
grace: reuses at once
```

Try these, in order:

1. **Run it.** With reuse at once, *Poisoned reads* is not zero, as in ch18, on a device with more than one core; the count is one observation: the writer reused a
   record a reader was reading.
2. **Switch the writer to *waits for a grace period*.** Zero poisoned reads, and *Grace-period
   waits* is large. Compare *Reads* with *Elapsed*: the readers read for as long as the writer ran, at the
   rate they had before, because their path did not change. The writer made the same number of
   updates and spent far longer making them.
3. **Add readers.** The writer's waits grow with the number of readers, since the grace period
   ends only when the last of them has passed a quiescent state. The readers' path is unchanged; their rate is not measured here.
4. **Open the deterministic trace.** The reader notes the epoch, follows the pointer, and reads.
   The writer publishes record two, moves the epoch to one, and spins until the reader's note
   says one, which it does only after the reader has finished. Only then does the writer poison
   record one.

## What the source hides

A reader that has noted epoch `e` cannot be inside a read that began before the writer moved the
epoch to `e`, because the note is written between reads. So a writer that moves the epoch after
publishing, and then waits until every reader has noted the new epoch, knows that every read
that could have seen the old pointer has finished. That is the grace period, and it is a
statement about time, not about any record: the writer never learns which record a reader held,
only that the reader has moved on.

```{include} _generated/rcu-trace-grace.md
```

Three things make it cheap for readers. The read path has no store, so a reader invalidates no line
in any other cache; the lines it reads it shares. The note is a store to a word only the writer
reads, so its line moves only when the writer looks, and when a neighbouring reader's note shares
the line, as this kernel's do. And the note needs no second load of the pointer, because the reader
is not protecting a record; it is reporting a time.

Two things make it expensive for the writer. It waits for the slowest reader, and a reader that
is asleep, or descheduled, or in a long read, holds every retirement back. And the memory
held back is every record retired during the grace period, which is unbounded if the writer does
not throttle itself. Production implementations batch retirements, let the grace period run
asynchronously, and let a callback free the records when it ends; the kernel spins to make the
wait visible.

## At the machine

The read side, which is the chapter's point:

::::{tab-set}
:::{tab-item} x86-64
:sync: x86-64
```{include} _generated/rcu-read-x86-64.md
```
:::
:::{tab-item} AArch64
:sync: aarch64
```{include} _generated/rcu-read-aarch64.md
```
:::
:::{tab-item} RISC-V
:sync: riscv64
```{include} _generated/rcu-read-riscv64.md
```
:::
:::{tab-item} WebAssembly
:sync: wasm
```{include} _generated/rcu-read-wasm.md
```
:::
::::

`rcu_read` is two loads, with an acquire on the first: `mov` and `mov` on x86-64, `ldar` and
`ldr` on AArch64, with a fence on RISC-V. Compare it with the protected reader of
[ch18](#memory-reclamation): no store, no second load, no `xchg`. `rcu_quiescent` is a load and a
store, both sequentially consistent, and on x86-64 the store is the `xchg` again; it runs once
between reads, not inside them, and a real implementation runs it far less often than that, at
a context switch or a tick.

The write side, where the wait lives:

::::{tab-set}
:::{tab-item} x86-64
:sync: x86-64
```{include} _generated/rcu-update-x86-64.md
```
:::
:::{tab-item} AArch64
:sync: aarch64
```{include} _generated/rcu-update-aarch64.md
```
:::
:::{tab-item} WebAssembly
:sync: wasm
```{include} _generated/rcu-update-wasm.md
```
:::
::::

The publish is an exchange with acquire and release, the epoch moves on with a sequentially
consistent add, and the grace period is the loop over the readers' notes.

## Fix one thing

The fix is the grace period, and this panel is locked to it:

```lab
experiment: rcu
readers: 3
grace: waits for a grace period
lock: grace
```

The read side is now the cheapest possible safe read of a shared structure: the same two loads
as an unsafe one. That is why RCU is the mechanism under a large part of an operating system
kernel's read-mostly data, where readers outnumber writers by orders of magnitude and a writer
that waits a few milliseconds costs nothing anyone notices.

## Break it again

Move the reader's note inside the read, between the pointer and the record. The writer can now see
the new epoch noted while the reader is still between the two loads, end the grace period, and
poison the record the reader is about to read. No panel here moves the note; the trace's reader
keeps it between reads. Move it in the model and the writer's wait ends while the reader is between
its two loads: the note must be outside the read, or it says nothing. The rule is the one every
quiescent-state scheme rests on: a quiescent state is a point where a thread holds no reference,
and reporting one from anywhere else is a lie the writer will act on.

## The mental model

:::{div}
:class: model

**RCU moves the cost of reclamation to the writer, and pays it in time.** Readers follow the
pointer and read, with nothing extra. The writer publishes, then waits a grace period, then
reuses.

**A grace period is about time, not records.** It ends when every reader has passed a quiescent
state since the publish, which means every read that could see the old record has finished.

**A quiescent state is a point where a reader holds nothing.** Reported from anywhere else, it
is false, and the writer frees what the reader holds.

**Removing the lock cost three things it had bundled.** Ordering, which the queue rebuilt; identity, which the ABA problem exposed; and lifetime, which reclamation and the grace period restore. Each came back as a protocol.
:::

## What this cannot tell you

**How a kernel implements it.** The Linux kernel's RCU has readers that, in its non-preemptible
form, cost nothing on the read path, with quiescent states inferred from context switches and timer
ticks, and grace periods tracked by a tree of counters across hundreds of cores. The kernel here is
the idea; the implementation is a field of its own.

**What a reader may do with a record.** Read it. A reader that modifies a record, or holds a
pointer past its read, is outside the protocol. Writers that must coordinate with each other
still need a lock, or a compare-and-swap, among themselves.

**The memory held back.** The kernel retires one record per update and waits each time. A
writer that retires faster than grace periods complete holds back unbounded memory, which real
implementations bound by throttling the writer.

## Where to go next

- **The origin.** Paul McKenney and John Slingwine, *Read-Copy Update: Using Execution History to
  Solve Concurrency Problems*, PDCS 1998.
- **The practitioner's book.** Paul McKenney, *Is Parallel Programming Hard, And, If So, What Can
  You Do About It?*, the chapter on deferred processing, which treats hazard pointers, RCU and
  their relatives together.
- **The Linux documentation.** `Documentation/RCU/` in the Linux kernel source, in particular
  `whatisRCU.rst`.
- **Next.** [Part VI](#part-performance-and-the-laboratory) measures contention and takes the
  laboratory apart.
