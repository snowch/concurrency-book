"""MyST's parse, rendered to HTML: the one renderer every page of the book goes through.

The input is MyST's own parse output, the JSON ``myst build`` writes under
``_build/site/content/``, not the markdown. Directives are already resolved in it: every
``{literalinclude}`` carries the real code from the working tree and every ``{include}`` carries
the real generated fragment, so there is no second implementation of either to drift.

A node type the renderer does not know **raises**. It is never skipped: a renderer that quietly
drops what it does not recognise loses content, and the only symptom is a paragraph nobody
notices is missing.

Three node shapes are this book's own:

- A fenced block in the language ``lab`` is an experiment. It becomes a mount point that
  ``web/lab/lab.js`` fills with the kernel on real workers, and the renderer checks that the
  experiment exists and that every setting the block gives is one its contract allows.
- A ``{literalinclude}`` of a file in this repository gets a bar naming the file, because the
  book's code is quoted from the implementation, and the reader should always be able to see
  which file a block came from.
- A ``{tab-set}`` whose items are synced to one group's keys is the same thing seen from several
  sides: an architecture group (x86-64, AArch64, RISC-V, WebAssembly) or a language group (C,
  Rust). Every tab set on every page follows one choice per group, which the page's head script
  keeps; without JavaScript every panel is shown, one after the other.
"""

from __future__ import annotations

import contextvars
import html
import json
import re
from pathlib import Path

from tools import experiments
from tools.highlight import highlight
from tools.outline import BY_ANCHOR, EXPERIMENTS

ROOT = Path(__file__).resolve().parent.parent
REPO_URL = "https://github.com/snowch/concurrency-book/blob/main/"


class UnknownNodeError(Exception):
    """A node type the renderer does not handle. Raised, never skipped."""


class LabBlockError(Exception):
    """A ``lab`` block that names an experiment, mode or setting that does not exist."""


class TabSetError(Exception):
    """A tab set whose tabs are not one of the book's groups."""


#: The tab groups a tab set may use: the key each tab syncs on, and the tab's label, in the
#: order the tabs appear. ``web/book.css`` and the head script know the group names.
TAB_GROUPS = {
    "arch": {
        "x86-64": "x86-64",
        "aarch64": "AArch64",
        "aarch64-lse": "AArch64 (LSE)",
        "riscv64": "RISC-V",
        "wasm": "WebAssembly",
    },
    "code": {"c": "C", "rust": "Rust"},
}

#: Keys a ``lab`` block may carry besides the experiment's own controls.
LAB_KEYS = ("experiment", "mode", "lock", "title", "autorun")

#: MyST page slug -> the file this build publishes it as. Filled in by the site build.
PAGES: dict[str, str] = {}

#: An image a page shows -> the file in this repository it is copied from. Filled in as pages
#: render, for the site build to copy each one beside the pages.
IMAGES: dict[str, Path] = {}

#: A reference whose text opens with a chapter label, which the renderer re-derives.
LABELLED = re.compile(r"^(ch\d+|Appendix [A-Z])\b")


def text_of(node) -> str:
    if isinstance(node, dict):
        if node.get("type") in ("text", "inlineCode"):
            return str(node.get("value", ""))
        return "".join(text_of(c) for c in node.get("children", []))
    if isinstance(node, list):
        return "".join(text_of(c) for c in node)
    return ""


def heading_id(node: dict) -> str:
    if node.get("html_id"):
        return str(node["html_id"])
    keep = "".join(c.lower() if c.isalnum() else "-" for c in text_of(node))
    return "-".join(p for p in keep.split("-") if p)


def parse_key_values(value: str, kind: str) -> dict:
    config = {}
    for line in value.splitlines():
        if not line.strip():
            continue
        key, sep, val = line.partition(":")
        if not sep:
            raise LabBlockError(f"{kind} block line has no colon: {line!r}")
        config[key.strip()] = val.strip()
    return config


