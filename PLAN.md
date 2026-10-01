# PLAN.md: the argument, and the decisions

*Concurrency at the Metal* teaches concurrency from executable behaviour down to the instruction:
races, atomics, locks and memory ordering, run in the reader's browser, with the compiled code
beside the result. The reader never has to believe the author when the computer can show the
claim. This file holds why the book is shaped as it is. CLAUDE.md holds the rules the build
enforces; AUTHORING_GUIDE.md says how to write a chapter; STYLE.md is the editing checklist.

## 1. What the book is for

A technically strong engineer who knows C, Rust or another systems language, and uses mutexes and
concurrency libraries, but has never watched a counter lose increments or seen what `x++` compiles
to on three processors. The book's loop is:

```
QUESTION -> TINY PROGRAM -> RUN -> OBSERVE -> INSPECT -> EXPLAIN -> CHANGE ONE THING -> RUN AGAIN
```

The failure mode it avoids is the catalogue: a list of APIs and patterns before the reader has a
physical model of what the processor, the compiler and the cache hierarchy do. Spinlocks, mutexes,
lock-free stacks, queues and RCU appear only as answers to problems the reader has already run into.

## 2. What this book inherits, and from where

Three books by the same author share one architecture, and this one is the fourth. The survey
below is what is shared today and what each book keeps to itself, from reading the three
repositories (`snowch/parquet-book`, `snowch/query-engine-book`, `snowch/sizing-and-tco`).

### Shared by all three

- **MyST parses; the repository renders.** `myst build --site --strict` writes the parse to
  `_build/site/content/*.json` and resolves every cross-reference; a Python renderer
  (`tools/render.py`, `scripts/build-site.py`) turns the parse into flat HTML pages with the
  family's chrome. MyST's own theme is never used. The renderer raises on any node type it does not
  know, so new markup cannot vanish silently. Every URL in the site is relative, so one build works
  at a domain root and under a GitHub Pages project path.
- **The outline is data.** `tools/outline.py` holds the parts, the chapters, the question each
  answers and the experiments it uses. A chapter's number is its position; its identity is its
  slug; `myst.yml`'s toc must match it, and a test says so.
- **One chapter shape, held by tests.** Fixed `##` headings in a fixed order; a `[To write` marker
  makes a planned chapter show as *planned* in the navigation.
