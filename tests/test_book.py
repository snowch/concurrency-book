"""The book's structure and its rules, held by tests rather than by habit.

Each test here enforces something CLAUDE.md or AUTHORING_GUIDE.md says. If one fails, the page
is wrong or the rule is, and the rule's documentation says which to suspect.
"""

from __future__ import annotations

import importlib.util
import re
from pathlib import Path

import pytest
import yaml

from tools import experiments
from tools.outline import (
    APPENDICES,
    CHAPTER_SHAPE,
    CHAPTERS,
    EXPERIMENTS,
    FRONT,
    OPTIONAL_HEADINGS,
    PARTS,
    UNWRITTEN,
)
from tools.render import LabBlockError, parse_lab_block

ROOT = Path(__file__).resolve().parent.parent
BOOK_PAGES = sorted(
    [ROOT / "cover.md", ROOT / "index.md"]
    + [ROOT / f.path for f in FRONT]
    + list((ROOT / "parts").glob("*.md"))
    + list((ROOT / "chapters").glob("*.md"))
    + list((ROOT / "appendices").glob("*.md"))
)
DOCS = [
    ROOT / n for n in ("README.md", "CLAUDE.md", "PLAN.md", "AUTHORING_GUIDE.md", "STYLE.md", "NEXT_STEPS.md")
]
WRITTEN = [c for c in CHAPTERS if UNWRITTEN not in (ROOT / c.path).read_text()]


def fences(text: str):
    """Yield (language, body) for every fenced block."""
    for m in re.finditer(r"^```([^\n]*)\n(.*?)^```\s*$", text, re.M | re.S):
        yield m.group(1).strip(), m.group(2)


def prose(text: str) -> str:
    """The page with its fenced blocks and inline code removed."""
    text = re.sub(r"^```.*?^```\s*$", "", text, flags=re.M | re.S)
    return re.sub(r"`[^`\n]*`", "", text)


def headings(text: str, level: int) -> list[str]:
    return [m.group(1).strip() for m in re.finditer(rf"^{'#' * level} (.+)$", prose(text), re.M)]


def section(text: str, heading: str) -> str:
    """The text of one `##` section of a chapter."""
    m = re.search(rf"^## {re.escape(heading)}\n(.*?)(?=^## |\Z)", text, re.M | re.S)
    return m.group(1) if m else ""


def test_the_table_of_contents_is_the_outline():
    toc = yaml.safe_load((ROOT / "myst.yml").read_text())["project"]["toc"]
    files = [toc[0]["file"]]
    for entry in toc[1:]:
        if "file" in entry:
            files.append(entry["file"])
        files += [c["file"] for c in entry.get("children", [])]
    expected = ["cover.md", "index.md"] + [f.path for f in FRONT]
    for part in PARTS:
        expected.append(part.path)
        expected += [c.path for c in CHAPTERS if c.part == part.title]
    expected += [a.path for a in APPENDICES]
    assert files == expected


@pytest.mark.parametrize("chapter", CHAPTERS, ids=lambda c: c.slug)
def test_every_chapter_has_the_shape(chapter):
    text = (ROOT / chapter.path).read_text()
    found = headings(text, 2)
    allowed = [h for h in CHAPTER_SHAPE if h in found or h not in OPTIONAL_HEADINGS]
    assert found == allowed, f"the headings are {CHAPTER_SHAPE}, less any of {sorted(OPTIONAL_HEADINGS)}"
    assert f"({chapter.anchor})=" in text, "the chapter's label is its slug"
    assert f"\ntitle: {chapter.title}\n" in text or f'\ntitle: "{chapter.title}"\n' in text
    assert f"\n# {chapter.title}\n" in text, "the heading repeats the title, so MyST drops it"


def test_no_identifier_carries_a_chapter_number():
    """A chapter's number is derived from its position. Labels and slugs never contain one."""
    for c in CHAPTERS:
        assert not re.search(r"(^|_)\d+(_|$)|ch\d", c.slug), c.slug


@pytest.mark.parametrize("page", BOOK_PAGES, ids=lambda p: str(p.relative_to(ROOT)))
def test_code_is_quoted_by_text_anchor_never_by_line_number(page):
    assert ":lines:" not in page.read_text(), "line numbers rot on the first edit above them"


