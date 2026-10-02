---
title: Build a concurrency lab in the browser
---

(build-a-concurrency-lab)=
# Build a concurrency lab in the browser

## The question

What does it take to run a C kernel on real threads in a page, and measure it?

[ch22](#webassembly-threads) named the three things a browser provides. This chapter shows the
code that uses them, which is the book's own laboratory, so that a reader who wants to run an
experiment the book does not have can build one. The pieces are short: a header every kernel
includes, a compiler invocation, a runtime that makes a memory and some workers, a worker that
gives its instance a stack, and a harness for the same kernel at a desk. Nothing in them is
specific to counters; every experiment in the book runs through the same code.

## The smallest program

A kernel is a C file that exports four functions. The header says which, and provides the start
barrier every kernel waits at:

```{literalinclude} ../experiments/cm.h
:language: c
:start-at: /* Keep a function out of line
:end-before: #endif
```

The kernel of [ch01](#what-x-plus-plus-does), which is among the smallest in the book, is the whole
of a kernel: a variable, a function or two, and the four exports:

```{literalinclude} ../experiments/counter/counter.c
:language: c
:start-at: /* a: increments per worker
:end-before: /* Result 0
```

## Run it

The counter again, because this chapter is about how it runs, not what it counts.

```lab
experiment: counter
workers: 4
operation: atomic
```

Try these, in order:

1. **Run it and watch the foot of the panel.** *Starting workers*, then *running*, then *done*.
   The first is the runtime creating a memory and four workers and waiting for each to say it is about to call into the kernel; the second is the kernel; the third is the results being read out of the
   shared memory.
2. **Compare *Elapsed* with the per-worker times in the note.** *Elapsed* is from the barrier
   opening to the last worker's report; each worker's own time is from its call into the kernel,
   which includes its wait at the barrier. An early worker's time can exceed *Elapsed* by the time the later
   workers took to start; the difference is the runtime's own latency, small against a run of a
   million increments and large against a run of a thousand.
3. **Set the increments to a thousand and run several times.** The times jump about, because the
   run is now shorter than the wake-ups and the messages around it. That is why the book's
   experiments default to counts in the hundreds of thousands, and why
   [ch21](#contention-and-scalability) said to read ratios rather than numbers.
4. **Switch to the deterministic trace and then to the desk commands.** The three modes are the kernel compiled to WebAssembly on workers, a model written by hand to mirror it, and the kernel compiled for pthreads: two views of the same code and one of a model.

:::{dropdown} What pthreads are
:class: library
POSIX threads: the C library's interface for creating threads and waiting for them, which the
native harness uses to run a kernel's `cm_run` on real operating-system threads. The kernel never
calls it; the harness does, which is why the same C runs on Web Workers and on pthreads
unchanged. [Appendix A](#reproducing-at-a-desk) has the commands.
:::

## What the source hides

Three things the kernel's source does not show.

**The compile.** clang compiles the kernel for the `wasm32` target with the atomics and
bulk-memory features, links it with a shared, imported memory and no entry point, and exports the
stack pointer. The shared memory is what makes threads possible at all; the last flag is what makes them safe, and the next paragraph says why. The build script in the repository, `tools/lower.py`, holds the exact flags, and
[Appendix A](#reproducing-at-a-desk) prints them.

**The stack.** A WebAssembly module keeps the part of its C stack that needs an address, arrays and
locals whose address is taken, in linear memory, with a global that points at the top. Every
instance of the module starts with the same value in that global. Two workers instantiating the
same module on the same memory would therefore share one stack and corrupt each other's locals,
which is a bug that shows up as nothing in particular. The linker exports the global and each
worker sets it to a region of its own before calling anything:

```{literalinclude} ../web/lab/worker.js
:language: javascript
:start-at: self.onmessage
:end-before: };
```

:::{dropdown} What `__stack_pointer` and `__heap_base` are
:class: compiler
Two names the linker, `wasm-ld`, gives the module: a global holding the top of the C stack, and
the address where the kernel's data ends and free memory begins. The build asks the linker to
export both, so the runtime can place a stack per worker above the data. They are the
toolchain's conventions, not part of C or of WebAssembly itself.
:::

**The barrier.** Workers are created one after another and take different times to start; a run
that began when each worker was ready would have the first worker finishing before the last had
begun. So every kernel waits at the barrier in `cm_run`, each worker tells the page as it is about
to call into the kernel, where its first act is to sleep at the barrier, and the page opens the
barrier once all have reported; a worker that arrives late finds the flag set and goes straight
through:

```{literalinclude} ../web/lab/runtime.js
:language: javascript
:start-at: await Promise.all(ready);
:end-before: const results = [];
```

The page's own thread never calls `cm_run`, because a page's thread may not wait, and `cm_run`'s
first act is to wait. It instantiates the module once, which lays out the kernel's data, calls
`cm_reset`, and reads the results when the workers are done.

## At the machine

The kernel's entry point in WebAssembly, where the barrier is two instructions and the loop is
the call the chapters have been reading:

```{include} _generated/counter-run-wasm.md
```

`i32.atomic.load` reads the barrier's flag; `memory.atomic.wait32` sleeps on it with the expected
value zero and no timeout; the loop after it calls `increment_atomic` or `increment` as the
arguments say. `cm_go`, which the runtime calls and the header above defines, is a release store of
one and the notify [ch22](#webassembly-threads) showed. Every kernel in the book begins with this
block, because every kernel includes the header.

## Fix one thing

The runtime's one fix worth copying is the stack. Without it, every experiment in the book runs
and most of them pass most of the time, which is the worst kind of bug. The symptom, when it
appears, is a worker whose local variables change under it, which looks like a race in the
kernel and is a race in the runtime. The fix is one line in the worker, and one linker flag to
make the line possible.

The harness at a desk needs no such fix, because pthreads give each thread a stack, and that is
the shape of the whole difference between the two: a web page has to build, in a few dozen
lines, what an operating system provides:

```{literalinclude} ../native/c/harness.c
:language: c
:start-at: static void *worker(void *p)
:end-before: static double now_ms
```

## Break it again

Set every worker's stack pointer to the same value, which is what happens with the line removed,
and run a kernel whose functions keep locals on the stack. The counter kernel keeps none, so it
would survive, which is why the symptom hides. The queue kernel of [ch19](#lock-free-queue) keeps
an array of sixteen last-seen values per consumer on its stack, and would report nonsense. A
laboratory is itself a concurrent program, and the book's checks drive every kernel on real threads
under Node and in a browser for exactly that reason.

## The mental model

:::{div}
:class: model

**A kernel is four exports and a barrier.** Reset, run, result, go. The barrier makes every run
begin together.

**The runtime makes one memory and many instances.** Each worker instantiates the module on the
shared memory and gives itself a stack; the page's thread instantiates once and never waits.

**Timing is wall time from go to the last report.** It includes the runtime's own latency, and it
is honest only for runs long enough to dwarf it.
:::

## What this cannot tell you

**The engine's behaviour.** How the browser compiles the WebAssembly, schedules the workers and
implements a wait is the engine's business, and differs between browsers and versions.

**What a production runtime adds.** A thread pool instead of fresh workers per run, a message
protocol for results richer than an integer, and a way to stop a kernel that will not stop. The
book's runtime terminates workers at a timeout, which is the crudest possible stop.

**Anything the kernel does not report.** The runtime reads integers through `cm_result`. A
kernel that wants to report a histogram reports it one integer at a time.

## Where to go next

- **The code.** `web/lab/runtime.js` and `web/lab/worker.js` in the repository, and
  `tools/lower.py` for the compile; `tests/threads.mjs` runs every kernel the same way under Node.
- **Emscripten's threads.** The Emscripten documentation on pthreads support, which builds the
  same machinery, with a real libc, for programs larger than a kernel.
- **The linker.** The LLVM `wasm-ld` documentation, on `--shared-memory`, `--import-memory` and
  the exports a threaded module needs.
- **Next.** [ch24](#from-wasm-to-machine-code) draws the line between the WebAssembly the kernel
  runs and the machine code the processor does.
