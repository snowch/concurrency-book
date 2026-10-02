"""What every instruction in the fragments means, in one line each.

One dictionary serves two readers. ``tools/highlight.py`` puts each line on its mnemonic as a
hover title, so a fragment explains itself where it is quoted; ``tools/lower.py`` writes the
same lines as the legend tables Appendix D includes, so the legend cannot drift from the
fragments. A mnemonic the fragments use and this module does not know fails ``make check``,
which is how the legend stays complete when a kernel changes.

The meanings are deliberately plain: what the instruction does to registers, memory or the
flags, and nothing about how fast or how a core implements it. Where an instruction is atomic
or orders memory, the line says so, because that is the property the book quotes it for.
"""

from __future__ import annotations

#: The instruction sets the fragments are written for, in the order the legend lists them, with
#: the name a reader sees.
TARGETS = {
    "x86-64": "x86-64, Intel syntax: destination first, `[...]` is memory",
    "aarch64": "AArch64: destination first, `[x0]` is memory at the address in x0",
    "riscv64": "RISC-V (RV64): destination first, `0(a0)` is memory at the address in a0",
    "wasm": "WebAssembly: a stack machine; an instruction pops its operands and pushes its result",
}

X86_64 = {
    "add": "Adds the source to the destination and keeps the result in the destination.",
    "and": "Bitwise and of the two operands, into the first.",
    "cmp": "Subtracts the second operand from the first to set the flags, keeping neither.",
    "cmpxchg": "Compare-and-exchange: if the accumulator equals the operand, stores the register into the operand; otherwise loads the operand into the accumulator. Atomic with a lock prefix.",
    "dec": "Subtracts one from the operand, which may be in memory.",
    "inc": "Adds one to the operand, which may be in memory.",
    "je": "Jumps if the last compare found the operands equal.",
    "jg": "Jumps if the last compare found the first operand greater, as signed numbers.",
    "jge": "Jumps if the last compare found the first operand greater or equal, as signed numbers.",
    "jle": "Jumps if the last compare found the first operand less or equal, as signed numbers.",
    "jmp": "Jumps unconditionally.",
    "jne": "Jumps if the last compare found the operands unequal.",
    "jns": "Jumps if the last result was not negative.",
    "lea": "Computes an address and puts it in a register, without loading from it.",
    "lock": "A prefix: the instruction's read and write of memory become one step no other core can get between, and a full barrier.",
    "mfence": "A fence: every earlier load and store of this thread completes before any later one.",
    "mov": "Copies the source to the destination; with a memory operand it is a load or a store.",
    "movabs": "Loads a 64-bit constant into a register.",
    "movsxd": "Copies a 32-bit value into a 64-bit register, extending the sign.",
    "or": "Bitwise or of the two operands, into the first.",
    "pop": "Takes a value off the stack into a register.",
    "push": "Puts a register's value on the stack.",
    "ret": "Returns from the function.",
    "sete": "Sets a byte register to one if the last compare found the operands equal, else zero.",
    "sub": "Subtracts the source from the destination.",
    "test": "Bitwise and of the two operands to set the flags, keeping neither.",
    "xadd": "Exchange-and-add: adds the register to the operand and leaves the operand's old value in the register. Atomic with a lock prefix.",
    "xchg": "Swaps a register with its operand; with a memory operand the swap is atomic, with or without a lock prefix.",
    "xor": "Bitwise exclusive or; a register with itself sets it to zero.",
}

AARCH64 = {
    "add": "Adds the last two operands into the first.",
    "adrp": "Puts the address of a 4 KiB page into a register, the first half of forming an address.",
    "and": "Bitwise and into the first operand.",
    "b": "Branches unconditionally.",
    "b.eq": "Branches if the last compare found the operands equal.",
    "b.ge": "Branches if the last compare found the first operand greater or equal, as signed numbers.",
    "b.gt": "Branches if the last compare found the first operand greater, as signed numbers.",
    "b.lt": "Branches if the last compare found the first operand less, as signed numbers.",
    "b.ne": "Branches if the last compare found the operands unequal.",
    "b.pl": "Branches if the last result was not negative.",
    "cas": "Compare-and-swap: if the memory word equals the first register, stores the second; the first receives the old value. An LSE instruction.",
    "casa": "Compare-and-swap with acquire ordering. An LSE instruction.",
    "cbnz": "Branches if the register is not zero.",
    "cbz": "Branches if the register is zero.",
    "ccmp": "Compares only if the condition holds; otherwise sets the flags to the value given.",
    "clrex": "Clears the exclusive monitor that a load-exclusive set.",
    "cmp": "Subtracts to set the flags, keeping no result.",
    "cset": "Sets a register to one if the condition holds, else zero.",
    "csetm": "Sets a register to all ones if the condition holds, else zero.",
    "dmb": "A data memory barrier: the accesses before it are ordered before the accesses after it, for the domain and kind named.",
    "ldadd": "Atomically adds a register to a memory word and returns the old value. An LSE instruction.",
    "ldar": "A load with acquire ordering: no later access of this thread can be reordered before it.",
    "ldaxr": "A load-exclusive with acquire ordering.",
    "ldr": "Loads from memory into a register.",
    "ldxr": "A load-exclusive: loads the word and marks the address, so a later store-exclusive succeeds only if nothing wrote it in between.",
    "lsl": "Shifts left.",
    "mov": "Copies a register or a constant into a register.",
    "orr": "Bitwise or into the first operand.",
    "ret": "Returns from the function.",
    "sbfiz": "Moves a bit field into position, extending the sign.",
    "stlr": "A store with release ordering: no earlier access of this thread can be reordered after it.",
    "stlxr": "A store-exclusive with release ordering.",
    "str": "Stores a register to memory.",
    "stxr": "A store-exclusive: stores only if the address is still marked by the matching load-exclusive, and reports failure as one in a register.",
    "sub": "Subtracts the last operand from the middle one into the first.",
    "subs": "Subtracts and sets the flags.",
    "swpa": "Atomically swaps a register with a memory word, with acquire ordering. An LSE instruction.",
    "sxtw": "Extends a 32-bit value to 64 bits with its sign.",
    "tbnz": "Branches if the named bit of the register is not zero.",
    "tbz": "Branches if the named bit of the register is zero.",
}

