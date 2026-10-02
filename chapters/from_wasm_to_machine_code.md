---
title: From Wasm to machine code
---

(from-wasm-to-machine-code)=
# From Wasm to machine code

## The question

What happens between a WebAssembly atomic and the instruction the processor runs?

Every chapter has shown two kinds of fragment side by side: the WebAssembly the kernel runs in
the page, and the native assembly clang emits for the same C on x86-64, AArch64 and RISC-V. The
book has been careful to say that the second is not what the browser runs. This chapter says what
is. Between the WebAssembly and the processor is the browser's engine, which compiles the
WebAssembly to machine code of its own, at load time or as the code runs, and makes its own
choices. The chapter draws that boundary, says what crosses it unchanged and what does not, and
explains why a book about instructions can still be honest while running on a layer it cannot
see through.

## The smallest program

The atomic increment of [ch03](#atomic-operations), one more time, because it is the smallest
program with an atomic in it:

```{literalinclude} ../experiments/counter/counter.c
:language: c
:start-at: /* One increment of the atomic counter
:end-before: /* Two atomic operations
```

## Run it

```lab
experiment: counter
workers: 4
operation: atomic
```

Try these, in order:

1. **Run it.** Exact, as always. Now ask what instruction made it exact. The honest answer is in
   two parts: the WebAssembly instruction, `i32.atomic.rmw.add`, which is what the kernel says;
   and a host instruction the engine chose, which the page cannot show you, because the engine
   does not say.
2. **Pick the WebAssembly tab under *At the machine*, then each native tab.** Those are the
   candidates: what clang would emit for a native build. The engine's compiler is not clang and
   owes it nothing; on x86-64 it will almost certainly emit a `lock` prefixed instruction too,
   because there is no other way to keep the promise, but which instruction and around what
   registers is its choice.
3. **Compare *plain* and *atomic* again, by time.** The difference is real on every host, and the
   ratio is the engine's and the hardware's together.
4. **Go back to [ch10](#sequential-consistency)'s panel** and recall the result this boundary
   produced: relaxed and release-acquire atomics could not show the store-buffer outcome in the
   browser, because WebAssembly has only sequentially consistent atomics, so the engine had to keep that
   order on the host, whatever instruction it chose. The boundary is not only a translation; it is a loss of distinctions
   the C had.

## What the source hides

WebAssembly is a target like x86-64 is a target, with one difference: no processor executes it. A
processor executes machine code; a WebAssembly engine translates WebAssembly to machine code and
then the processor executes that. The translation happens in your browser, on your device, for the
host you have, which is why the book can run on a phone and a laptop from one file.

What crosses the boundary unchanged is meaning. `i32.atomic.rmw.add` means: add, atomically,
with sequentially consistent ordering. The engine must emit machine code with that meaning, on
whatever host, or the engine is wrong; the WebAssembly specification is the contract, and the
book's live results depend on it being kept. What does not cross unchanged is form. The engine
picks the instructions, the registers, whether to inline, whether to compile the function at all
before running it the first time, and the exact fence or prefix that keeps the ordering promise
on this host. Two engines on one machine may differ; one engine may compile a function twice,
first quickly and then well.

Two consequences follow for the book. First, the native fragments are representative in the precise
sense the conditions line under each says: one real compiler's lowering of the same C for a native
target, which shows the mechanism, such as the `lock` prefix or the exclusive pair, without being
the browser's code. Second, WebAssembly's own instruction set is a memory model of its own, with
sequentially consistent atomics and plain accesses that promise no order, as
[ch15](#x86-is-not-the-model) tabulated, and some of C's distinctions are gone before the engine
sees the code.

## At the machine

::::{tab-set}
:::{tab-item} WebAssembly
:sync: wasm
```{include} _generated/counter-increment-atomic-wasm.md
```
:::
:::{tab-item} x86-64
:sync: x86-64
```{include} _generated/counter-increment-atomic-x86-64.md
```
:::
:::{tab-item} AArch64
:sync: aarch64
```{include} _generated/counter-increment-atomic-aarch64.md
```
:::
:::{tab-item} AArch64 (LSE)
:sync: aarch64-lse
```{include} _generated/counter-increment-atomic-aarch64-lse.md
```
:::
:::{tab-item} RISC-V
:sync: riscv64
```{include} _generated/counter-increment-atomic-riscv64.md
```
:::
::::

Read the WebAssembly first this time. Two constants and one instruction: the address, the operand,
and `i32.atomic.rmw.add`, whose result is dropped. That is what the kernel is. The four native tabs
are four answers to "what might the engine emit", each what clang emits for a native build, and the
AArch64 pair shows that the answer depends on more than the architecture: with the LSE extension it
is one instruction, without it a loop, and an engine can choose at load time by asking the
processor what it has what it has.

To see what your engine emitted, you would need the engine's own tools: V8, Chromium's engine,
prints the machine code its WebAssembly compilers produce when started with a flag, and the other
engines have equivalents. The book does not run them, because what they show changes with every
browser release, and a fragment that is true for one version of one engine on one day is the kind
of claim this book refuses to make.

## Fix one thing

The fix for not knowing the host instruction is to stop needing to know it: write to the
language's model and let each layer keep its promise. The book's claims are of that kind. "An
atomic add loses nothing" is true because the C standard promises it, the compiler keeps it in
WebAssembly, and the engine keeps it in machine code, and the live run shows all three keeping
it. "This is three instructions on AArch64" is a claim about one compiler's native lowering, and
the fragment says so.

This panel runs the plain increment, whose failure crosses every boundary too: the C promised
nothing, the WebAssembly promised nothing, the engine kept that non-promise, and the processor lost
updates. Every layer kept its word.

```lab
experiment: counter
workers: 4
operation: plain
lock: operation
```

## Break it again

Assume the mapping. Decide, from the x86-64 fragment, that a relaxed atomic is a plain `mov`, and
reason about the browser's behaviour from that: the conclusion is wrong, because the WebAssembly
has no relaxed atomic and the engine had to emit whatever keeps sequential consistency on the host.
Or decide, from the WebAssembly, that a plain store is "only a store" on every host, and port a
program that relies on x86-64's ordering to a phone, where the engine may emit a plain `str` that
AArch64 reorders freely, after its own optimiser has had its turn. Each is the boundary read as if
it were not there.

## The mental model

:::{div}
:class: model

**WebAssembly is compiled, not executed by a processor.** The browser's engine translates it to machine code for
the host, with choices of its own.

**Meaning crosses the boundary; form does not.** An atomic add is an atomic add on every host.
Which instruction, and with what around it, is the engine's.

**WebAssembly is its own memory model.** Atomics are sequentially consistent, and plain accesses promise no order, so what you see is whatever the engine and then the host allow. Some of C's distinctions are gone before the engine sees them.

**Native fragments show a mechanism, not the browser's code.** They are one compiler's lowering,
labelled, and the book claims nothing more for them.
:::

## What this cannot tell you

**What your engine emitted.** Only the engine's own tools can, and the answer changes with
versions. The book's fragments are for understanding the mechanism; your engine's dump is for
debugging your engine.

**Which engine you have.** Chromium, Firefox and Safari compile WebAssembly differently, and
tier their compilation differently. A kernel that is correct is correct on all three, because the meaning is; what a race loses, and the times, are each run's own.

**Whether a plain WebAssembly access can be torn.** Aligned accesses of the natural size are
atomic in practice on every host; the specification's wording is weaker. The book's plain
accesses are aligned words.

## Where to go next

- **The specification.** The WebAssembly Core Specification, and the threads proposal's memory
  model, which defines what an engine must keep.
- **The engines.** V8's documentation on its baseline and optimising WebAssembly compilers;
  SpiderMonkey's and JavaScriptCore's equivalents, which describe tiering.
- **The model.** Conrad Watt, Andreas Rossberg and Jean Pichon-Pharabod, *Weakening WebAssembly*,
  OOPSLA 2019, on how WebAssembly's memory model relates to C's and the hosts'.
- **Next.** [ch25](#diagnose-the-race) hands you a broken program.
