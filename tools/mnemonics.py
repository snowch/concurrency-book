"""What every instruction in the fragments means, and why the book quotes it.

One dictionary serves three readers. ``tools/highlight.py`` puts each instruction's two lines on
its mnemonic as a hover, so a fragment explains itself where it is quoted; ``tools/lower.py``
writes the same lines as the legend tables Appendix D includes, so the legend cannot drift from
the fragments; and ``tools/lower.py`` refuses a fragment that uses an instruction this module
does not know, which is how the legend stays complete when a kernel changes.

Each instruction has a kind, a literal meaning, and a significance. The meaning says what the
instruction does to registers, memory or the flags, and nothing about how fast or how a core
implements it. The significance says what the instruction is to a program with more than one
thread: a load is a thread's view of memory being taken, a store is what another thread may
see, an atomic read-modify-write is the step nothing can get between, arithmetic in a register
is invisible to everyone else. The kind supplies the significance unless an instruction has a
sharper one of its own, which the ones the book is about do.
"""

from __future__ import annotations

#: The instruction sets the fragments are written for, in the order the legend lists them, with
#: the note a reader needs first.
TARGETS = {
    "x86-64": "x86-64, Intel syntax: destination first, `[...]` is memory",
    "aarch64": "AArch64: destination first, `[x0]` is memory at the address in x0",
    "riscv64": "RISC-V (RV64): destination first, `0(a0)` is memory at the address in a0",
    "wasm": "WebAssembly: a stack machine; an instruction pops its operands and pushes its result",
}

#: What each kind of instruction is to a program with more than one thread.
KINDS = {
    "load": "A load: the read half of a read-modify-write, and the moment this thread's view of the word is taken.",
    "store": "A store: the write another thread may see, before or after its own, with nothing to say which.",
    "rmw": "An atomic read-modify-write: one step that no other core's access can get between.",
    "memrmw": "A read-modify-write on memory in one instruction: still a read and a separate write, atomic only with a lock prefix.",
    "exclusive": "Half of a load-exclusive, store-exclusive pair: the retry loop that stands in for an atomic read-modify-write.",
    "fence": "A fence: stops the processor reordering the memory accesses on either side of it.",
    "prefix": "A prefix that makes the instruction after it atomic.",
    "sync": "Sleeping on a word and waking the sleepers: what a mutex is made of below the spin.",
    "branch": "Control flow: what a retry loop, a spin or a wait is made of.",
    "arith": "Arithmetic in a register: invisible to every other thread.",
    "move": "A register copy or a constant: invisible to every other thread.",
    "address": "Forms an address: how the code reaches a shared variable.",
    "stack": "The function's own frame or stack: not shared with anyone.",
    "directive": "An assembler directive, not an instruction.",
}

#: The kinds the book quotes for their atomicity or ordering, which the legend sets apart and
#: the highlighter marks.
ATOMIC_KINDS = ("rmw", "exclusive", "fence", "prefix", "sync")

