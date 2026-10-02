---
title: Lock-free stack
---

(lock-free-stack)=
# Lock-free stack

## The question

How can many threads push and pop one stack with no lock?

Every structure so far was one word: a counter, a flag, a lock. A stack is many words linked
together, and Part II's answer would be to put a lock around it. A lock has costs this book has
measured, spinning or sleeping, and one it has not: a thread that holds the lock and stops, for
a page fault, a signal, or the end of its time slice, stops everyone. A lock-free structure has
no such thread. Some thread always makes progress, whatever the others do, because no thread
holds anything the others need. The price is that every change to the structure must be one
compare-and-swap, and this chapter pays it for the simplest structure there is.

## The smallest program

The stack is a pool of nodes, named by index so that an index is what the head holds and what
compare-and-swap compares. A push points the new node at the current top and swings the head to
it, if the top is still the one it pointed at:

```{literalinclude} ../experiments/stack/stack.c
:language: c
:start-at: /* Push node n
:end-before: /* Pop: read the top
```

A pop reads the top and the node below it, and swings the head to the node below, if the top is
still the one it read:

```{literalinclude} ../experiments/stack/stack.c
:language: c
:start-at: /* Pop: read the top
:end-before: /* Not a pop
```

Each is [ch04](#compare-and-swap)'s loop with a different decision inside. The `release` on the
push's swing and the `acquire` on the pop's are [ch08](#acquire-and-release)'s handover: the
node's `next` is written before the head is swung, and read after it is seen.

## Run it

Four workers, each pushing four thousand nodes of its own and then popping four thousand, from
anyone. Every node remembers how often it was popped, so the page can account for all of them.

```lab
experiment: stack
workers: 4
operation: cas
```

Try these, in order:

1. **Run it.** *Popped twice* and *Lost* are zero. Every one of sixteen thousand nodes was popped
   exactly once or is still in the stack, and the two numbers add up to the pushes. Four workers
   pushed and popped at once with no lock, and nothing was lost.
2. **Add workers, and run again.** Still exact. More workers mean more failed compare-and-swaps,
   which ch04's panel counted and this one does not, and a failed swing is a retry, never a
   loss.
3. **Open the deterministic trace.** Two threads pop from a stack of three nodes. Under
   *alternate*, both read node one as the top, both read node two below it, the first
   compare-and-swap succeeds, the second fails and retries, and the two threads leave with
   different nodes.
4. **Switch the pop to *broken*.** *Break it again*, below.

## What the source hides

A pop is a read of two words and a write of one, and the two reads describe a structure that
may have changed by the time of the write. The compare-and-swap is what makes the change
conditional on the top being the one the reads described. The trace shows the retry:

```{include} _generated/stack-trace-cas.md
```

Thread B's compare-and-swap at step six fails because A has already swung the head to node two. B
reads again, finds two on top and three below, and succeeds. The structure was never inconsistent
at any step, because the only write to it is the swing, and the swing happens only if the head is
as the writer last saw it, which in this kernel means the structure is too, because no popped node
is pushed again.

That is the discipline of this stack, and the simplest a lock-free structure can have: every
mutation is one compare-and-swap on one word, whose expected value encodes everything the mutation
assumed. Here the assumption is "the top is still this node", which is enough as long as a node
that was popped is never pushed again. [ch17](#the-aba-problem) breaks exactly that assumption.

## At the machine

The pop:

::::{tab-set}
:::{tab-item} x86-64
:sync: x86-64
```{include} _generated/stack-pop-x86-64.md
```
:::
:::{tab-item} AArch64
:sync: aarch64
```{include} _generated/stack-pop-aarch64.md
```
:::
:::{tab-item} AArch64 (LSE)
:sync: aarch64-lse
```{include} _generated/stack-pop-aarch64-lse.md
```
:::
:::{tab-item} RISC-V
:sync: riscv64
```{include} _generated/stack-pop-riscv64.md
```
:::
:::{tab-item} WebAssembly
:sync: wasm
```{include} _generated/stack-pop-wasm.md
```
:::
::::

The shape is ch04's with one more load: the top, then the node's `next` at an address computed from
the top, then the compare-and-swap. On **x86-64** that is a `mov`, a `mov` from an indexed address,
and `lock cmpxchg`. On **AArch64** the head's acquire load is `ldar`, the relaxed load of `next` a
plain `ldr`, and the compare-and-swap the exclusive pair `ldaxr` and `stxr` or, with **LSE**,
`casa`, compare-and-swap with acquire. **RISC-V** uses the reserved and conditional pair with the
acquire fence. **WebAssembly** uses `i32.atomic.load` and `i32.atomic.rmw.cmpxchg`, with the index
arithmetic in between.

The push, in the same shape with the store of `next` before the swing:

::::{tab-set}
:::{tab-item} x86-64
:sync: x86-64
```{include} _generated/stack-push-x86-64.md
```
:::
:::{tab-item} AArch64
:sync: aarch64
```{include} _generated/stack-push-aarch64.md
```
:::
:::{tab-item} RISC-V
:sync: riscv64
```{include} _generated/stack-push-riscv64.md
```
:::
:::{tab-item} WebAssembly
:sync: wasm
```{include} _generated/stack-push-wasm.md
```
:::
::::

## Fix one thing

Nothing is broken, so the thing to notice is what the fix of ch04 bought here. A locked stack would
need the lock's acquire, the two reads, the write and the release, with every other thread waiting
through all of it. The lock-free pop is two reads and one compare-and-swap, and a thread that is
descheduled between them holds nothing: the others proceed, and when it wakes its compare-and-swap
fails if the head has moved, and it reads again. That is the progress guarantee, and it is the
reason to accept the discipline.

## Break it again

Make the swing a plain store. The pop reads the top, reads the node below, and stores the node
below as the new head, in two steps instead of one:

```{literalinclude} ../experiments/stack/stack.c
:language: c
:start-at: /* Not a pop
:end-before: /* a: nodes per worker
```

This panel is locked to it. Run it: on a device with more than one core, *Popped twice* and *Lost*
are not zero in most runs; on one core, the trace below is the instrument.

```lab
experiment: stack
workers: 4
operation: broken
lock: operation
```

The trace, under *alternate*:

```{include} _generated/stack-trace-broken.md
```

Both threads read node one as the top, both store node two as the head, and both leave holding node
one. One node, two owners, and node two is still the head though it was "popped" by nobody. In the
live run that shows as nodes popped twice, and as nodes lost: a push that swung the head between a
pop's read and its plain store is undone by that store, and the pushed node, with everything pushed
above it since, is unreachable from the head. No node here is ever pushed back; a push and a broken
pop need only overlap. It is [ch03](#atomic-operations)'s split increment, in a structure: each
step atomic, the pair not.

## The mental model

:::{div}
:class: model

**The simplest lock-free structure changes by one compare-and-swap per mutation.** The expected value encodes
what the mutation assumed. If the assumption no longer holds, the swap fails and the thread
reads again.

**Nobody holds anything.** A thread that stops between its reads and its swap blocks nobody; its
swap fails when it resumes.

**The assumption here is "the top is still this node".** It holds as long as a popped node is
never pushed again. The next chapter pushes one again.
:::

## What this cannot tell you

**Whether lock-free is faster.** It is not, in general: a compare-and-swap costs a cache-line
round trip as a lock does. Its promise is progress under preemption, not speed.

**How a real implementation allocates.** The pool of indices avoids allocation. A real stack
allocates nodes, frees them, and reuses memory, which is [ch18](#memory-reclamation)'s problem.

**What a pop does when the node below has been freed.** Reading `next` of a node another thread
has freed is a use after free. The pool hides it; ch18 does not.

## Where to go next

- **The stack.** R. Kent Treiber, *Systems Programming: Coping with Parallelism*, IBM Research
  Report RJ 5118, 1986: the algorithm this chapter builds.
- **The definitions.** Maurice Herlihy and Nir Shavit, *The Art of Multiprocessor Programming*,
  on lock-freedom, wait-freedom and linearisability.
- **The instructions.** Arm's `CASA` and the LSE atomics; `LOCK CMPXCHG` in the Intel manual.
- **Next.** [ch17](#the-aba-problem) pushes a popped node back.
