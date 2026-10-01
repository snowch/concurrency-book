---
title: "Part V: Lock-free algorithms"
---

(part-lock-free-algorithms)=
# Part V: Lock-free algorithms

> What can threads share with no lock at all, and what does that cost them?

Every part so far has needed compare-and-swap. This one builds data structures from it.
[ch16](#lock-free-stack) builds a stack that many threads push and pop with no lock.
[ch17](#the-aba-problem) breaks it: a compare-and-swap that succeeds because the value came back,
not because nothing changed. [ch18](#memory-reclamation) shows the problem removing a lock
creates about when memory may be reused. [ch19](#lock-free-queue) builds a queue for many
producers and many consumers. [ch20](#rcu) lets readers never wait at all, and makes the writer
wait instead.

At the end of the part you know why lock-free code is harder than locked code, and which of its
difficulties are about ordering, which about ABA and which about lifetime.
