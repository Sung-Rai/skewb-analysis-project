# Skewb Solver

An optimal Skewb solver written in C, with a browser-based 2D cube-net GUI.

The project models the Skewb as a finite permutation system. A puzzle state is represented using the visible sticker colours, and each legal move is implemented as a permutation of sticker positions. The solver can find optimal solutions using breadth-first search, count the full reachable state space, calculate the God number for the implemented move set, and optionally use a precomputed lookup table for fast repeated solving.

## Features

- Command-line Skewb solver written in C
- Browser-based GUI using Python's standard library
- 2D cube-net style colour input
- Optimal solving using breadth-first search
- User can enter a Skewb state without knowing the original solved colour scheme
- State-space counter
- God number calculation
- Precomputed lookup-table solver
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
│   └── webgui.py
└── docs/
    ├── testing_notes.md
    ├── performance_comparison.md
    ├── limitations.md
    ├── state_space_notes.md
    ├── lookup_table_notes.md
    ├── validity_checks.md
    └── webgui_notes.md
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

The browswer GUI requires:

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

To remove generated files:
```bash
make clean
```

## Run

### In terminal mode

```bash
make run
```
This launches command-line interface

### The browser GUI

```bash
make webgui
```
The GUI displays the Skewb stickers in a 2D cube-net layout. The user can click stickers to cycle through colours, load an example scramble, clear the grid, and solve the current state.

## Summary

This purpose of this project is to demonstrate how group theory and computation can be combined to solve a twisty puzzle. Skewb moves are represented as permutations, the generated state space is explored using breadth-first search, and the resulting traversal can be used both to find optimal solutions and to analyse the mathematical structure of the puzzle.