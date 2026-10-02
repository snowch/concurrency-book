---
title: The compiler is part of the concurrency story
---

(the-compiler-is-part-of-the-story)=
# The compiler is part of the concurrency story

## The question

Why can a program that reads a flag in a loop never see the flag change?

Every chapter so far has watched the processor. [ch01](#what-x-plus-plus-does) saw a hint that
the compiler is a second actor: a loop of a million increments became one add, because the
compiler is allowed to assume no other thread is looking at a plain variable. This chapter makes
that assumption bite. One worker waits in a loop for a flag; another worker sets it. The flag is
a plain `int`, then a `volatile int`, then an `_Atomic int`, and the compiler emits a different
loop for each. One of the three loops never ends.

## The smallest program

Three flags, so each loop has its own:

```{literalinclude} ../experiments/compiler/compiler.c
:language: c
:start-at: /* The flag, three times over
:end-before: /* What the waiter saw
```

The loop on the plain flag:

```{literalinclude} ../experiments/compiler/compiler.c
:language: c
:start-at: /* Wait on a plain int.
:end-before: /* Wait on a volatile int.
```

The same loop on a volatile flag, and on an atomic one:

```{literalinclude} ../experiments/compiler/compiler.c
:language: c
:start-at: /* Wait on a volatile int.
:end-before: /* Set all three flags
```

The setter does some busy work, then sets all three:

```{literalinclude} ../experiments/compiler/compiler.c
:language: c
:start-at: /* Set all three flags
:end-before: /* Two workers.
```

## Run it

Two workers: worker zero waits, worker one sets. This panel does not run by itself, because with
the plain flag it cannot finish: press *Run*, and the page stops the workers after four seconds.

```lab
experiment: compiler
workers: 2
lock: workers
flag: plain
autorun: false
```

Try these, in order:

1. **Run it with the plain flag.** The run does not finish. The setter sets the flag after its busy work, which *Elapsed* on a volatile run measures; the waiter never notices. After four seconds the page stops the workers
   and says so. Nothing about the processor is to blame: *At the machine* shows that the loop
   the compiler emitted reads the flag once, before the loop, and if it read zero branches to itself forever.
2. **Set the busy steps to zero and run again.** Still no end. Even a flag that is set before the
   waiter starts looping does not help if the waiter's one read happened first, and the barrier
   makes the two workers start together, so it usually does.
3. **Switch the flag to *volatile*.** The loop ends on the value one, and *Elapsed* is about how
   long the setter's busy work took. The compiler reads a volatile variable every time the
   source does.
4. **Switch the flag to *atomic*.** The same result. On most targets the same instructions, as
   the fragments show. The difference between volatile and atomic is not in this loop; it is in
   what else the compiler and the processor promise, which is the rest of this chapter and Part
   III.
5. **Open the deterministic trace.** The trace models the loop the compiler emitted, not the
   source. With the plain flag the waiter loads once and then tests its register; the setter
   stores one; the waiter keeps testing the stale register until the trace gives up. With the
   volatile flag the waiter loads every time round and stops after the store.

## What the source hides

The source says "read the flag until it is non-zero". The compiler is allowed to read it once.
Two rules of the language make that legal, and they are the reason this chapter exists.

The first is the data race rule from [ch02](#two-threads-one-variable): if another thread writes
a plain variable while this thread reads it without synchronisation, the program has undefined
behaviour. The compiler is entitled to assume the program is defined, so it assumes no other
thread writes `flag` during the loop. Then the value cannot change inside the loop, so one read
suffices.

The second is the forward-progress rule. A loop with no side effects, no atomic operations, no
volatile accesses and no calls may be assumed to terminate. Having hoisted the read, the compiler
is left with a loop whose body does nothing and whose condition is a register, and it may treat
the case where the register is zero as unreachable, or emit an empty loop for it, as clang did
here. Other compilers delete the loop entirely and return at once, which is a different wrong
answer to the same question.

The trace of the emitted loop:

```{include} _generated/compiler-trace-plain.md
```

`volatile` disables the first assumption for that variable, and only that assumption. It says:
every read in the source is a read in the code, every write a write, in program order relative to
other volatile accesses. It was designed for memory-mapped hardware registers, where a read has a
visible effect, and it says nothing about other threads, about caches, or about the order of this
variable's accesses against any non-volatile variable. `_Atomic` says the first thing and the
rest: another thread may write this, so every read is a read, and the orderings of Part III may
be asked for.

## At the machine

The plain loop. Find the single load before the loop, and the loop that jumps to itself:

::::{tab-set}
:::{tab-item} x86-64
:sync: x86-64
```{include} _generated/compiler-plain-x86-64.md
```
:::
:::{tab-item} AArch64
:sync: aarch64
```{include} _generated/compiler-plain-aarch64.md
```
:::
:::{tab-item} RISC-V
:sync: riscv64
```{include} _generated/compiler-plain-riscv64.md
```
:::
:::{tab-item} WebAssembly
:sync: wasm
```{include} _generated/compiler-plain-wasm.md
```
:::
::::

On every target the shape is the same. One load of `flag`, a test, and then either a return or a
branch to itself: `jmp .LBB1_1`, `b .LBB1_2`, `j .LBB1_2`, and in WebAssembly a `loop` whose
only instruction is `br 0`, a branch back to its own start. The flag is never read again.

The volatile loop, and the atomic one:

::::{tab-set}
:::{tab-item} x86-64
:sync: x86-64
```{include} _generated/compiler-volatile-x86-64.md
```
```{include} _generated/compiler-atomic-x86-64.md
```
:::
:::{tab-item} AArch64
:sync: aarch64
```{include} _generated/compiler-volatile-aarch64.md
```
```{include} _generated/compiler-atomic-aarch64.md
```
:::
:::{tab-item} RISC-V
:sync: riscv64
```{include} _generated/compiler-volatile-riscv64.md
```
```{include} _generated/compiler-atomic-riscv64.md
```
:::
:::{tab-item} WebAssembly
:sync: wasm
```{include} _generated/compiler-volatile-wasm.md
```
```{include} _generated/compiler-atomic-wasm.md
```
:::
::::

Now the load is inside the loop, on every target, for both. On AArch64 the volatile and the
atomic loop are the same instructions to the letter: `ldr`, `cbz`, back. On x86-64 they differ
only in that the compiler compared the volatile flag in memory and the atomic one in a register,
which is a choice, not a meaning. Only WebAssembly distinguishes them in the instruction set:
`i32.load` for the volatile flag, `i32.atomic.load` for the atomic one, because WebAssembly's
atomic loads carry an ordering the plain ones do not.

So on three of the four targets the two loops are the same instructions, and the difference between
`volatile` and `_Atomic` is in what the language promised and the compiler must keep. For this
loop, which reads one word and nothing else, the promises coincide. The moment the waiter reads a
second variable after the flag, they part: an atomic load with acquire ordering, which
[ch08](#acquire-and-release) asks for, orders that second read after the flag; neither a volatile
load nor this relaxed one does, and the compiler, or the processor, may move the second read above
it, and the compiler, or the processor, may move the second read above it. That is
[ch08](#acquire-and-release).

## Fix one thing

The fix is the atomic flag, and the smallest fix is `memory_order_relaxed`, which is what the
kernel asks for and all this loop needs: a read every time round, and nothing about order. You ran
it above. Volatile would also have ended the loop, and it is the wrong fix, because it fixes this
symptom and not the disease. A program that uses volatile for a flag will work until it reads a
second variable, and then it can fail twice over: the compiler may move the second read above the
volatile one on any target, and a processor that reorders loads may do the same, in a way no test
on x86-64 will find.

## Break it again

Turn the optimiser off. The plain loop, compiled at optimisation level zero:

::::{tab-set}
:::{tab-item} x86-64
:sync: x86-64
```{include} _generated/compiler-plain-unoptimised-x86-64.md
```
:::
:::{tab-item} AArch64
:sync: aarch64
```{include} _generated/compiler-plain-unoptimised-aarch64.md
```
:::
:::{tab-item} RISC-V
:sync: riscv64
```{include} _generated/compiler-plain-unoptimised-riscv64.md
```
:::
:::{tab-item} WebAssembly
:sync: wasm
```{include} _generated/compiler-plain-unoptimised-wasm.md
```
:::
::::

The load is back inside the loop, and the loop would end. This is the bug's natural habitat: a
program that works in a debug build and hangs in a release build, and a developer who concludes
the optimiser is broken. The optimiser is not broken. The program had a data race, the language
gave it no meaning, and the optimiser chose the meaning that ran fastest. Every chapter from here
on uses atomics for anything one thread writes and another reads, including flags that look too
simple to need them.

## The mental model

:::{div}
:class: model

**The compiler assumes there is no data race, because the language told it so.** A plain
variable this thread does not write will not change, so one read is as good as many. A loop
with nothing in it may be assumed to end.

**`volatile` means "every access in the source is an access in the code".** Nothing more: no
promise about other threads, caches or the order against other variables. It is for hardware
registers.

**`_Atomic` means "another thread may touch this".** Every access is an access, and the orderings
of Part III can be asked for.

**For a single relaxed flag the two produce the same instructions on three of the four targets. The difference is the promise, and the
promise is what breaks first when the program grows.**
:::

## What this cannot tell you

**Which wrong code another compiler emits.** clang hoisted the load and left an empty loop; gcc at
some versions and settings deletes the loop and returns. The fragments show one compiler's
choice, as every fragment in this book does.

**How WebAssembly treats the race.** In WebAssembly a plain load that races with a store has a
defined, weak meaning, so the engine could not have removed the loop had the compiler left it in.
The loop was removed before the WebAssembly existed, by the C compiler, under C's rules. The
layer that broke the program is the one above the instruction set.

**Why the volatile fix is wrong.** This loop cannot show it, because it reads one variable. The
next chapter's loop reads two.

## Where to go next

- **The rules.** ISO C, section 5.1.2.4 (data races), section 6.8.5 (iteration statements and the
  forward-progress assumption), and section 6.7.3 on `volatile`.
- **Why volatile is not enough.** Hans Boehm, *Threads Cannot be Implemented as a Library*, PLDI
  2005, and the Linux kernel's `Documentation/process/volatile-considered-harmful.rst`.
- **The compiler's view.** The LLVM Atomic Instructions and Concurrency Guide, on what the
  optimiser may assume about non-atomic memory.
- **Next.** [ch08](#acquire-and-release) hands a finished piece of data from one thread to
  another, through a flag, and finds that the flag arriving is not the same as the data arriving.