# Each entry: kind, what the instruction does, and (optionally) why it matters here when the
# kind's line is not sharp enough.
X86_64 = {
    "add": (
        "arith",
        "Adds the source to the destination and keeps the result in the destination.",
        "With a register destination, the middle of the three steps; with a memory destination, a read and a separate write on memory, like inc, atomic only with a lock prefix.",
    ),
    "and": ("arith", "Bitwise and of the two operands, into the first.", None),
    "cmp": (
        "arith",
        "Subtracts the second operand from the first to set the flags, keeping neither.",
        "The test of a spin or a retry: compares what was loaded with what was expected.",
    ),
    "cmpxchg": (
        "rmw",
        "Compare-and-exchange: if eax, the accumulator, equals the operand, stores the register into the operand; otherwise loads the operand into eax. Atomic with a lock prefix.",
        "The compare-and-swap of ch04, and the foundation of every lock-free structure in Part V.",
    ),
    "dec": (
        "memrmw",
        "Subtracts one from the operand, which may be in memory.",
        "A read-modify-write on memory in one instruction; without a lock prefix, still a read and a separate write.",
    ),
    "inc": (
        "memrmw",
        "Adds one to the operand, which may be in memory.",
        "A read-modify-write on memory in one instruction; without a lock prefix, still a read and a separate write, which ch02 loses updates inside.",
    ),
    "je": ("branch", "Jumps if the last compare found the operands equal.", None),
    "jg": ("branch", "Jumps if the last compare found the first operand greater, as signed numbers.", None),
    "jge": (
        "branch",
        "Jumps if the last compare found the first operand greater or equal, as signed numbers.",
        None,
    ),
    "jle": (
        "branch",
        "Jumps if the last compare found the first operand less or equal, as signed numbers.",
        None,
    ),
    "jmp": ("branch", "Jumps unconditionally.", None),
    "jne": (
        "branch",
        "Jumps if the last compare found the operands unequal.",
        "The branch back to the top of a retry loop: the compare failed, so go round again.",
    ),
    "jns": ("branch", "Jumps if the last result was not negative.", None),
    "lea": ("address", "Computes an address and puts it in a register, without loading from it.", None),
    "lock": (
        "prefix",
        "A prefix: the instruction's read and write of memory become one step no other core can get between, and a full barrier.",
        "The one byte that turns ch01's increment into ch03's atomic one, and on x86-64 a full fence besides.",
    ),
    "mfence": (
        "fence",
        "A fence: every earlier load and store of this thread completes before any later one.",
        "The fence of ch11: with a locked instruction, one of the two ways on x86-64 to stop a store waiting in the store buffer while a later load runs.",
    ),
    "mov": (
        "move",
        "Copies the source to the destination; with a memory operand it is a load or a store.",
        "With a memory operand this is the load or the store: the two accesses a race gets between.",
    ),
    "movabs": ("move", "Loads a 64-bit constant into a register.", None),
    "movsxd": ("move", "Copies a 32-bit value into a 64-bit register, extending the sign.", None),
    "or": ("arith", "Bitwise or of the two operands, into the first.", None),
    "pop": ("stack", "Takes a value off the stack into a register.", None),
    "push": ("stack", "Puts a register's value on the stack.", None),
    "ret": (
        "branch",
        "Returns from the function.",
        "The end of the function; nothing here touches shared memory.",
    ),
    "sete": (
        "arith",
        "Sets a byte register to one if the last compare found the operands equal, else zero.",
        "Turns the outcome of a compare-and-swap into the value the C function returns.",
    ),
    "sub": ("arith", "Subtracts the source from the destination.", None),
    "test": (
        "arith",
        "Bitwise and of the two operands to set the flags, keeping neither.",
        "The test of a spin: did the load see the value the loop is waiting for?",
    ),
    "xadd": (
        "rmw",
        "Exchange-and-add: adds the register to the operand and leaves the operand's old value in the register. Atomic with a lock prefix.",
        "An atomic fetch-and-add that returns the old value: ch03's counter when the old value is wanted.",
    ),
    "xchg": (
        "rmw",
        "Swaps a register with its operand; with a memory operand the swap is atomic, with or without a lock prefix.",
        "The test-and-set of ch05: one atomic swap takes the lock and reports whether it was free.",
    ),
    "xor": ("arith", "Bitwise exclusive or; a register with itself sets it to zero.", None),
}

