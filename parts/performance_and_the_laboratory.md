---
title: "Part VI: Performance and the browser laboratory"
---

(part-performance-and-the-laboratory)=
# Part VI: Performance and the browser laboratory

> How do these experiments run in a browser, and what do they measure?

Every chapter so far has run on the laboratory without saying how it works. This part turns the
laboratory into the subject. [ch21](#contention-and-scalability) adds workers to a shared
counter and watches the rate fall. [ch22](#webassembly-threads) shows how a page runs threads on
shared memory at all. [ch23](#build-a-concurrency-lab) takes the book's own laboratory apart,
kernel, module, workers and measurement. [ch24](#from-wasm-to-machine-code) draws the boundary
between a WebAssembly instruction and the one the processor runs. [ch25](#diagnose-the-race)
hands you a broken program and the whole book's model, and nothing else.

At the end of the part you can build an experiment of your own, and you know what a browser's
timing can and cannot tell you.
