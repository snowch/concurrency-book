#!/usr/bin/env python3
"""The book as static pages, rendered from MyST's parse rather than MyST's theme.

    python3 scripts/build-site.py                 # every page, into _build/html/
    python3 scripts/build-site.py --out DIR

This is the published site, not a preview of one: the deploy runs this file against the same
parse ``make check`` does. It rests on three facts.

**MyST parses; this repository renders.** ``myst build --strict`` without ``--html`` produces the
AST and resolves every cross-reference, offline. ``tools/render.py`` walks the AST and raises on
anything it does not know. This file wraps the result in the site's chrome and writes it.

**The page is not somebody else's application.** Nothing hydrates, so the lab's script can own
the parts of the page it mounts into.

**Every URL is relative.** Pages are flat, and every asset is addressed from the page, so the
site works at a domain root, under a GitHub Pages project path, or opened from a disk.

One thing is this book's own. Real threads need shared memory, and a browser grants shared
memory only to a cross-origin isolated page: two response headers GitHub Pages cannot send. The
service worker this file writes (``service_worker``) adds them to every response, and the head
script reloads the page once after the worker installs. See CLAUDE.md, *How the browser runs
threads*.
"""

from __future__ import annotations

import argparse
import hashlib
import html
import json
import shutil
import subprocess
import sys
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from tools import experiments  # noqa: E402
from tools import render as renderer  # noqa: E402
from tools.outline import APPENDICES, CHAPTERS, EXPERIMENTS, PARTS, UNWRITTEN  # noqa: E402

CONTENT = ROOT / "_build" / "site" / "content"
WASM = ROOT / "_build" / "wasm"
TITLE = "Concurrency at the Metal"
SUBTITLE = "What happens below the mutex"
#: Every key the pages keep in the browser is prefixed, because the books of this family share
#: one origin (snowch.github.io), and the service worker's cache name likewise.
PREFIX = "concurrency-book"


def page_list() -> list[dict]:
    """Every page, in reading order, with what the chrome needs to know about it.

    The cover is published as index.html, where a reader arriving at the site lands, and the
    preface as preface.html. MyST names its pages by their place in the table of contents, so a
    link is resolved through MyST's slug, never through the name a page is published under.
    """
    pages = [
        {
            "source": "cover.md",
            "href": "index.html",
            "title": TITLE,
            "nav": "Cover",
            "label": None,
            "cover": True,
        },
        {"source": "index.md", "href": "preface.html", "title": "Preface", "label": None},
    ]
    for part in PARTS:
        pages.append(
            {
                "source": part.path,
                "href": f"{part.slug.replace('_', '-')}.html",
                "title": part.title,
                "label": None,
            }
        )
        for c in CHAPTERS:
            if c.part == part.title:
                pages.append(
                    {
                        "source": c.path,
                        "href": f"{c.anchor}.html",
                        "title": c.title,
                        "label": c.label,
                        "chapter": c,
                    }
                )
    for a in APPENDICES:
        pages.append({"source": a.path, "href": f"{a.anchor}.html", "title": a.title, "label": a.label})
    return pages


def load_parse() -> dict[str, dict]:
    if not CONTENT.exists():
        sys.exit("no MyST parse at _build/site/content; run ./scripts/parse-book.sh first")
    by_source = {}
    for path in CONTENT.glob("*.json"):
        data = json.loads(path.read_text())
        by_source[data["location"].lstrip("/")] = data
    return by_source


def is_unwritten(source: str) -> bool:
    return UNWRITTEN in (ROOT / source).read_text()


def nav_html(pages: list[dict], here: str) -> str:
    out = ['<nav class="nav" id="nav" aria-label="Chapters"><ol>']
    appendices = False
    for p in pages:
        if p["source"].startswith("appendices/") and not appendices:
            appendices = True
            out.append('<li class="part">Appendices</li>')
        cls = ["here"] if p["href"] == here else []
        if p.get("chapter") is not None and is_unwritten(p["source"]):
            cls.append("unwritten")
        c = f' class="{" ".join(cls)}"' if cls else ""
        aria = ' aria-current="page"' if p["href"] == here else ""
        if p["source"].startswith("parts/"):
            out.append(f'<li class="part"><a href="{p["href"]}"{aria}>{html.escape(p["title"])}</a></li>')
        elif p["label"]:
            num = p["label"].replace("Appendix ", "").replace("ch", "")
            out.append(
                f'<li><a href="{p["href"]}"{c}{aria}><span class="num">{html.escape(num)}</span>'
                f"{html.escape(p['title'])}</a></li>"
            )
        else:
            name = p.get("nav", p["title"])
            out.append(f'<li><a href="{p["href"]}"{c}{aria}>{html.escape(name)}</a></li>')
    out.append("</ol></nav>")
    return "".join(out)


