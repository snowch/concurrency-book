"""The C the kernels use that Kernighan and Ritchie do not teach, construct by construct.

The kernels are plain C89 in shape, which is the C most readers learnt, plus a short list of
things that came later: fixed-width integers and a few conveniences from C99, the atomics of
C11, and what clang adds. This module lists exactly those, with what each is, where it comes
from, and where the book teaches it, and ``tools/lower.py`` writes the tables Appendix E
includes from it. A test scans the kernels and fails if they use a construct this module does
not know, so the appendix cannot drift from the code, in the same way the mnemonic legend cannot
drift from the fragments.

The meanings are deliberately about the construct, not the concept: what the name is, what shape
the call has, which header declares it. Why an ordering is acquire or release, and what an
atomic read-modify-write buys, are the chapters' to teach, and each entry says which.
"""

from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
KERNELS = sorted(ROOT.glob("experiments/*/*.c")) + [ROOT / "experiments" / "cm.h"]

#: The groups the appendix lists, in order, with the note that heads each table.
GROUPS = {
    "c99": "From C99, the first standard after the second edition of Kernighan and Ritchie",
    "c11": "From C11, which gave C threads, atomics and a memory model",
    "compiler": "What clang adds: not C, and labelled *compiler* wherever a chapter meets it",
    "idiom": "Idioms of C89 that Kernighan and Ritchie do not dwell on",
}

# Each entry: group, what it is, and where the book teaches what it is for (a chapter label or
# an appendix name, as prose). The key is the construct as it appears in the kernels.
ENTRIES = {
    "int32_t": (
        "c99",
        "A signed integer of exactly 32 bits, from `<stdint.h>`, so a word means the same on every target.",
        "Used throughout; ch01 says why a word's width matters.",
    ),
    "uint32_t": ("c99", "An unsigned integer of exactly 32 bits, from `<stdint.h>`.", "Used throughout."),
    "int64_t": (
        "c99",
        "A signed integer of exactly 64 bits, from `<stdint.h>`: the width of a tagged pointer.",
        "ch17, where a pointer and a tag share one word.",
    ),
    "static inline": (
        "c99",
        "A function defined in a header, visible only in the file that includes it, which the compiler may expand in place rather than call.",
        "The barrier and the wait in `cm.h`; ch02 and ch06.",
    ),
    "for (int i = 0; ...)": (
        "c99",
        "A loop variable declared in the loop header, where C89 required every declaration at the top of a block.",
        "Every kernel's `cm_run`.",
    ),
    "_Atomic": (
        "c11",
        "A type qualifier: every access to the variable is one indivisible step that another thread may observe, which the language promises for no plain access.",
        "ch03 for what that buys and what it does not; ch07 for the compiler's side.",
    ),
    "atomic_load_explicit": (
        "c11",
        "Reads an atomic variable with the ordering named by its last argument, from `<stdatomic.h>`.",
        "ch08 and ch09 for acquire and relaxed loads.",
    ),
    "atomic_store_explicit": (
        "c11",
        "Writes an atomic variable with the ordering named by its last argument.",
        "ch08 and ch10 for release and sequentially consistent stores.",
    ),
    "atomic_fetch_add_explicit": (
        "c11",
        "Adds to an atomic variable as one indivisible read-modify-write and returns the old value.",
        "ch03.",
    ),
    "atomic_fetch_sub_explicit": (
        "c11",
        "Subtracts from an atomic variable as one indivisible read-modify-write and returns the old value.",
        "ch25, the seat count with atomics.",
    ),
    "atomic_fetch_or_explicit": (
        "c11",
        "Ors a value into an atomic variable as one indivisible read-modify-write and returns the old value.",
        "ch19, the bit set that detects a duplicate item.",
    ),
    "atomic_exchange_explicit": (
        "c11",
        "Stores a new value into an atomic variable and returns the old one, as one indivisible step.",
        "ch05, where the exchange is the lock.",
    ),
    "atomic_compare_exchange_weak_explicit": (
        "c11",
        "Stores a new value only if the variable still holds the value expected, and otherwise writes what it holds into the expected variable; may fail with nothing changed, so it is called in a loop.",
        "ch04, with the weak and strong forms side by side.",
    ),
    "atomic_compare_exchange_strong_explicit": (
        "c11",
        "The compare-and-swap that fails only when the value differs, at the cost of a loop inside it on some targets.",
        "ch04.",
    ),
    "atomic_thread_fence": (
        "c11",
        "An ordering with no variable: orders this thread's accesses before it against those after, through the atomic operations around it.",
        "ch11.",
    ),
    "memory_order_relaxed": (
        "c11",
        "The weakest ordering: atomicity and nothing about other variables.",
        "ch09.",
    ),
    "memory_order_acquire": (
        "c11",
        "On a load: nothing this thread does after the load may be seen before it.",
        "ch08.",
    ),
    "memory_order_release": (
        "c11",
        "On a store: nothing this thread did before the store may be seen after it.",
        "ch08.",
    ),
    "memory_order_acq_rel": (
        "c11",
        "Both at once, on a read-modify-write.",
        "ch16 and ch18, where a swing both publishes and takes.",
    ),
    "memory_order_seq_cst": (
        "c11",
        "One order of every such operation that every thread agrees on; the default when no ordering is named.",
        "ch10.",
    ),
    "volatile": (
        "c11",
        "A type qualifier from C89 that K&R mentions only in the appendix: every access in the source is an access in the code, in order with other volatile accesses in the same thread. It does not make an access indivisible and says nothing about other threads.",
        "ch07 for what it is for; ch08 for what it is not.",
    ),
    "__attribute__((noinline))": (
        "compiler",
        "A clang and GCC attribute that keeps a function out of line, so the fragments can show it on its own. The kernels spell it `CM_NOINLINE`.",
        "The note in ch01.",
    ),
    "__attribute__((export_name(...)))": (
        "compiler",
        "A clang attribute for WebAssembly: the function is exported from the module under that name, so the page can call it. The kernels spell it `CM_EXPORT`.",
        "The note in ch01; ch23.",
    ),
    "__builtin_wasm_memory_atomic_wait32": (
        "compiler",
        "A clang builtin that becomes the WebAssembly instruction `memory.atomic.wait32`: sleep if the word still holds the value, until a notify or the timeout.",
        "ch22.",
    ),
    "__builtin_wasm_memory_atomic_notify": (
        "compiler",
        "A clang builtin that becomes `memory.atomic.notify`: wake up to that many threads sleeping on the word.",
        "ch22.",
    ),
    "__wasm__": (
        "compiler",
        "A macro clang defines when compiling for WebAssembly, tested with `#ifdef` to choose the wait and the wake.",
        "The note in ch22.",
    ),
    "__linux__": (
        "compiler",
        "A macro the compiler defines when the target is Linux, where the native harness can use the futex system call.",
        "ch06; Appendix A.",
    ),
    "(void)c;": (
        "idiom",
        "Evaluates an argument and discards it, so the compiler does not warn that the kernel never uses it.",
        "Every kernel with a spare argument.",
    ),
}

