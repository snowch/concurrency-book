---
title: The ABA problem
---

(the-aba-problem)=
# The ABA problem

## The question

How can a compare-and-swap succeed when the world changed underneath it?

[ch16](#lock-free-stack)'s pop assumed one thing: if the head still holds the node I read, the
node below it is still the one I read. The assumption held because no popped node was ever
pushed again. Real stacks reuse nodes. A node is popped, used, and pushed back, or freed and its
memory reused for a new node at the same address, and then the head can hold the same value with
a different node below it. The compare-and-swap compares values, as [ch04](#compare-and-swap)
warned, and the value is the same. It succeeds, and swings the head to a node that is no longer
in the stack. The pattern is named for the sequence of values the head went through: A, then B,
then A again.

## The smallest program

The stack of ch16, with three nodes, and workers that pop a node and push it straight back, so
that nodes leave and return constantly. The pop is ch16's:

```{literalinclude} ../experiments/aba/aba.c
:language: c
:start-at: /* The pop of ch16
:end-before: /* The same stack with a version
```

Each worker checks every node it pops: a node that was not marked as being in the stack is one
the head was swung to while another worker held it.

```{literalinclude} ../experiments/aba/aba.c
:language: c
:start-at: /* a: pop-and-push rounds
:end-before: CM_EXPORT("cm_reset")
```

## Run it

```lab
experiment: aba
workers: 4
head: plain
```

Try these, in order:

1. **Run it.** *Not in the stack* is not zero, on a device with more than one core, and *In the
   stack at the end* is rarely three. A count larger than the pool means the head chain loops:
   a node points at itself or at a node above it, and the stack is destroyed.
2. **Open the deterministic trace** and set the schedule to *manual*. Step A twice: A reads node
   one as the top and node two below it. Now step B to the end: B pops one, pops two, and pushes
   one back; the head is one again, with three below it. Step A three times: its compare-and-swap expects one, finds one, and swings the head to two, which B holds; once A has stored what it popped, the outcome line says so.
3. **Switch the head to *tagged*.** *Not in the stack* is zero and the stack ends with its three
   nodes, every run. *Fix one thing* says what changed.
4. **Repeat the trace with the tagged head.** The same interleaving, and A's compare-and-swap
   fails, because the tag moved on while the index came back.

## What the source hides

The compare-and-swap at the end of the pop checks that the head is the value read. It does not
check that nothing happened: it cannot, because the word has no memory of its history, only its
present value. The trace is the whole problem in a dozen steps:

```{include} _generated/aba-trace-plain.md
```

Read the head column down: one until step four, two at step five, three at step nine, one again at
step thirteen. Step fourteen is the moment. Between A's read of the node below and A's
compare-and-swap, the head went from one to two to three to one. A's expected value is one; the
head is one; the swap succeeds; the node below, which A read as two, is in B's hands. Nothing in
the hardware is wrong. The compare-and-swap did exactly what [ch04](#compare-and-swap) said:
compared a value, not a history.

The fix is to give the word a history. Put a version counter beside the index and compare and
swap the two together, as one wider word. Every swing of the head adds one to the version, so a
head that left and returned has a different version even when it has the same index, and the
compare fails:

```{include} _generated/aba-trace-tagged.md
```

That needs a compare-and-swap on a word twice as wide as the index, which each of this book's four
targets has for a 64-bit word; a 32-bit host need not. The other fix is to make the assumption true
again: never reuse a node while any thread might be between its reads and its swap, which is
[ch18](#memory-reclamation).

## At the machine

The tagged pop. The index is the low half of a 64-bit word and the version the high half; the
compare-and-swap is on the whole word:

::::{tab-set}
:::{tab-item} x86-64
:sync: x86-64
```{include} _generated/aba-tagged-x86-64.md
```
:::
:::{tab-item} AArch64
:sync: aarch64
```{include} _generated/aba-tagged-aarch64.md
```
:::
:::{tab-item} AArch64 (LSE)
:sync: aarch64-lse
```{include} _generated/aba-tagged-aarch64-lse.md
```
:::
:::{tab-item} RISC-V
:sync: riscv64
```{include} _generated/aba-tagged-riscv64.md
```
:::
:::{tab-item} WebAssembly
:sync: wasm
```{include} _generated/aba-tagged-wasm.md
```
:::
::::

On **x86-64** it is `lock cmpxchg` on a `qword`, the 64-bit form, with the version moved on by one
`add` of a constant that is one in the high half, which `movabs` put in a register. **AArch64**
uses the exclusive pair on `x` registers, or `casa` on an `x` register with **LSE**. **RISC-V** has
`lr.d` and `sc.d`. **WebAssembly** has `i64.atomic.rmw.cmpxchg`, and the index arithmetic around it
is the 64-bit shifts and masks the macros in the kernel spell out.

A real pointer is already 64 bits wide on these targets, so a tagged pointer needs either a
128-bit compare-and-swap, which x86-64 has as `cmpxchg16b` and AArch64 as `casp`, or spare bits
in the pointer, which most allocators leave at the bottom and current processors leave at the
top. Both are used in production; neither is portable; and the version counter can wrap, which
is a probability argument rather than a proof.

## Fix one thing

The fix in the kernel is the tag, and this panel is locked to it:

```lab
experiment: aba
workers: 4
head: tagged
lock: head
```

The kernel's tagged push and pop:

```{literalinclude} ../experiments/aba/aba.c
:language: c
:start-at: /* The same stack with a version
:end-before: /* a: pop-and-push rounds
```

## Break it again

Remove the tag and keep the reuse: that is the plain head, and the panel at the top. Or keep the
tag and let the version counter be narrow enough to wrap during one slow pop, which no kernel here
can show and which has happened in production with a sixteen-bit tag. The honest statement is that
a tag turns a failure this workload all but guarantees into one that needs the counter to wrap, and
that the fix with a proof is the next chapter's.

## The mental model

:::{div}
:class: model

**Compare-and-swap compares a value, not a history.** A word that changed and changed back compares
equal. For a counter that is harmless; for a pointer it means the same address with something
different behind it: the same node re-linked, or another object there.

**ABA needs reuse.** A node popped and pushed again, or memory freed and reallocated, while a
thread is between its reads and its swap.

**Two fixes.** Give the word a history, with a version beside the pointer, compared and swapped
together; or forbid reuse while any thread might be mid-operation, which is reclamation.
:::

## What this cannot tell you

**How often ABA happens in your program.** The kernel pushes popped nodes back at once on a
stack of three, which is the worst case by design. A real workload's window is narrower and
the count is one observation.

**Where the pool's reuse ends and the allocator's begins.** The kernel reuses nodes; a real
program reuses memory, and a freed node's `next` may be anything by the time a slow pop reads it.
That is the use after free the next chapter is about.

**Whether the engine's 64-bit compare-and-swap is one instruction.** On a 32-bit host it may
not be. The WebAssembly instruction promises atomicity; the host delivers it somehow.

## Where to go next

- **The name.** IBM System/370 Principles of Operation, on `CDS`, compare double and swap, which
  the mainframe added for exactly this, and the appendix on the ABA problem.
- **The analysis.** Maged Michael, *ABA Prevention Using Single-Word Instructions*, IBM Research
  Report RC 23089, 2004.
- **The alternatives.** Maurice Herlihy and Nir Shavit, *The Art of Multiprocessor Programming*,
  on stamped references.
- **Next.** [ch18](#memory-reclamation) forbids the reuse.