def parse_lab_block(value: str) -> tuple[dict, experiments.Experiment]:
    """A ``lab`` block is ``key: value`` lines. Validated here, so a typo fails the build."""
    config = parse_key_values(value, "lab")
    name = config.get("experiment")
    if name not in EXPERIMENTS:
        raise LabBlockError(f"unknown experiment {name!r}; known: {', '.join(EXPERIMENTS)}")
    if name not in experiments.available():
        raise LabBlockError(f"experiment {name!r} has no contract yet (experiments/{name}/experiment.json)")
    exp = experiments.load(name)
    controls = {c["name"]: c for c in exp.controls}
    if "mode" in config and config["mode"] not in exp.modes:
        raise LabBlockError(f"lab block asks for mode {config['mode']!r}; {name} offers {exp.modes}")
    for locked in filter(None, config.get("lock", "").split(",")):
        if locked.strip() not in controls:
            raise LabBlockError(f"lab block locks {locked.strip()!r}, which is not a control of {name}")
    for key, val in config.items():
        if key in LAB_KEYS:
            continue
        if key not in controls:
            raise LabBlockError(f"lab block sets {key!r}, which is not a control of {name}: {list(controls)}")
        c = controls[key]
        if c["kind"] == "range":
            if not re.fullmatch(r"-?\d+", val) or not c["min"] <= int(val) <= c["max"]:
                raise LabBlockError(
                    f"{name}.{key} must be an integer from {c['min']} to {c['max']}, not {val!r}"
                )
        elif c["kind"] == "select":
            if val not in [str(o) for o in c["options"]]:
                raise LabBlockError(f"{name}.{key} must be one of {c['options']}, not {val!r}")
        elif c["kind"] == "toggle":
            if val not in ("true", "false"):
                raise LabBlockError(f"{name}.{key} must be true or false, not {val!r}")
    return config, exp


def _lab(node: dict) -> str:
    config, exp = parse_lab_block(str(node.get("value", "")))
    attrs = " ".join(f'data-{html.escape(k)}="{html.escape(v)}"' for k, v in config.items())
    contract = json.dumps(exp.raw, separators=(",", ":")).replace("</", "<\\/")
    return (
        f'<div class="lab" {attrs}>'
        f'<script type="application/json" class="lab-contract">{contract}</script>'
        '<p class="lab-fallback">This experiment runs the chapter\'s C kernel in your browser, '
        "compiled to WebAssembly, on real threads where the browser allows them. It needs "
        'JavaScript. The same kernel runs at a desk: see <a href="reproducing-at-a-desk.html">'
        "Appendix A</a>.</p></div>"
    )


#: The instruction set of the generated fragment being rendered, if any, so the highlighter can
#: give each mnemonic the meaning it has there. Set while an include of a fragment renders.
_TARGET: contextvars.ContextVar[str | None] = contextvars.ContextVar("fragment_target", default=None)

#: How a generated fragment's file name ends for each instruction set (tools/lower.py names them).
_FRAGMENT_TARGETS = (
    ("-aarch64-lse.md", "aarch64"),
    ("-aarch64.md", "aarch64"),
    ("-x86-64.md", "x86-64"),
    ("-riscv64.md", "riscv64"),
    ("-wasm.md", "wasm"),
)


def _fragment_target(include: dict) -> str | None:
    name = str(include.get("file", ""))
    if "_generated/" not in name:
        return None
    return next((target for suffix, target in _FRAGMENT_TARGETS if name.endswith(suffix)), None)


#: The labels a note may carry: where the machinery it explains comes from. A note's class names
#: one of these; the renderer prints the label on the fold, so a reader sees before opening it
#: that the note is not the subject of the page.
NOTE_LABELS = {
    "c": "C",
    "compiler": "Compiler",
    "library": "Library",
    "os": "Operating system",
    "isa": "Instruction set",
    "hardware": "Hardware",
    "deep": "Deep dive",
}


def _details(node: dict, footnotes: list | None) -> str:
    """A MyST dropdown: a folded note. Its class must name where the machinery comes from."""
    classes = str(node.get("class", "")).split()
    labels = [c for c in classes if c in NOTE_LABELS]
    if len(labels) != 1:
        raise ValueError(
            f"a dropdown needs exactly one of the note labels {sorted(NOTE_LABELS)} as its class, "
            f"got {classes}"
        )
    label = NOTE_LABELS[labels[0]]
    kids = node.get("children", [])
    if not kids or kids[0].get("type") != "summary":
        raise ValueError("a dropdown needs a title")
    summary = "".join(render(c, footnotes) for c in kids[0].get("children", []))
    body = "".join(render(c, footnotes) for c in kids[1:])
    open_ = " open" if node.get("open") else ""
    cls = " ".join(["aside", *classes])
    return (
        f'<details class="{html.escape(cls)}"{open_}>'
        f'<summary data-label="{html.escape(label)}">{summary}</summary>{body}</details>'
    )


