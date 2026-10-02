# CLAUDE.md

Project instructions for anyone, human or AI, working on this book. They are binding.

## What this is

*Concurrency at the Metal*: an interactive technical book about low-level concurrency, for
engineers who want to know what is underneath the primitives they use. It assumes basic C and
nothing else, and ends at atomics, memory ordering, cache coherence and machine instructions. Each chapter asks one question,
answers it with a C function small enough to read in one glance, runs that function on real
threads in the reader's browser, shows the instructions four compiler targets emit for it, and
changes one thing. Races, atomics, locks, memory ordering, cache coherence and lock-free
algorithms each arrive as the answer to a problem the reader has already run into.

Read **PLAN.md** for the argument and the settled decisions, **AUTHORING_GUIDE.md** before
writing or editing a page, and **STYLE.md** while editing. **NEXT_STEPS.md** is the working list.

The architecture follows `snowch/parquet-book`, which follows `snowch/sizing-and-tco`: MyST
parses, the repository renders, every number is generated or live, code is quoted rather than
pasted, and the interactive panel is a view of the implementation. What differs is what runs:
freestanding C kernels, compiled by clang to WebAssembly with atomics for the page and to
assembly for the chapters, and run on Web Workers sharing one memory.

## Architecture

```
                          THE BOOK (chapters/*.md)
                                    │
                 ┌──────────────────┴──────────────────┐
            explanation                            experiment
     {literalinclude} of a kernel              ```lab block in a page
     {include} of a generated fragment                  │
                 └──────────────────┬──────────────────┘
                                    │
                experiments/<name>/<name>.c   (the kernel: freestanding C)
                experiments/<name>/experiment.json   (its contract)
                                    │
        ┌───────────────┬───────────┼─────────────────┬───────────────────┐
        │               │           │                 │                   │
  tools/lower.py   tools/lower.py   web/lab/      native/c/harness.c   tools/trace.mjs
  --target=wasm32  -S for x86-64,   runtime.js    the kernel on        the deterministic
  → lab/<name>.wasm aarch64, riscv64 workers on     pthreads, at a desk  model, one table
        │           → chapters/     one shared                          per schedule
        │             _generated/   memory                              → chapters/_generated/
        └───── web/lab/<name>.js draws what the kernel reports ─────────┘
