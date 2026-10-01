---
title: The compiler is part of the concurrency story
---

(the-compiler-is-part-of-the-story)=
# The compiler is part of the concurrency story

:::{div}
:class: unwritten-note

This chapter is planned and not yet written. The outline below is the plan: the question it
answers and what it shows.
:::

## The question

Why can a program that reads a flag in a loop never see the flag change?

[To write: the paragraph that says why the previous chapter leaves this open.]

## The smallest program

[To write: the kernel, quoted from experiments/, that asks the question.]

## Run it

[To write: the experiment (compiler), and what to try.]

## What the source hides

[To write: the operations one line became.]

## At the machine

[To write: the instructions, from the generated fragments, for each target.]

## Fix one thing

[To write: the smallest change that addresses the problem.]

## Break it again

[To write: one guarantee removed, and what that shows.]

## The mental model

[To write: A loop the optimiser turned into a single load, the same loop with volatile, and the same loop with an atomic, each compiled and run.]

## What this cannot tell you

[To write: what the experiment and the fragments leave out.]

## Where to go next

[To write: primary sources.]
