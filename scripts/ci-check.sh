#!/usr/bin/env bash
# Exactly what CI runs. Run it before pushing: `make check`.
#
# CI invokes this same script, so a laptop and CI cannot drift. Each stage says what it protects,
# because a check nobody understands is a check somebody eventually deletes.
set -euo pipefail
cd "$(dirname "$0")/.."

PY_PATHS=(tools scripts tests)

echo "== Python: lint and format =="
python3 -m ruff check "${PY_PATHS[@]}"
python3 -m ruff format --check "${PY_PATHS[@]}"

echo "== C: the kernels are formatted =="
# clang-format with the repository's style; a kernel is quoted in a book, so its shape matters.
if command -v clang-format >/dev/null 2>&1; then
  clang-format --dry-run --Werror experiments/*/*.c experiments/*.h native/c/*.c
else
  echo "  clang-format not installed; skipping"
fi

echo "== the kernels compile to WebAssembly, and the fragments are what clang emits =="
# Every assembly fragment a chapter quotes was written by tools/lower.py from the kernel it
# names, with the pinned clang. A change to a kernel that moves an instruction fails here until
# `make lower` is run and the result committed.
python3 tools/lower.py --wasm
python3 tools/lower.py --check

echo "== the deterministic traces are what the model computes =="
node tools/trace.mjs --check

echo "== no measured number is typed into prose =="
python3 scripts/verify-numbers.py

echo "== MyST parses every page and resolves every reference =="
./scripts/parse-book.sh

echo "== the site renders =="
# The renderer raises on a node type it does not handle, so rendering every page on every push is
# what stops new markup from silently disappearing.
python3 scripts/build-site.py --out _build/html

echo "== every link in the built site resolves =="
python3 scripts/check-built-links.py _build/html

echo "== the book's own tests =="
python3 -m pytest tests -q

echo "== the kernels, on real threads under Node =="
# Every kernel runs on worker threads sharing one memory, as the page runs it, and what it
# reports is held to what its contract promises (an atomic counter is exact; a plain one is
# never more than exact).
node tests/threads.mjs _build/html

echo "== the experiments, driven in a headless browser =="
# Needs Playwright and a Chromium. CI installs both; locally the check runs if they are present.
if node -e "require.resolve('playwright')" >/dev/null 2>&1 \
   || [ -d "$(npm root -g 2>/dev/null)/playwright" ]; then
  node tests/browser/smoke.mjs _build/html
elif [ -n "${CI:-}" ]; then
  echo "ERROR: Playwright is not installed, and CI must not skip the browser checks." >&2
  exit 1
else
  echo "  Playwright not installed; skipping (npm install -g playwright && npx playwright install chromium)"
fi

echo
echo "All checks passed."
