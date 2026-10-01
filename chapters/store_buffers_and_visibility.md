---
title: Store buffers and visibility
---

(store-buffers-and-visibility)=
# Store buffers and visibility

:::{div}
:class: unwritten-note

This chapter is planned and not yet written. The outline below is the plan: the question it
answers and what it shows.
:::

## The question

Why does another core not see a store the moment it happens?

[To write: why the previous chapter leaves this open.]

## The smallest program

[To write: the kernel, quoted from experiments/, that asks it.]

## Run it

[To write: the experiment (store_buffer), and what to try.]

## What the source hides

[To write: the operations one line became.]

## At the machine

[To write: the instructions, from the generated fragments, for each target.]

## Fix one thing

[To write: the smallest change that addresses the problem.]

## Break it again

[To write: one guarantee removed, and what that shows.]

## The mental model

[To write: A store that sits in a buffer while the load after it runs, observed on x86-64.]

## What this cannot tell you

[To write: what the experiment and the fragments leave out.]

## Where to go next

[To write: primary sources.]
