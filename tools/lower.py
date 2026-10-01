#!/usr/bin/env python3
"""Compile every kernel: to WebAssembly for the page, and to assembly fragments for the chapters.

    python3 tools/lower.py            # _build/wasm/<name>.wasm, and chapters/_generated/*.md
    python3 tools/lower.py --check    # fail if a committed fragment is not what clang emits now
    python3 tools/lower.py --wasm     # only the WebAssembly modules

A chapter never pastes assembly. Each ``lowerings`` entry in an experiment's contract names the
functions a chapter quotes and the optimisation level, and this script writes one fragment per
target, each ending with a conditions line that says which compiler, version, target and flags
produced it. The fragments are committed and ``--check`` holds them to the compiler in CI, as the
sibling books hold their generated tables to their readers.

The compiler is pinned by major and minor version (``CLANG_VERSION``): a different clang emits
different instructions, and a fragment that drifted from its conditions line would be the one
kind of lie the book cannot afford. Set ``CLANG`` to point at the pinned one.
"""

from __future__ import annotations

import argparse
import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from tools import experiments  # noqa: E402
from tools.outline import EXPERIMENTS  # noqa: E402

GENERATED = ROOT / "chapters" / "_generated"
WASM_OUT = ROOT / "_build" / "wasm"

#: The clang the fragments were made with. ``--check`` refuses to run under another.
CLANG_VERSION = "18.1"

#: The largest memory a kernel may grow to: 64 MiB, in 64 KiB pages. web/lab/runtime.js creates
#: the shared memory with the same maximum, and the two must agree for the import to link.
MAX_PAGES = 1024

#: What each target is called in prose, the triple clang is given, and the flags beyond the
#: common ones. x86-64 is shown in Intel syntax, as the book says on every fragment.
TARGETS = {
    "wasm": ("WebAssembly", "wasm32", ["-matomics", "-mbulk-memory", "-nostdlib"], "#"),
    "x86-64": ("x86-64", "x86_64-unknown-linux-gnu", ["-masm=intel"], "#"),
    "aarch64": ("AArch64", "aarch64-unknown-linux-gnu", [], "//"),
    "aarch64-lse": ("AArch64 with LSE atomics", "aarch64-unknown-linux-gnu", ["-march=armv8.1-a"], "//"),
    "riscv64": ("RISC-V", "riscv64-unknown-linux-gnu", ["-march=rv64gc"], "#"),
}
COMMON = ["-ffreestanding", "-fno-asynchronous-unwind-tables", "-fno-exceptions"]

#: Directives kept in a fragment: a function's signature in WebAssembly's assembly is one.
KEEP_DIRECTIVES = (".functype",)


def clang() -> str:
    return os.environ.get("CLANG") or shutil.which("clang-18") or "clang"


def clang_version() -> str:
    out = subprocess.run([clang(), "--version"], capture_output=True, text=True, check=True).stdout
    m = re.search(r"clang version (\d+\.\d+\.\d+)", out)
    if not m:
        sys.exit(f"cannot read a version from `{clang()} --version`: {out.splitlines()[0]!r}")
    return m.group(1)


def check_version() -> str:
    version = clang_version()
    if not version.startswith(CLANG_VERSION + "."):
        sys.exit(
            f"the fragments are made with clang {CLANG_VERSION}.x and this is {version}; "
            f"set CLANG to a pinned clang, or change CLANG_VERSION in tools/lower.py and regenerate"
        )
    return version


def wasm_flags(opt: str) -> list[str]:
    return [
        "--target=wasm32",
        f"-{opt}",
        *COMMON,
        *TARGETS["wasm"][2],
        "-Wl,--no-entry",
        "-Wl,--import-memory",
        "-Wl,--shared-memory",
        f"-Wl,--max-memory={MAX_PAGES * 65536}",
        # Each worker gives its instance a stack of its own by setting this global (worker.js).
        "-Wl,--export=__stack_pointer",
        "-Wl,--export=__heap_base",
        "-Wl,--export=__data_end",
    ]


def build_wasm(exp: experiments.Experiment, out: Path) -> None:
    out.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run([clang(), *wasm_flags("O2"), "-o", str(out), str(exp.kernel)], check=True)


def assemble(kernel: Path, target: str, opt: str) -> str:
    """clang's assembly for ``kernel`` on ``target``, as text."""
    _, triple, flags, _ = TARGETS[target]
    cmd = [clang(), f"--target={triple}", f"-{opt}", *COMMON, *flags, "-S", "-o", "-", str(kernel)]
    return subprocess.run(cmd, capture_output=True, text=True, check=True).stdout


