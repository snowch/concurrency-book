---
title: "Part III: Memory ordering"
---

(part-memory-ordering)=
# Part III: Memory ordering

> When does one thread's write become visible to another, and in what order?

Part II left a question open: an atomic flag said *ready*, and the data it announced was not
there. [ch08](#acquire-and-release) names the orderings that make a flag carry its data with it.
[ch09](#relaxed-atomics) takes them away and shows what an atomic operation still guarantees
with no ordering at all. [ch10](#sequential-consistency) asks for the strongest ordering and
shows what changes in the generated code. [ch11](#fences) separates a fence from an atomic
read-modify-write, which are not the same thing however often they are confused.

At the end of the part you can read `memory_order_acquire` and say what the compiler and the
processor each owe you for it.
