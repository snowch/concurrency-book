---
title: WebAssembly threads
---

(webassembly-threads)=
# WebAssembly threads

## The question

How does a web page run threads on shared memory at all?

Every live run in this book has been real threads, in a page, sharing one memory, and no chapter
has said how. A web page's JavaScript runs on one thread by design, and for most of the web's
history it could not share memory with anything. What changed is three things, and this chapter
is about them: a worker, which is a second thread with no access to the page; a shared memory,
which both can read and write; and two instructions, which let a thread sleep on a word of that
memory and be woken by another. The kernel is the handshake that every lock in Part II relied
on, timed, so that the cost of a wake-up is a number you have seen on your own device.

## The smallest program

One worker says ping and waits for pong; the other waits for ping and says pong. Waiting by
sleeping:

```{literalinclude} ../experiments/handshake/handshake.c
:language: c
:start-at: /* Wait until the word reads at least `want`, sleeping
:end-before: /* Wait until the word reads at least `want`, spinning
```

Saying a word stores it and wakes whoever sleeps on it:

```{literalinclude} ../experiments/handshake/handshake.c
:language: c
:start-at: /* Say a word
:end-before: /* Two workers.
```

`cm_wait` and `cm_notify` are the two instructions, wrapped once for every kernel in
`experiments/cm.h`:

```{literalinclude} ../experiments/cm.h
:language: c
:start-at: #ifdef __wasm__
:end-before: #elif defined(CM_NATIVE_FUTEX)
```

