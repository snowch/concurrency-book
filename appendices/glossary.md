---
title: Glossary
---

(glossary)=
# Glossary

Each term is defined where a chapter first uses it; this is the list, with the chapter.

**Atomic operation.** An operation that other threads see as one indivisible step: either it has
not happened or it has, never half. [ch03](#atomic-operations)

**Data race.** Two threads accessing the same variable, at least one writing, with nothing to
order them. In C it is undefined behaviour; in WebAssembly it has a defined but weak meaning.
[ch02](#two-threads-one-variable)

**Lost update.** An increment that another thread's store overwrote: both read the same old
value, both wrote the same new one. [ch02](#two-threads-one-variable)

**Read-modify-write.** An operation that reads a value, computes from it and writes the result.
Plain, it is three steps; atomic, it is one. [ch01](#what-x-plus-plus-does)

**Shared memory.** Memory more than one thread can read and write. In the laboratory, one
WebAssembly memory every worker's instance imports. [ch02](#two-threads-one-variable)

**Worker.** A thread in the laboratory: a Web Worker running the kernel on the shared memory.
[ch02](#two-threads-one-variable)
