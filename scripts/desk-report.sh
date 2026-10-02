#!/usr/bin/env bash
# The ordering kernels at a desk, on whatever machine this is: build the store-buffer, the
# publication and the counter kernels with the native harness, run each under every ordering
# its page offers, and print what this machine showed as a markdown table. One run of each: the
# counts are one observation, and the point is which of them are zero on this architecture and
# which are not. Appendix A says how to read the table; the AArch64 workflow runs this on an
# Arm runner and keeps the table as its step summary.
#
#     scripts/desk-report.sh                       # CLANG, TRIALS and WORKERS override the defaults
set -euo pipefail
cd "$(dirname "$0")/.."
CLANG=${CLANG:-$(command -v clang-18 2>/dev/null || echo clang)}
TRIALS=${TRIALS:-200000}
WORKERS=${WORKERS:-4}
INCREMENTS=1000000
mkdir -p native/build

build() {
  "$CLANG" -O2 -pthread -DKERNEL="\"../../experiments/$1/$1.c\"" native/c/harness.c -o "native/build/$1"
}
# Result N of a run, from the harness's "result[N] value" lines.
result() { awk -v want="result[$2]" '$1 == want { print $2 }' <<<"$1"; }

build store_buffer
build publication
build counter

echo "## The ordering kernels on this machine"
echo
echo "\`$(uname -m)\`, $(nproc) logical cores, $("$CLANG" --version | head -1). One run of each: the counts are one observation."
echo
echo "| Kernel | Ordering | Outcome counted | Seen | Of |"
echo "| --- | --- | --- | --- | --- |"
# The store-buffer test: result 1 counts the trials where both loads returned zero, the outcome
# no interleaving of the four operations allows.
i=0
for ordering in volatile relaxed release-acquire seq_cst fence; do
  out=$(native/build/store_buffer 2 "$TRIALS" "$i")
  echo "| store buffer | $ordering | both loaded zero | $(result "$out" 1) | $(result "$out" 0) trials |"
  i=$((i + 1))
done
# Publication: result 1 counts the trials where the reader saw the flag but not the data.
i=0
for ordering in volatile relaxed release-acquire seq_cst; do
  out=$(native/build/publication 2 "$TRIALS" "$i")
  echo "| publication | $ordering | the flag seen, the data stale | $(result "$out" 1) | $(result "$out" 0) trials |"
  i=$((i + 1))
done
# The counter: what the plain and the atomic increments lost, out of workers times increments.
expected=$((WORKERS * INCREMENTS))
out=$(native/build/counter "$WORKERS" "$INCREMENTS" 0)
echo "| counter | plain | lost increments | $((expected - $(result "$out" 0))) | $expected increments |"
out=$(native/build/counter "$WORKERS" "$INCREMENTS" 1)
echo "| counter | atomic | lost increments | $((expected - $(result "$out" 1))) | $expected increments |"
