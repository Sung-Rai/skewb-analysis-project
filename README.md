# Skewb Solver

An optimal Skewb solver written in C, with a browser-based Skewb-net GUI.

The project models the Skewb as a finite permutation system. A puzzle state is represented using the visible sticker colours, and each legal move is implemented as a permutation of sticker positions. The solver can find optimal solutions using breadth-first search, count the full reachable state space, calculate the God number for the implemented move set, and optionally use a precomputed lookup table for fast repeated solving and graph visualisation.

## Features

- Command-line Skewb solver written in C
- Browser-based GUI using Python's standard library
- Skewb-shaped net input with triangular corner stickers and diamond centre stickers
- Guided camera scanning for sticker colour input
- Optimal solving using breadth-first search
- User can enter a Skewb state without knowing the original solved colour scheme
- State-space counter
- God number calculation
- Precomputed lookup-table solver
- Lookup-backed graph visualisation for solution paths, visited states, and all states
- Exact reachability validation when the lookup table exists
- Automated smoke tests and full tests
- Performance comparison scripts

## Project structure

```text
skewb_project/
├── Makefile
├── README.md
├── include/
│   ├── input.h
│   ├── lookup_table.h
│   ├── skewb.h
│   ├── solver.h
│   ├── state_counter.h
│   └── tests.h
├── src/
│   ├── input.c
│   ├── lookup_table.c
│   ├── main.c
│   ├── skewb.c
│   ├── solver.c
│   └── state_counter.c
├── tests/
│   ├── smoke_test.sh
│   ├── full_test.sh
│   └── tests.c
├── scripts/
│   └── performance_compare.sh
├── gui/
│   ├── webgui.py
│   └── static/
│       ├── index.html
│       ├── app.js
│       ├── camera.js
│       ├── graph.js
│       └── style.css
└── docs/
    ├── limitations.md
    ├── lookup_table_notes.md
    ├── performance_comparison.md
    ├── testing_notes.md
    └── user_guide.md
```

## Generated files

Generated files are placed in:

```text
skewb_project/
└── build/
    ├── bin/
    ├── obj/
    └── lookup/
```

## Requirements

The core solver requires:

```text
gcc
make
```

The browser GUI requires:

```text
python3
```

## Build

Compile the project with:
```bash
make
```

The executable is created at
```text
build/bin/skewb_solver
```

To build the lookup table for fast solving and graph visualisation:
```bash
make build-lookup
```

To remove generated files:
```bash
make clean
```

## Run

### In terminal mode

```bash
make run
```
This launches the command-line interface.

### The browser GUI

```bash
make webgui
```
The GUI displays the Skewb stickers in a Skewb-shaped net layout. The user can click stickers, scan colours with the camera, load an example scramble, clear the grid, solve the current state, and explore the lookup-backed graph visualisation.

## Summary

The purpose of this project is to demonstrate how group theory and computation can be combined to solve a twisty puzzle. Skewb moves are represented as permutations, the generated state space is explored using breadth-first search, and the resulting traversal can be used both to find optimal solutions and to visualise the structure of the puzzle state space.