@pytest.mark.parametrize("page", BOOK_PAGES, ids=lambda p: str(p.relative_to(ROOT)))
def test_no_kernel_or_assembly_is_pasted_into_a_page(page):
    """C is quoted from experiments/ with {literalinclude}; assembly comes from the generated
    fragments. A pasted block could drift from what the build compiles and runs."""
    for lang, _ in fences(page.read_text()):
        assert lang not in ("c", "h", "asm", "s", "wasm", "wat"), "quote the kernel or include the fragment"


@pytest.mark.parametrize("page", BOOK_PAGES + DOCS, ids=lambda p: p.name)
def test_no_em_dashes(page):
    if not page.exists():
        pytest.skip("not written")
    assert chr(0x2014) not in page.read_text(), "STYLE.md: no em dashes"


BANNED = [r"\bIn this chapter\b", r"\bsimply\b", r"\bobviously\b", r"\bjust\b", r"\bbasically\b"]


@pytest.mark.parametrize("page", BOOK_PAGES, ids=lambda p: str(p.relative_to(ROOT)))
def test_prose_avoids_the_words_style_md_bans(page):
    text = prose(page.read_text())
    found = [p for p in BANNED if re.search(p, text, re.I)]
    assert not found, f"STYLE.md rule 13: {found}"


def lab_blocks(text: str) -> list[dict]:
    return [parse_lab_block(body)[0] for lang, body in fences(text) if lang == "lab"]


@pytest.mark.parametrize("chapter", CHAPTERS, ids=lambda c: c.slug)
def test_experiments_are_the_ones_the_outline_declares(chapter):
    text = (ROOT / chapter.path).read_text()
    used = {b["experiment"] for b in lab_blocks(text)}
    if chapter in WRITTEN:
        assert used == set(chapter.experiments)
    else:
        assert used <= set(chapter.experiments)


def test_every_experiment_is_used_by_some_chapter():
    used = {e for c in CHAPTERS for e in c.experiments}
    assert used == set(EXPERIMENTS)


def test_a_lab_block_naming_an_unknown_experiment_or_setting_is_refused():
    with pytest.raises(LabBlockError):
        parse_lab_block("experiment: nonsense")
    with pytest.raises(LabBlockError):
        parse_lab_block("experiment: counter\nworkers: 999")
    with pytest.raises(LabBlockError):
        parse_lab_block("experiment: counter\noperation: slow")
    with pytest.raises(LabBlockError):
        parse_lab_block("experiment: counter\nmode: dream")
    with pytest.raises(LabBlockError):
        parse_lab_block("experiment: counter\nlock: colour")


def test_every_mounted_experiment_has_a_panel_and_a_contract():
    """An experiment with a contract has a panel module for the page, and a trace program if it
    offers a trace; the catalogue the outline names is the only one the pages may use."""
    programs = (ROOT / "web" / "lab" / "programs.js").read_text()
    for name in experiments.available():
        assert name in EXPERIMENTS, f"experiments/{name} is not in tools/outline.EXPERIMENTS"
        exp = experiments.load(name)
        assert (ROOT / "web" / "lab" / f"{name}.js").exists(), f"web/lab/{name}.js does not exist"
        if "trace" in exp.modes:
            assert re.search(rf"\b{exp.trace['program']}\b", programs), (
                f"no trace program {exp.trace['program']}"
            )


@pytest.mark.parametrize("chapter", WRITTEN, ids=lambda c: c.slug)
def test_a_written_chapter_runs_something_and_shows_the_instructions(chapter):
    """Every chapter has at least one experiment, quotes at least one generated fragment under
    *At the machine*, quotes its kernel rather than pasting it, and ends on a model."""
    text = (ROOT / chapter.path).read_text()
    assert lab_blocks(text), "a chapter embeds at least one lab block"
    machine = section(text, "At the machine")
    assert "{include} _generated/" in machine, "At the machine includes a generated fragment"
    assert "{literalinclude} ../experiments/" in text, "the kernel is quoted from experiments/"
    model = section(text, "The mental model")
    assert ":class: model" in model, "The mental model sits in a div with class model"
    for m in re.finditer(r"```\{include\} (\S+)", text):
        assert (ROOT / "chapters" / m.group(1)).exists(), m.group(1)


@pytest.mark.parametrize("chapter", WRITTEN, ids=lambda c: c.slug)
def test_a_written_chapter_opens_on_its_question(chapter):
    text = (ROOT / chapter.path).read_text()
    opening = section(text, "The question").strip().splitlines()[0]
    assert opening == chapter.question, "The question opens with the outline's question, word for word"


