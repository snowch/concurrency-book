---
title: WebAssembly threads
---

(webassembly-threads)=
# WebAssembly threads

:::{div}
:class: unwritten-note

This chapter is planned and not yet written. The outline below is the plan: the question it
answers and what it shows.
:::

## The question

How does a web page run threads on shared memory at all?

[To write: the paragraph that says why the previous chapter leaves this open.]

## The smallest program

[To write: the kernel, quoted from experiments/, that asks the question.]

## Run it

[To write: the experiment (handshake), and what to try.]

## What the source hides

[To write: the operations one line became.]

## At the machine

[To write: the instructions, from the generated fragments, for each target.]

## Fix one thing

[To write: the smallest change that addresses the problem.]

## Break it again

[To write: one guarantee removed, and what that shows.]

## The mental model

[To write: A worker that sleeps on a word of shared memory and the notify that wakes it.]

## What this cannot tell you

[To write: what the experiment and the fragments leave out.]

## Where to go next

[To write: primary sources.]