def toc_html(mdast: dict) -> str:
    items = []
    for node in walk(mdast):
        if node.get("type") == "heading" and node.get("depth") in (2, 3):
            hid = renderer.heading_id(node)
            items.append(
                f'<li class="d{node["depth"]}"><a href="#{html.escape(hid)}">'
                f"{html.escape(renderer.text_of(node))}</a></li>"
            )
    if not items:
        return '<aside class="toc" id="toc"></aside>'
    return (
        f'<aside class="toc" id="toc" aria-label="On this page"><p>On this page</p>'
        f"<ol>{''.join(items)}</ol></aside>"
    )


def walk(node):
    if isinstance(node, dict):
        yield node
        for c in node.get("children", []):
            yield from walk(c)


def normalise_headings(mdast: dict) -> None:
    """Make the shallowest section heading an ``h2``: the page title is the only ``h1``."""
    depths = [n["depth"] for n in walk(mdast) if n.get("type") == "heading"]
    if not depths:
        return
    shift = 2 - min(depths)
    for n in walk(mdast):
        if n.get("type") == "heading":
            n["depth"] = max(2, min(6, n["depth"] + shift))


def commit() -> str:
    try:
        return subprocess.run(
            ["git", "rev-parse", "--short", "HEAD"], cwd=ROOT, capture_output=True, text=True, check=True
        ).stdout.strip()
    except (OSError, subprocess.CalledProcessError):
        return "uncommitted"


#: Before the page paints: the colour theme, the tab choices every tab set follows, and the
#: service worker that makes the page cross-origin isolated on a host that cannot set headers.
HEAD_SCRIPT = r"""<script>
(() => {
  const root = document.documentElement;
  const KEY = (k) => "concurrency-book:" + k;
  let theme = "system";
  try { const kept = localStorage.getItem(KEY("theme")); if (kept === "light" || kept === "dark") theme = kept; } catch (e) {}
  const apply = () => {
    if (theme === "system") root.removeAttribute("data-theme"); else root.setAttribute("data-theme", theme);
  };
  apply();
  // The architecture whose assembly the book shows, and the language its code is shown in. Every
  // tab set on every page follows them; a tab set lacking the chosen tab shows its first.
  const groups = { arch: "x86-64", code: "c" };
  for (const g of Object.keys(groups)) {
    try { const kept = localStorage.getItem(KEY(g)); if (kept) groups[g] = kept; } catch (e) {}
    root.setAttribute("data-" + g, groups[g]);
  }
  const reflect = () => {
    for (const set of document.querySelectorAll(".tab-set[data-group]")) {
      const g = set.dataset.group, want = root.getAttribute("data-" + g);
      const panels = [...set.querySelectorAll(":scope > .tab-panel")];
      const chosen = panels.find((p) => p.dataset.key === want) || panels[0];
      for (const p of panels) p.hidden = p !== chosen;
      for (const b of set.querySelectorAll(":scope > .tab-bar > button")) {
        b.setAttribute("aria-selected", String(b.dataset.key === chosen.dataset.key));
      }
    }
  };
  document.addEventListener("click", (e) => {
    const b = e.target.closest(".tab-set[data-group] > .tab-bar > button[data-key]");
    if (!b) return;
    const g = b.closest(".tab-set").dataset.group;
    const top = b.getBoundingClientRect().top;
    root.setAttribute("data-" + g, b.dataset.key);
    try { localStorage.setItem(KEY(g), b.dataset.key); } catch (e) {}
    reflect();
    // Keep the clicked tab where it was: panels above it may change height.
    scrollBy(0, b.getBoundingClientRect().top - top);
  });
  document.addEventListener("DOMContentLoaded", () => {
    reflect();
    const button = document.getElementById("theme");
    const names = { system: "System", light: "Light", dark: "Dark" };
    const order = ["system", "light", "dark"];
    const show = () => { button.textContent = names[theme]; button.setAttribute("aria-label", `Colours: ${names[theme]}`); };
    button.hidden = false;
    show();
    button.addEventListener("click", () => {
      theme = order[(order.indexOf(theme) + 1) % order.length];
      try { if (theme === "system") localStorage.removeItem(KEY("theme")); else localStorage.setItem(KEY("theme"), theme); } catch (e) {}
      apply(); show();
    });
  });
  // Real threads need a cross-origin isolated page. Where the host did not send the headers
  // (GitHub Pages cannot), the service worker adds them, and the page is reloaded once so that
  // it is loaded through the worker. A page the worker already controls and that is still not
  // isolated is one the browser will not isolate, and is left alone: the experiments then offer
  // their deterministic trace instead of a live run.
  if ("serviceWorker" in navigator && location.protocol !== "file:") {
    const once = () => {
      try { if (sessionStorage.getItem(KEY("reloaded"))) return; sessionStorage.setItem(KEY("reloaded"), "1"); } catch (e) { return; }
      location.reload();
    };
    addEventListener("load", () => {
      navigator.serviceWorker.register("sw.js").then((reg) => {
        if (crossOriginIsolated || navigator.serviceWorker.controller) return;
        if (reg.active) once();
        else navigator.serviceWorker.addEventListener("controllerchange", once, { once: true });
      }).catch(() => {});
    });
  }
})();
</script>"""