def _code(node: dict) -> str:
    lang = node.get("lang") or ""
    # One blank line at most: an excerpt that spans two definitions keeps the two blank lines the
    # formatter puts between them in the source, and on a phone every line counts.
    code = re.sub(r"\n(?:[ \t]*\n){2,}", "\n\n", str(node.get("value", "")))
    body = highlight(code, lang, _TARGET.get())
    cls = f' class="language-{html.escape(lang)}"' if lang else ""
    return f"<pre><code{cls}>{body}</code></pre>"


def _repo_path(include: dict) -> str:
    # MyST gives the path as written in the page, relative to it. Resolve against the
    # repository, so the bar can name the file the way the reader will find it on disk.
    clean = str(include.get("file", ""))
    while clean.startswith("../"):
        clean = clean[3:]
    return clean


#: What the bar above a quoted file calls the place it came from.
SOURCES = (
    ("experiments/", "From the laboratory"),
    ("web/lab/", "From the runtime"),
    ("native/", "From the harness"),
    ("tools/", "From the build"),
    ("scripts/", "From the build"),
)


def _source_bar(include: dict) -> str:
    clean = _repo_path(include)
    label = next((name for prefix, name in SOURCES if clean.startswith(prefix)), "From the repository")
    return (
        f'<div class="source-bar"><span class="source-label">{label}</span>'
        f'<a href="{REPO_URL}{html.escape(clean)}"><code>{html.escape(clean)}</code></a></div>'
    )


def _tab_set(node: dict, footnotes: list | None) -> str:
    items = node.get("children", [])
    syncs = [str(i.get("sync", "")) for i in items]
    if any(i.get("type") != "tabItem" for i in items) or len(syncs) < 2 or len(set(syncs)) != len(syncs):
        raise TabSetError(
            f"a tab set holds two or more tab-items, each synced to a distinct key, not {syncs} "
            f"(near {json.dumps(node.get('position', {}))})"
        )
    group = next((g for g, keys in TAB_GROUPS.items() if set(syncs) <= set(keys)), None)
    if group is None:
        raise TabSetError(
            f"a tab set's keys must all come from one group, not {syncs}; the groups are "
            f"{ {g: list(k) for g, k in TAB_GROUPS.items()} } (near {json.dumps(node.get('position', {}))})"
        )
    keys = TAB_GROUPS[group]
    items = sorted(items, key=lambda i: list(keys).index(i["sync"]))
    bar = "".join(
        f'<button type="button" role="tab" data-key="{i["sync"]}">{html.escape(keys[i["sync"]])}</button>'
        for i in items
    )
    panels = "".join(
        f'<div class="tab-panel" role="tabpanel" data-key="{i["sync"]}">'
        + "".join(render(c, footnotes) for c in i.get("children", []))
        + "</div>"
        for i in items
    )
    label = {"arch": "Architecture", "code": "Language"}[group]
    return (
        f'<div class="tab-set" data-group="{group}"><div class="tab-bar" role="tablist" aria-label="{label}">'
        f"{bar}</div>{panels}</div>"
    )


def _xref(node: dict, inner: str) -> str:
    """A link to another part of the book, as a relative URL this build publishes.

    MyST resolves a reference to a page-root URL such as ``/atomic-operations``. The site is
    served under a base path it is not told, so every internal link is rewritten to the relative
    file this build writes. A reference to a chapter whose text opens with a label (``ch05``)
    gets the label re-derived from the outline, so it cannot go stale when chapters move.
    """
    ident = str(node.get("identifier") or "")
    target = BY_ANCHOR.get(ident)
    if target is not None:
        text = text_of(node).strip()
        m = LABELLED.match(text)
        if m:
            inner = html.escape(target.label + text[m.end() :])
        return f'<a class="xref" href="{target.anchor}.html">{inner}</a>'
    url = str(node.get("url") or "")
    path, _, fragment = url.partition("#")
    if not fragment and node.get("type") == "crossReference":
        fragment = str(node.get("html_id") or ident)
    if path.startswith("/"):
        page = PAGES.get(path.strip("/") or "index")
        if page is None:
            raise UnknownNodeError(f"internal link to {url!r}, which this build does not publish")
        href = page + (f"#{fragment}" if fragment else "")
    else:
        href = f"#{fragment}"
    return f'<a class="xref" href="{html.escape(href)}">{inner}</a>'