def function_body(asm: str, name: str, target: str) -> str:
    """The lines of one function, without the assembler's bookkeeping."""
    comment = TARGETS[target][3]
    lines = asm.splitlines()
    start = next((i for i, line in enumerate(lines) if re.match(rf"^{re.escape(name)}:", line)), None)
    if start is None:
        raise SystemExit(f"{target}: no function {name!r} in the assembly")
    out = []
    for line in lines[start:]:
        if re.match(r"^\.Lfunc_end\d+:", line) or line.strip() == "end_function":
            break
        # A trailing comment: `# @increment` on the label, `// =0x1` after an immediate.
        line = re.sub(rf"\s*{re.escape(comment)}.*$", "", line.rstrip())
        stripped = line.strip()
        if not stripped:
            continue
        if (
            stripped.startswith(".")
            and not stripped.startswith(KEEP_DIRECTIVES)
            and not stripped.endswith(":")
        ):
            continue
        # WebAssembly's control flow is structured: a branch names a nesting depth, never a
        # label, so the labels LLVM prints beside `end_loop` mean nothing to a reader of it.
        if target == "wasm" and re.match(r"^\.LBB\d+_\d+:$", stripped):
            continue
        out.append(line.replace("\t", "    ").rstrip())
    return "\n".join(out)


def fragment(exp: experiments.Experiment, lowering: experiments.Lowering, target: str, version: str) -> str:
    asm = assemble(exp.kernel, target, lowering.opt)
    bodies = "\n\n".join(function_body(asm, f, target) for f in lowering.functions)
    name, triple, flags, _ = TARGETS[target]
    lang = "wasm" if target == "wasm" else "asm"
    syntax = ", Intel syntax" if target == "x86-64" else ""
    extra = " ".join(f for f in flags if f.startswith("-m") and f != "-masm=intel")
    extra = f", {extra}" if extra else ""
    kernel = exp.kernel.relative_to(ROOT)
    return (
        f"% Generated by tools/lower.py from {kernel}. Do not edit.\n"
        f"```{lang}\n{bodies}\n```\n\n"
        f"*Emitted by clang {version} for {triple} at -{lowering.opt}{extra}{syntax}: {name}. "
        f"Representative: another compiler, version or flag set may emit different instructions.*\n"
    )


def fragments(version: str) -> dict[str, str]:
    """Every fragment the catalogue asks for, by file name under chapters/_generated."""
    out = {}
    for name in EXPERIMENTS:
        if name not in experiments.available():
            continue
        exp = experiments.load(name)
        for lowering in exp.lowerings:
            for target in lowering.targets:
                out[Path(lowering.fragment(name, target)).name] = fragment(exp, lowering, target, version)
    return out


def write(fragments_: dict[str, str]) -> None:
    GENERATED.mkdir(parents=True, exist_ok=True)
    for file, text in fragments_.items():
        (GENERATED / file).write_text(text)


def check(fragments_: dict[str, str]) -> int:
    """Compare what clang emits now with what is committed; say what differs."""
    bad = []
    for file, text in fragments_.items():
        path = GENERATED / file
        if not path.exists():
            bad.append(f"missing: chapters/_generated/{file} (run `make lower`)")
        elif path.read_text() != text:
            bad.append(f"stale: chapters/_generated/{file} (run `make lower`)")
    for path in sorted(GENERATED.glob("*.md")):
        if path.name not in fragments_ and "tools/lower.py" in path.read_text().splitlines()[0]:
            bad.append(f"orphan: chapters/_generated/{path.name} (no contract asks for it)")
    for b in bad:
        print("  " + b)
    return 1 if bad else 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument(
        "--check", action="store_true", help="compare the committed fragments with clang's output"
    )
    parser.add_argument("--wasm", action="store_true", help="build only the WebAssembly modules")
    parser.add_argument("--out", default=str(WASM_OUT), help="where the .wasm modules go")
    args = parser.parse_args()
    version = check_version()
    if not args.check:
        for name in EXPERIMENTS:
            if name in experiments.available():
                build_wasm(experiments.load(name), Path(args.out) / f"{name}.wasm")
        where = Path(args.out)
        built = len([n for n in EXPERIMENTS if n in experiments.available()])
        print(
            f"  built {built} modules into {where.relative_to(ROOT) if where.is_relative_to(ROOT) else where}"
        )
    if args.wasm:
        return 0
    with tempfile.TemporaryDirectory():
        made = fragments(version)
    if args.check:
        status = check(made)
        if status == 0:
            where = Path(args.out)
        print(f"  {len(made)} fragments are what clang {version} emits")
        return status
    write(made)
    print(f"  wrote {len(made)} fragments into chapters/_generated")
    return 0


if __name__ == "__main__":
    sys.exit(main())
