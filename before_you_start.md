---
title: Before you start
---

(before-you-start)=
# Before you start

## What this page is for

This book assumes basic C and nothing else. You do not need to have written a threaded program,
read a listing of instructions, or know what a compiler does to your code: each of those is
taught where the book needs it. What the book does need is that the notation on the page never
stops you. This page gives you that in about twenty minutes: the C the kernels use, the words
the first chapter leans on, how to read a listing, and how a chapter is laid out so you know
what to skip on a first reading. Come back whenever a line looks foreign.

## The rule the book keeps for you

Whatever is on a page is either the subject of the chapter or incidental machinery, and the
book says which. Machinery that is not the subject is explained in a folded note, labelled with
where it comes from, like this one:

:::{dropdown} Why does every quoted function carry CM_NOINLINE?
:class: compiler
`CM_NOINLINE` is a macro the book's own header defines; it expands to an attribute that stops
the compiler from copying the function's body into its caller. Without it the compiler would
merge the function into the loop that calls it, and the chapter would have no separate function
to show you. It is not part of C and has nothing to do with concurrency. When you see it, read
past it.
:::

The label says what kind of thing the note explains:

| Label | What it marks |
|---|---|
| **C** | Part of the C language. |
| **Compiler** | Something that tells the compiler how to treat the program: an attribute, a macro that expands to one, a flag. |
| **Library** | Provided by a library rather than the language, here almost always C's `<stdatomic.h>`. |
| **Operating system** | A facility of the operating system, such as the call that puts a thread to sleep. |
| **Instruction set** | A fact about an instruction set: what an instruction means on x86-64, AArch64, RISC-V or WebAssembly. |
| **Hardware** | What a processor and its caches do beneath the instruction set. |
| **Deep dive** | More than the chapter needs, for a reader who wants it. |

A folded note is safe to skip. The kernel, the listing of instructions and the result of a run
never fold, because they are the evidence.

## The C you will meet

The kernels are short and use a small part of C. Everything in this table appears in them.

