---
title: What does x++ actually do?
---

(what-x-plus-plus-does)=
# What does x++ actually do?

## The question

What does one increment of a shared variable become, once the compiler is done with it?

Every concurrency bug in this book starts with a line that looks like one thing and is several.
`counter++` reads as a single act: the counter goes up. The language says more. C defines it as a
read of the variable, an addition, and a write of the result, and promises nothing about what
happens between those three if another thread is looking. Before two threads can disagree about
a value, you need to see the three steps one thread takes, and the instructions the compiler
emits for them. That is this chapter's whole job, with one thread, where nothing can go wrong
yet.

## The smallest program

The kernel is a C file in the repository, compiled to WebAssembly for the page and to assembly
for the fragments below. Its shared variable is an ordinary `int`:

```{literalinclude} ../experiments/counter/counter.c
:language: c
:start-at: /* The variable the workers share
:end-before: /* One increment of the plain counter
```

The function the chapter is about increments it once:

```{literalinclude} ../experiments/counter/counter.c
:language: c
:start-at: /* One increment of the plain counter
:end-before: /* The same increment, in a loop
```

`CM_NOINLINE` keeps the function out of line, so its instructions are its own and the loop that
calls it cannot be merged with it. The loop is in the kernel's entry point, which every worker
runs; with the operation set to *plain* it calls `increment` once per iteration:

```{literalinclude} ../experiments/counter/counter.c
:language: c
:start-at: /* a: increments per worker
:end-before: CM_EXPORT("cm_reset")
```

:::{dropdown} What CM_NOINLINE and CM_EXPORT are
:class: compiler
Both are macros from the book's own header, `experiments/cm.h`. `CM_NOINLINE` expands to a
compiler attribute that stops clang copying the function's body into its caller, so the
fragments below show the function on its own; `CM_EXPORT` names the four functions the page
calls, `cm_run`, `cm_reset`, `cm_result` and `cm_go`, so the runtime can find them in the
compiled module. Neither is part of C, and neither has anything to do with the increment.
:::