def test_the_renderer_and_the_outline_know_the_same_pages():
    spec = importlib.util.spec_from_file_location("build_site", ROOT / "scripts" / "build-site.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    sources = [p["source"] for p in module.page_list()]
    assert sources[:2] == ["cover.md", "index.md"], "the cover, then the preface"
    assert sorted(sources) == sorted(str(p.relative_to(ROOT)) for p in BOOK_PAGES)


LICENCES = {"CC-BY-NC-4.0": ("CC BY-NC 4.0", "LICENSE"), "Apache-2.0": ("Apache 2.0", "LICENSE-CODE")}


def test_the_cover_names_the_author_and_the_licences_myst_declares():
    config = yaml.safe_load((ROOT / "myst.yml").read_text())["project"]
    cover = (ROOT / "cover.md").read_text()
    assert f"By {config['authors'][0]['name']}, in collaboration with Claude (Anthropic)" in cover
    repo = config["github"].rstrip("/")
    for part in ("content", "code"):
        name, file = LICENCES[config["license"][part]]
        assert f"[{name}]({repo}/blob/main/{file})" in cover, part
        assert (ROOT / file).is_file()
    assert "cover-hero.svg" in cover and (ROOT / "web" / "cover-hero.svg").is_file()
    assert "](#preface)" in cover, "the cover starts the reader at the preface"


def test_the_number_check_catches_a_typed_number():
    spec = importlib.util.spec_from_file_location("verify_numbers", ROOT / "scripts" / "verify-numbers.py")
    vn = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(vn)
    page = ROOT / "chapters" / "_scratch_test_page.md"
    try:
        page.write_text("---\ntitle: x\n---\n\nThe run lost 380 updates.\n\n```\n637 bytes\n```\n")
        found = vn.problems(page)
        assert len(found) == 1 and "380 updates" in found[0]
        page.write_text("% number-ok: a definition\nA power of 256.\n\nA power of 256.\n")
        assert len(vn.problems(page)) == 1
        page.write_text("A 32-bit word on x86-64 and AArch64, since C11.\n")
        assert vn.problems(page) == []
    finally:
        page.unlink()


def test_every_generated_fragment_states_its_conditions():
    """A fragment makes a claim about a compiler or a model; its last line bounds the claim."""
    for path in sorted((ROOT / "chapters" / "_generated").glob("*.md")):
        lines = path.read_text().rstrip().splitlines()
        assert lines[0].startswith("% Generated by"), path.name
        assert lines[-1].startswith("*") and lines[-1].endswith("*"), (
            f"{path.name} ends with its conditions line"
        )
        if path.name.startswith("legend-"):
            assert "mnemonics.py" in lines[-1], f"{path.name} says where the meanings come from"
        elif "lower.py" in lines[0]:
            assert "Representative" in lines[-1], f"{path.name} says the assembly is representative"
            assert ":class: layers" in path.read_text(), f"{path.name} names its four layers"
        if "trace.mjs" in lines[0]:
            assert "not the compiled code" in lines[-1], f"{path.name} says a trace is a model"


def test_every_instruction_in_the_fragments_has_a_meaning():
    """The legend and the hover text come from one dictionary, and a kernel change that brings a
    new instruction into a fragment must bring its meaning too."""
    from tools import lower, mnemonics

    for path in sorted((ROOT / "chapters" / "_generated").glob("*.md")):
        m = re.search(r"```(asm|wasm)\n(.*?)```", path.read_text(), re.S)
        if not m:
            continue
        name = path.name
        target = (
            "wasm"
            if name.endswith("-wasm.md")
            else "x86-64"
            if name.endswith("-x86-64.md")
            else "aarch64"
            if "-aarch64" in name
            else "riscv64"
        )
        assert not mnemonics.unknown(target, lower.used_mnemonics(m.group(2))), name


def test_glossary_terms_are_bold_and_cite_a_chapter():
    text = (ROOT / "appendices" / "glossary.md").read_text()
    entries = re.findall(r"^\*\*(.+?)\.\*\* (.+?)(?=\n\n|\Z)", text, re.M | re.S)
    assert entries, "the glossary has entries"
    names = [e[0] for e in entries]
    assert names == sorted(names, key=str.lower), "entries are alphabetical"
    for name, body in entries:
        assert re.search(r"\[ch\d\d\]\(#[\w-]+\)", body), f"{name}: names the chapter that introduces it"
