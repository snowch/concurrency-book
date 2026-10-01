---
title: The experiments
---

(the-experiments)=
# The experiments

Every experiment is a directory under `experiments/`: a kernel in freestanding C, a contract
(`experiment.json`) that declares its controls, its results, its modes and the functions the
chapters quote as assembly, and a panel under `web/lab/` that draws what the kernel reports.
The same kernel runs in the page, compiled to WebAssembly, and at a desk, on pthreads
([Appendix A](#reproducing-at-a-desk)).

Every kernel exports the same four functions, so one runtime runs them all:

```{literalinclude} ../experiments/cm.h
:language: c
:start-at: Every kernel exports
:end-before: #ifndef CM_H
```

## counter

*A shared counter.* Every worker increments one shared counter, with a plain increment or an
atomic one, and the page compares what the counter holds with what it should.
Used by [ch01](#what-x-plus-plus-does), [ch02](#two-threads-one-variable),
[ch03](#atomic-operations), [ch23](#build-a-concurrency-lab) and
[ch24](#from-wasm-to-machine-code).

| | |
|---|---|
| Controls | workers; increments per worker; operation (plain or atomic) |
| Arguments | `a` increments per worker; `b` 1 for the atomic increment, 0 for the plain one |
| Results | result 0, the plain counter; result 1, the atomic counter |
| Modes | live, trace, at a desk |

## The others

The experiments the later chapters use are listed here as each is written: a compare-and-swap
loop, a spinlock, a sleeping lock, the compiler's loop, publication through a flag, the
store-buffer test, shared and padded counters, a lock-free stack, ABA, reclamation, a queue, RCU,
contention, the wait-and-notify handshake, and the final challenge.
