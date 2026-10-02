"""The renderer refuses what it does not know and keeps what the page needs without scripts."""

from __future__ import annotations

import json
import re

import pytest

from tools import render


def test_an_unknown_node_type_raises_rather_than_vanishing():
    with pytest.raises(render.UnknownNodeError):
        render.render({"type": "hologram", "children": []})


def test_a_lab_block_becomes_a_mount_point_with_its_contract_and_a_fallback():
    out = render.render(
        {"type": "code", "lang": "lab", "value": "experiment: counter\nworkers: 1\nlock: workers"}
    )
    assert out.startswith('<div class="lab" ')
    assert 'data-experiment="counter"' in out and 'data-workers="1"' in out and 'data-lock="workers"' in out
    start = out.index('class="lab-contract">') + len('class="lab-contract">')
    contract = json.loads(out[start : out.index("</script>", start)])
    assert contract["name"] == "counter" and contract["controls"]
    assert "needs JavaScript" in out and "reproducing-at-a-desk.html" in out


def test_a_lab_block_with_a_bad_setting_fails_the_build():
    with pytest.raises(render.LabBlockError):
        render.render({"type": "code", "lang": "lab", "value": "experiment: counter\niterations: 7"})


def _tab(sync: str, text: str) -> dict:
    return {
        "type": "tabItem",
        "sync": sync,
        "children": [{"type": "paragraph", "children": [{"type": "text", "value": text}]}],
    }


def test_a_tab_set_follows_one_group():
    out = render.render({"type": "tabSet", "children": [_tab("aarch64", "arm"), _tab("x86-64", "intel")]})
    assert 'data-group="arch"' in out
    # Ordered as the group lists them, whatever the page's order.
    assert out.index('data-key="x86-64"') < out.index('data-key="aarch64"')
    assert (
        render.render({"type": "tabSet", "children": [_tab("c", "c"), _tab("rust", "r")]}).count("tab-panel")
        == 2
    )
    with pytest.raises(render.TabSetError):
        render.render({"type": "tabSet", "children": [_tab("c", "c"), _tab("wasm", "w")]})
    with pytest.raises(render.TabSetError):
        render.render({"type": "tabSet", "children": [_tab("c", "c")]})


def test_a_quoted_kernel_gets_a_bar_naming_its_file():
    out = render.render(
        {
            "type": "include",
            "literal": True,
            "file": "../experiments/counter/counter.c",
            "children": [{"type": "code", "lang": "c", "value": "int counter = 0;"}],
        }
    )
    assert "From the laboratory" in out and "experiments/counter/counter.c" in out
    assert '<span class="tok-type">int</span>' in out


def test_assembly_is_coloured_by_mnemonic():
    out = render.render(
        {"type": "code", "lang": "asm", "value": "increment:\n    lock inc dword ptr [rip + counter]"}
    )
    assert '<span class="tok-type">increment:</span>' in out
    assert re.search(r'class="tok-keyword tok-atomic"[^>]*>lock</span>', out)
    # Every mnemonic carries its one-line meaning as a hover, from the dictionary the legend uses.
    assert 'title="A prefix:' in out and ">inc</span>" in out and 'title="Adds one' in out


def test_a_fragment_is_explained_in_its_own_instruction_set():
    inc = {
        "type": "include",
        "file": "_generated/counter-increment-atomic-aarch64.md",
        "children": [{"type": "code", "lang": "asm", "value": "    ldxr w8, [x9]"}],
    }
    assert 'title="A load-exclusive' in render.render(inc)
    # Outside a fragment the target is unknown, and a mnemonic one instruction set knows still
    # gets that meaning.
    bare = {"type": "code", "lang": "asm", "value": "    ldxr w8, [x9]"}
    assert 'title="A load-exclusive' in render.render(bare)


def test_a_folded_note_carries_its_label_and_needs_one():
    note = {
        "type": "details",
        "class": "compiler",
        "children": [
            {"type": "summary", "children": [{"type": "text", "value": "Why CM_NOINLINE?"}]},
            {"type": "paragraph", "children": [{"type": "text", "value": "A compiler note."}]},
        ],
    }
    out = render.render(note)
    assert out.startswith('<details class="aside compiler"><summary data-label="Compiler">Why CM_NOINLINE?')
    assert "<p>A compiler note.</p></details>" in out
    with pytest.raises(ValueError):
        render.render({**note, "class": "trivia"})
    with pytest.raises(ValueError):
        render.render({**note, "class": "compiler os"})
