# Authoring Guide

How to write a chapter of *Concurrency at the Metal* without breaking the three things that make
it worth reading: experiments that run the code the reader sees, assembly the build wrote from
that code, and claims a reader can check on their own machine.

## Quick start

```bash
make install     # Python packages, pinned MyST
make             # modules, fragments, traces and the site, into _build/html
make serve       # read it at http://127.0.0.1:8000, with live runs
make check       # exactly what CI runs
```

There is no live preview: re-run `make site` after an edit and reload the page. An edit to a
kernel needs `make lower` first; an edit to a trace program, `make traces`.

## The order to write in

Not the order the chapter is read in.

1. **The kernel.** The smallest C that asks the chapter's question, in `experiments/<name>/`,
   following `experiments/cm.h`. Run it natively first (`make native KERNEL=<name>`) and watch
   it do what the chapter will claim. Keep it readable: it is quoted whole or in pieces.
2. **The contract.** `experiment.json`: the controls that matter to the concept and nothing
   else, what each argument means, what each result is, which modes make sense, which functions
   the chapter will quote as assembly and at which optimisation level.
3. **The panel.** `web/lab/<name>.js`: live, trace and native, using the shell. The panel draws
   what the kernel reports and writes it on the mount element for the tests. If the chapter
   needs a trace, add its program to `programs.js` and its static tables to `tools/trace.mjs`.
4. **The checks.** The kernel's promises in `tests/threads.mjs`; the panel in
   `tests/browser/smoke.mjs`.
5. **The fragments.** `make lower`, then read them. If a fragment does not show what the chapter
   wants to say, change the kernel or the flags, not the prose.
6. **The prose**, last, to serve all of the above.

Writing the prose first produces a chapter that explains what you meant to build.

## The sections

`tools/outline.CHAPTER_SHAPE`, and not negotiable; `tests/test_book.py` fails a chapter that adds
or loses one. A section the chapter needs and the shape lacks is a `###` inside one of them.
*Break it again* may be left out where removing a guarantee would show nothing new.

**The question** is the outline's question, word for word, as the first line, then a paragraph on
why the previous chapter leaves it open. The opening names what the previous chapter established
and what it left; the Query Engine book's openers are the model.

**The smallest program** quotes the kernel, or the part of it the question is about, with a
paragraph before each quote saying what to look for. Lead with code: the audience reads C.

**Run it** embeds the `lab` block, fixing with `lock` any control the chapter is not about, then
a numbered list of things to try, each saying what to change and what to look for. Write it so a
reader who does each step in order discovers the chapter's point before being told it. Say which
mode each step uses. Where the result is nondeterministic, say what a reader on a single core,
or without a live run, should do instead (the trace, or the desk).

**What the source hides** expands the line into its operations, in words and, where it helps, a
`text` block of the operations. No C or assembly is pasted here: the kernel is quoted above and
the instructions come next.

**At the machine** includes the generated fragments, in an architecture tab set where there is one
per target, with a sentence per target saying what to look at. Say what is representative and
what is guaranteed: the instruction set's semantics are guaranteed, the choice of instruction is
the compiler's.

**Fix one thing** changes the smallest thing that addresses the problem and runs it again: the
same `lab` block with one setting changed, or the next kernel.

**Break it again** removes one guarantee and shows why it was there.

**The mental model** sits in a `:::{div}` with `:class: model`. It is a compact statement, a few
sentences or a short list, that later chapters can refer back to. Nothing in it is new.

**What this cannot tell you** is the easiest section to skip and the one that makes the others
believable. Name what the browser's timing does not measure, what the trace's model leaves out,
what the fragments do not promise, and which later chapter deals with each.

**Where to go next**: primary sources (the C standard's memory model, the architecture manuals,
the WebAssembly specification, the papers) and the next chapter.

## Rules with a check behind them

### Never type a number into prose

Lost updates, times, rates and retry counts come from the laboratory, live, or from a trace table
under `chapters/_generated/`, included with:

````markdown
```{include} _generated/counter-trace-alternate.md
```
````

Every table ends with the conditions it was computed under. `scripts/verify-numbers.py` fails on
a number with a unit, or any number of two or more digits, in prose. Counts written as words
("two threads") pass. A number that must be typed takes `% number-ok: <reason>` on the line
before its paragraph.