RISCV64 = {
    "add": "Adds two registers into a third.",
    "addi": "Adds a constant to a register.",
    "addiw": "Adds a constant to the low 32 bits and extends the sign of the result.",
    "amoadd.w": "Atomically adds a register to a memory word and returns the old value.",
    "amoadd.w.aqrl": "The atomic add, with acquire and release ordering.",
    "amoswap.w": "Atomically swaps a register with a memory word.",
    "amoswap.w.aq": "The atomic swap, with acquire ordering.",
    "and": "Bitwise and of two registers.",
    "andi": "Bitwise and with a constant.",
    "auipc": "Adds a constant to the upper bits of the program counter, the first half of forming an address.",
    "beq": "Branches if the two registers are equal.",
    "beqz": "Branches if the register is zero.",
    "bge": "Branches if the first register is greater or equal, as signed numbers.",
    "bgez": "Branches if the register is not negative.",
    "blez": "Branches if the register is zero or negative.",
    "blt": "Branches if the first register is less, as signed numbers.",
    "bne": "Branches if the two registers differ.",
    "bnez": "Branches if the register is not zero.",
    "fence": "A fence: the kinds of access named before it complete before the kinds named after it.",
    "j": "Jumps unconditionally.",
    "ld": "Loads a 64-bit word from memory.",
    "li": "Loads a constant into a register.",
    "lr.d.aq": "Load-reserved of a 64-bit word, with acquire ordering.",
    "lr.w": "Load-reserved: loads a word and reserves the address for a store-conditional.",
    "lr.w.aq": "Load-reserved with acquire ordering.",
    "lw": "Loads a 32-bit word from memory.",
    "mv": "Copies a register.",
    "or": "Bitwise or of two registers.",
    "ret": "Returns from the function.",
    "sc.d": "Store-conditional of a 64-bit word: stores only if the reservation still holds, and writes zero on success to a register.",
    "sc.w": "Store-conditional: stores only if the reservation from the load-reserved still holds, and writes zero on success or non-zero on failure to a register.",
    "sc.w.rl": "Store-conditional with release ordering.",
    "sd": "Stores a 64-bit word to memory.",
    "seqz": "Sets a register to one if the source is zero, else zero.",
    "sext.w": "Extends the low 32 bits to 64 with their sign.",
    "slli": "Shifts left by a constant.",
    "srli": "Shifts right by a constant, filling with zeros.",
    "subw": "Subtracts the low 32 bits and extends the sign of the result.",
    "sw": "Stores a 32-bit word to memory.",
    "xor": "Bitwise exclusive or of two registers.",
}

