---
title: "Part I: Instructions and races"
---

(part-instructions-and-races)=
# Part I: Instructions and races

> What does one line of code become, and what happens when two threads run it?

This part starts at the smallest thing the book has: one increment of one variable.
[ch01](#what-x-plus-plus-does) compiles it and reads the operations it became.
[ch02](#two-threads-one-variable) gives the same line to two threads and loses increments, first
in a trace you control and then on real workers. [ch03](#atomic-operations) replaces the three
operations with one that cannot be split, and asks what that does and does not fix.
[ch04](#compare-and-swap) meets the one primitive the rest of the book is built from: change a
value only if it is still what you last saw.

At the end of the part you can look at a line of C, say which operations it hides, and say
whether two threads running it can disagree about the result.
