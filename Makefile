# Concurrency at the Metal: the commands the book tells you to run.
#
#   make            compile the kernels, generate the fragments, render the site into _build/html
#   make serve      serve the built site with the headers real threads need, at http://127.0.0.1:8000
#   make check      everything CI runs
#
# The kernels in experiments/ are freestanding C. The browser runs them compiled to WebAssembly on
# Web Workers sharing one memory; the chapters quote the assembly clang emits for them on four
# targets; native/c/harness.c runs them on pthreads at a desk.

PYTHON ?= python3
PORT   ?= 8000
SHELL  := /bin/bash
CLANG  ?= $(shell command -v clang-18 2>/dev/null || echo clang)
export CLANG

.DEFAULT_GOAL := all

.PHONY: help
help:  ## Show this list
	@grep -hE '^[a-zA-Z0-9_-]+:.*?## .*$$' $(MAKEFILE_LIST) \
	  | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-12s\033[0m %s\n", $$1, $$2}'

.PHONY: all
all: lower traces site  ## Build everything: modules, fragments, traces, site

# -- setup ---------------------------------------------------------------------------------

.PHONY: install
install:  ## Install the toolchain pieces the build needs (clang and lld come from your system)
	$(PYTHON) -m pip install -r requirements.txt -r requirements-dev.txt
	npm install -g "mystmd@$$(node -p "require('./package.json').devDependencies.mystmd")"
	@command -v $(CLANG) >/dev/null || echo "install clang 18 and lld: e.g. apt install clang-18 lld-18"

# -- the kernels ---------------------------------------------------------------------------

.PHONY: wasm
wasm:  ## Compile every kernel to WebAssembly, into _build/wasm
	$(PYTHON) tools/lower.py --wasm

.PHONY: lower
lower:  ## Compile every kernel, and regenerate the assembly fragments the chapters quote
	$(PYTHON) tools/lower.py

.PHONY: traces
traces:  ## Regenerate the deterministic trace tables the chapters include
	node tools/trace.mjs

.PHONY: native
native:  ## Build one kernel for pthreads: make native KERNEL=counter, then native/build/counter
	@test -n "$(KERNEL)" || (echo "usage: make native KERNEL=<experiment>"; exit 2)
	mkdir -p native/build
	$(CLANG) -O2 -pthread -DKERNEL='"../../experiments/$(KERNEL)/$(KERNEL).c"' native/c/harness.c -o native/build/$(KERNEL)
	@echo "  native/build/$(KERNEL) WORKERS A B C"

# -- the book ------------------------------------------------------------------------------

.PHONY: site
site: wasm  ## Parse the pages with MyST and render the site into _build/html
	./scripts/parse-book.sh
	$(PYTHON) scripts/build-site.py --out _build/html

.PHONY: serve
serve:  ## Serve the built site (run `make` first); add ARGS=--no-isolation to serve as GitHub Pages does
	$(PYTHON) scripts/serve.py --port $(PORT) $(ARGS)

.PHONY: chapter
chapter:  ## Write skeletons for chapters in tools/outline.py that have no page yet
	$(PYTHON) scripts/new-chapter.py --all

# -- tests ---------------------------------------------------------------------------------

.PHONY: test
test:  ## The book's tests, and the kernels on real threads under Node
	$(PYTHON) -m pytest tests -q
	node tests/threads.mjs _build/html

.PHONY: browser-test
browser-test: all  ## Drive the built site in a headless browser and check the experiments
	node tests/browser/smoke.mjs _build/html

.PHONY: check
check:  ## Everything CI runs
	./scripts/ci-check.sh

.PHONY: clean
clean:  ## Remove build output (committed fragments are kept)
	rm -rf _build native/build
