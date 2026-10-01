---
title: "Part II: Building and breaking locks"
---

(part-building-and-breaking-locks)=
# Part II: Building and breaking locks

> How does a lock come out of one atomic instruction, and what does it cost?

Part I ended with compare-and-swap, which can decide a contest between threads. This part uses
it to keep every other thread out. [ch05](#test-and-set-and-spinlocks) builds a spinlock from
test-and-set and measures who gets it and how long the rest burn.
[ch06](#from-spinlock-to-mutex) makes the waiting threads sleep instead, and shows what a
production mutex adds to an atomic variable and a loop.
[ch07](#the-compiler-is-part-of-the-story) turns to the compiler, which can hoist a load out of
a loop and make a thread wait forever for a flag it never reads again.

At the end of the part you know what a lock is made of, when spinning is the right choice, and
why `volatile` is not a concurrency primitive.
