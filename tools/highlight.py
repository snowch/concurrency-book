"""Syntax colouring at build time, for the languages the book quotes.

A page carries coloured code as plain HTML spans, so it reads correctly with scripts off and
costs the reader nothing to download. The colouring is a lexer, not a parser: comments, strings,
numbers, keywords and type names, which is what the eye uses to find its way around a block.
Assembly gets its own pass: a label, then the mnemonic, then whatever follows. A language this
module does not know is shown uncoloured, never guessed at.
"""

from __future__ import annotations

import html
import re

from tools import mnemonics

_C_KEYWORDS = (
    "auto break case const continue default do else enum extern for goto if inline register "
    "restrict return sizeof static struct switch typedef union volatile while _Alignas _Alignof "
    "_Atomic _Generic _Noreturn _Static_assert _Thread_local"
)
_C_TYPES = (
    "void char short int long float double signed unsigned _Bool bool int8_t int16_t int32_t "
    "int64_t uint8_t uint16_t uint32_t uint64_t size_t ssize_t uintptr_t intptr_t ptrdiff_t "
    "atomic_int atomic_bool atomic_uint"
)
_RUST_KEYWORDS = (
    "as break const continue crate else enum extern false fn for if impl in let loop match mod "
    "move mut pub ref return self Self static struct super trait true type unsafe use where while "
    "dyn"
)
_PY_KEYWORDS = (
    "and as assert async await break class continue def del elif else except False finally for "
    "from global if import in is lambda None nonlocal not or pass raise return True try while "
    "with yield"
)
_JS_KEYWORDS = (
    "async await break case catch class const continue default delete do else export extends "
    "false finally for from function if import in instanceof let new null of return static super "
    "switch this throw true try typeof undefined var void while yield"
)

_LANGS = {
    "c": (_C_KEYWORDS, r"//[^\n]*|/\*[\s\S]*?\*/", r'"(?:\\.|[^"\\\n])*"|\'(?:\\.|[^\'\\\n])\''),
    "rust": (_RUST_KEYWORDS, r"//[^\n]*", r'b?"(?:\\.|[^"\\])*"' + r"|b'(?:\\.|[^'\\])'"),
    "python": (
        _PY_KEYWORDS,
        r"#[^\n]*",
        r'"""[\s\S]*?"""|\'\'\'[\s\S]*?\'\'\'|[rbf]?"(?:\\.|[^"\\\n])*"|[rbf]?\'(?:\\.|[^\'\\\n])*\'',
    ),
    "javascript": (
        _JS_KEYWORDS,
        r"//[^\n]*|/\*[\s\S]*?\*/",
        r'"(?:\\.|[^"\\\n])*"|\'(?:\\.|[^\'\\\n])*\'|`(?:\\.|[^`\\])*`',
    ),
    "bash": (
        "if then else fi for do done case esac in function export while",
        r"#[^\n]*",
        r'"(?:\\.|[^"\\])*"|\'[^\']*\'',
    ),
    "yaml": ("true false null", r"#[^\n]*", r'"(?:\\.|[^"\\])*"|\'[^\']*\''),
    "json": ("true false null", r"(?!x)x", r'"(?:\\.|[^"\\])*"'),
}
_ALIASES = {
    "rs": "rust",
    "py": "python",
    "js": "javascript",
    "mjs": "javascript",
    "sh": "bash",
    "shell": "bash",
    "console": "bash",
    "yml": "yaml",
    "h": "c",
    "s": "asm",
    "wat": "wasm",
}

_NUMBER = (
    r"\b(?:0x[0-9a-fA-F_]+|\d[\d_]*(?:\.\d+)?(?:[eE][+-]?\d+)?)"
    r"(?:u8|u16|u32|u64|usize|i8|i16|i32|i64|f32|f64|[uUlL]+)?\b"
)


def _pattern(lang: str) -> re.Pattern:
    keywords, comment, string = _LANGS[lang]
    kw = "|".join(re.escape(k) for k in keywords.split())
    parts = [
        rf"(?P<comment>{comment})",
        rf"(?P<string>{string})",
        rf"(?P<number>{_NUMBER})",
        rf"(?P<keyword>\b(?:{kw})\b)",
    ]
    if lang == "c":
        types = "|".join(re.escape(t) for t in _C_TYPES.split())
        parts.append(r"(?P<attr>^[ \t]*#[^\n]*|\bmemory_order_\w+\b|\bCM_\w+\b)")
        parts.append(rf"(?P<type>\b(?:{types})\b)")
    if lang == "rust":
        parts.append(r"(?P<attr>#!?\[[^\]\n]*\])")
        parts.append(r"(?P<macro>\b[a-z_][a-z0-9_]*!)")
        parts.append(r"(?P<type>\b[A-Z][A-Za-z0-9_]*\b)")
    if lang == "python":
        parts.append(r"(?P<attr>@[\w.]+)")
        parts.append(r"(?P<type>\b[A-Z][A-Za-z0-9_]*\b)")
    if lang == "yaml":
        parts.append(r"(?P<type>^[ \t-]*[\w.-]+(?=:))")
    return re.compile("|".join(parts), re.MULTILINE)