#: The two rails, and whether the reader wants them. Below 58rem the chapter list is closed and
#: the Chapters button opens it over the page; where there is room it is open, and the same
#: button closes it. The outline exists only from 72rem, so its button is there and nowhere
#: else. Either choice is remembered, per browser rather than per page, and read before the page
#: paints, so a reader who closed a rail does not watch it close again on every chapter.
#:
#: The outline also hides itself when showing it would leave the chapter narrower than what it
#: holds: the prose's measure, or, on a page with code, a hundred columns of it. A media query
#: cannot decide that, because `rem` inside one is 16px whatever the reader's text size, so it is
#: decided here, from the rails' own computed widths and a block of a hundred zeros measured in
#: whatever monospace font this device has. Closing the chapter list gives the outline its room.
RAILS = r"""<script>
(() => {
  const root = document.documentElement;
  const KEY = (k) => "concurrency-book:" + k;
  try {
    if (localStorage.getItem(KEY("nav")) === "closed") root.classList.add("nav-closed");
    if (localStorage.getItem(KEY("toc")) === "closed") root.classList.add("toc-closed");
  } catch (e) {}
  const wide = matchMedia("(min-width: 58rem)"), roomy = matchMedia("(min-width: 72rem)");
  const px = (name) => parseFloat(getComputedStyle(root).getPropertyValue(name)) || 0;
  let columns = null;
  const columnsNeed = () => {
    if (!root.classList.contains("has-code")) return 0;
    if (columns === null) {
      const probe = document.createElement("pre");
      probe.textContent = "0".repeat(100);
      probe.style.cssText = "position:absolute;visibility:hidden;width:max-content;margin:0";
      (document.body || root).appendChild(probe);
      columns = probe.getBoundingClientRect().width;
      probe.remove();
    }
    return columns;
  };
  let bar = null;
  const room = () => {
    if (bar === null) {
      const probe = document.createElement("div");
      probe.style.cssText = "position:absolute;visibility:hidden;overflow:scroll;width:100px;height:50px";
      (document.body || root).appendChild(probe);
      bar = probe.offsetWidth - probe.clientWidth;
      probe.remove();
    }
    return innerWidth - bar;
  };
  const cramped = () => {
    if (!roomy.matches) return false;
    const rails = (root.classList.contains("nav-closed") ? 0 : px("--nav")) + px("--toc");
    return room() - rails - 2 * px("--pad") < Math.max(px("--measure"), columnsNeed());
  };
  const reflect = () => {
    root.classList.toggle("toc-cramped", cramped());
    const menu = document.getElementById("menu"), outline = document.getElementById("outline");
    if (menu) {
      const shown = wide.matches ? !root.classList.contains("nav-closed")
                                 : document.body.classList.contains("nav-open");
      menu.setAttribute("aria-expanded", String(shown));
      menu.title = `${shown ? "Hide" : "Show"} the list of chapters`;
    }
    if (outline) {
      outline.hidden = !roomy.matches || root.classList.contains("toc-cramped")
        || root.classList.contains("toc-none");
      const shown = !root.classList.contains("toc-closed");
      outline.setAttribute("aria-expanded", String(shown));
      outline.title = `${shown ? "Hide" : "Show"} this page's outline`;
    }
  };
  const remember = (key, closed) => {
    try { if (closed) localStorage.setItem(KEY(key), "closed"); else localStorage.removeItem(KEY(key)); } catch (e) {}
  };
  reflect();
  addEventListener("resize", reflect);
  wide.addEventListener("change", () => { document.body.classList.remove("nav-open"); reflect(); });
  roomy.addEventListener("change", reflect);
  document.addEventListener("DOMContentLoaded", () => {
    // On a phone the list covers the page and reads as a screen of its own, so Back closes it
    // rather than leaving the chapter: opening adds a history entry, and closing goes back
    // through it. A chapter chosen from the list replaces that entry, so Back from the chapter
    // returns to the page the list was opened on, not to the list.
    const body = document.body, listed = () => !!(history.state && history.state.list);
    const shut = () => { body.classList.remove("nav-open"); reflect(); };
    document.getElementById("menu").addEventListener("click", () => {
      if (wide.matches) { remember("nav", root.classList.toggle("nav-closed")); reflect(); return; }
      if (!body.classList.contains("nav-open")) {
        body.classList.add("nav-open");
        history.pushState({ list: true }, "");
        reflect();
      } else if (listed()) history.back();
      else shut();
    });
    addEventListener("popstate", () => { if (!listed() && body.classList.contains("nav-open")) shut(); });
    addEventListener("pageshow", (event) => {
      if ((event.persisted || !listed()) && body.classList.contains("nav-open")) shut();
    });
    document.getElementById("nav").addEventListener("click", (event) => {
      const link = event.target.closest("a[href]");
      if (!link || wide.matches || !listed()) return;
      event.preventDefault();
      location.replace(link.href);
    });
    document.getElementById("outline").addEventListener("click", () => {
      remember("toc", root.classList.toggle("toc-closed"));
      reflect();
    });
    columns = null;
    reflect();
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { columns = null; reflect(); });
  });
})();
</script>"""