AARCH64 = {
    "add": (
        "arith",
        "Adds the last two operands into the first.",
        "Register arithmetic between a load and a store: the middle of the three steps, or half of an address.",
    ),
    "adrp": (
        "address",
        "Puts the address of a 4 KiB page into a register, the first half of forming an address.",
        None,
    ),
    "and": ("arith", "Bitwise and into the first operand.", None),
    "b": ("branch", "Branches unconditionally.", None),
    "b.eq": ("branch", "Branches if the last compare found the operands equal.", None),
    "b.ge": (
        "branch",
        "Branches if the last compare found the first operand greater or equal, as signed numbers.",
        None,
    ),
    "b.gt": (
        "branch",
        "Branches if the last compare found the first operand greater, as signed numbers.",
        None,
    ),
    "b.lt": ("branch", "Branches if the last compare found the first operand less, as signed numbers.", None),
    "b.ne": (
        "branch",
        "Branches if the last compare found the operands unequal.",
        "The branch back to the top of a retry loop: the compare failed, so go round again.",
    ),
    "b.pl": ("branch", "Branches if the last result was not negative.", None),
    "cas": (
        "rmw",
        "Compare-and-swap: if the memory word equals the first register, stores the second; the first receives the old value. An LSE instruction.",
        "The compare-and-swap of ch04 in one instruction, where a core without LSE needs a loop of ldxr and stxr.",
    ),
    "casa": (
        "rmw",
        "Compare-and-swap with acquire ordering. An LSE instruction.",
        "ch04's compare-and-swap with ch08's acquire ordering built in.",
    ),
    "cbnz": (
        "branch",
        "Branches if the register is not zero.",
        "The branch back to the top of an exclusive retry loop: the store-exclusive failed, so load again.",
    ),
    "cbz": ("branch", "Branches if the register is zero.", None),
    "ccmp": (
        "arith",
        "Compares only if the condition holds; otherwise sets the flags to the value given.",
        None,
    ),
    "clrex": (
        "exclusive",
        "Clears the exclusive monitor that a load-exclusive set.",
        "Leaves an exclusive loop without storing: the compare-and-swap found the wrong value.",
    ),
    "cmp": (
        "arith",
        "Subtracts to set the flags, keeping no result.",
        "The test of a spin or a retry: compares what was loaded with what was expected.",
    ),
    "cset": (
        "arith",
        "Sets a register to one if the condition holds, else zero.",
        "Turns the outcome of a compare into the value the C function returns.",
    ),
    "csetm": ("arith", "Sets a register to all ones if the condition holds, else zero.", None),
    "dmb": (
        "fence",
        "A data memory barrier: the accesses before it are ordered before the accesses after it, for the domain and kind named.",
        "The fence of ch11 on AArch64; `dmb ish` is the full one, and what a sequentially consistent fence becomes.",
    ),
    "ldadd": (
        "rmw",
        "Atomically adds a register to a memory word and returns the old value. An LSE instruction.",
        "ch03's atomic increment in one instruction, where a core without LSE needs a loop of ldxr and stxr.",
    ),
    "ldar": (
        "load",
        "A load with acquire ordering: no later access of this thread can be reordered before it.",
        "The acquire load of ch08: the instruction a reader's side of a handover compiles to.",
    ),
    "ldaxr": (
        "exclusive",
        "A load-exclusive with acquire ordering.",
        "The load half of an exclusive pair, with ch08's acquire ordering: how a lock is taken.",
    ),
    "ldr": ("load", "Loads from memory into a register.", None),
    "ldxr": (
        "exclusive",
        "A load-exclusive: loads the word and marks the address, so a later store-exclusive succeeds only if nothing wrote it in between.",
        "The load half of the pair that makes ch03's atomic increment and ch04's compare-and-swap without LSE.",
    ),
    "lsl": ("arith", "Shifts left.", None),
    "mov": ("move", "Copies a register or a constant into a register.", None),
    "orr": ("arith", "Bitwise or into the first operand.", None),
    "ret": (
        "branch",
        "Returns from the function.",
        "The end of the function; nothing here touches shared memory.",
    ),
    "sbfiz": ("arith", "Moves a bit field into position, extending the sign.", None),
    "stlr": (
        "store",
        "A store with release ordering: no earlier access of this thread can be reordered after it.",
        "The release store of ch08: the instruction a writer's side of a handover compiles to.",
    ),
    "stlxr": (
        "exclusive",
        "A store-exclusive with release ordering.",
        "The store half of an exclusive pair, with ch08's release ordering: how a lock is released or a value published.",
    ),
    "str": ("store", "Stores a register to memory.", None),
    "stxr": (
        "exclusive",
        "A store-exclusive: stores only if the address is still marked by the matching load-exclusive, and reports failure as one in a register.",
        "The store half of the pair; a failure means the word may have been written, or the reservation was lost for another reason, so the loop goes round.",
    ),
    "sub": ("arith", "Subtracts the last operand from the middle one into the first.", None),
    "subs": ("arith", "Subtracts and sets the flags.", None),
    "swpa": (
        "rmw",
        "Atomically swaps a register with a memory word, with acquire ordering. An LSE instruction.",
        "The test-and-set of ch05 in one instruction, with ch08's acquire ordering built in.",
    ),
    "sxtw": ("arith", "Extends a 32-bit value to 64 bits with its sign.", None),
    "tbnz": ("branch", "Branches if the named bit of the register is not zero.", None),
    "tbz": ("branch", "Branches if the named bit of the register is zero.", None),
}