:::{dropdown} Conditional compilation and the builtins
:class: compiler
`#ifdef __wasm__` compiles the lines up to `#elif` only when the target is WebAssembly; the name
is one clang defines for that target. `__builtin_wasm_memory_atomic_wait32` and its notify twin
are not functions in any library but names clang understands and turns straight into the two
instructions. A native build takes the next branch of the header, the futex of
[ch06](#from-spinlock-to-mutex), instead.
:::

## Run it

```lab
experiment: handshake
workers: 2
lock: workers
waiting: sleep and wake
```

Try these, in order:

1. **Run it.** Ten thousand round trips, every one completed, and *Per round trip* is the time
   for a ping and a pong: two wake-ups. On most devices it is several microseconds, which is a
   long time for a processor: a thread that is asleep is woken by the engine, which asks the
   operating system, which schedules it.
2. **Switch the waiting to *spin*.** With a core free for each worker, the same round
   trips in a fraction of the time, with spins instead of sleeps; with one core the spinner burns
   its slice, and the round trip is the scheduler's. A spinning worker sees the word change once
   the line arrives, the coherence latency of [ch12](#cache-coherence) on your device, with no
   scheduler involved; the spin counter it increments is on a line both workers want, and is in
   the time too.
3. **Open the deterministic trace.** With sleep and wake, a waiting worker takes no steps until
   the other's notify; with spinning, it takes a step per turn and changes nothing. Step it by
   hand and watch A fall asleep on pong and wake when B says it.
4. **Think about [ch06](#from-spinlock-to-mutex)'s trade-off** with these two numbers in hand. A
   critical section shorter than a wake-up is cheaper to spin through; a longer one is cheaper
   to sleep through; and the lock that spins a little and then sleeps is a bet on which.

## What the source hides

The source hides the three things the browser had to provide, and the book has been providing
without comment. First, a thread: a Web Worker, which runs a script of its own, with no access to
the page's document and no way to touch the page's variables. Second, a memory both can use: a
`WebAssembly.Memory` created shared, which both the page and every worker instantiate the kernel
against, so that the kernel's variables are the same bytes in every thread. The laboratory's
runtime creates one per run, gives each worker's instance a stack of its own inside it, and reads
the results from it when the workers are done; [ch23](#build-a-concurrency-lab) shows that code.

Third, a way to wait. A worker could spin, and the spin version does; but a lock whose waiters
burn a core each is [ch05](#test-and-set-and-spinlocks)'s problem, and a worker cannot sleep by
itself. So WebAssembly has `memory.atomic.wait32`: compare a word with an expected value and, if
they match, sleep until a `memory.atomic.notify` on the same address or a timeout. The compare is
atomic with the sleep, which is what makes [ch06](#from-spinlock-to-mutex)'s lost wake-up
impossible: a notify that lands between the compare and the sleep is seen, because there is no
between. The trace:

```{include} _generated/handshake-trace-sleep.md
```

And one thing the book has hidden on purpose until now. A browser hands a page shared memory only
when the page is cross-origin isolated, which means served with two headers: one cuts the page off
from windows of other origins that opened it or that it opens, the other forbids it to load
anything from another origin that has not agreed to be loaded. The reason is a class of timing
attacks, Spectre among them, that a shared memory and a fine clock make practical against anything
in the same process. The host this book is published on cannot send those headers, so the book's
pages install a service worker that adds them to every response and reload themselves once. You saw
none of that; a page that cannot be isolated offers its trace and its desk commands instead.
`CLAUDE.md` in the repository documents it for whoever maintains the book.

## At the machine

The sleeping wait and the say, in WebAssembly, where the two instructions are:

::::{tab-set}
:::{tab-item} WebAssembly
:sync: wasm
```{include} _generated/handshake-sleeping-wasm.md
```
:::
:::{tab-item} x86-64
:sync: x86-64
```{include} _generated/handshake-spinning-x86-64.md
```
:::
:::{tab-item} AArch64
:sync: aarch64
```{include} _generated/handshake-spinning-aarch64.md
```
:::
:::{tab-item} RISC-V
:sync: riscv64
```{include} _generated/handshake-spinning-riscv64.md
```
:::
::::

Find `memory.atomic.wait32` in `await_sleeping`: the address, the expected value, and the timeout
of minus one, forever, and a result the kernel drops. Find `memory.atomic.notify` in `say`, with
the count of waiters to wake, where the kernel asks for all of them. The native tabs show the
spinning wait, because on a native target a sleep is a call into the operating system, the
futex system call on Linux, and not an instruction at all; the harness makes that call and
[Appendix A](#reproducing-at-a-desk) runs it.

The spinning wait is a load in a loop on every target, with the acquire that
[ch08](#acquire-and-release) said a flag's load needs, so that whatever the other worker wrote
before saying the word is visible after it is seen. On x86-64 the acquire costs no instruction,
because the instruction set keeps loads in order; AArch64 shows `ldar`, and RISC-V a `fence r, rw`
after the `lw`.

## Fix one thing

The fix for a slow wake-up is not to need one: spin when the wait will be short, which is what the
spin version does, and what a production lock does before it sleeps. The fix for a burned core is
to sleep. The handshake kernel offers both and the panel's two numbers are the two sides. This
panel is locked to spinning, so no wake-up is in the per-round-trip time: what remains is the
word's journey between the two cores, and the spin counter both workers increment while they wait:

```lab
experiment: handshake
workers: 2
lock: workers, waiting
waiting: spin
```

## Break it again

Notify before storing. Say the word by waking the sleeper first and storing the round number
after, and the sleeper wakes, compares the word, finds the old value, and sleeps again, now with
nobody left to wake it. The kernel keeps the order, store then notify, and the trace lets you
see why by stepping: B's wait compares the word with what it expects, and sleeps only if nothing
has changed. The rule is the same one as ch06's: the store is the message; the notify is only a
nudge to look.

## The mental model

:::{div}
:class: model

**A page runs threads as Web Workers sharing one WebAssembly memory.** Each worker instantiates
the kernel against the same bytes; each has a stack of its own.

**Waiting is an instruction pair.** `memory.atomic.wait32` sleeps if the word still holds the
expected value, atomically; `memory.atomic.notify` wakes. The compare is what prevents a lost
wake-up.

**A wake-up costs microseconds; a spin costs a line's latency.** That gap is the whole reason
locks spin before they sleep.

**Shared memory needs isolation.** The browser grants it only to a cross-origin isolated page,
which the book's service worker makes every page into.
:::

## What this cannot tell you

**How the engine implements a wait.** It may park the thread in the operating system, spin briefly
first, or both. WebAssembly's promise is only that a waiting thread takes no steps until it is
woken or times out.

**The wake-up cost on your operating system.** The per-round-trip time is two wake-ups on this
device, this run, through this browser. The native harness measures the futex directly.

**What the page's own thread may do.** The main thread of a page may notify but may not wait;
the laboratory's runtime never calls the kernel's entry point on the page's thread for that
reason, and [ch23](#build-a-concurrency-lab) shows where.

## Where to go next

- **The specification.** The WebAssembly threads proposal, which added shared memories, the atomic
  instructions, and wait and notify.
- **The JavaScript side.** The ECMAScript specification's `SharedArrayBuffer` and `Atomics`
  objects, `Atomics.wait` and `Atomics.notify`, which are the same operations from JavaScript.
- **The isolation.** The HTML specification's cross-origin isolation, and the `Cross-Origin-Opener-Policy`
  and `Cross-Origin-Embedder-Policy` headers; Spectre, in Paul Kocher and others, *Spectre
  Attacks: Exploiting Speculative Execution*, IEEE S&P 2019, for why.
- **Next.** [ch23](#build-a-concurrency-lab) takes the laboratory apart.