- **Experiments are fenced blocks.** A ```` ```lab ```` block of `key: value` lines becomes a
  mount point that `web/lab/lab.js` fills. Plain ES modules, no framework, no build step.
- **Nothing is typed that the build can compute.** `scripts/verify-numbers.py` refuses measured
  numbers in prose; generated fragments under `chapters/_generated/` carry a conditions line;
  `--check` modes fail CI when a committed fragment is stale. Code is quoted with
  `{literalinclude}` and text anchors, never pasted, never by line number.
- **The chrome and the palette.** Serif prose, sans furniture, the blue-grey palette with one
  meaning per accent, light and dark, a chapter rail and an outline rail, a theme button, prev and
  next links, a colophon naming the author and the licences, a stamp with the commit. The CSS is
  copied between the books with small changes, and so is the head script.
- **`scripts/ci-check.sh` is CI.** The Quality workflow runs it on every push; the Deploy workflow
  builds the site and publishes it with `actions/deploy-pages`. `make check` runs the same script.
- **The same documents.** CLAUDE.md (binding rules), AUTHORING_GUIDE.md, STYLE.md (the same
  checklist, adapted), PLAN.md, NEXT_STEPS.md, README.md, a CC BY-NC 4.0 licence for the prose and
  Apache 2.0 for the code, and a cover that names both.
- **Voice.** British English, the reader as *you*, short sentences, no em dashes, no *simply*,
  *just*, *obviously*, *basically*, no *In this chapter*; tests check the list.

### Specific to each

| | Parquet, byte by byte | Query engine | Sizing & TCO |
|---|---|---|---|
| What computes | A Rust reader compiled to WebAssembly, and its Python twin under Pyodide | A Python engine, run at build time; Pyodide recomputes on request | A Python sampler; stamped JSON results drive every figure |
| The experiment | A panel that draws the reader's JSON; no Run button, recomputes on change | A panel over build-time JSON, with predict-then-reveal | Sliders over a declared range; a viewer page in an iframe |
| Chapter shape | 7 headings: question, experiment, building it, limits, takeaways, problems, next | 10 headings, with *Observe*, *Predict, then measure*, *Compare* | 6 headings, with *The material* |
| Problems | Stubs graded by tests, in two languages, run in a workbench | Stubs graded by tests, run in a workbench | Stubs graded by tests, with a Check button |
| Figures | Generated tables; one hand-drawn cover SVG | Generated tables, box-drawn plans, a vendored monospace font | Generated SVG diagrams, each with a conditions line |

### What this book takes from each

- **From Parquet (the main DNA):** the renderer and chrome, the `lab` block, the outline module,
  `ci-check.sh`, the browser smoke test driven by Playwright, the relative-URL discipline, the
  service worker, and the rule that a panel is a view of the implementation, never an animation.
- **From Query Engine (the conceptual spine):** the dependency-driven order, where each chapter's
  opening says what the previous one left open; part pages that chain their chapters' questions;
  findings written as *claim in bold, then reason*; a glossary whose terms a test holds to the
  chapter that introduces them.
- **From Sizing & TCO (the controls):** declared ranges for every control, values the reader can
  move with the result updating beside them, side-by-side comparison of two settings, a conditions
  line under every figure, and the refusal to show a number the book did not produce.

### What is new here

The subject needs things none of the three have:

- **Real threads in the page.** Web Workers sharing one `WebAssembly.Memory`, running the same C
  kernel the book quotes, compiled by clang to WebAssembly with atomics. That needs cross-origin
  isolation, which GitHub Pages cannot set in headers; the service worker adds the two headers to
  every response and the page reloads itself once. A reader never sees this; CLAUDE.md documents
  it for maintainers, and ch22 teaches the part worth teaching.
- **Three modes for a nondeterministic result.** *Live*: the compiled kernel on real workers.
  *Trace*: a deterministic model of the operations under a chosen interleaving, so a lost update
  can be shown on a laptop with one core. *Native*: the commands that run the same kernel at a
  desk, under pthreads.
- **Generated assembly.** Every kernel is compiled by the build for wasm32, x86-64, AArch64 and
  RISC-V, and the functions a chapter names are quoted as fragments with a conditions line that
  gives the compiler, the version and the flags. The fragments are checked in CI like every other
  generated figure. The book never claims that a WebAssembly instruction *is* a host instruction:
  the native fragments show one concrete lowering; the browser's compiler makes its own.

## 3. The decisions (brief, section 13)

- **Language.** C first: it maps onto the hardware with the fewest layers, and `<stdatomic.h>`
  names the orderings the chapters are about. Rust appears where ownership and lifetimes explain
  something C cannot say as clearly (reclamation, ch18), as a second tab beside the C.
- **Assembly syntax.** Intel syntax for x86-64, labelled as such on every fragment.
- **Architectures.** x86-64, AArch64 and RISC-V, always together, so that x86's strong ordering
  is never mistaken for the model.
- **Browser.** Chromium first, where WebAssembly threads and `Atomics.waitAsync` are richest.
  Firefox and Safari run the same code; a browser without isolation or shared memory gets the
  trace mode and the native commands, and every page stays useful without them.
- **Measurement.** Browser timings for intuition, shown with the device's core count and the
  caveat that a browser is not a benchmark harness; native commands for anything serious.
- **Deployment.** GitHub stays the source of truth and GitHub Pages the host. The service worker
  approach is validated by the browser test in three configurations: headers from the server,
  headers from the service worker, and no isolation at all.

## 4. The order of the chapters

Dependency-driven: each chapter's question is one the previous chapter leaves open.

- **Part I, Instructions and races:** what one line becomes (ch01), what two threads do to it
  (ch02), what an atomic instruction fixes and does not (ch03), and the one primitive the rest is
  built from (ch04).
- **Part II, Building and breaking locks:** a lock out of test-and-set (ch05), why a production
  mutex is more (ch06), and the compiler's own reorderings (ch07).
- **Part III, Memory ordering:** publication with acquire and release (ch08), what relaxed keeps
  and drops (ch09), sequential consistency (ch10), fences (ch11).
- **Part IV, Hardware reality:** coherence (ch12), false sharing (ch13), store buffers (ch14), and
  three architectures side by side (ch15).
- **Part V, Lock-free algorithms:** a stack (ch16), ABA (ch17), reclamation (ch18), a queue
  (ch19), RCU (ch20).
- **Part VI, Performance and the laboratory:** contention (ch21), WebAssembly threads (ch22), how
  the lab is built (ch23), from Wasm to machine code (ch24), and a broken program to diagnose
  (ch25).

## 5. The phases

1. Reconnaissance: this file.
2. A vertical slice: the shell, the runtime, one kernel (`counter`) behind two experiences, a lost
   update with a deterministic trace and an atomic increment on real workers, ch01 to ch03, and
   the build and deploy path proved.
3. The low-level stack: generated assembly for four targets, the architecture tabs, native
   reproduction.
4. The pattern experiments: CAS, spinlocks, ordering litmus tests, false sharing, contention,
   lock-free structures, RCU.
5. The chapters, in dependency order, each with at least one runnable or deterministic experiment.
6. Validation: three isolation configurations in a headless browser, every assembly fragment
   qualified, no observed run presented as a guarantee.