#: What the column cannot hold. A block of code or a table sits at the prose's measure, and takes
#: the wide column only when it would be cut off at the measure: the `wide` class, decided here,
#: because only the page knows the fonts it got. Each is measured once, as a copy with nothing
#: squeezing it. A widened block also gets `fits` and its own width, so it starts at the prose's
#: left edge, and every block of code is one width, the code column of a hundred characters.
#:
#: Anything still cut off at the width it was given gets an Expand button, which gives it the
#: window: the same element, so the reader's place survives. On a phone an expanded block reads
#: as a page of its own, so Back closes it rather than leaving the chapter.
EXPAND = r"""<script>
document.addEventListener("DOMContentLoaded", () => {
  const root = document.documentElement;
  const article = document.querySelector("#main > .page");
  if (!article) return;
  const px = (name) => parseFloat(getComputedStyle(root).getPropertyValue(name)) || 0;
  const phone = matchMedia("(max-width: 40rem)");
  // Panels look after their own widths.
  const OWN = ".lab";
  const PROMOTE = "pre, .wide-block, .table-wrap, .generated, .tab-set, figure.quoted";

  let scrolled = 0;
  const label = (button, open) => {
    button.querySelector("span").textContent = open ? "Close" : "Expand";
    button.setAttribute("aria-expanded", String(open));
  };
  const shut = () => {
    const box = article.querySelector(".expanded");
    if (!box) return;
    box.classList.remove("expanded");
    root.classList.remove("expand-open");
    const button = box.querySelector(".expand");
    label(button, false);
    scrollTo({ top: scrolled, behavior: "instant" });
    button.focus({ preventScroll: true });
    schedule();
  };
  const close = () => {
    if (!article.querySelector(".expanded")) return;
    if (history.state && history.state.expanded) history.back();
    else shut();
  };
  addEventListener("popstate", shut);
  addEventListener("pageshow", (event) => { if (event.persisted) shut(); });
  document.addEventListener("keydown", (event) => { if (event.key === "Escape") close(); });

  const control = (box) => {
    const button = document.createElement("button");
    button.className = "expand";
    button.type = "button";
    button.hidden = true;
    button.setAttribute("aria-expanded", "false");
    button.title = "Show all of it, in the whole window";
    button.innerHTML = '<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">'
      + '<path d="M6 2H2v4M10 14h4v-4M2 10v4h4M14 6V2h-4" fill="none" stroke="currentColor"'
      + ' stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg><span>Expand</span>';
    button.addEventListener("click", () => {
      if (box.classList.contains("expanded")) { close(); return; }
      scrolled = scrollY;
      history.pushState({ expanded: true }, "");
      box.classList.add("expanded");
      root.classList.add("expand-open");
      label(button, true);
    });
    return button;
  };
  const boxOf = (el) => {
    const quoted = el.closest("figure.quoted");
    if (quoted) {
      if (!quoted.querySelector(":scope > .source-bar > .expand")) {
        quoted.querySelector(":scope > .source-bar").append(control(quoted));
      }
      return quoted;
    }
    const wrapped = el.closest(".wide-block");
    if (wrapped) return wrapped;
    const box = document.createElement("div");
    box.className = "wide-block";
    el.before(box);
    box.append(control(box), el);
    return box;
  };

  const kept = new WeakMap();
  const needs = (els) => {
    const meter = document.createElement("div");
    meter.style.cssText = "position:fixed;left:0;top:0;visibility:hidden;pointer-events:none;"
      + "width:max-content;height:0;overflow:hidden";
    const copies = els.map((el) => {
      if (kept.has(el)) return null;
      let copy;
      if (el.matches(".table-wrap")) {
        const table = el.querySelector("table");
        if (!table || (table.matches(".cards") && phone.matches)) return null;
        copy = table.cloneNode(true);
        copy.style.display = "table";
      } else {
        copy = el.cloneNode(true);
      }
      copy.style.width = "max-content";
      copy.style.maxWidth = "none";
      copy.style.margin = "0";
      copy.style.overflow = "visible";
      meter.append(copy);
      return copy;
    });
    document.body.append(meter);
    const out = els.map((el, i) => {
      if (!copies[i]) return kept.get(el) || 0;
      const width = copies[i].getBoundingClientRect().width;
      kept.set(el, width);
      return width;
    });
    meter.remove();
    return out;
  };
  let column = 0;
  const codeColumn = (pre) => {
    if (column || !pre) return column;
    const cs = getComputedStyle(pre);
    const probe = document.createElement("span");
    probe.style.cssText = "position:absolute;visibility:hidden;white-space:pre;"
      + `font-family:${cs.fontFamily};font-size:${cs.fontSize}`;
    probe.textContent = "0".repeat(100);
    document.body.append(probe);
    column = probe.getBoundingClientRect().width + parseFloat(cs.paddingLeft)
      + parseFloat(cs.paddingRight) + parseFloat(cs.borderLeftWidth) * 2;
    probe.remove();
    return column;
  };
  const topOf = (el) => {
    while (el && el.parentElement !== article) el = el.parentElement;
    return el;
  };

  let width = -1;
  const layout = () => {
    pending = false;
    if (root.classList.contains("expand-open")) return;
    const blocks = [...article.querySelectorAll("pre, .table-wrap")]
      .filter((el) => !el.closest(OWN) && !el.matches(".table-wrap pre"));
    const boxes = blocks.map(boxOf);
    const need = needs(blocks);
    const code = codeColumn(blocks.find((el) => el.matches("pre") && el.offsetParent !== null));
    const prose = Math.min(article.clientWidth, px("--measure"));
    width = article.clientWidth;
    const units = new Map();
    blocks.forEach((el, i) => {
      const unit = topOf(el);
      if (!unit || !unit.matches(PROMOTE)) return;
      const u = units.get(unit) || { need: 0 };
      u.need = Math.max(u.need, el.matches(".table-wrap") ? need[i] : code);
      units.set(unit, u);
    });
    for (const el of article.querySelectorAll(":scope > .wide")) {
      if (!units.has(el)) el.classList.remove("wide", "fits");
    }
    for (const [unit, u] of units) {
      const wide = u.need > prose + 1;
      unit.classList.toggle("wide", wide);
      unit.classList.toggle("fits", wide);
      if (wide) unit.style.setProperty("--need", `${Math.ceil(u.need) + 2}px`);
    }
    const cut = blocks.map((el, i) => el.offsetParent !== null
      && need[i] > (el.matches(".table-wrap") ? el.clientWidth : el.offsetWidth) + 1);
    blocks.forEach((el, i) => {
      if (el.offsetParent === null) return;
      const button = boxes[i].querySelector(":scope > .expand, :scope > .source-bar > .expand");
      button.hidden = !cut[i];
    });
  };
  let pending = false;
  const schedule = () => {
    if (!pending) { pending = true; requestAnimationFrame(layout); }
  };
  layout();
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { column = 0; schedule(); });
  new ResizeObserver(() => { if (article.clientWidth !== width) schedule(); }).observe(article);
  document.addEventListener("click", (event) => { if (event.target.closest(".tab-bar")) schedule(); });
});
</script>"""