_COMPILED: dict[str, re.Pattern] = {}

#: What a comment starts with in each assembly dialect the book shows. The x86-64 fragments are
#: Intel syntax from clang, where `#` opens a comment; AArch64 uses `//`; RISC-V and WebAssembly's
#: text form use `#` and `;;` respectively.
_ASM_COMMENT = re.compile(r"(//|#|;;|;).*$")


def _asm_line(line: str, wasm: bool, target: str | None = None) -> str:
    """One line of assembly: a label, or a mnemonic and its operands, with a comment at the end."""
    comment = ""
    m = _ASM_COMMENT.search(line)
    # In AArch64 an immediate is written `#1`: a `#` after a comma is an operand, not a comment.
    if m and not (m.group(1) == "#" and re.search(r",\s*$", line[: m.start()])):
        comment, line = line[m.start() :], line[: m.start()]
    label = re.match(r"^(\S+:)(.*)$", line)
    out = ""
    if label:
        out += f'<span class="tok-type">{html.escape(label.group(1))}</span>'
        line = label.group(2)
    body = re.match(r"^(\s*)(\.?[\w.]+)(.*)$", line)
    if body:
        indent, mnemonic, rest = body.groups()
        cls = "tok-attr" if mnemonic.startswith(".") else "tok-keyword"
        if wasm and ("atomic" in mnemonic or mnemonic.startswith("memory.")):
            cls = "tok-keyword tok-atomic"
        if not wasm and (
            mnemonic in ("lock", "mfence", "dmb", "dsb", "isb", "fence")
            or mnemonic.startswith(
                ("ldxr", "stxr", "ldaxr", "stlxr", "ldadd", "ldar", "stlr", "cas", "swp", "amo", "lr.", "sc.")
            )
        ):
            cls = "tok-keyword tok-atomic"
        # A prefix such as x86-64's `lock` is followed by the instruction it modifies on the same
        # line; both carry their meaning, so a hover on either explains it.
        prefixed = re.match(r"^(\s+)(\S+)(.*)$", rest) if mnemonic == "lock" else None
        if prefixed:
            indent2, second, rest = prefixed.groups()
        rest = re.sub(
            _NUMBER, lambda n: f'<span class="tok-number">{html.escape(n.group(0))}</span>', html.escape(rest)
        )
        out += f'{indent}<span class="{cls}"{_title(target, mnemonic)}>{html.escape(mnemonic)}</span>'
        if prefixed:
            out += f'{indent2}<span class="tok-keyword"{_title(target, second)}>{html.escape(second)}</span>'
        out += rest
    else:
        out += html.escape(line)
    if comment:
        out += f'<span class="tok-comment">{html.escape(comment)}</span>'
    return out


def _title(target: str | None, mnemonic: str) -> str:
    """A ``title`` attribute holding the instruction's one-line meaning, or nothing if unknown."""
    meaning = mnemonics.describe(target, mnemonic)
    return f' title="{html.escape(meaning)}"' if meaning else ""


def highlight(code: str, lang: str | None, target: str | None = None) -> str:
    """HTML for ``code``, with spans classed ``tok-<kind>`` where the language is known. For
    assembly, ``target`` names the instruction set so each mnemonic's hover gives its meaning
    there; without it the first instruction set that knows the mnemonic answers."""
    lang = _ALIASES.get((lang or "").lower(), (lang or "").lower())
    if lang in ("asm", "wasm"):
        return "\n".join(_asm_line(line, lang == "wasm", target) for line in code.split("\n"))
    if lang not in _LANGS:
        return html.escape(code)
    pattern = _COMPILED.setdefault(lang, _pattern(lang))
    out, at = [], 0
    for m in pattern.finditer(code):
        out.append(html.escape(code[at : m.start()]))
        kind = m.lastgroup
        out.append(f'<span class="tok-{kind}">{html.escape(m.group(0))}</span>')
        at = m.end()
    out.append(html.escape(code[at:]))
    return "".join(out)
