---
title: Reproducing at a desk
---

(reproducing-at-a-desk)=
# Reproducing at a desk

## In your browser

Nothing to install. Every experiment runs in the page: the kernel the chapter quotes, compiled
to WebAssembly, on Web Workers sharing one memory. A run is one observation on your device. Run it
again and the numbers move, which is the point.

A browser grants shared memory only to a page served under two headers, and the book's pages
arrange that for themselves on first visit. If a page says a live run is not available, the
browser withheld shared memory; the deterministic trace and the commands below are the same
experiment by other means.

## The same kernel on pthreads

Every kernel in `experiments/` is freestanding C that compiles natively. The harness
`native/c/harness.c` includes a kernel, runs `cm_run` on as many pthreads as you ask for, opens
the start barrier, and prints every result the kernel reports with the wall time:

```bash
git clone https://github.com/snowch/concurrency-book
cd concurrency-book
make native KERNEL=counter
native/build/counter 4 1000000 0     # four workers, a million plain increments each
native/build/counter 4 1000000 1     # the same, atomic
```

The arguments after the worker count are the kernel's `a`, `b` and `c`; each experiment's page
says what they mean, and [Appendix B](#the-experiments) lists them. The time the harness prints
is a wall-clock measurement of one run on your machine, under whatever else it was doing. Treat
it as a comparison between two settings of one kernel, not as a benchmark.

To see what the ordering chapters' tests do on your machine in one go, run
`scripts/desk-report.sh`. It builds the store-buffer, the publication and the counter kernels
and prints a table of what one run showed under every ordering each page offers. On x86-64 the
store-buffer outcome is the one reordering the instruction set allows, so expect it under
volatile, relaxed and release-acquire and never under seq_cst or a fence; the publication test's
stale read is forbidden there by the instruction set, so it can come only from the compiler. On
AArch64 both tests can show their outcomes under volatile and relaxed, and the table is where
to look. The repository's *On AArch64* workflow runs the same script on an Arm runner on every
push to main, and keeps its table as the job's summary: one observation on one machine, like
yours.

## The instructions, for yourself

The fragments in the chapters were written by `tools/lower.py` with clang 18 at the flags each
fragment states. To see the same assembly, or more of it:

```bash
clang --target=x86_64-unknown-linux-gnu -O2 -ffreestanding -S -masm=intel -o - experiments/counter/counter.c
clang --target=aarch64-unknown-linux-gnu -O2 -ffreestanding -S -o - experiments/counter/counter.c
clang --target=riscv64-unknown-linux-gnu -march=rv64gc -O2 -ffreestanding -S -o - experiments/counter/counter.c
clang --target=wasm32 -O2 -matomics -mbulk-memory -ffreestanding -nostdlib -S -o - experiments/counter/counter.c
```

To disassemble a native build instead of reading the compiler's assembly:

```bash
clang -O2 -c -o counter.o experiments/counter/counter.c
llvm-objdump -d --x86-asm-syntax=intel counter.o
```

Another compiler, another version or another set of flags will emit different instructions for
the same source. The book's claims are about mechanisms, and the fragments show one concrete
lowering of each; they are not a promise about your compiler.

## What you need

- clang 18 with `wasm-ld` (the LLVM WebAssembly linker). On Debian and Ubuntu:
  `apt install clang-18 lld-18`. The build refuses any clang other than clang 18.1 for the fragments for the fragments,
  because they are checked byte for byte; the native harness builds with any recent clang or gcc.
- Python 3.11 or later, with the packages in `requirements.txt`.
- Node.js 22 and the pinned MyST, for the book itself: `make install`.

From a fresh clone, `make` compiles the kernels, regenerates the fragments and the traces, and
renders the site into `_build/html`; `make serve` serves it with the headers the live runs need;
`make check` runs everything CI runs, including the experiments in a headless browser if
Playwright is installed.