#: How the book was written, said the same way on the cover and at the foot of every page.
WRITTEN_WITH = "in collaboration with Claude (Anthropic)"

#: What each licence ``myst.yml`` may declare is called, and the file that holds its text.
LICENCES = {"CC-BY-NC-4.0": ("CC BY-NC 4.0", "LICENSE"), "Apache-2.0": ("Apache 2.0", "LICENSE-CODE")}


def colophon() -> str:
    """The foot of every page but the cover: who wrote the book, and the terms each part of it is
    under, read from ``myst.yml``, the one place the licences are declared."""
    config = yaml.safe_load((ROOT / "myst.yml").read_text())["project"]
    repo = config["github"].rstrip("/")
    author = config["authors"][0]["name"]

    def terms(spdx: str) -> str:
        name, file = LICENCES[spdx]
        return f'<a href="{repo}/blob/main/{file}">{html.escape(name)}</a>'

    return (
        f'<footer class="colophon">By {html.escape(author)}, {WRITTEN_WITH} · Prose and figures: '
        f"{terms(config['license']['content'])} · Code: {terms(config['license']['code'])}</footer>"
    )


def page_html(
    p: dict, body: str, nav: str, toc: str, prev: dict | None, nxt: dict | None, stamp: str, has_lab: bool
) -> str:
    chapter = p.get("chapter")
    if p["label"]:
        h1 = f'<h1><span class="label">{html.escape(p["label"])}</span>{html.escape(p["title"])}</h1>'
    else:
        h1 = f"<h1>{html.escape(p['title'])}</h1>"
    shows = ""
    if chapter is not None:
        shows = f'<p class="builds"><strong>What you see:</strong> {html.escape(chapter.shows)}</p>'

    def link(q, cls, word):
        if q is None:
            return ""
        label = f"{q['label']} · " if q["label"] else ""
        name = q.get("nav", q["title"])
        return f'<a class="{cls}" href="{q["href"]}"><small>{word}</small>{html.escape(label + name)}</a>'

    lab = (
        '<link rel="stylesheet" href="lab/lab.css"><script type="module" src="lab/lab.js"></script>'
        if has_lab
        else ""
    )
    title = f"{p['label']} · {p['title']}" if p["label"] else p["title"]
    title = TITLE if p.get("cover") else f"{title} · {TITLE}"
    classes = [c for c, on in (("toc-none", "<ol>" not in toc), ("has-code", "<pre" in body)) if on]
    attrs = f' class="{" ".join(classes)}"' if classes else ""
    return f"""<!doctype html>
<html lang="en-GB"{attrs}>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{html.escape(title)}</title>
<link rel="icon" href="favicon.svg" type="image/svg+xml">
<link rel="manifest" href="manifest.webmanifest">
<link rel="apple-touch-icon" href="icon-192.png">
<meta name="theme-color" content="#35648f">
<link rel="stylesheet" href="book.css">
{lab}
{HEAD_SCRIPT}
{RAILS}
{EXPAND}
</head>
<body>
<header class="top">
<button id="menu" type="button" aria-controls="nav" aria-expanded="false">Chapters</button>
<a class="brand" href="index.html">{TITLE} <span>· {SUBTITLE}</span></a>
<button id="outline" type="button" aria-controls="toc" aria-expanded="true" hidden>On this page</button>
<button id="theme" type="button" hidden>System</button>
</header>
<div class="layout">
{nav}
<main id="main"><article class="{"page cover" if p.get("cover") else "page"}">
{h1}
{shows}
{body}
<nav class="prevnext" aria-label="Previous and next">{link(prev, "prev", "Previous")}{link(nxt, "next", "Next")}</nav>
{"" if p.get("cover") else colophon()}
<p class="stamp">{html.escape(stamp)}</p>
</article></main>
{toc}
</div>
</body>
</html>
"""