def _image(node: dict) -> str:
    """An image from this repository, published beside the pages under its own file name.

    MyST copies an image it parses to a root-relative, hashed name, which breaks under a base
    path; the file it came from is in ``urlSource``. An SVG's width and height come from its
    ``viewBox``, so the page keeps the picture's room before it loads.
    """
    url = str(node.get("url", ""))
    alt = html.escape(str(node.get("alt", "")))
    source = str(node.get("urlSource") or "")
    if url.startswith("/"):
        path = ROOT / source
        if not source or not path.is_file():
            raise UnknownNodeError(f"image {url!r} is not a file in this repository")
        name = path.name
        if IMAGES.get(name, path) != path:
            raise UnknownNodeError(f"two images are published as {name!r}: {IMAGES[name]} and {path}")
        IMAGES[name] = path
        url = name
        box = (
            re.search(r'viewBox="[-\d.]+ [-\d.]+ ([\d.]+) ([\d.]+)"', path.read_text())
            if name.endswith(".svg")
            else None
        )
        size = f' width="{box.group(1)}" height="{box.group(2)}"' if box else ""
    else:
        size = ""
    return f'<img src="{html.escape(url)}" alt="{alt}"{size}>'


def _plain(node: dict) -> str:
    """A node's text, without markup: a table heading as a label."""
    if "value" in node and node.get("type") in ("text", "inlineCode"):
        return str(node["value"])
    return "".join(_plain(c) for c in node.get("children", []))