| You will read | It means | From |
|---|---|---|
| `int counter = 0;` | A variable: a named word of memory holding a number. | C |
| `int *p = &counter;` | `&counter` is the address of `counter`; `p` is a pointer, a variable holding that address. | C |
| `*p = 5;` | A store through the pointer: the variable `p` points at becomes five. | C |
| `void f(int *p)` | A function that receives a pointer, so it can read and write the caller's variable. | C |
| `static int seen;` | A variable or function visible only inside its file. The kernels mark their helpers static and leave the shared variables and the quoted functions visible, so that the fragments can name them. | C |
| `const int n` | A value the function promises not to change. | C |
| `struct node { int value; struct node *next; };` | A record with named fields. A pointer to one is how the structures of Part V link their nodes. | C |
| `uint32_t`, `int64_t` | Integers of a stated width, from `<stdint.h>`, so a word means the same on every target. | Library |
| `#include <stdatomic.h>` | The declarations of C's atomic operations. | Library |
| `_Atomic int counter;` | An atomic integer: every access to it is indivisible. What that buys, and what it does not, is [ch03](#atomic-operations). | C |
| `atomic_fetch_add_explicit(&counter, 1, memory_order_relaxed)` | Adds to an atomic variable as one indivisible step and returns the old value. The last argument names an ordering; [Part III](#part-memory-ordering) explains the orderings, and until then read it as "the weakest". | Library |
| `volatile int flag;` | Tells the compiler that every access to `flag` must happen as written. It does not make accesses indivisible, keeps them in order only with other volatile accesses in the same thread, and promises nothing about what another thread sees; [ch07](#the-compiler-is-part-of-the-story) shows what it is for and [ch08](#acquire-and-release) what it is not. | C |
| `#ifdef __wasm__` ... `#else` ... `#endif` | Conditional compilation: the lines between are compiled only when building for WebAssembly. The kernels use it to wait and wake in the way each platform offers; the name it tests is defined by the compiler. | C |
| `CM_EXPORT("cm_run")`, `CM_NOINLINE` | Macros from the book's own header, `experiments/cm.h`. The first makes a function callable from the page; the second keeps it out of line. Neither is C or concurrency. | Compiler |
| `(void)tid;` | Marks an argument as deliberately unused, so the compiler does not warn about it. | C |

## The words the first chapter leans on

Five words, a sentence each, because [ch01](#what-x-plus-plus-does) uses them before it can
stop to define them. Everything else, race and atomic and lock among them, arrives as the answer
to a question and is defined where it arrives.

- **Core.** The part of a processor that runs instructions. A machine with four cores runs four
  streams of instructions at once.
- **Thread.** One stream of instructions with its own registers and its own stack, run on a
  core. A process can have many, and they share the process's memory, which is the whole
  subject of this book. In the browser, a Web Worker is a thread.
- **Shared memory.** Memory that more than one thread can read and write. A variable in it is
  one word at one address, and every thread that holds the address reaches the same word.
- **Instruction.** The unit of work a core performs: load a word from memory into a register, add
  two registers, store a register to memory, compare, branch. One line of C becomes several.
- **Compiler.** The program that turns the C into instructions, choosing which and in what
  order within the rules the language sets. The book shows its output for four instruction sets
  and names the compiler and its flags every time.

Two pairs come up in passing. A **process** is a running program with memory of its own, and
its threads share that memory. The **stack** is where a thread keeps its local variables, one
stack per thread; the **heap** is memory handed out on request, reachable by every thread that
holds a pointer into it.

## Reading a listing

Every chapter shows what the compiler emitted, as one listing per instruction set. You do not
need to know an instruction set to read one. Here is `counter++` as clang emits it for AArch64:

```{include} chapters/_generated/counter-increment-aarch64.md
```

Read the middle three lines as the three steps of the increment: a load, an add, a store. The
rest is how a function reaches its variable and returns. The notation:

- A name ending in a colon, `increment:`, is a label: here, where the function starts.
- Each line is one instruction: its name first, then its operands, destination first. `ldr`
  loads, `add` adds, `str` stores.
- `x8`, `w9`, `eax`, `a0` are registers: a core's few named words of fast storage, where
  arithmetic happens.
- Square brackets, `[x8, :lo12:counter]` or x86-64's `[rip + counter]`, mean the memory at that
  address; RISC-V writes the same as `0(a0)`. The variable lives in memory, and the instructions
  that touch memory are the ones concurrency is about.
- Hover over any instruction for two lines: what it does, and why it matters to a program with
  more than one thread. [Appendix D](#reading-the-fragments) lists every instruction the book's
  listings use, with the same two lines.

The strip under the listing names four layers, and every listing carries it. The **language** is
the C above. The **compiler** is clang at the stated version and optimisation level; another
compiler or flag may choose other instructions, so every listing says *representative*. The
**instruction set** is what the instructions mean. The **microarchitecture** is the core that
runs them, which no listing shows. One of the four is set in relief: the layer this listing is
evidence for. The book keeps the four apart because a surprising result belongs to one of them,
and the habit to form is to ask which layer you are talking about before asking what the
processor does.

## How a chapter is laid out

Every chapter has the same ten sections, named in the [Preface](#preface). On a first reading
you need four of them: the question, the smallest program, the run, and the mental model. The
machine section shows the listings for four instruction sets; read the one for the machine in
front of you and leave the rest, and the tabs remember your choice. The *what this cannot tell
you* section is where the book says what the experiment did not prove, and is worth a glance
before you draw a conclusion of your own.

What you can always skip: a folded note, the instruction sets you do not care about, and the
*At a desk* commands, which are for readers who want the same experiment on their own machine
rather than in the browser. What you should not skip: a run. The page is built so that the
result comes from the kernel and not from the author, and a reader who presses *Run* is holding
the book to that.

## Where this starts

[ch01](#what-x-plus-plus-does) takes one line, `counter++`, and shows the three operations it
became and the instructions four targets run for it.