#: The icon: two threads, drawn as two bars, and the one word of memory they share, drawn as a
#: bar across both. The same shapes make the SVG favicon and the PNG home-screen icons.
BARS = [(7, 6, 5, 20, 1.5, 1.0), (20, 6, 5, 20, 1.5, 0.75), (5, 14, 22, 4, 1.5, 0.45)]
FAVICON = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
<rect width="32" height="32" rx="6" fill="#35648f"/>
<rect x="7" y="6" width="5" height="20" rx="1.5" fill="#fff"/>
<rect x="20" y="6" width="5" height="20" rx="1.5" fill="#fff" opacity=".75"/>
<rect x="5" y="14" width="22" height="4" rx="1.5" fill="#fff" opacity=".45"/>
</svg>
"""


def icon_png(size: int, maskable: bool = False) -> bytes:
    """The favicon's picture as a PNG ``size`` pixels square: home screens want a bitmap. Drawn
    here, from the same shapes, so the build needs no image library and writes the same bytes
    every time. ``maskable`` is Android's kind: the blue fills the whole square, and the picture
    shrinks into the middle four fifths, the part every launcher shape keeps."""
    import struct
    import zlib

    blue = (0x35, 0x64, 0x8F)

    def inside(x: float, y: float, rx: float, ry: float, w: float, h: float, r: float) -> bool:
        cx = min(max(x, rx + r), rx + w - r)
        cy = min(max(y, ry + r), ry + h - r)
        return rx <= x <= rx + w and ry <= y <= ry + h and (x - cx) ** 2 + (y - cy) ** 2 <= r * r

    samples = ((0.25, 0.25), (0.75, 0.25), (0.25, 0.75), (0.75, 0.75))
    raw = bytearray()
    for py in range(size):
        raw.append(0)
        for px in range(size):
            rgb, alpha = [0.0, 0.0, 0.0], 0.0
            for sx, sy in samples:
                x, y = (px + sx) * 32 / size, (py + sy) * 32 / size
                if maskable:
                    x, y = (x - 16) / 0.8 + 16, (y - 16) / 0.8 + 16
                elif not inside(x, y, 0, 0, 32, 32, 6):
                    continue
                white = max(
                    (o for bx, by, bw, bh, br, o in BARS if inside(x, y, bx, by, bw, bh, br)), default=0.0
                )
                for i in range(3):
                    rgb[i] += blue[i] * (1 - white) + 255 * white
                alpha += 1
            n = len(samples)
            colour = [round(c / alpha) if alpha else 0 for c in rgb]
            raw += bytes([*colour, round(255 * alpha / n)])

    def chunk(kind: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data))

    header = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", header)
        + chunk(b"IDAT", zlib.compress(bytes(raw), 9))
        + chunk(b"IEND", b"")
    )


def manifest() -> str:
    return json.dumps(
        {
            "name": TITLE,
            "short_name": "Concurrency",
            "start_url": "index.html",
            "scope": "./",
            "display": "standalone",
            "background_color": "#fdfdfc",
            "theme_color": "#35648f",
            "icons": [
                {"src": "icon-192.png", "sizes": "192x192", "type": "image/png"},
                {"src": "icon-512.png", "sizes": "512x512", "type": "image/png"},
                {
                    "src": "icon-maskable-512.png",
                    "sizes": "512x512",
                    "type": "image/png",
                    "purpose": "maskable",
                },
            ],
        },
        indent=2,
    )


def service_worker(files: list[str], version: str) -> str:
    """Two jobs. Keep every file of the site on first visit, so the book reads with no network
    after it; and make the page cross-origin isolated on a host that sends no headers.

    The list is every file the build wrote, and the cache name carries a hash of their contents,
    so a new deploy replaces the old copy instead of mixing with it. Online, every file comes
    from the network, so a reader sees a new deploy on the next page they open.

    Every same-origin response, from the network or the cache, goes out with
    ``Cross-Origin-Opener-Policy: same-origin`` and ``Cross-Origin-Embedder-Policy: require-corp``.
    A page loaded through this worker is isolated, and may create shared memory. The book loads
    nothing from another origin, so the embedder policy costs it nothing.
    """
    return f"""// Written by scripts/build-site.py. Keeps the whole book for offline reading, and makes every
