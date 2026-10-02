# NEXT_STEPS.md

The working list. PLAN.md says why; this says what is next.

## Done

- Reconnaissance of the three sibling books, and the decisions, in PLAN.md.
- The laboratory: a kernel compiled to WebAssembly with atomics, run on Web Workers sharing one
  memory, with a stack per worker; the service worker that isolates the page on GitHub Pages; the
  deterministic trace model; the shell with its three modes; the native harness.
- The build: fragments for four targets written by the pinned clang and checked in CI; trace
  tables written by the model and checked; the family's renderer and chrome.
- The sixteen experiments, each a kernel, a contract and a panel, with a trace program wherever
  the outcome depends on the schedule, and a check in `tests/threads.mjs` and in the browser
  smoke test.
- The twenty-five chapters and the three appendices, in dependency order, each with a runnable
  or deterministic experiment and the fragments its claims rest on.
- Validation in headless Chromium: live with server headers, live through the service worker,
  the trace fallback when the service worker is blocked, and the phone width.

## Next

1. Run the smoke test in Firefox and in WebKit where a machine with them is available. The
   capability check and the fallback are written for both and have been exercised only in
   Chromium.
2. Read the book end to end on a phone, in both themes, for what the smoke test cannot see.
3. Publish: turn on GitHub Pages for the repository with GitHub Actions as the source, so
   `deploy.yml` serves `_build/html`.
4. Run the native harness on an AArch64 machine and add what it observes to the experiments
   appendix, which so far reports observations from an x86-64 machine only.

## Open questions

- Whether to add Rust twins of the reclamation kernels (ch18), as PLAN.md allows, or keep the
  book in C throughout.
- A `.devcontainer/` for readers without clang 18, as the Parquet book has.
- Whether the contention sweep should remember its last result on the device, so a returning
  reader sees a chart before the run finishes.
