---
title: Lock-free stack
---

(lock-free-stack)=
# Lock-free stack

:::{div}
:class: unwritten-note

This chapter is planned and not yet written. The outline below is the plan: the question it
answers and what it shows.
:::

## The question

How can many threads push and pop one stack with no lock?

[To write: the paragraph that says why the previous chapter leaves this open.]

## The smallest program

[To write: the kernel, quoted from experiments/, that asks the question.]

## Run it

[To write: the experiment (stack), and what to try.]

## What the source hides

[To write: the operations one line became.]

## At the machine

[To write: the instructions, from the generated fragments, for each target.]

## Fix one thing

[To write: the smallest change that addresses the problem.]

## Break it again

[To write: one guarantee removed, and what that shows.]

## The mental model

[To write: A stack built on compare-and-swap, pushed and popped by workers, with every node accounted for.]

## What this cannot tell you

[To write: what the experiment and the fragments leave out.]

## Where to go next

[To write: primary sources.]