```

| Path | What it is |
|---|---|
| `experiments/cm.h` | What every kernel includes: the four exports, the start barrier, wait and notify for Wasm and for native. |
| `experiments/<name>/` | One experiment: the kernel (`<name>.c`) and its contract (`experiment.json`: controls, arguments, results, modes, the functions to quote as assembly, the native example). |
| `web/lab/` | The browser half: `lab.js` mounts, `shell.js` draws the common shell, `runtime.js` and `worker.js` run a kernel on workers sharing one memory, `trace.js` is the deterministic model and `trace-view.js` its stepper, `programs.js` holds the traces' programs, `<name>.js` is each experiment's panel. Plain ES modules, no framework, no build step. |
| `native/c/harness.c` | The kernels on pthreads: `make native KERNEL=<name>`. |
| `tools/` | `outline.py` (the book's shape), `experiments.py` (the contracts), `lower.py` (kernels to Wasm and to fragments), `trace.mjs` (trace tables), `render.py` (MyST's parse to HTML), `highlight.py`. |
| `scripts/` | Build and check entry points. `ci-check.sh` is what CI runs; `serve.py` serves with the headers live runs need. |
| `chapters/`, `parts/`, `appendices/`, `index.md`, `cover.md` | The book, in MyST markdown. |
| `chapters/_generated/` | Fragments written by `tools/lower.py` and `tools/trace.mjs`. Never edited by hand. |
| `web/book.css`, `web/lab/lab.css` | The site's stylesheet and the laboratory's. |
| `tests/` | The book's rules (`test_book.py`), the renderer, the contracts, the kernels on Node threads (`threads.mjs`), and `browser/smoke.mjs`, which drives Chromium in three isolation configurations. |

## Build, run, test

```bash
make install     # Python packages, pinned MyST; clang 18 and lld come from your system
make             # modules, fragments, traces, site: _build/html
make serve       # http://127.0.0.1:8000, with the headers live runs need
make test        # pytest, then the kernels on Node worker threads
make check       # ./scripts/ci-check.sh: exactly what CI runs
```

Always run `make check` before pushing. It runs, in order: ruff, clang-format (if installed), the
WebAssembly build, the fragment check, the trace check, the number check, the MyST parse, the
site render, the link check, pytest, the kernels on Node threads, and the headless browser test.

## How the pieces talk

**MyST parses; this repository renders.** `scripts/parse-book.sh` runs `myst build --site --strict`,
which writes the parse to `_build/site/content/*.json` and resolves every cross-reference.
`scripts/build-site.py` renders the parse through `tools/render.py`, which raises on any node
type it does not handle.

**A kernel is one C file that compiles three ways.** `tools/lower.py` compiles it for `wasm32`
with `-matomics -mbulk-memory` and links it with `--shared-memory --import-memory`, exporting
`__stack_pointer` so each worker can give its instance a stack of its own; and it compiles the
same file with `-S` for x86-64 (Intel syntax), AArch64 (with and without LSE) and RISC-V, cutting
out the functions the contract names and writing each as a fragment with a conditions line.
`native/c/harness.c` includes the same file and runs it on pthreads.

**Every kernel has the same four exports** (`experiments/cm.h`): `cm_reset`, `cm_run(tid, a, b, c)`,
`cm_result(i)` and `cm_go`. `web/lab/runtime.js` makes one shared `WebAssembly.Memory` per run,
instantiates the module once on the page (which lays out the data) and once per worker, waits for every worker to say it is about to call `cm_run`, whose first act is to sleep on the kernel's barrier, calls `cm_go`, and reads the
results when the last worker reports. The timing is wall time from `cm_go` to the last report.

**Experiments are fenced blocks.** A page embeds one with:

````markdown
```lab
experiment: counter
workers: 1
lock: workers
```
````

`tools/render.py` validates the experiment against its contract (every key is a control, every
value is one the control allows, `mode` is one the experiment offers, `lock` names controls) and
emits a mount point holding the contract as JSON. `web/lab/lab.js` builds the shell and imports
`web/lab/<name>.js`, which fills the shell's panels: live, trace and native.

**Three modes, because the result depends on the machine.** *Live* runs the compiled kernel on
real workers. *Trace* runs `web/lab/trace.js`, a model of the operations, under a schedule the
reader picks or steps by hand; the same model under Node writes the static tables the chapters
include. *Native* prints the commands for the harness. A page offers live only when the browser
grants shared memory, and says why when it does not.

## How the browser runs threads

For maintainers; readers are not burdened with it, and ch22 teaches the part worth teaching.

A browser creates a shared `WebAssembly.Memory` only in a cross-origin isolated page: one served
with `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp`
on the page and on everything it loads. GitHub Pages sends no custom headers. So
`scripts/build-site.py` writes a service worker (`sw.js`) that adds both headers to every
same-origin response, and the head script of every page registers it and, if the page is not yet
isolated and the worker has just taken control, reloads once (guarded by `sessionStorage`, so a
browser that refuses to isolate never loops). After that one reload every page of the book is
isolated, offline too, since the same worker keeps a copy of the site. `scripts/serve.py` sends
the headers itself, so a local build runs live at once; `--no-isolation` serves as Pages does.
`tests/browser/smoke.mjs` drives all three cases: headers from the server, headers from the
worker, and no isolation with service workers blocked, where the page must stay useful.

The book loads nothing from another origin (no CDN, no web fonts), so `require-corp` costs it
nothing. Keep it that way: a cross-origin resource without a CORP header breaks under it.

## The invariants

1. **The interactive UI is a view of the implementation, never a scripted animation.** A count on
   the page was read from the kernel's shared memory after the workers finished. A time is wall
   time on the reader's device, and the page says so. JavaScript draws; it never computes a
   result a kernel reports. The one exception is the trace, which is a model, and every trace says it is a model and not the compiled code. The page draws that model as a teaching machine (registers, program counter, store buffer, memory, program); the machine view is a view of `web/lab/trace.js` and adds no semantics, scheduler, interpreter or expected results of its own, and its programs are written by hand to mirror a kernel, never presented as compiler output.
2. **No number typed into prose.** Lost updates, times, rates and retry counts come from a live
   run, from a trace table under `chapters/_generated/`, or from the reader's own device.
   `scripts/verify-numbers.py` fails the build otherwise. A number that must be typed takes
   `% number-ok: <reason>` before its paragraph.
3. **No code pasted into prose.** C is quoted with `{literalinclude}` and `:start-at:` /
   `:end-before:` text anchors, never `:lines:`; assembly is `{include}`d from a generated fragment.
   A pasted `c`, `asm` or `wasm` block fails `tests/test_book.py`.
4. **Every fragment states its conditions.** Compiler, version, target, optimisation level,
   syntax, and the word *Representative*. `tools/lower.py --check` holds every fragment to the
   pinned clang; a fragment that drifted from its conditions line is the one lie this book cannot
   afford.
5. **Four things are kept apart**: the language's memory model, the compiler, the instruction
   set, and the microarchitecture. A surprising result is attributed to one of them by name.
   The book never says that a WebAssembly instruction *is* a particular host instruction: the
   native fragments are one concrete lowering of the same C, and the browser's compiler makes its
   own.
6. **A run is one observation.** Nondeterministic results are shown as what happened on this
   device this time, never as what always happens. A chapter that needs a result to be certain
   uses the trace.
7. **The page stays useful without a live run.** Every chapter reads, and every experiment offers
   its trace or its native commands, where shared memory is withheld.
8. **Incidental machinery never blocks the concept.** Anything on a page that is not the
   chapter's subject (an attribute, a macro, a library call, a system call, an assembler
   directive) is explained at its first appearance in a folded note labelled with where it comes
   from: `c`, `compiler`, `library`, `os`, `isa`, `hardware` or `deep`. The renderer refuses a
   note without a label. The kernel, the fragments and the results never fold.

## Adding things

**A chapter.** It is already in `tools/outline.py` with its question, what it shows and its
experiments; `myst.yml`'s toc matches, and `tests/test_book.py` checks it. `make chapter` writes a
skeleton for any chapter without a page. Then follow AUTHORING_GUIDE.md: kernel first, then the
contract and the panel, then the fragments, then the prose. A chapter's number is its position;
its identity is its slug. Never put a chapter number in a slug, label or file name.

**An experiment.** A directory `experiments/<name>/` with the kernel and `experiment.json`
(`tools/experiments.py` says what the contract must hold); its name in `tools/outline.EXPERIMENTS`
and in some chapter's `experiments`; a panel `web/lab/<name>.js` exporting `mount(shell)`; a trace
program in `web/lab/programs.js` if it offers a trace (with `src` on the first operation of each
group, the kernel line it mirrors), and its tables and any listing in `tools/trace.mjs`; its
checks in `tests/threads.mjs` and `tests/browser/smoke.mjs`; and an entry in Appendix B. `make lower`
writes the fragments the contract's `lowerings` ask for.

**A fragment.** Add a lowering to the contract (functions, optimisation level, targets), run
`make lower`, and `{include}` the fragment, in an architecture tab set where there is one per
target.

## Coding conventions

- **C kernels:** freestanding, `<stdatomic.h>` and `<stdint.h>` only, no allocation, no I/O.
  Readable before fast: this code is quoted in a book. Every shared variable says in a comment
  what it is for. `CM_NOINLINE` on a function the chapter quotes as a fragment, so its
  instructions are its own. clang-format with the repository's `.clang-format`. A construct
  beyond Kernighan and Ritchie's C (a C99 or C11 feature, a clang attribute or builtin, a
  predefined macro) needs an entry in `tools/cdict.py`, which generates Appendix E; the build
  fails on one it does not know, and on an entry no kernel uses.
- **JavaScript:** plain ES modules, no framework, no build step. It moves bytes and draws what
  the kernel reports.
- **Python tooling:** the renderer, the scripts and the tests. `python3 -m pytest`, ruff clean.
- **Comments** say why, in full sentences, as in the sibling repositories.

## Book-writing conventions

British English, direct, active voice, short sentences, the reader as *you*. No em dashes. No
"In this chapter". No *simply*, *just*, *obviously*, *basically*: `tests/test_book.py` enforces
the list. Every chapter has the headings in `tools/outline.CHAPTER_SHAPE` (*Break it again* may
be left out where removing a guarantee would show nothing new). STYLE.md is the checklist; run
both of its passes over a page before finishing it.

Product and vendor names appear only where the book describes a specific implementation's
behaviour (what clang 18 emits; what Chromium allows). The book never recommends a vendor.

Every fragment carries a four-layer strip (language, compiler, instruction set,
microarchitecture) with the layer the listing is evidence for set in relief; the contract names
that layer per lowering (`"layer"`, `isa` by default) and a chapter can wrap one include in a
`layer-<name>` div to argue from another. Every mnemonic carries two hover lines, what it does
and why it matters here, from `tools/mnemonics.py`; a kernel change that brings a new
instruction into a fragment must add its entry there, or the build fails. Appendix D is
generated from the same dictionary.

## Things that break the build

- Renaming or reformatting a line a `{literalinclude}` anchors on. Search `chapters/` for the text.
- Changing a kernel so an instruction moves, without `make lower`.
- Changing the trace model or a program, without `make traces`.
- Another clang major version (`tools/lower.py` refuses it: set `CLANG`).
- A new MyST directive or node type without a branch in `tools/render.py`.
- A root-relative URL (`/lab/...`) anywhere in a page: the site is served under a base path.
- A resource from another origin: the embedder policy blocks it.