RISCV64 = {
    "add": ("arith", "Adds two registers into a third.", None),
    "addi": (
        "arith",
        "Adds a constant to a register.",
        "Register arithmetic between a load and a store: the middle of the three steps.",
    ),
    "addiw": (
        "arith",
        "Adds a constant to the low 32 bits and extends the sign of the result.",
        "Register arithmetic between a load and a store: the middle of the three steps.",
    ),
    "amoadd.w": (
        "rmw",
        "Atomically adds a register to a memory word and returns the old value.",
        "ch03's atomic increment in one instruction.",
    ),
    "amoadd.w.aqrl": (
        "rmw",
        "The atomic add, with acquire and release ordering.",
        "ch03's atomic increment with ch10's sequentially consistent ordering: acquire and release at once.",
    ),
    "amoswap.w": (
        "rmw",
        "Atomically swaps a register with a memory word.",
        "The test-and-set of ch05 in one instruction.",
    ),
    "amoswap.w.aq": (
        "rmw",
        "The atomic swap, with acquire ordering.",
        "The test-and-set of ch05 with ch08's acquire ordering built in: how a lock is taken.",
    ),
    "and": ("arith", "Bitwise and of two registers.", None),
    "andi": ("arith", "Bitwise and with a constant.", None),
    "auipc": (
        "address",
        "Adds a constant to the upper bits of the program counter, the first half of forming an address.",
        None,
    ),
    "beq": ("branch", "Branches if the two registers are equal.", None),
    "beqz": ("branch", "Branches if the register is zero.", None),
    "bge": ("branch", "Branches if the first register is greater or equal, as signed numbers.", None),
    "bgez": ("branch", "Branches if the register is not negative.", None),
    "blez": ("branch", "Branches if the register is zero or negative.", None),
    "blt": ("branch", "Branches if the first register is less, as signed numbers.", None),
    "bne": (
        "branch",
        "Branches if the two registers differ.",
        "The branch back to the top of a retry loop: the compare failed, so go round again.",
    ),
    "bnez": (
        "branch",
        "Branches if the register is not zero.",
        "The branch back to the top of a reserved retry loop: the store-conditional failed, so load again.",
    ),
    "fence": (
        "fence",
        "A fence: the kinds of access named before it complete before the kinds named after it.",
        "The fence of ch11 on RISC-V; `fence rw,rw` is the full one.",
    ),
    "j": ("branch", "Jumps unconditionally.", None),
    "ld": ("load", "Loads a 64-bit word from memory.", None),
    "li": ("move", "Loads a constant into a register.", None),
    "lr.d.aq": (
        "exclusive",
        "Load-reserved of a 64-bit word, with acquire ordering.",
        "The load half of a reserved pair, with ch08's acquire ordering.",
    ),
    "lr.w": (
        "exclusive",
        "Load-reserved: loads a word and reserves the address for a store-conditional.",
        "The load half of the pair that makes ch04's compare-and-swap on RISC-V.",
    ),
    "lr.w.aq": (
        "exclusive",
        "Load-reserved with acquire ordering.",
        "The load half of a reserved pair, with ch08's acquire ordering: how a lock is taken.",
    ),
    "lw": ("load", "Loads a 32-bit word from memory.", None),
    "mv": ("move", "Copies a register.", None),
    "or": ("arith", "Bitwise or of two registers.", None),
    "ret": (
        "branch",
        "Returns from the function.",
        "The end of the function; nothing here touches shared memory.",
    ),
    "sc.d": (
        "exclusive",
        "Store-conditional of a 64-bit word: stores only if the reservation still holds, and writes zero on success to a register.",
        "The store half of a reserved pair; a failure means the word may have been written, or the reservation was lost for another reason, so the loop goes round.",
    ),
    "sc.w": (
        "exclusive",
        "Store-conditional: stores only if the reservation from the load-reserved still holds, and writes zero on success or non-zero on failure to a register.",
        "The store half of the pair; a failure means the word may have been written, or the reservation was lost for another reason, so the loop goes round.",
    ),
    "sc.w.rl": (
        "exclusive",
        "Store-conditional with release ordering.",
        "The store half of a reserved pair, with ch08's release ordering: how a lock is released.",
    ),
    "sd": ("store", "Stores a 64-bit word to memory.", None),
    "seqz": (
        "arith",
        "Sets a register to one if the source is zero, else zero.",
        "Turns the outcome of a store-conditional or a compare into the value the C function returns.",
    ),
    "sext.w": ("arith", "Extends the low 32 bits to 64 with their sign.", None),
    "slli": ("arith", "Shifts left by a constant.", None),
    "srli": ("arith", "Shifts right by a constant, filling with zeros.", None),
    "subw": ("arith", "Subtracts the low 32 bits and extends the sign of the result.", None),
    "sw": ("store", "Stores a 32-bit word to memory.", None),
    "xor": ("arith", "Bitwise exclusive or of two registers.", None),
}

