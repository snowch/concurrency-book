---
title: x86 is not the model
---

(x86-is-not-the-model)=
# x86 is not the model

## The question

Which reorderings does each architecture allow, and what does the same C become on each?

[ch14](#store-buffers-and-visibility) found that x86-64 permits one reordering, and every
chapter in Part III found that x86-64 charges nothing for release, acquire and relaxed. A
programmer who learns concurrency on x86-64 learns that most orderings are free and that the
only bug is the store-buffer one. That programmer's code then runs on a phone, a Mac, a server
with Arm cores, or a RISC-V board, and breaks. This chapter puts the three architectures side by
side, with the same C and the fragments the book has been generating all along, and makes the
differences a table instead of a surprise.

## The smallest program

The programs are the ones from [ch08](#acquire-and-release) and [ch10](#sequential-consistency):
the handover, a store then a flag, and the store-buffer test, a store then a load. Here is the
handover's writer in the four orderings again, because the point of the chapter is to read it
four times on three targets:

```{literalinclude} ../experiments/publication/publication.c
:language: c
:start-at: /* The writer's half, four ways
:end-before: /* The reader's half
```

## Run it

```lab
experiment: store_buffer
workers: 2
lock: workers
ordering: volatile
```

Try these, in order:

1. **Run it, and note what your device is.** The foot of the panel says how many cores; it cannot
   say which architecture, so you have to. On x86-64, *volatile* shows *both loaded zero* and
   nothing else surprising. On AArch64 the same run shows it too;
   reordering a load past a load, or a store past a store, needs a program with two of a kind,
   which this test is not.
2. **Switch the ordering to *release-acquire*.** On every device in this browser, zero: the
   WebAssembly atomics are strong. Natively the result differs by architecture, and the fragments
   below say how: on x86-64 the outcome returns, because release-acquire is the plain pair; on
   AArch64 it does not, because `stlr` followed by `ldar` happens to be ordered.
3. **Open the deterministic trace.** In this test the model has one reordering, the store
   buffer's, which is the one x86-64 allows. In ch08 the same buffer drained out of order, which
   x86-64 never does and AArch64 and RISC-V may; the model shows no more than that.

## What the source hides

The source hides which reorderings the target will make. Here they are, for the three native
targets and WebAssembly, for two accesses to different addresses with nothing ordering them:

| Reordering | x86-64 | AArch64 | RISC-V | WebAssembly |
|---|---|---|---|---|
| A store overtaken by a later load | allowed | allowed | allowed | plain accesses: the host's; atomics: never |
| A store overtaken by a later store | never | allowed | allowed | plain: the host's; atomics: never |
| A load overtaken by a later load | never | allowed | allowed | plain: the host's; atomics: never |
| A load overtaken by a later store | never | allowed | allowed | plain: the host's; atomics: never |

x86-64 is *total store order*: stores reach memory in program order, loads are performed in program
order, and only the store buffer breaks the symmetry. AArch64 and RISC-V are *weakly ordered*: any
two accesses to different addresses may be reordered unless an instruction says otherwise, and the
instructions that say otherwise are the ones the fragments have been showing. WebAssembly's
position is the one this book has repeated since [ch03](#atomic-operations): its atomics are
sequentially consistent and reorder nothing; its plain accesses inherit whatever the engine and
then the host do with them. A WebAssembly program is weakly ordered on an Arm device and strongly
ordered on an x86-64 one, and a program that is only correct on the laptop has a bug the laptop
cannot show.

Two consequences for the handover of ch08. On x86-64, a relaxed flag publishes its data correctly
by accident: the compiler happened to keep the stores in order, and the architecture then keeps
them in order too. Neither was promised. On AArch64 it does not: the data's store may be overtaken
by the flag's, or the data's load may run before the flag's. The correct program, with release and
acquire, runs on both; the incorrect one runs on one.

## At the machine

The handover's writer, every ordering, on every target. This is the chapter's table in
instructions:

::::{tab-set}
:::{tab-item} x86-64
:sync: x86-64
```{include} _generated/publication-publish-x86-64.md
```
:::
:::{tab-item} AArch64
:sync: aarch64
```{include} _generated/publication-publish-aarch64.md
```
:::
:::{tab-item} RISC-V
:sync: riscv64
```{include} _generated/publication-publish-riscv64.md
```
:::
:::{tab-item} WebAssembly
:sync: wasm
```{include} _generated/publication-publish-wasm.md
```
:::
::::

Read down each tab. On **x86-64**, three of the four are identical: `mov`, `mov`. The ordering
rules of the architecture provide the release, so the compiler emits nothing for it; only the
sequentially consistent store differs, and it differs by using `xchg`. On **AArch64**, the
relaxed store is `str` and the release store is `stlr`: a different instruction, with a
different promise, at a different cost. On **RISC-V**, the release is a `fence rw, w` before an
ordinary `sw`. On **WebAssembly**, the three atomic versions are one instruction, and only the
volatile version, which is not an atomic at all, differs.

And the store-buffer test, where the strongest ordering is the one that differs:

::::{tab-set}
:::{tab-item} x86-64
:sync: x86-64
```{include} _generated/store_buffer-a-x86-64.md
```
:::
:::{tab-item} AArch64
:sync: aarch64
```{include} _generated/store_buffer-a-aarch64.md
```
:::
:::{tab-item} RISC-V
:sync: riscv64
```{include} _generated/store_buffer-a-riscv64.md
```
:::
:::{tab-item} WebAssembly
:sync: wasm
```{include} _generated/store_buffer-a-wasm.md
```
:::
::::

Here AArch64 is the one that charges nothing extra for sequential consistency over
release-acquire: `stlr` then `ldar` is already ordered. x86-64 charges an `xchg`, and RISC-V a
full fence. The cost of an ordering is not a property of the ordering. It is a property of the
pair, the ordering and the target, and the only way to know it is to read the fragment for the
target you ship on.

## Fix one thing

The fix is to write to the language's model and not to a processor's. The language's model is
Part III: relaxed for a counter, release and acquire for a handover, sequentially consistent
when a store must be visible before this thread's next load. A program written that way asks each
target for exactly what it needs, and each target charges what it charges. A program written to
x86-64's model, with relaxed where release was needed, is free on x86-64 and wrong on AArch64.

This panel is the handover with release and acquire, which is correct on every target:

```lab
experiment: publication
ordering: release-acquire
lock: ordering
```

## Break it again

The way to break a correct program is to port it to a stronger machine and then optimise it there.
Replace a release with relaxed because the x86-64 fragment showed they were the same instruction.
They were. The AArch64 fragment shows they are not, and the program may now publish stale data on
any Arm device it runs on. Every removal of an ordering must be justified by the language's rules,
which hold on every target, and never by a fragment, which holds on one.

## The mental model

:::{div}
:class: model

**x86-64 is total store order; AArch64 and RISC-V are weakly ordered; WebAssembly atomics are
sequentially consistent and its plain accesses are the host's.** The one reordering x86-64 allows
is the store buffer's.

**An ordering's cost is a property of the target.** Release is free on x86-64 and an instruction
on AArch64; sequential consistency is an exchange on x86-64 and free over release-acquire on
AArch64; RISC-V spells every one out as a fence.

**Write to the language's model.** It is the only one that holds on every target. A fragment
shows one target's price, never a permission to drop the order.
:::

## What this cannot tell you

**What your browser's host reorders.** The engine emits plain host accesses for plain WebAssembly
accesses and strong ones for atomics. The test shows you x86-64's reordering on x86-64 and
AArch64's on AArch64, and nothing about either on the other.

**The whole of a memory model.** The table is the four reorderings of two independent accesses.
Dependencies, multi-copy atomicity, and the exact rules for mixed-size accesses are in the
architecture manuals and the formal models cited below.

**RISC-V's real hardware.** RVWMO is the specification; a given core may be stronger. The fragments
show the mapping clang 18 chose, one of several the specification allows.

## Where to go next

- **The formal models.** Jade Alglave, Luc Maranget and Michael Tautschnig, *Herding Cats:
  Modelling, Simulation, Testing, and Data Mining for Weak Memory*, ACM TOPLAS 2014, and the
  `herd` tool and litmus tests, which run tests like this chapter's on real and modelled
  hardware. Shaked Flur and others, *Modelling the ARMv8 Architecture, Operationally*, POPL 2016.
- **The manuals.** Intel 64 and IA-32 Architectures Software Developer's Manual, volume 3,
  section 8.2; Arm Architecture Reference Manual for A-profile, the memory model chapter; The
  RISC-V Instruction Set Manual, volume I, the RVWMO chapter and its appendix of litmus tests.
- **WebAssembly's model.** The WebAssembly threads proposal and Conrad Watt, Andreas Rossberg and
  Jean Pichon-Pharabod, *Weakening WebAssembly*, OOPSLA 2019.
- **Next.** [Part V](#part-lock-free-algorithms) builds data structures with no lock at all.
