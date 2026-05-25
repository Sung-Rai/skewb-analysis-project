#!/usr/bin/env bash
set -euo pipefail

BIN="${1:-./build/bin/skewb_solver}"

pass() {
    printf "PASS: %s\n" "$1"
}

fail() {
    printf "FAIL: %s\n" "$1" >&2
    exit 1
}

require_contains() {
    local output="$1"
    local expected="$2"
    local name="$3"
    if grep -Fq "$expected" <<< "$output"; then
        pass "$name"
    else
        printf "\nOutput was:\n%s\n" "$output" >&2
        fail "$name: expected to find '$expected'"
    fi
}

printf "Running Skewb solver smoke tests...\n\n"

# Test 1: a solved state should require zero moves.
out="$($BIN --solve-any WWWWW RRRRR GGGGG YYYYY OOOOO BBBBB)"
require_contains "$out" "OK" "solved state accepted"
require_contains "$out" "LENGTH 0" "solved state has solution length 0"
require_contains "$out" "VERIFIED yes" "solved state verifies"

# Test 2: a single R move should be solved by R'.
out="$($BIN --solve-any WGGGG WWRWW RRRGR YBYYY OYOOO OBBBB)"
require_contains "$out" "LENGTH 1" "single-move scramble has length 1"
require_contains "$out" "SOLUTION R'" "single R scramble solved by R'"
require_contains "$out" "VERIFIED yes" "single-move solution verifies"

# Test 3: known seven-move scramble from the portfolio example.
out="$($BIN --solve-any WOWYB RGYRO GGBGY YWBBG OROYW WBORR)"
require_contains "$out" "LENGTH 7" "known multi-move scramble has length 7"
require_contains "$out" "SOLUTION L D R B' L' D' R'" "known multi-move scramble solution"
require_contains "$out" "VERIFIED yes" "known multi-move solution verifies"

# Test 4: invalid colour counts should be rejected.
set +e
out="$($BIN --solve-any WWWWW RRRRR GGGGG YYYYY OOOOB BBBBB 2>&1)"
status=$?
set -e
if [[ $status -eq 0 ]]; then
    printf "\nOutput was:\n%s\n" "$out" >&2
    fail "invalid colour counts should return a non-zero exit code"
else
    pass "invalid colour counts rejected"
fi
require_contains "$out" "ERROR" "invalid input reports an error"

# Test 5: if the lookup table exists, check that fast solving agrees on the example.
LOOKUP="build/lookup/skewb_lookup.bin"
if [[ -f "$LOOKUP" ]]; then
    out="$($BIN --solve-any-fast WOWYB RGYRO GGBGY YWBBG OROYW WBORR)"
    require_contains "$out" "LENGTH 7" "lookup-table example has length 7"
    require_contains "$out" "SOLUTION L D R B' L' D' R'" "lookup-table example solution"
    require_contains "$out" "VERIFIED yes" "lookup-table solution verifies"
else
    printf "SKIP: lookup-table test skipped because %s does not exist. Run 'make build-lookup' to enable it.\n" "$LOOKUP"
fi

printf "\nAll smoke tests passed.\n"
