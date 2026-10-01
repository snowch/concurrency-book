"""Every experiment's contract says what the build, the page and the chapters need."""

from __future__ import annotations

import json
import re
from pathlib import Path

import pytest

from tools import experiments
from tools.outline import EXPERIMENTS

ROOT = Path(__file__).resolve().parent.parent
AVAILABLE = experiments.available()


def test_the_catalogue_is_a_prefix_of_the_outline_in_any_order():
    assert set(AVAILABLE) <= set(EXPERIMENTS)


@pytest.mark.parametrize("name", AVAILABLE)
def test_the_contract_loads_and_its_kernel_follows_cm_h(name):
    exp = experiments.load(name)
    src = exp.kernel.read_text()
    assert '#include "../cm.h"' in src, "a kernel includes experiments/cm.h"
    for fn in ("cm_run", "cm_reset", "cm_result"):
        assert f'CM_EXPORT("{fn}")' in src, f"{name}: exports {fn}"
    assert "cm_barrier_wait();" in src, f"{name}: cm_run waits at the start barrier"
    for lowering in exp.lowerings:
        for fn in lowering.functions:
            assert re.search(rf"\b{re.escape(fn)}\s*\(", src), (
                f"{name}: lowering names {fn}, which the kernel lacks"
            )
        for target in lowering.targets:
            assert (ROOT / "chapters" / lowering.fragment(name, target)).exists(), (
                f"{name}: fragment {lowering.fragment(name, target)} is missing; run `make lower`"
            )


@pytest.mark.parametrize("name", AVAILABLE)
def test_controls_and_native_examples_agree_with_the_arguments(name):
    exp = experiments.load(name)
    names = [c["name"] for c in exp.controls]
    for a in exp.args:
        assert a in names
    if exp.native:
        assert exp.native["example"].split()[0].isdigit(), "the native example starts with the worker count"


def test_a_bad_contract_is_refused(tmp_path, monkeypatch):
    bad = tmp_path / "bad"
    bad.mkdir()
    (bad / "bad.c").write_text("")
    contract = {
        "name": "bad",
        "title": "x",
        "kernel": "bad.c",
        "summary": "",
        "modes": ["live"],
        "results": [{"name": "r", "label": "r", "what": "w"}],
        "controls": [{"name": "n", "label": "n", "kind": "range", "min": 1, "max": 2, "default": 9}],
    }
    (bad / "experiment.json").write_text(json.dumps(contract))
    monkeypatch.setattr(experiments, "EXPERIMENTS_DIR", tmp_path)
    with pytest.raises(experiments.ContractError):
        experiments.load("bad")