WASM = {
    "atomic.fence": (
        "fence",
        "A fence: this thread's earlier accesses are ordered before its later ones, as other threads see them.",
        "The fence of ch11 in WebAssembly, which the engine lowers to whatever its host needs.",
    ),
    "block": ("branch", "Opens a block; a branch to it leaves it.", None),
    "br": (
        "branch",
        "Branches to the block or loop at the named depth: out of a block, back to the start of a loop.",
        None,
    ),
    "br_if": (
        "branch",
        "Branches if the value on top of the stack is not zero.",
        "The branch back to the top of a retry loop or a spin.",
    ),
    "br_table": (
        "branch",
        "Branches to one of several depths, chosen by the value on top of the stack.",
        None,
    ),
    "call": (
        "branch",
        "Calls a function.",
        "A call: what the called function does to shared memory is in that function's own listing.",
    ),
    "drop": ("move", "Discards the value on top of the stack.", None),
    "end_block": ("branch", "Closes a block; the specification's text format spells it end.", None),
    "end_loop": ("branch", "Closes a loop; the specification's text format spells it end.", None),
    "global.get": ("move", "Pushes a global variable's value.", None),
    "i32.add": (
        "arith",
        "Pops two 32-bit values and pushes their sum.",
        "Arithmetic on the stack between a load and a store: the middle of the three steps.",
    ),
    "i32.and": ("arith", "Pops two 32-bit values and pushes their bitwise and.", None),
    "i32.atomic.load": (
        "load",
        "An atomic load of a 32-bit word, sequentially consistent.",
        "An atomic load: indivisible and ordered, which a plain load on shared memory is not.",
    ),
    "i32.atomic.rmw.add": (
        "rmw",
        "Atomically adds to a 32-bit word in memory and pushes the old value.",
        "ch03's atomic increment, which the engine lowers to an atomic read-modify-write of its own choosing on the host.",
    ),
    "i32.atomic.rmw.cmpxchg": (
        "rmw",
        "Compare-and-swap on a 32-bit word: stores the new value if the word equals the expected one, and pushes the old value either way.",
        "The compare-and-swap of ch04, and the foundation of every lock-free structure in Part V.",
    ),
    "i32.atomic.rmw.sub": (
        "rmw",
        "Atomically subtracts from a 32-bit word in memory and pushes the old value.",
        "An atomic decrement: ch25's seat count when every access is atomic.",
    ),
    "i32.atomic.rmw.xchg": (
        "rmw",
        "Atomically exchanges a 32-bit word in memory and pushes the old value.",
        "The test-and-set of ch05: one atomic swap takes the lock and reports whether it was free.",
    ),
    "i32.atomic.store": (
        "store",
        "An atomic store of a 32-bit word, sequentially consistent.",
        "An atomic store: indivisible and ordered, which a plain store on shared memory is not.",
    ),
    "i32.const": ("move", "Pushes a 32-bit constant.", None),
    "i32.eq": ("arith", "Pops two values and pushes one if they are equal, else zero.", None),
    "i32.eqz": (
        "arith",
        "Pops a value and pushes one if it is zero, else zero.",
        "The test of a spin: did the load see the value the loop is waiting for?",
    ),
    "i32.ge_s": (
        "arith",
        "Pops two values and pushes one if the first is greater or equal, as signed numbers.",
        None,
    ),
    "i32.gt_s": ("arith", "Pops two values and pushes one if the first is greater, as signed numbers.", None),
    "i32.le_s": (
        "arith",
        "Pops two values and pushes one if the first is less or equal, as signed numbers.",
        None,
    ),
    "i32.load": (
        "load",
        "A plain load of a 32-bit word; on shared memory it promises neither atomicity nor ordering.",
        "A plain load: with another thread writing the word, a data race.",
    ),
    "i32.lt_s": ("arith", "Pops two values and pushes one if the first is less, as signed numbers.", None),
    "i32.ne": ("arith", "Pops two values and pushes one if they differ, else zero.", None),
    "i32.shl": ("arith", "Pops two values and pushes the first shifted left by the second.", None),
    "i32.store": (
        "store",
        "A plain store of a 32-bit word; on shared memory it promises neither atomicity nor ordering.",
        "A plain store: another thread may see it at any time, or not yet.",
    ),
    "i32.sub": ("arith", "Pops two 32-bit values and pushes their difference.", None),
    "i32.wrap_i64": ("arith", "Keeps the low 32 bits of a 64-bit value.", None),
    "i64.add": ("arith", "Pops two 64-bit values and pushes their sum.", None),
    "i64.and": ("arith", "Pops two 64-bit values and pushes their bitwise and.", None),
    "i64.atomic.load": (
        "load",
        "An atomic load of a 64-bit word, sequentially consistent.",
        "An atomic load of a tagged pointer: ch17 reads the pointer and its tag as one word.",
    ),
    "i64.atomic.load32_u": ("load", "An atomic load of a 32-bit word, extended with zeros to 64 bits.", None),
    "i64.atomic.rmw.cmpxchg": (
        "rmw",
        "Compare-and-swap on a 64-bit word: stores the new value if the word equals the expected one, and pushes the old value either way.",
        "The double-width compare-and-swap of ch17: pointer and tag replaced together, or not at all.",
    ),
    "i64.const": ("move", "Pushes a 64-bit constant.", None),
    "i64.ne": ("arith", "Pops two 64-bit values and pushes one if they differ, else zero.", None),
    "i64.or": ("arith", "Pops two 64-bit values and pushes their bitwise or.", None),
    "local.get": ("move", "Pushes a local variable's value.", None),
    "local.set": ("move", "Pops a value into a local variable.", None),
    "local.tee": (
        "move",
        "Sets a local variable to the value on top of the stack and leaves the value there.",
        None,
    ),
    "loop": ("branch", "Opens a loop; a branch to it goes back to its start.", None),
    "memory.atomic.notify": (
        "sync",
        "Wakes up to the given number of threads waiting on the address, and pushes how many it woke.",
        "The wake half of ch06's sleeping lock and ch22's handshake.",
    ),
    "memory.atomic.wait32": (
        "sync",
        "If the 32-bit word equals the expected value, sleeps until a notify on the address or the timeout; pushes why it woke.",
        "The sleep half of ch06's sleeping lock: the compare and the sleep are one step, so no wake-up can be lost between them.",
    ),
    "return": (
        "branch",
        "Returns from the function.",
        "The end of the function; nothing here touches shared memory.",
    ),
}

