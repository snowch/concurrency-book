---
title: The C after Kernighan and Ritchie
---

(the-c-after-kernighan-and-ritchie)=
# The C after Kernighan and Ritchie

The kernels are plain C in shape: the C of *The C Programming Language*, which is the C most
readers learnt, with variables, pointers, functions, structures and the preprocessor used as
that book uses them. On top of it they use a short list of things that came later, and this
appendix is that list and nothing more. Every row is something a kernel in this book uses; the
tables are generated from a dictionary in the repository that a check holds to the kernels, so a
construct cannot appear in the code without appearing here, and nothing is listed that the code
does not use.

The second column says what the construct is: the name, the shape of the call, the header that
declares it. It does not say what the construct is for. What an atomic read-modify-write buys,
why a load is acquire and a store release, and what `volatile` fails to promise are the
chapters' to teach, and the third column says which. A reader with Kernighan and Ritchie and
this page can read every kernel; a reader who wants to know why the kernels are written as they
are reads the chapters.

## From C99

The 1999 standard added integer types of a stated width, which the kernels use so that a word
is the same size on x86-64, AArch64, RISC-V and WebAssembly, and two conveniences the kernels
lean on: a function defined in a header and expanded in place, and a loop variable declared
where the loop starts.

```{include} ../chapters/_generated/cdict-c99.md
```

## From C11

The 2011 standard gave C a memory model, and with it atomic types and operations. Every
operation the kernels use is the `_explicit` form, which takes an ordering as its last
argument; the plain forms, without the suffix, are the same operations with
`memory_order_seq_cst` assumed. The orderings are the subject of [Part III](#part-memory-ordering),
and until then every `memory_order_relaxed` in a kernel can be read as "atomic, and nothing
more".

```{include} ../chapters/_generated/cdict-c11.md
```

## What clang adds

Two attributes, two builtins and two predefined macros, none of them C. The kernels hide the
attributes behind the macros `CM_NOINLINE` and `CM_EXPORT` from `experiments/cm.h`, so that a
compiler without them could define the macros as nothing; the builtins are the only way to say
"this WebAssembly instruction" from C, and the header uses them inside `#ifdef __wasm__` so that
the same file compiles natively.

```{include} ../chapters/_generated/cdict-compiler.md
```

## One idiom

```{include} ../chapters/_generated/cdict-idiom.md
```

## What is not here

Threads. Kernighan and Ritchie's C had none, and C11's `<threads.h>` is not used either: in the
browser a thread is a Web Worker that the page creates, and at a desk it is a pthread the native
harness creates, so no kernel ever starts a thread. The kernel is the function every thread
runs, and how the threads come to exist is [ch23](#build-a-concurrency-lab)'s
subject and [Appendix A](#reproducing-at-a-desk)'s.
