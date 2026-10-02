"""The experiment catalogue: one contract per directory under ``experiments/``.

An experiment is a kernel (freestanding C), a declarative contract (``experiment.json``) and a
panel (``web/lab/<name>.js``) that draws what the kernel reports. The contract says what the
reader can set, what the kernel reports, which modes the panel offers, which functions the
chapters quote as assembly, and how to run the kernel natively. This module reads and validates
the contracts; the renderer, the build and the tests all go through it.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
EXPERIMENTS_DIR = ROOT / "experiments"

#: The modes a panel may offer, in the order the shell shows them.
MODES = ("live", "trace", "native")
#: The kinds of control the shell knows how to draw.
CONTROL_KINDS = ("range", "select", "toggle")
#: The targets ``tools/lower.py`` can compile for.
TARGETS = ("wasm", "x86-64", "aarch64", "aarch64-lse", "riscv64")
DEFAULT_TARGETS = ("wasm", "x86-64", "aarch64", "riscv64")


class ContractError(Exception):
    """An ``experiment.json`` that does not say what the build needs."""


#: The four layers the book keeps apart, as a listing's strip names them.
LAYERS = ("language", "compiler", "isa", "microarchitecture")


@dataclass(frozen=True)
class Lowering:
    name: str
    functions: tuple[str, ...]
    opt: str
    targets: tuple[str, ...]
    #: The layer this listing is evidence for, which the strip under it sets in relief: ``isa``
    #: for most, ``compiler`` where the point is the compiler's choice, ``language`` where it is
    #: what the C asked for, ``microarchitecture`` where the explanation is in the layer no
    #: listing shows.
    layer: str = "isa"

    def fragment(self, experiment: str, target: str) -> str:
        """The generated fragment's file name, relative to ``chapters/``."""
        return f"_generated/{experiment}-{self.name}-{target}.md"


@dataclass(frozen=True)
class Experiment:
    name: str
    title: str
    kernel: Path
    summary: str
    requires: dict
    modes: tuple[str, ...]
    controls: tuple[dict, ...]
    args: tuple[str, ...]
    results: tuple[dict, ...]
    trace: dict | None
    lowerings: tuple[Lowering, ...]
    native: dict | None
    raw: dict

    @property
    def directory(self) -> Path:
        return EXPERIMENTS_DIR / self.name

    def control(self, name: str) -> dict:
        for c in self.controls:
            if c["name"] == name:
                return c
        raise KeyError(name)


def _check(condition: bool, message: str) -> None:
    if not condition:
        raise ContractError(message)


def load(name: str) -> Experiment:
    path = EXPERIMENTS_DIR / name / "experiment.json"
    _check(path.is_file(), f"experiments/{name}/experiment.json does not exist")
    raw = json.loads(path.read_text())
    _check(raw.get("name") == name, f"{path}: name must be {name!r}")
    kernel = EXPERIMENTS_DIR / name / raw.get("kernel", "")
    _check(kernel.is_file(), f"{path}: kernel {raw.get('kernel')!r} is not a file")
    modes = tuple(raw.get("modes", ()))
    _check(modes and all(m in MODES for m in modes), f"{path}: modes must be from {MODES}")
    controls = tuple(raw.get("controls", ()))
    names = set()
    for c in controls:
        _check(c.get("kind") in CONTROL_KINDS, f"{path}: control kind must be from {CONTROL_KINDS}: {c}")
        _check(
            "name" in c and "label" in c and "default" in c,
            f"{path}: a control needs name, label, default: {c}",
        )
        _check(c["name"] not in names, f"{path}: two controls named {c['name']!r}")
        names.add(c["name"])
        if c["kind"] == "range":
            _check({"min", "max"} <= set(c), f"{path}: a range needs min and max: {c}")
            _check(c["min"] <= c["default"] <= c["max"], f"{path}: default outside the range: {c}")
        if c["kind"] == "select":
            _check(c.get("options") and c["default"] in c["options"], f"{path}: default not an option: {c}")
    args = tuple(raw.get("args", ()))
    _check(len(args) <= 3 and all(a in names for a in args), f"{path}: args name up to three controls")
    results = tuple(raw.get("results", ()))
    _check(
        results and all({"name", "label", "what"} <= set(r) for r in results),
        f"{path}: results need name, label, what",
    )
    trace = raw.get("trace")
    if "trace" in modes:
        _check(isinstance(trace, dict) and "program" in trace, f"{path}: trace mode needs a trace.program")
    lowerings = []
    for lw in raw.get("lowerings", ()):
        targets = tuple(lw.get("targets", DEFAULT_TARGETS))
        _check(all(t in TARGETS for t in targets), f"{path}: lowering targets must be from {TARGETS}")
        _check(lw.get("opt") in ("O0", "O1", "O2", "O3", "Os"), f"{path}: lowering opt is O0..O3 or Os")
        _check(lw.get("functions"), f"{path}: a lowering names at least one function")
        layer = lw.get("layer", "isa")
        if layer not in LAYERS:
            raise ContractError(f"{name}: lowering {lw['name']!r} names layer {layer!r}; one of {LAYERS}")
        lowerings.append(Lowering(lw["name"], tuple(lw["functions"]), lw["opt"], targets, layer))
    native = raw.get("native")
    if "native" in modes:
        _check(isinstance(native, dict) and "example" in native, f"{path}: native mode needs native.example")
    return Experiment(
        name=name,
        title=raw["title"],
        kernel=kernel,
        summary=raw["summary"],
        requires=raw.get("requires", {}),
        modes=modes,
        controls=controls,
        args=args,
        results=results,
        trace=trace,
        lowerings=tuple(lowerings),
        native=native,
        raw=raw,
    )


def load_all(names) -> dict[str, Experiment]:
    return {n: load(n) for n in names}


def available() -> list[str]:
    """The experiments that have a contract today, in directory order."""
    return sorted(p.parent.name for p in EXPERIMENTS_DIR.glob("*/experiment.json"))
