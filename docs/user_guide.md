# User Guide

The user guide details some of the features of the project. Immportant commands are listed at the bottom.

## Direct command-line solve mode

The command-line solver can solve a state directly from six face strings:

```bash
./build/bin/skewb_solver --solve-any WOWYB RGYRO GGBGY YWBBG OROYW WBORR
```

### Expected output format:

```text
OK
LENGTH 7
SOLUTION L D R B' L' D' R'
STATES 848611
VERIFIED yes
```

## Solving without knowing the solved colour scheme

The main solve mode uses:

```bash
--solve-any
```

This means the user does not need to know which colour belongs to which solved face.

The solver treats the entered colours as an unknown colour scheme and searches for a solution to any valid solved arrangement where each face has one uniform colour.

This is useful because a user is more likely to know the current visible sticker colours but not the original solved colour orientation.

## State-space counter

The project includes a state-space analysis mode. It performs a breadth-first traversal from the solved Skewb and counts every unique reachable sticker state.

```bash
make count-states
```
or
```bash
./build/bin/skewb_solver --count-states
```

### Expected outcome

```text
Total unique states: 3149280
God number: 11 moves
```

## Precomputed lookup table

The project can precompute a lookup table from the solved Skewb. This table stores every reachable state in the generated Skewb group, together with information needed to move each state one step closer to solved.

Build the table once with:

```bash
make build-lookup
```

## Exact reachability validation

Basic input validation checks that:

- There are exactly six colours
- Each colour appears exactly five times

This catches common input mistakes but does not prove that a state is physically reachable.

If the lookup table has been generated, the program can perform exact reachability validation. It checks whether the entered sticker arrangement exists in the precomputed reachable state space.

For:

```bash
./build/bin/skewb_solver --validate-any WOWYB RGYRO GGBGY YWBBG OROYW WBORR
```

### Expected output

```text
OK
REACHABLE yes
LOOKUP_ATTEMPTS 720
MIN_DISTANCE 7
```

### Expected output (unreachable)

```text
OK
REACHABLE no
LOOKUP_ATTEMPTS 720
```

## Tests

Run the standard smoke tests with:

```bash
make test
```

These tests check:

- Solved-state input
- A single-move scramble
- A known multi-move scramble
- Invalid colour-count rejection
- Lookup-table solving if the lookup file already exists
- Exact validation if the lookup file already exists

Run the longer test suite with:

```bash
make test-full
```

To also run the state-space count.

## Performance comparison

```bash
make perf
```

This times the normal BFS solver on the standard example scramble. If the lookup table exists, it also times the lookup-table solver.

## Important commands

```bash
make                     # build the solver
make run                 # run terminal interface
make webgui              # run browser GUI
make webgui-fast         # build lookup table, then run     browser GUI
make count-states        # count reachable states and God number
make build-lookup        # generate lookup table
make solve-example-fast  # solve example using lookup table
make validate-example    # validate known reachable example
make validate-impossible # validate deliberately impossible example
make test                # run smoke tests
make test-full           # run longer tests including state count
make perf                # run performance comparison
make clean               # remove generated files
```