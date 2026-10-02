---
title: Relaxed atomics
---

(relaxed-atomics)=
# Relaxed atomics

## The question

What does an atomic operation still guarantee when it promises nothing about order?

[ch08](#acquire-and-release) ended with a relaxed flag that failed to carry its data on a weakly
ordered processor, and with a browser that could not show the failure. Relaxed is the ordering
this book has used since [ch03](#atomic-operations), on a counter that was exact every time.
Both are correct. A relaxed atomic promises three things and withholds a fourth, and the
counter needed only the three. This chapter names them, shows the fourth missing in the trace,
and reads the instructions that make relaxed the cheapest atomic there is.

## The smallest program

The reader's loop from ch08, relaxed:

```{literalinclude} ../experiments/publication/publication.c
:language: c
:start-at: CM_NOINLINE int receive_relaxed
:end-before: CM_NOINLINE int receive_acquire
```

and the writer's:

```{literalinclude} ../experiments/publication/publication.c
:language: c
:start-at: CM_NOINLINE void publish_relaxed
:end-before: CM_NOINLINE void publish_release
```

Compare them with the volatile versions above them in the kernel. The only textual difference
is the word `atomic` and the ordering argument.

## Run it

```lab
experiment: publication
workers: 2
lock: workers
ordering: relaxed
```

Try these, in order:

1. **Run it.** No stale reads, in this browser, however long you run. Do not conclude anything
   yet: *At the machine* shows that the WebAssembly the kernel runs has no relaxed store or load
   to emit, so the relaxed version got the strong instructions.
2. **Switch to *volatile*.** Stale reads return, because the compiler reordered the volatile
   version's stores and left the relaxed version's alone. Relaxed did not promise that order: the compiler may move a plain store past a relaxed store of another variable, and here it chose not to. What relaxed promises is that the atomic accesses themselves are neither folded, hoisted nor reordered against each other.
3. **Open the deterministic trace** with *relaxed* and the writer's stores reaching memory *flag
   first*. The model lets a relaxed flag overtake the data, as a weakly ordered processor does,
   and a stale read follows. The trace is the only place in this browser where relaxed's missing
   promise is visible.
4. **Go back to [ch03](#atomic-operations)'s counter**, which is relaxed, and recall that it was
   exact under every schedule. A counter needs atomicity and nothing else, and relaxed gives it.

## What the source hides

A relaxed atomic operation promises:

- **Atomicity.** The operation is indivisible, as [ch03](#atomic-operations) showed: a
  read-modify-write cannot be split, and a load or store cannot be torn.
- **The compiler's honesty.** The compiler treats the variable as shared. Every access in the
  source is an access in the code; none is hoisted, folded or removed; and, on this one variable,
  none is reordered against another access to it.
- **One order per variable.** Every thread sees the stores to a single atomic variable in the
  same order, the variable's modification order, and no thread sees an older value after it has
  seen a newer one. This is coherence, and [ch12](#cache-coherence) shows the hardware that
  provides it.

And it withholds one thing: any relationship with any other variable. A relaxed store of the flag
says nothing about the data stored before it. A relaxed load of the flag says nothing about a
load of the data after it. The trace shows what that permits:

```{include} _generated/publication-trace-reordered.md
```

The three promises are exactly what a counter, a statistics field or a progress indicator needs:
each increment lands, the compiler cannot lose one, and every thread agrees on the sequence of
values. They are exactly what a flag that announces other data does not need, because the flag's
job is the relationship relaxed withholds.

## At the machine

The reader's loop, relaxed against acquire. Look at what each target charges for the difference:

::::{tab-set}
:::{tab-item} x86-64
:sync: x86-64
```{include} _generated/publication-receive-x86-64.md
```
:::
:::{tab-item} AArch64
:sync: aarch64
```{include} _generated/publication-receive-aarch64.md
```
:::
:::{tab-item} RISC-V
:sync: riscv64
```{include} _generated/publication-receive-riscv64.md
```
:::
:::{tab-item} WebAssembly
:sync: wasm
```{include} _generated/publication-receive-wasm.md
```
:::
::::

On **AArch64** the relaxed loop spins on `ldr` and the acquire loop on `ldar`. `ldr` is the
ordinary load; nothing about it tells the processor to hold later loads back, and it is the
cheapest instruction on the page. **RISC-V** charges a `fence r, rw` after the acquire load and
nothing for the relaxed one. On **x86-64** the two are the same `mov`: the processor orders
loads against later loads whether asked or not, so relaxed and acquire cost the same and the
distinction lives only in the compiler. On **WebAssembly** both are `i32.atomic.load`, because
the instruction set has one atomic load and it is the strong one.

The writer's side is in [ch08](#acquire-and-release)'s fragments: a relaxed store is a plain
`str` on AArch64, a plain `sw` on RISC-V, a plain `mov` on x86-64.

So a relaxed load or store costs what a plain one costs, on every target where an aligned word is already atomic, which is all of them. A relaxed read-modify-write still pays for its atomicity, as ch03's lock prefix showed. What you buy with it is the compiler's
honesty and the one order per variable; what the processor adds is nothing, on these instructions;
the page does not time them.

## Fix one thing

The fix is to use each ordering for what it promises. A counter that nobody reads to learn about
other data: relaxed, as ch03's is. A flag that says other data is ready: release and acquire, as
ch08's is. This panel runs the relaxed counter's cousin, the relaxed flag, and is locked so you can
set the trials and watch the stale count, which is the promise relaxed does not make. The promise
it keeps, an exact count under contention, is ch03's panel, while the stale count is the promise it
does not make:

```lab
experiment: publication
workers: 2
lock: workers, ordering
ordering: relaxed
```

## Break it again

The trace already broke it: a relaxed flag with the stores reordered. The live run cannot, in this
browser. That gap between what a program may do and what it did on one machine is the most
dangerous thing in this book. A program with a relaxed flag passes every test on x86-64 when the
compiler happens to keep the stores in order, as this one did, because the architecture then keeps
them in order too; it passes every test in this browser, because WebAssembly's atomics are all
strong; and it fails on a phone, where AArch64's `str` and `ldr` owe it nothing. The fix was never
to find the machine that shows the failure. It was to ask the language for the order, and let each
target pay for it as the fragments show.

## The mental model

:::{div}
:class: model

**Relaxed promises three things.** Atomicity of each operation; the compiler's honesty about the
variable being shared; and one modification order per variable that every thread sees.

**Relaxed withholds one thing.** Any relationship with any other variable.

**A relaxed load or store costs what a plain one costs.** `str`, `ldr`, `mov`, `sw`: the same instructions. The
promises are kept by the compiler and by coherence, not by a fence.
:::

## What this cannot tell you

**Whether a relaxed program is correct.** Correct uses of relaxed are counters and statistics
that no other data depends on. The test is whether any thread reads the variable to decide to
read something else. The kernel cannot run that test for you.

**What relaxed does on this browser's host.** The WebAssembly atomics are strong, and the engine
emits strong host instructions for them, whichever host. The native fragments are the only view
of the weak case.

**Coherence's cost.** One order per variable is cheap to promise and expensive to provide when
many cores write the same word. [ch12](#cache-coherence) and [ch21](#contention-and-scalability).

## Where to go next

- **The standard.** ISO C, section 7.17.3, `memory_order_relaxed`, and section 5.1.2.4 on
  modification order and coherence.
- **The arguments about it.** Hans Boehm and Brian Demsky, *Outlawing Ghosts: Avoiding
  Out-of-Thin-Air Results*, MSPC 2014, on what relaxed should not be allowed to do and the
  trouble in saying so.
- **A practitioner's view.** Jeff Preshing's essays on acquire and release semantics and on
  relaxed atomics, which pair the standard's words with the instructions.
- **Next.** [ch10](#sequential-consistency) asks for the strongest ordering, and finds that
  acquire and release were not it.
