#!/usr/bin/env bash
set -euo pipefail

BIN="${1:-./build/bin/skewb_solver}"
FACES=(WOWYB RGYRO GGBGY YWBBG OROYW WBORR)
LOOKUP="build/lookup/skewb_lookup.bin"

if [[ ! -x "$BIN" ]]; then
    echo "Executable not found: $BIN" >&2
    echo "Run 'make' first." >&2
    exit 1
fi

run_and_time() {
    local label="$1"
    shift

    echo "===== $label ====="
    if command -v /usr/bin/time >/dev/null 2>&1; then
        /usr/bin/time -f "TIME_SECONDS %e" "$@"
    else
        time "$@"
    fi
    echo
}

printf "Performance comparison for known example scramble:\n"
printf "Faces: %s %s %s %s %s %s\n\n" "${FACES[@]}"

run_and_time "Normal BFS solve" "$BIN" --solve-any "${FACES[@]}"

if [[ -f "$LOOKUP" ]]; then
    run_and_time "Lookup-table solve" "$BIN" --solve-any-fast "${FACES[@]}"
else
    echo "Lookup-table solve skipped: $LOOKUP does not exist."
    echo "Run 'make build-lookup' and then run this comparison again."
    echo
fi

echo "Optional state-space count timing:"
echo "  make count-states"
echo
echo "Optional lookup build timing:"
echo "  make build-lookup"
