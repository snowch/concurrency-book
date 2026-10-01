# Concurrency at the Metal

An interactive technical book about low-level concurrency, for engineers who use mutexes and
want to know what is under them.

Each chapter asks one question, answers it with a C function small enough to read in one glance,
runs that function on real threads in your browser (Web Workers sharing one WebAssembly memory),
shows the instructions clang emits for it on x86-64, AArch64, RISC-V and WebAssembly, and changes
one thing. Races, atomics, locks, memory ordering, cache coherence and lock-free algorithms each
arrive as the answer to a problem you have already run into on the page.

Nothing in the browser is a scripted animation: a count on the page was read from the kernel's
shared memory, and every block of assembly was written by the build from the function above it,
with the compiler and flags stated under it. Where a browser withholds shared memory, every
experiment offers a deterministic trace and the commands to run the same kernel on pthreads.

## Build and read it

```bash
git clone https://github.com/snowch/concurrency-book
cd concurrency-book
make install    # one-off: Python packages, pinned MyST
make            # modules, fragments, traces, site
make serve      # http://127.0.0.1:8000
```

You need clang 18 with its WebAssembly linker (`apt install clang-18 lld-18`), Python 3.11+, and
Node.js 22. `make check` runs everything CI runs, including the experiments in a headless browser
if Playwright is installed.

## Run a kernel at a desk

```bash
make native KERNEL=counter
native/build/counter 4 1000000 0     # four workers, a million plain increments each
native/build/counter 4 1000000 1     # the same, atomic
```

## What is here

| Path | |
|---|---|
| `experiments/` | the kernels, one directory each, with a contract that declares controls, results and the functions to quote |
| `web/lab/` | the browser laboratory: runtime, workers, shell, trace model, one panel per experiment |
| `native/` | the kernels on pthreads |
| `chapters/`, `parts/`, `appendices/` | the book, in MyST markdown |
| `chapters/_generated/` | assembly fragments and trace tables the build writes and CI checks |
| `tools/`, `scripts/`, `tests/` | the renderer, the build, and the checks |

## Status

The laboratory, the build and the first three chapters (one increment, two threads, atomic
operations) are in place and checked in a headless browser in three isolation configurations.
The remaining chapters are planned in `tools/outline.py` and marked *planned* in the navigation;
see `PLAN.md` for the plan and `NEXT_STEPS.md` for what comes next.

## Contributing

Read `CLAUDE.md` first: it holds the rules the build enforces. Then `AUTHORING_GUIDE.md` and
`STYLE.md`.

## Licence

The text is CC BY-NC 4.0. The code is Apache 2.0.