WASM = {
    "atomic.fence": "A fence: this thread's earlier accesses are ordered before its later ones, as other threads see them.",
    "block": "Opens a block; a branch to it leaves it.",
    "br": "Branches to the block or loop at the named depth: out of a block, back to the start of a loop.",
    "br_if": "Branches if the value on top of the stack is not zero.",
    "br_table": "Branches to one of several depths, chosen by the value on top of the stack.",
    "call": "Calls a function.",
    "drop": "Discards the value on top of the stack.",
    "end_block": "Closes a block.",
    "end_loop": "Closes a loop.",
    "global.get": "Pushes a global variable's value.",
    "i32.add": "Pops two 32-bit values and pushes their sum.",
    "i32.and": "Pops two 32-bit values and pushes their bitwise and.",
    "i32.atomic.load": "An atomic load of a 32-bit word, sequentially consistent.",
    "i32.atomic.rmw.add": "Atomically adds to a 32-bit word in memory and pushes the old value.",
    "i32.atomic.rmw.cmpxchg": "Compare-and-swap on a 32-bit word: stores the new value if the word equals the expected one, and pushes the old value either way.",
    "i32.atomic.rmw.sub": "Atomically subtracts from a 32-bit word in memory and pushes the old value.",
    "i32.atomic.rmw.xchg": "Atomically exchanges a 32-bit word in memory and pushes the old value.",
    "i32.atomic.store": "An atomic store of a 32-bit word, sequentially consistent.",
    "i32.const": "Pushes a 32-bit constant.",
    "i32.eq": "Pops two values and pushes one if they are equal, else zero.",
    "i32.eqz": "Pops a value and pushes one if it is zero, else zero.",
    "i32.ge_s": "Pops two values and pushes one if the first is greater or equal, as signed numbers.",
    "i32.gt_s": "Pops two values and pushes one if the first is greater, as signed numbers.",
    "i32.le_s": "Pops two values and pushes one if the first is less or equal, as signed numbers.",
    "i32.load": "A plain load of a 32-bit word; on shared memory it promises neither atomicity nor ordering.",
    "i32.lt_s": "Pops two values and pushes one if the first is less, as signed numbers.",
    "i32.ne": "Pops two values and pushes one if they differ, else zero.",
    "i32.shl": "Pops two values and pushes the first shifted left by the second.",
    "i32.store": "A plain store of a 32-bit word; on shared memory it promises neither atomicity nor ordering.",
    "i32.sub": "Pops two 32-bit values and pushes their difference.",
    "i32.wrap_i64": "Keeps the low 32 bits of a 64-bit value.",
    "i64.add": "Pops two 64-bit values and pushes their sum.",
    "i64.and": "Pops two 64-bit values and pushes their bitwise and.",
    "i64.atomic.load": "An atomic load of a 64-bit word, sequentially consistent.",
    "i64.atomic.load32_u": "An atomic load of a 32-bit word, extended with zeros to 64 bits.",
    "i64.atomic.rmw.cmpxchg": "Compare-and-swap on a 64-bit word: stores the new value if the word equals the expected one, and pushes the old value either way.",
    "i64.const": "Pushes a 64-bit constant.",
    "i64.ne": "Pops two 64-bit values and pushes one if they differ, else zero.",
    "i64.or": "Pops two 64-bit values and pushes their bitwise or.",
    "local.get": "Pushes a local variable's value.",
    "local.set": "Pops a value into a local variable.",
    "local.tee": "Sets a local variable to the value on top of the stack and leaves the value there.",
    "loop": "Opens a loop; a branch to it goes back to its start.",
    "memory.atomic.notify": "Wakes up to the given number of threads waiting on the address, and pushes how many it woke.",
    "memory.atomic.wait32": "If the 32-bit word equals the expected value, sleeps until a notify on the address or the timeout; pushes why it woke.",
    "return": "Returns from the function.",
}

#: Assembler directives the fragments keep, because a reader needs them to read what follows.
DIRECTIVES = {
    ".functype": "An assembler directive, not an instruction: declares the function's parameter and result types.",
}

BY_TARGET = {"x86-64": X86_64, "aarch64": AARCH64, "riscv64": RISCV64, "wasm": WASM}

#: The ones the book quotes for their atomicity or ordering, which the legend sets apart and the
#: highlighter marks.
ATOMIC = {
    "x86-64": ("lock", "cmpxchg", "mfence", "xadd", "xchg"),
    "aarch64": (
        "cas",
        "casa",
        "clrex",
        "dmb",
        "ldadd",
        "ldar",
        "ldaxr",
        "ldxr",
        "stlr",
        "stlxr",
        "stxr",
        "swpa",
    ),
    "riscv64": (
        "amoadd.w",
        "amoadd.w.aqrl",
        "amoswap.w",
        "amoswap.w.aq",
        "fence",
        "lr.d.aq",
        "lr.w",
        "lr.w.aq",
        "sc.d",
        "sc.w",
        "sc.w.rl",
    ),
    "wasm": tuple(m for m in WASM if "atomic" in m),
}


def describe(target: str | None, mnemonic: str) -> str | None:
    """The one-line meaning of ``mnemonic`` on ``target``; with no target, the first instruction
    set that knows it, which is enough for a hover on a fragment whose target is not known."""
    if mnemonic in DIRECTIVES:
        return DIRECTIVES[mnemonic]
    tables = [BY_TARGET[target]] if target in BY_TARGET else list(BY_TARGET.values())
    for table in tables:
        if mnemonic in table:
            return table[mnemonic]
    return None


def unknown(target: str, mnemonics: set[str]) -> set[str]:
    """The mnemonics in ``mnemonics`` that this module cannot explain for ``target``."""
    return {m for m in mnemonics if m not in BY_TARGET[target] and m not in DIRECTIVES}


def table(target: str) -> str:
    """The legend for one target, as a MyST table: atomic and ordering instructions first."""
    rows = BY_TARGET[target]
    atomic = [m for m in rows if m in ATOMIC[target]]
    plain = [m for m in rows if m not in ATOMIC[target]]
    out = ["% Generated by tools/lower.py from tools/mnemonics.py. Do not edit.", ""]
    out.append(f"*{TARGETS[target]}.*")
    out.append("")
    out.append("| Instruction | What it does |")
    out.append("|---|---|")
    for m in atomic + plain:
        mark = " (atomic or ordering)" if m in atomic else ""
        out.append(f"| `{m}`{mark} | {rows[m]} |")
    return "\n".join(out) + "\n"