The barrier at the top holds every worker until the page says go. With one worker it changes
nothing; it matters from [ch02](#two-threads-one-variable) on.

## Run it

One worker, as many increments as you like. The page compiles nothing: it loads the kernel,
already compiled to WebAssembly, runs it on a worker, and reads the counter out of the worker's
memory when the worker finishes.

```lab
experiment: counter
workers: 1
lock: workers
operation: plain
```

Try these, in order:

1. **Run it as it is.** *Observed* equals *Expected*. One thread, one variable, nothing to
   disagree with: every increment lands.
2. **Raise the increments.** Pick a larger count and run again. Still exact, and *Elapsed* grows
   with the count: the worker is doing the work you asked for, once per iteration.
3. **Switch the operation to *folded*.** The same count, in a loop the compiler could see all of.
   Still exact, and the time collapses. Keep this result in mind for *Break it again* below: the
   compiler did not run your loop.

## What the source hides

`counter++` is a read-modify-write. Whatever the instruction count, an increment of a variable in
memory is a read of the word, an addition, and a write of the result, and the read and the write
are two separate memory accesses. The book has a machine built to show exactly that. The
teaching machine is a model: each thread has a few registers and a program counter, the threads
share one memory, and each runs a short program written by hand to mirror the kernel's C. Here is
its program for `increment`, beside the line it mirrors:

```{include} _generated/counter-program-plain.md
```

Three operations for one line of C, and the register `r` is where the value lives between the
load and the store. Now run them. The panel below is the same experiment in its *trace* mode. Set
*Increments per thread in the trace* to one and the schedule to *manual*, then press *Step A*
three times, watching the machine drawn above the table:

```lab
experiment: counter
workers: 1
mode: trace
lock: workers
operation: plain
```

The load copies the word from memory into the register and changes nothing in memory. The add
changes the register and, again, nothing in memory. Only the store writes the word back. Between
the first step and the third, memory still holds the old value, and the machine shows it holding
it. With one thread the three steps can happen in no other order, so nothing goes wrong yet.

The C standard describes the increment in its own words. It reads the stored value and writes the
new one, and a program in which another thread writes the variable with nothing to order the two
accesses has a data race, which the standard declines to give any meaning at all. One thread
cannot race with itself, so for now the three steps are only a fact about the shape of the
operation. Hold on to the shape: the window between the load and the store is where
[ch02](#two-threads-one-variable) puts a second thread.

**Two microscopes.** The teaching machine is the first, and everything under it is visible: every
register, every word of memory, every step, in an order you chose, with the same result every
time. That is also its limit. It is an executable model of selected instruction and
microarchitectural behaviour, written for this book. It is not an implementation of any real
instruction set or processor, and its programs are written by hand, not emitted by a compiler.
The second microscope is the real toolchain: the kernel compiled by clang and run on your
device's threads in *Run it* above, with the instructions clang emitted shown under *At the
machine* below. Under it you can see the C, the instructions and the result, and not the rest:
which thread ran when, what each core held in its cache, what the processor reordered. Those you
infer from the result, and the chapters are about how.

```text
             THE TEACHING MACHINE                  YOUR MACHINE
             fully visible                         partially visible

  program    written by hand to mirror the C       the instructions clang emitted
  schedule   yours, one step at a time             the scheduler's and the hardware's: hidden
  state      every register and every word,        the result, read when the last worker
             at every step                         finishes
  result     the same every time: a model          one observation on one device: real
```

When a chapter needs a result to be certain, it uses the machine, where the result is
constructed. When it needs the result to be real, it uses yours, where the result is observed.
Every chapter from here on uses both, and each panel says which it is showing.

## At the machine

Each fragment below was written by the build, from the function above, with clang at
optimisation level two for the target named under it. Pick an architecture; the choice follows
you through the book.

:::{dropdown} What an optimisation level is
:class: compiler
`-O2` is a flag that tells clang how hard to work on the code. At `-O0` it translates each line
as written; at `-O2` it may keep values in registers, fold loops and choose other instructions,
within the rules the language sets. The book shows `-O2` because that is what ships, and `-O0`
beside it where the difference teaches something. Which level produced a fragment is always in
the line under it.
:::

::::{tab-set}
:::{tab-item} x86-64
:sync: x86-64
```{include} _generated/counter-increment-x86-64.md
```
:::
:::{tab-item} AArch64
:sync: aarch64
```{include} _generated/counter-increment-aarch64.md
```
:::
:::{tab-item} RISC-V
:sync: riscv64
```{include} _generated/counter-increment-riscv64.md
```
:::
:::{tab-item} WebAssembly
:sync: wasm
```{include} _generated/counter-increment-wasm.md
```
:::
::::

**AArch64** shows the three steps as three instructions, and nothing hides them: `ldr` loads the
word into a register, `add` adds one, `str` stores it back. The `adrp` before them forms the
variable's address. **RISC-V** is the same shape with its own names: `lw`, `addi`, `sw`.
**WebAssembly** is a stack machine, so the register is the stack: `i32.load` pushes the value,
`i32.add` replaces it with the sum, `i32.store` writes it. The `i32.const 0` lines are the
address of the variable, pushed where the load and the store need it.

**x86-64 is the one that lies to you.** The compiler chose `inc dword ptr [rip + counter]`: one
instruction that increments a word in memory in place. The source became one instruction, so it is
tempting to conclude that the increment is one step. It is not. Its architectural effect is still a
read of the word and a write of the result: two memory accesses in one encoding. Without the `lock`
prefix the instruction set does not make them one indivisible access, so another core's access may
land between them. [ch03](#atomic-operations) shows the one-byte prefix that makes it so, and the
trace in [ch02](#two-threads-one-variable) loses an update inside exactly this instruction.

:::{dropdown} Reading `inc dword ptr [rip + counter]`
:class: isa
`dword ptr` says the operand is a 32-bit word in memory. `[rip + counter]` is its address,
written relative to the instruction pointer, which is how x86-64 code reaches a global variable
wherever the code is loaded. AArch64's `adrp` with `:lo12:` and RISC-V's `auipc` form the same
address in two steps. [Appendix D](#reading-the-fragments) has the notation of every target.
:::

What is guaranteed here, and what is not: the instruction set's meaning is guaranteed. `ldr`
loads, `str` stores, and the processor performs them as the manual says. The compiler's choice
of instructions is not: another compiler, version or optimisation level emits something else for
the same C. The conditions line under each fragment says what produced it, and *Break it again*
shows how much the choice can move.

## Fix one thing

Nothing is broken yet, so the thing to fix is the one you cannot see: the kernel's loop calls an
out-of-line function once per iteration, and the question is why. Here is the same increment with
the loop inside the function, where the compiler can see all of it:

```{literalinclude} ../experiments/counter/counter.c
:language: c
:start-at: /* The same increment, in a loop
:end-before: /* One increment of the atomic counter
```

::::{tab-set}
:::{tab-item} x86-64
:sync: x86-64
```{include} _generated/counter-loop-x86-64.md
```
:::
:::{tab-item} AArch64
:sync: aarch64
```{include} _generated/counter-loop-aarch64.md
```
:::
:::{tab-item} RISC-V
:sync: riscv64
```{include} _generated/counter-loop-riscv64.md
```
:::
:::{tab-item} WebAssembly
:sync: wasm
```{include} _generated/counter-loop-wasm.md
```
:::
::::

The loop is gone. The compiler proved that running the increment `n` times has the same effect, for
one thread, as adding `n` once, and emitted one load, one add of `n` and one store. On x86-64 it is
one `add` with the count in a register. That is what *folded* ran in the panel above, and why its
*Elapsed* collapsed in your run. The compiler is allowed to do this because the language told it
nothing about other threads: a variable that is not atomic is, as far as the compiler is concerned,
this thread's alone. [ch07](#the-compiler-is-part-of-the-story) is about the consequences. The fix,
for a kernel that must do what it says, is the out-of-line call: the compiler cannot see through
it, so the loop stays a loop.

## Break it again

Take the optimiser away instead. The same `increment`, compiled at optimisation level zero:

::::{tab-set}
:::{tab-item} x86-64
:sync: x86-64
```{include} _generated/counter-increment-unoptimised-x86-64.md
```
:::
:::{tab-item} AArch64
:sync: aarch64
```{include} _generated/counter-increment-unoptimised-aarch64.md
```
:::
:::{tab-item} RISC-V
:sync: riscv64
```{include} _generated/counter-increment-unoptimised-riscv64.md
```
:::
:::{tab-item} WebAssembly
:sync: wasm
```{include} _generated/counter-increment-unoptimised-wasm.md
```
:::
::::

Now x86-64 shows its three steps too: a `mov` from memory into a register, an `add` on the
register, a `mov` back, wrapped in the stack frame an unoptimised function keeps. The behaviour is
the same as the one-instruction version in every way the reader of the program can see, and in one
way they cannot: the window between the load and the store is now three instructions wide instead
of being inside one. The instruction set always defined a read and a separate write. Only the
encoding changed.

## The mental model

:::{div}
:class: model

**An increment is a load, an add and a store.** The source shows one operation; the language
defines three; and on every target the read and the write are two memory accesses, whatever the
instruction count. On AArch64 and RISC-V the three are three instructions. On x86-64 the compiler
usually folds them into one instruction whose read and write are still two accesses. The window
between the load and the store is where every race in Part I happens.

**The compiler keeps the meaning for one thread and promises nothing to a second.** A loop of
increments became one add. That is correct for the thread that runs it and fatal for any other
thread that was counting on seeing each one.
:::

## What this cannot tell you

**The browser's time is not a measurement of the instruction.** *Elapsed* is wall time on your
device, from the barrier opening to the worker reporting back through a message port, under
whatever else your machine is doing. It tells you that *folded* is faster than *plain* by a large
factor, and nothing finer than that. [Appendix A](#reproducing-at-a-desk) has the native commands
for a time that means more.

**The fragments are one compiler's choices.** clang at the version and flags stated under each.
gcc, another clang, or `-Os` may pick a different instruction for the same source, and the
WebAssembly engine in your browser compiles the WebAssembly to its own machine code, which the
book does not show and does not claim to know. [ch24](#from-wasm-to-machine-code) draws that
boundary.

**One thread shows the shape of the operation, not the problem.** Nothing was lost here, and
nothing could be. The question of what two threads do with the same three steps is the next
chapter's.

## Where to go next

- **The language's definition.** ISO C, section 6.5.2.4, postfix increment, and section 5.1.2.4,
  multi-threaded executions and data races, which says what the standard refuses to define.
- **The instruction sets.** Intel 64 and IA-32 Architectures Software Developer's Manual, volume
  2, `INC` and `ADD`; Arm Architecture Reference Manual for A-profile, `LDR`, `ADD` and `STR`;
  The RISC-V Instruction Set Manual, volume I, the RV32I and RV64I base integer instructions.
- **WebAssembly's instructions.** The WebAssembly Core Specification, the memory instructions and
  the numeric instructions.
- **Next.** [ch02](#two-threads-one-variable) gives the same three steps to two threads.
