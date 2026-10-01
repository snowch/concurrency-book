---
title: From spinlock to mutex
---

(from-spinlock-to-mutex)=
# From spinlock to mutex

:::{div}
:class: unwritten-note

This chapter is planned and not yet written. The outline below is the plan: the question it
answers and what it shows.
:::

## The question

Why is a production mutex more than an atomic variable and a loop?

[To write: the paragraph that says why the previous chapter leaves this open.]

## The smallest program

[To write: the kernel, quoted from experiments/, that asks the question.]

## Run it

[To write: the experiment (mutex), and what to try.]

## What the source hides

[To write: the operations one line became.]

## At the machine

[To write: the instructions, from the generated fragments, for each target.]

## Fix one thing

[To write: the smallest change that addresses the problem.]

## Break it again

[To write: one guarantee removed, and what that shows.]

## The mental model

[To write: A lock that sleeps instead of spinning, and the cost of each when the holder is slow.]

## What this cannot tell you

[To write: what the experiment and the fragments leave out.]

## Where to go next

[To write: primary sources.]
