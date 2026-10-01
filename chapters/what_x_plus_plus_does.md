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
4. **Open the deterministic trace.** Set the schedule to *manual* and press *Step A* three times.
   The trace is a model of the operations the source hides, and with one thread it shows them in
   the only order they can happen: a load, an add, a store.

## What the source hides

`counter++` is a read-modify-write. The processor holds values in registers, and arithmetic
happens there, so an increment of a variable in memory is three steps: fetch the value into a
register, add one to the register, write the register back. In the trace's notation:

```text
r = load counter
r = r + 1
store counter = r
```

The C standard says the same thing in its own words. The increment reads the stored value and
writes the new one, and a program that lets another thread write the variable in between has a
data race, which the standard declines to give any meaning at all. One thread cannot race with
itself, so for now the three steps are only a fact about the shape of the operation. Hold on to
the shape: the window between the load and the store is where [ch02](#two-threads-one-variable)
puts a second thread.

## At the machine

Each fragment below was written by the build, from the function above, with clang at
optimisation level two for the target named under it. Pick an architecture; the choice follows
you through the book.

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
instruction that increments a word in memory in place. The source became one instruction, so it
is tempting to conclude that the increment is one step. It is not. The processor still fetches
the word, adds one to it and writes it back; the instruction set hides the three steps inside
one encoding. Nothing about it is indivisible with respect to another core. [ch03](#atomic-operations)
shows the one-byte prefix that makes it so, and the trace in [ch02](#two-threads-one-variable)
loses an update inside exactly this instruction.

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

The loop is gone. The compiler proved that running the increment `n` times has the same effect,
for one thread, as adding `n` once, and emitted one load, one add of `n` and one store. On x86-64
it is one `add` with the count in a register. That is what *folded* ran in the panel above, and
why it took no measurable time. The compiler is allowed to do this because the language told it
nothing about other threads: a variable that is not atomic is, as far as the compiler is
concerned, this thread's alone. [ch07](#the-compiler-is-part-of-the-story) is about the
consequences. The fix, for a kernel that must do what it says, is the out-of-line call: the
compiler cannot see through it, so the loop stays a loop.

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
register, a `mov` back, wrapped in the stack frame an unoptimised function keeps. The behaviour
is the same as the one-instruction version in every way the reader of the program can see, and
in one way they cannot: the window between the load and the store is now three instructions wide
instead of being inside one. The processor was always doing three things. Only the encoding
changed.

## The mental model

:::{div}
:class: model

**An increment is a load, an add and a store.** The source shows one operation; the language
defines three; the processor performs three, whatever the instruction count. On AArch64 and
RISC-V the three are three instructions. On x86-64 the compiler usually folds them into one
instruction that is still three steps inside. The window between the load and the store is where
every race in Part I happens.

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