#: Assembler directives the fragments keep, because a reader needs them to read what follows.
DIRECTIVES = {
    ".functype": (
        "directive",
        "An assembler directive, not an instruction: declares the function's parameter and result types.",
        None,
    ),
}

BY_TARGET = {"x86-64": X86_64, "aarch64": AARCH64, "riscv64": RISCV64, "wasm": WASM}


def _entry(target: str | None, mnemonic: str) -> tuple[str, str, str | None] | None:
    if mnemonic in DIRECTIVES:
        return DIRECTIVES[mnemonic]
    tables = [BY_TARGET[target]] if target in BY_TARGET else list(BY_TARGET.values())
    for table in tables:
        if mnemonic in table:
            return table[mnemonic]
    return None


def describe(target: str | None, mnemonic: str) -> str | None:
    """The one-line meaning of ``mnemonic`` on ``target``; with no target, the first instruction
    set that knows it, which is enough for a hover on a fragment whose target is not known."""
    entry = _entry(target, mnemonic)
    return entry[1] if entry else None


def why(target: str | None, mnemonic: str) -> str | None:
    """Why the instruction matters to a program with more than one thread: its own line, or its
    kind's."""
    entry = _entry(target, mnemonic)
    if not entry:
        return None
    kind, _, own = entry
    return own or KINDS[kind]


def is_atomic(target: str | None, mnemonic: str) -> bool:
    """Whether the instruction is one the book quotes for its atomicity or ordering."""
    entry = _entry(target, mnemonic)
    return bool(entry) and entry[0] in ATOMIC_KINDS


def unknown(target: str, mnemonics: set[str]) -> set[str]:
    """The mnemonics in ``mnemonics`` that this module cannot explain for ``target``."""
    return {m for m in mnemonics if m not in BY_TARGET[target] and m not in DIRECTIVES}


def table(target: str) -> str:
    """The legend for one target, as a MyST table: atomic and ordering instructions first."""
    rows = BY_TARGET[target]
    atomic = [m for m in rows if rows[m][0] in ATOMIC_KINDS]
    plain = [m for m in rows if rows[m][0] not in ATOMIC_KINDS]
    out = ["% Generated by tools/lower.py from tools/mnemonics.py. Do not edit.", ""]
    out.append(f"*{TARGETS[target]}.*")
    out.append("")
    out.append("| Instruction | What it does | Why it matters here |")
    out.append("|---|---|---|")
    for m in atomic + plain:
        kind, meaning, own = rows[m]
        mark = " (atomic or ordering)" if kind in ATOMIC_KINDS else ""
        out.append(f"| `{m}`{mark} | {meaning} | {own or KINDS[kind]} |")
    return "\n".join(out) + "\n"