#: How each construct is found in the kernels: a pattern, and the entry it must match. The
#: scan is what keeps the appendix complete.
PATTERNS = (
    (r"\b(u?int(?:8|16|32|64)_t)\b", lambda m: m.group(1)),
    (r"\bstatic inline\b", lambda m: "static inline"),
    (r"\bfor \(int\b", lambda m: "for (int i = 0; ...)"),
    (r"\b_Atomic\b", lambda m: "_Atomic"),
    (r"\b(atomic_[a-z_]+)\s*\(", lambda m: m.group(1)),
    (r"\b(memory_order_[a-z_]+)\b", lambda m: m.group(1)),
    (r"\bvolatile\b", lambda m: "volatile"),
    (
        r"__attribute__\(\((\w+)",
        lambda m: f"__attribute__(({m.group(1)}))"
        if m.group(1) == "noinline"
        else f"__attribute__(({m.group(1)}(...)))",
    ),
    (r"\b(__builtin_\w+)\b", lambda m: m.group(1)),
    # Predefined macros such as __wasm__; the attribute keyword has the same shape and is not one.
    (r"\b(__(?!attribute__)[a-z0-9_]+?__)\b", lambda m: m.group(1)),
    (r"\(void\)\s*\w+;", lambda m: "(void)c;"),
)


def used(paths=KERNELS) -> set[str]:
    """Every construct the kernels use that this module is responsible for, by entry key."""
    found = set()
    for path in paths:
        text = path.read_text()
        for pattern, key in PATTERNS:
            for m in re.finditer(pattern, text):
                found.add(key(m))
    return found


def unknown(paths=KERNELS) -> set[str]:
    """The constructs in the kernels that this module cannot explain."""
    return {k for k in used(paths) if k not in ENTRIES}


def unused(paths=KERNELS) -> set[str]:
    """The entries no kernel uses, which should not be in the appendix."""
    return {k for k in ENTRIES if k not in used(paths)}


def table(group: str) -> str:
    """One group's table, as MyST, for `chapters/_generated/cdict-<group>.md`."""
    out = ["% Generated by tools/lower.py from tools/cdict.py. Do not edit.", ""]
    out.append(f"*{GROUPS[group]}.*")
    out.append("")
    out.append("| You will read | What it is | Where the book teaches it |")
    out.append("|---|---|---|")
    for key, (g, what, where) in ENTRIES.items():
        if g == group:
            out.append(f"| `{key}` | {what} | {where} |")
    out.append("")
    out.append(
        "*Generated from tools/cdict.py, which lists exactly what the kernels use; a kernel that uses a "
        "construct the list does not know fails the build, and an entry no kernel uses is removed.*"
    )
    return "\n".join(out) + "\n"
