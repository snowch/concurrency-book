# NEXT_STEPS.md

The working list. PLAN.md says why; this says what is next.

## Done

- Reconnaissance of the three sibling books, and the decisions, in PLAN.md.
- The laboratory: a kernel compiled to WebAssembly with atomics, run on Web Workers sharing one
  memory, with a stack per worker; the service worker that isolates the page on GitHub Pages; the
  deterministic trace model; the shell with its three modes; the native harness.
- The build: fragments for four targets written by the pinned clang and checked in CI; trace
  tables written by the model and checked; the family's renderer and chrome.
- The vertical slice: `counter`, with ch01 to ch03.

## Next

1. Phase 3, the low-level stack: the `compiler` experiment (a loop at -O0 and -O2, with
   `volatile` and with an atomic), ch07, ch15, ch24.
2. Phase 4, the pattern experiments, each a kernel, a contract, a panel and its checks: `cas`,
   `spinlock`, `mutex`, `publication`, `store_buffer`, `sharing`, `stack`, `aba`, `reclamation`,
   `queue`, `rcu`, `contention`, `handshake`, `challenge`.
3. Phase 5, the chapters, in dependency order.
4. Phase 6, validation on Firefox and Safari where available; the fallback on each.

## Open questions

- Whether to add Rust twins of the reclamation kernels (ch18), as PLAN.md allows, or keep the
  book in C throughout.
- A `.devcontainer/` for readers without clang 18, as the Parquet book has.
