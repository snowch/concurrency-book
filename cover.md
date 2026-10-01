---
title: Concurrency at the Metal
short_title: Cover
numbering: false
---

(cover)=
*Races, atomics, locks and memory ordering, run in your browser and read down to the instruction.*

A book for engineers who use mutexes and concurrency libraries every day and want to know what
happens underneath them. Each chapter asks one question, answers it with a program small enough
to read in one glance, runs that program on real threads in the page, and then shows what the
compiler made of it on x86-64, AArch64, RISC-V and WebAssembly. You change one thing and run it
again. Spinlocks, mutexes, lock-free stacks and RCU appear only once you have met the problem each
one solves. [Start with the Preface](#preface) to see how a chapter works and what you need to
run the programs at a desk.

![Two threads each load, add to and store one shared counter. Their operations interleave on one timeline, both read the same value, and the second store overwrites the first.](web/cover-hero.svg)

By Chris Snow, in collaboration with Claude (Anthropic)

% number-ok: the names of the two licences, which carry their version numbers
The prose and figures are under [CC BY-NC 4.0](https://github.com/snowch/concurrency-book/blob/main/LICENSE); the code is under [Apache 2.0](https://github.com/snowch/concurrency-book/blob/main/LICENSE-CODE).