// page cross-origin isolated, which real threads need. See CLAUDE.md, "How the browser runs threads".
const CACHE = "{PREFIX}-{version}";
const FILES = {json.dumps(files)};
self.addEventListener("install", (e) => {{
  // Straight from the server, not the browser's HTTP cache, which may hold a page from before
  // this deploy for as long as the host allows (ten minutes on GitHub Pages).
  e.waitUntil(caches.open(CACHE)
    .then((c) => c.addAll(FILES.map((f) => new Request(f, {{ cache: "reload" }}))))
    .then(() => self.skipWaiting()));
}});
self.addEventListener("activate", (e) => {{
  e.waitUntil(caches.keys().then((keys) => Promise.all(
    keys.filter((k) => k !== CACHE && k.startsWith("{PREFIX}-")).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
}});
// The two headers that isolate a page. Added to every response this worker hands back.
const isolated = (response) => {{
  if (!response || response.status === 0) return response;
  const headers = new Headers(response.headers);
  headers.set("Cross-Origin-Opener-Policy", "same-origin");
  headers.set("Cross-Origin-Embedder-Policy", "require-corp");
  return new Response(response.body, {{ status: response.status, statusText: response.statusText, headers }});
}};
self.addEventListener("fetch", (e) => {{
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  const navigate = e.request.mode === "navigate";
  // The network first, and the kept copy only when there is none. Each answer from the network
  // refreshes the copy, so offline reading gets the latest pages. `no-cache` asks the server
  // every time, so the browser's HTTP cache cannot hand back a page from before a deploy.
  const network = () => (navigate
    ? fetch(url.href, {{ cache: "no-cache", credentials: "same-origin" }})
    : fetch(e.request, {{ cache: "no-cache" }})).then((response) => {{
      if (response.ok) {{
        const copy = response.clone();
        const key = navigate ? url.origin + url.pathname : e.request;
        caches.open(CACHE).then((c) => c.put(key, copy));
      }}
      return response;
    }});
  const kept = () => caches.match(e.request, {{ ignoreSearch: true }});
  const offline = () => kept().then((hit) => hit || Response.error());
  e.respondWith(network().catch(offline).then(isolated));
}});
"""


def build(out: Path) -> None:
    parse = load_parse()
    pages = page_list()
    missing = [p["source"] for p in pages if p["source"] not in parse]
    if missing:
        sys.exit(f"MyST produced no parse for: {', '.join(missing)}. Is each page in myst.yml's toc?")
    renderer.PAGES.clear()
    renderer.IMAGES.clear()
    for p in pages:
        renderer.PAGES[parse[p["source"]]["slug"]] = p["href"]

    if out.exists():
        shutil.rmtree(out)
    (out / "lab").mkdir(parents=True)

    stamp = f"Built from commit {commit()}."
    for i, p in enumerate(pages):
        mdast = parse[p["source"]]["mdast"]
        normalise_headings(mdast)
        body = renderer.render_page(mdast)
        has_lab = 'class="lab"' in body
        text = page_html(
            p,
            body,
            nav_html(pages, p["href"]),
            toc_html(mdast),
            pages[i - 1] if i > 0 else None,
            pages[i + 1] if i + 1 < len(pages) else None,
            stamp,
            has_lab,
        )
        (out / p["href"]).write_text(text)

    shutil.copy(ROOT / "web" / "book.css", out / "book.css")
    for name, source in sorted(renderer.IMAGES.items()):
        shutil.copy(source, out / name)
    (out / "favicon.svg").write_text(FAVICON)
    for size in (192, 512):
        (out / f"icon-{size}.png").write_bytes(icon_png(size))
    (out / "icon-maskable-512.png").write_bytes(icon_png(512, maskable=True))
    (out / "manifest.webmanifest").write_text(manifest())
    for f in (ROOT / "web" / "lab").iterdir():
        if f.suffix in (".js", ".css"):
            shutil.copy(f, out / "lab" / f.name)
    # The kernels, compiled for the browser: one module per experiment that has a contract.
    for name in EXPERIMENTS:
        if name not in experiments.available():
            continue
        module = WASM / f"{name}.wasm"
        if not module.exists():
            sys.exit(f"{module.relative_to(ROOT)} is missing; run `make wasm` first")
        shutil.copy(module, out / "lab" / f"{name}.wasm")
    (out / ".nojekyll").write_text("")

    files = sorted(str(f.relative_to(out)) for f in out.rglob("*") if f.is_file() and f.name != ".nojekyll")
    digest = hashlib.sha256()
    for f in files:
        digest.update(f.encode())
        digest.update((out / f).read_bytes())
    (out / "sw.js").write_text(service_worker(["./", *files], digest.hexdigest()[:12]))
    where = out.relative_to(ROOT) if out.is_relative_to(ROOT) else out
    print(f"wrote {len(pages)} pages and {len(files) - len(pages)} assets to {where}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--out", default=str(ROOT / "_build" / "html"))
    args = parser.parse_args()
    build(Path(args.out).resolve())


if __name__ == "__main__":
    main()
