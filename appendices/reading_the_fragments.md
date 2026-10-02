---
title: Reading the fragments
---

(reading-the-fragments)=
# Reading the fragments

Every listing in this book was written by the build from the kernel above it, by clang at the
version and flags stated under it. This appendix is the legend: the notation of each instruction
set, and for every instruction the listings use, what it does and why it matters to a program
with more than one thread. The second line is the one to read: a load is the moment a thread's
view of a word is taken, a store is what another thread may see, an atomic read-modify-write is
the step nothing can get between, and arithmetic in a register is invisible to everyone else.
The same two lines appear when you hover over an instruction in any listing, because both come
from one dictionary in the repository, `tools/mnemonics.py`, and the build fails if a listing
uses an instruction the dictionary does not know.

## Four layers, every time

Under every listing a strip names four things, because a listing is evidence about exactly one
of them. The **language** is the C kernel above it, with the meaning C gives it. The
**compiler** is clang at the stated version and optimisation level; another compiler, or the
same one with other flags, may choose other instructions, which is why every listing says
*representative*. The **instruction set** is what each instruction means and what the
architecture allows a core to reorder. The **microarchitecture** is the core that runs the
instructions, with its caches and buffers; no listing shows it, and the timings in the
experiments are its only trace. One of the four is set in relief: the layer the listing is evidence
for, which is the instruction set unless the chapter is making a point about the compiler's
choice, about what the C asked for, or about a cost that the instructions do not show. When a
result surprises, the chapter names which of the four is responsible.

## x86-64

Intel syntax, destination first: `mov eax, dword ptr [rip + counter]` loads the 32-bit word at
`counter` into the register `eax`, and `mov dword ptr [rip + counter], eax` stores it back.
`rax` to `r15` are 64-bit registers; `eax` is the low 32 bits of `rax`, and writing it clears the
high half. `rip` is the instruction pointer, so `[rip + counter]` is an address relative to the
code, which is how a global variable is reached. `rsp` is the stack pointer, `rbp` the frame
pointer when there is one, and `rdi` and `rsi` carry the first two arguments. `cmp` and `test` set
the flags that the conditional jumps read. A `lock` prefix on a read-modify-write instruction is
the book's main interest here.

```{include} ../chapters/_generated/legend-x86-64.md
```

## AArch64

Destination first: `ldr w8, [x9]` loads into `w8` from the address in `x9`, and `str w8, [x9]`
stores. `x0` to `x30` are 64-bit registers and `w0` to `w30` their low 32 bits; `x0` to `x7` carry
arguments and the result, `sp` is the stack pointer, and `wzr` or `xzr` reads as zero. `adrp`
followed by `add` forms a global variable's address. Memory ordering shows in the instruction
names: `ldar` and `stlr` are the acquire and release forms of `ldr` and `str`, and `ldxr` with
`stxr` is the pair that makes an atomic read-modify-write without the LSE extension, where
`ldadd` and `cas` do it in one instruction.

```{include} ../chapters/_generated/legend-aarch64.md
```

## RISC-V

Destination first: `lw a1, 0(a0)` loads the 32-bit word at the address in `a0`, plus an offset
of zero, into `a1`, and `sw a1, 0(a0)` stores it. `a0` to `a7` carry arguments and results, the `t`
registers are temporaries, the `s` registers are kept across calls, `sp` is the stack pointer and
`zero` reads as zero. A `.w` or `.d` suffix is the width, 32 or 64 bits; `.aq` and `.rl` on an
atomic instruction mean acquire and release; `lr` and `sc` are the reserve-and-conditional pair,
and `amoadd` and `amoswap` the one-instruction forms.

```{include} ../chapters/_generated/legend-riscv64.md
```

## WebAssembly

A stack machine, so instructions name no registers. `local.get 0` pushes the function's first
argument or local, `i32.load` pops an address and pushes the 32-bit word there, and `i32.store`
pops a value and an address. The number after a memory instruction is an offset added to the
address. Locals belong to the function; globals, such as the stack pointer, to the module. The
`atomic` instructions are sequentially consistent, and the plain ones promise neither atomicity
nor ordering on shared memory, which is what [ch22](#webassembly-threads) builds on.

```{include} ../chapters/_generated/legend-wasm.md
```

## What the legend does not say

How long an instruction takes, and how a core carries it out, is the microarchitecture's and is
not here. Whether a plain load may be reordered with a later store is the instruction set's
memory model, which [Part III](#part-memory-ordering) and [Part IV](#part-hardware-reality)
treat; the one-line meanings above describe each instruction on its own.
