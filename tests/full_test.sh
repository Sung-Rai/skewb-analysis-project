#!/usr/bin/env bash
set -euo pipefail

BIN="${1:-./build/bin/skewb_solver}"

printf "Running full Skewb tests...\n\n"
./tests/smoke_test.sh "$BIN"

printf "\nRunning full state-space count. This may take a while.\n"
out="$($BIN --count-states)"
printf "%s\n" "$out"

grep -Fq "Total unique states: 3149280" <<< "$out" || {
    printf "FAIL: expected total state count 3149280.\n" >&2
    exit 1
}

grep -Fq "God number: 11 moves" <<< "$out" || {
    printf "FAIL: expected God number 11.\n" >&2
    exit 1
}

printf "\nFull tests passed.\n"
