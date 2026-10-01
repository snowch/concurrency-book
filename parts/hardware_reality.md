---
title: "Part IV: Hardware reality"
---

(part-hardware-reality)=
# Part IV: Hardware reality

> What is the machine doing that the memory model describes?

Part III described orderings as rules. This part shows the machinery the rules describe.
[ch12](#cache-coherence) passes one cache line between cores and times it.
[ch13](#false-sharing) puts two unrelated counters on one line and watches them slow each other
down. [ch14](#store-buffers-and-visibility) catches a store sitting in a buffer while the load
after it runs, on the processor most readers have. [ch15](#x86-is-not-the-model) puts x86-64,
AArch64 and RISC-V side by side and shows that the strong one is the exception.

At the end of the part you can explain a surprising result by naming the piece of hardware that
produced it.