def render(node: dict, footnotes: list | None = None, label: str = "") -> str:
    """Render one node. ``label`` is a table cell's column heading."""
    kind = node.get("type")

    def children() -> str:
        return "".join(render(c, footnotes) for c in node.get("children", []))

    if kind == "text":
        return html.escape(str(node.get("value", "")))
    if kind in ("root", "block"):
        return children()
    if kind == "paragraph":
        return f"<p>{children()}</p>"
    if kind == "heading":
        level = min(max(int(node.get("depth", 2)), 1), 6)
        hid = heading_id(node)
        return (
            f'<h{level} id="{html.escape(hid)}">{children()}'
            f'<a class="anchor" href="#{html.escape(hid)}" aria-label="Link to this section">#</a></h{level}>'
        )
    if kind == "strong":
        return f"<strong>{children()}</strong>"
    if kind == "emphasis":
        return f"<em>{children()}</em>"
    if kind == "inlineCode":
        return f"<code>{html.escape(str(node.get('value', '')))}</code>"
    if kind == "keyboard":
        return f"<kbd>{children()}</kbd>"
    if kind == "break":
        return "<br>"
    if kind == "thematicBreak":
        return "<hr>"
    if kind == "comment":
        return ""
    if kind == "code":
        if node.get("lang") == "lab":
            return _lab(node)
        return _code(node)
    if kind == "include":
        if node.get("literal"):
            return (
                '<figure class="quoted">'
                + _source_bar(node)
                + "".join(render(c, footnotes) for c in node.get("children", []))
                + "</figure>"
            )
        token = _TARGET.set(_fragment_target(node))
        try:
            return f'<div class="generated">{children()}</div>'
        finally:
            _TARGET.reset(token)
    if kind == "details":
        return _details(node, footnotes)
    if kind == "tabSet":
        return _tab_set(node, footnotes)
    if kind == "blockquote":
        return f"<blockquote>{children()}</blockquote>"
    if kind == "list":
        tag = "ol" if node.get("ordered") else "ul"
        start = node.get("start")
        attr = f' start="{int(start)}"' if tag == "ol" and start not in (None, 1) else ""
        return f"<{tag}{attr}>{children()}</{tag}>"
    if kind == "listItem":
        # A tight list item holds one paragraph; unwrap it so the list does not double-space.
        kids = node.get("children", [])
        if len(kids) == 1 and kids[0].get("type") == "paragraph":
            return f"<li>{''.join(render(c, footnotes) for c in kids[0].get('children', []))}</li>"
        return f"<li>{children()}</li>"
    if kind == "table":
        rows = node.get("children", [])
        head = [r for r in rows if all(c.get("header") for c in r.get("children", []))]
        body = [r for r in rows if r not in head]
        thead = "".join(render(r, footnotes) for r in head)
        # Each body cell carries its column's heading, so a wide table can become one card per row
        # on a narrow screen (web/book.css), with every value labelled, instead of squeezing a
        # sentence into a column one word wide.
        labels = [_plain(c) for c in head[0].get("children", [])] if head else []
        tbody = "".join(
            "<tr>"
            + "".join(
                render(c, footnotes, label=labels[i] if i < len(labels) else "")
                for i, c in enumerate(r.get("children", []))
            )
            + "</tr>"
            for r in body
        )
        wide = ' class="cards"' if len(labels) >= 5 else ""
        return (
            f'<div class="table-wrap"><table{wide}>'
            f"{'<thead>' + thead + '</thead>' if thead else ''}<tbody>{tbody}</tbody></table></div>"
        )
    if kind == "tableRow":
        return f"<tr>{children()}</tr>"
    if kind == "tableCell":
        tag = "th" if node.get("header") else "td"
        align = node.get("align")
        style = f' class="align-{align}"' if align in ("left", "right", "center") else ""
        data = f' data-label="{html.escape(label)}"' if label else ""
        return f"<{tag}{style}{data}>{children()}</{tag}>"
    if kind == "div":
        classes = " ".join(str(node.get("class", "")).split())
        return f'<div class="{html.escape(classes)}">{children()}</div>'
    if kind == "admonition":
        return f'<aside class="admonition {html.escape(str(node.get("kind", "note")))}">{children()}</aside>'
    if kind == "admonitionTitle":
        return f'<p class="admonition-title">{children()}</p>'
    if kind == "link" and node.get("internal"):
        return _xref(node, children())
    if kind == "link":
        url = str(node.get("url", ""))
        ext = url.startswith(("http://", "https://"))
        rel = ' rel="noopener"' if ext else ""
        return f'<a href="{html.escape(url)}"{rel}>{children()}</a>'
    if kind == "crossReference":
        return _xref(node, children())
    if kind == "mystTarget":
        return f'<span id="{html.escape(str(node.get("label", "")))}"></span>'
    if kind == "footnoteReference":
        n = html.escape(str(node.get("enumerator") or node.get("label")))
        return f'<sup class="fn"><a id="fnref-{n}" href="#fn-{n}">{n}</a></sup>'
    if kind == "footnoteDefinition":
        if footnotes is not None:
            footnotes.append(node)
        return ""
    if kind == "image":
        return _image(node)
    if kind == "container":
        return f"<figure>{children()}</figure>"
    if kind == "caption":
        return f"<figcaption>{children()}</figcaption>"
    if kind in ("subscript", "superscript", "delete"):
        tag = {"subscript": "sub", "superscript": "sup", "delete": "del"}[kind]
        return f"<{tag}>{children()}</{tag}>"
    if kind == "abbreviation":
        return f'<abbr title="{html.escape(str(node.get("title", "")))}">{children()}</abbr>'
    raise UnknownNodeError(
        f"no renderer for MyST node type {kind!r}; add a branch to tools/render.py "
        f"(near {json.dumps(node.get('position', {}))})"
    )


def render_page(mdast: dict) -> str:
    """The body of a page, with its footnotes collected at the end."""
    footnotes: list = []
    body = render(mdast, footnotes)
    if footnotes:
        items = "".join(
            f'<li id="fn-{html.escape(str(f.get("enumerator") or f.get("label")))}">'
            f"{''.join(render(c) for c in f.get('children', []))}</li>"
            for f in footnotes
        )
        body += f'<section class="footnotes"><ol>{items}</ol></section>'
    return body
