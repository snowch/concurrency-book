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
- Published on GitHub Pages from main, with the Quality workflow green on every push.
- A ramp from basic C: the *Before you start* page, folded labelled notes where incidental
  machinery first appears, a four-layer strip under every fragment with the layer the listing
  is evidence for set in relief, and a legend appendix generated from the dictionary that also
  gives every mnemonic its two hover lines.
- A conceptual audit of every chapter by four independent readers, with the minimal edits that
  keep the language, the compiler, the instruction set and the microarchitecture apart, and
  every count from a run called one observation.
- The teaching machine, stage one: the trace model drawn as a machine a reader can look into
  (registers, program counter, store buffer, memory, and the program beside the C it mirrors),
  the same model and nothing more; and ch01 puts it first, before clang's fragments, with the
  two microscopes named.
- The teaching machine, stage two: cache lines in the model, where a program declares them, with
  a state per line per thread, invalidation on every write and a count of round trips; drawn in
  the machine and argued from in ch12 to ch14, where false sharing is two words on one line that
  the reader watches bounce. Every program now carries the C it mirrors.

## Next

1. A reader-led editorial pass: one systems expert asked to find every statement simplified
   enough to mislead, and one strong programmer without memory-model background asked only to
   say where they stopped understanding why something was true. The machines have checked
   what they can; this is what they cannot.
2. Run the experiments on an AArch64 device, a phone or an Apple laptop, through the browser and
   the native harness, and record what the ordering chapters show there; the book's biggest
   latent payoff, since x86-64 hides most of what Part III is about.
3. Run the smoke test in Firefox and in WebKit where a machine with them is available. The
   capability check and the fallback are written for both and have been exercised only in
   Chromium.
4. An "open the hood" appendix: how to print the machine code a browser's engine made from the
   same WebAssembly (V8 prints it when started with a flag), so the book's "representative"
   native fragments can be set beside what one engine did on one day.

## Open questions

- Whether to add Rust twins of the reclamation kernels (ch18), as PLAN.md allows, or keep the
  book in C throughout.
- A `.devcontainer/` for readers without clang 18, as the Parquet book has.
- Whether the contention sweep should remember its last result on the device, so a returning
  reader sees a chart before the run finishes.