### Never paste code into prose

C is quoted from the kernel by text anchors:

````markdown
```{literalinclude} ../experiments/counter/counter.c
:language: c
:start-at: CM_NOINLINE void increment(void)
:end-before: CM_NOINLINE void increment_atomic
```
````

Anchor on text that will survive clang-format: a signature, a comment's first words. Never
`:lines:`. The MyST parse fails if an anchor stops matching. Assembly is included from a fragment
`tools/lower.py` wrote, and never edited:

````markdown
::::{tab-set}
:::{tab-item} x86-64
:sync: x86-64
```{include} _generated/counter-increment-x86-64.md
```
:::
:::{tab-item} AArch64
:sync: aarch64
```{include} _generated/counter-increment-aarch64.md
```
:::
::::
````

A tab set's keys all come from one group: `x86-64`, `aarch64`, `aarch64-lse`, `riscv64`, `wasm`,
or `c`, `rust`. The reader's choice follows them from page to page.

### Never fake the experiment

A panel draws what `cm_result` returned and what the clock measured. It never computes a count in
JavaScript, never shows a lost update the kernel did not lose, and never smooths a time. If a
panel needs a number, the kernel must report it. `tests/threads.mjs` holds every kernel to its
promises under Node, and `tests/browser/smoke.mjs` checks the drawn page.

### Say what is a model

The trace is a model of operations, not the compiled code. The fragment under every trace table
says so, and the panel's caption says so. Prose that describes a trace says *the model* or *the
trace*, never *the program*.

### Fold what is not the subject

The book assumes basic C and nothing else, so machinery a chapter uses without teaching gets a
folded note at its first appearance, labelled with where it comes from:

````markdown
:::{dropdown} Why does every quoted function carry CM_NOINLINE?
:class: compiler
`CM_NOINLINE` expands to an attribute that keeps the function out of line, so the chapter has a
separate function to show. It is not C and not concurrency; read past it.
:::
````

The class is one of `c`, `compiler`, `library`, `os`, `isa`, `hardware` or `deep`, and the
renderer refuses a note without exactly one. The label it prints tells the reader, before they
open the note, that this is not the subject of the page. A note says what the thing is, why the
kernel has it, and that it is incidental, in that order, and sends the reader to the chapter
that teaches it if one exists. Only notes fold. A kernel, a fragment or a result in a note is a
mistake: evidence is never optional.

The strip under every fragment names the four layers and sets one in relief: the layer the
listing is evidence for. The contract says which, per lowering, with `"layer": "compiler"`
(or `language`, `isa`, `microarchitecture`; `isa` when absent). A chapter that argues from
another layer around one include wraps it:

````markdown
:::{div}
:class: layer-compiler
```{include} _generated/counter-loop-x86-64.md
```
:::
````

Every mnemonic in a fragment carries two lines on hover, what it does and why it matters to a
program with more than one thread, from `tools/mnemonics.py`; the legend in Appendix D has the
same two columns. A new instruction in a fragment needs its entry there, or the build fails.

Terms the first chapter needs are on the *Before you start* page; every other term is defined
where the chapter that introduces it needs it, and the glossary says why the book needs it.

## What no check catches

Read the finished page as somebody who has read every chapter before it and none after, and
stop at:

- a sentence that states what *always* happens about a nondeterministic run;
- a sentence that says a WebAssembly instruction *becomes* or *is* a host instruction;
- a claim about the compiler that the fragment on the page does not show;
- a word used technically (*atomic*, *ordered*, *visible*, *coherent*) in two senses on one page;
- *the* in front of something the page has not introduced;
- the same argument made twice, far apart.

Then run STYLE.md's two passes.

## Definition of done

- [ ] Kernel merged, run natively, quoted by text anchor
- [ ] Contract complete, panel built, checks in `tests/threads.mjs` and `tests/browser/smoke.mjs`
- [ ] Fragments generated by `make lower` and read; each included with a sentence about it
- [ ] Every number from a live run or a generated table
- [ ] *What this cannot tell you* names the browser's, the model's and the fragments' limits
- [ ] Edited against STYLE.md, both passes
- [ ] The `[To write` markers gone, and `make check` clean
