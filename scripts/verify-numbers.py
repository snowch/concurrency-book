#!/usr/bin/env python3
"""Fail if a published page types a measured number into its prose.

    python3 scripts/verify-numbers.py

Every count of lost updates, every time and every rate in the book is produced by the
laboratory, live in the page, or by the build, in a generated fragment under
``chapters/_generated/``. A number typed into a sentence would be true on the machine it was
observed on and silently wrong on the reader's, so this script refuses them.

What it flags, in prose only (not code blocks, not directives, not inline code, not URLs):

- a number followed by a unit this book measures in: bytes, ms, ns, seconds, increments, updates,
  workers, threads, cores, iterations, runs, retries;
- any other integer of two or more digits, except a year, a chapter label, a bit width, or an
  RFC or section number in a citation.

Small counts written as words ("two threads", "three operations") pass: they are the shape of
the experiment, not a measurement, and do not go stale. A number that must be typed can be
exempted with ``% number-ok: <reason>`` on the line before its paragraph, which covers the
paragraph, where a reviewer will see the reason.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PAGES = ["cover.md", "index.md", "parts/*.md", "chapters/*.md", "appendices/*.md"]

UNIT = (
    r"(?:bytes?|B|KB|KiB|MB|MiB|GB|GiB|ms|ns|µs|us|seconds?|increments?|updates?|workers?|threads?"
    r"|cores?|iterations?|runs?|retries|times|cycles?|instructions?)"
)
WITH_UNIT = re.compile(rf"(?<![\w.])\d[\d,._]*\s*{UNIT}\b")
BARE = re.compile(r"(?<![\w.#/-])\d{2,}(?![\w-])")
ALLOWED_BARE = re.compile(r"^(?:19|20)\d\d$|^(?:16|32|64|128)$")  # a year, or a width in bits
INLINE_CODE = re.compile(r"`[^`]*`")
LINK_TARGET = re.compile(r"\]\([^)]*\)")
CITATION = re.compile(
    r"\b(?:RFC|section|ch|Appendix|Part|C|C\+\+|x86-|x86_|RISC-V|armv|Armv)\s*-?\d+", re.IGNORECASE
)
#: Architecture names and standards that carry digits: x86-64, AArch64, C11, RV64; and the
#: versions of the tools the book pins, which are names of a kind too: clang 18, Node.js 22.
NAMES = re.compile(
    r"\b(?:x86-64|x86_64|AArch64|aarch64|C11|C\+\+11|RV64|rv64gc|i32|i64|u32|u64|f64|int32_t|uint32_t|int64_t)\b"
    r"|\b(?:clang|Clang|LLVM|gcc|Node\.js|Node|Python|Pyodide|Chromium|Firefox|Safari|MyST)\s+\d+(?:\.\d+)*"
)


def prose_lines(text: str):
    """Yield (line number, line) for the prose of a page, with exemptions applied."""
    in_front = text.startswith("---\n")
    fence = None
    exempt = False
    for n, line in enumerate(text.splitlines(), 1):
        if in_front:
            if n > 1 and line.strip() == "---":
                in_front = False
            continue
        stripped = line.strip()
        m = re.match(r"^(`{3,}|~{3,})", stripped)
        if fence:
            if m and stripped.startswith(fence):
                fence = None
            continue
        if m:
            fence = m.group(1)
            continue
        if stripped.startswith("%"):
            exempt = exempt or stripped.startswith("% number-ok:")
            continue
        if not stripped:
            exempt = False
        if stripped.startswith(":::") or stripped.startswith(":class:") or stripped.startswith(":sync:"):
            continue
        if re.match(r"^\(.*\)=$", stripped):
            continue
        if exempt:
            continue
        yield n, line


def problems(path: Path) -> list[str]:
    out = []
    for n, line in prose_lines(path.read_text()):
        text = INLINE_CODE.sub("", LINK_TARGET.sub("]", line))
        text = CITATION.sub("", text)
        text = NAMES.sub("", text)
        text = re.sub(r"^\s*(?:\d+\.|[-*])\s+", "", text)  # list markers
        text = re.sub(r"^#+\s", "", text)
        covered = []
        for m in WITH_UNIT.finditer(text):
            covered.append(m.span())
            out.append(f"{path.relative_to(ROOT)}:{n}: {m.group(0)!r} is a measured number in prose")
        for m in BARE.finditer(text):
            if any(a <= m.start() < b for a, b in covered):
                continue
            if not ALLOWED_BARE.match(m.group(0)):
                out.append(f"{path.relative_to(ROOT)}:{n}: {m.group(0)!r} is a number typed into prose")
    return out


def main() -> int:
    found = []
    for pattern in PAGES:
        for path in sorted(ROOT.glob(pattern)):
            found += problems(path)
    if found:
        print("Numbers typed into prose. Let the laboratory or a generated fragment show them,")
        print("or exempt the line with `% number-ok: <reason>` above it:")
        for f in found:
            print("  " + f)
        return 1
    print("  no measured numbers typed into prose")
    return 0


if __name__ == "__main__":
    sys.exit(main())
