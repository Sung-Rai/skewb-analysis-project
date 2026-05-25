# Limitations and Future Work

This section summarises the main limitations of the current Skewb solver and possible future improvements.

## 1. Sticker order must be entered correctly

The solver depends on the user entering colours in the exact sticker order shown by the program or web GUI. If the user misidentifies a sticker position, the solver may reject the state or return a solution for a different physical position. Especially since the layout of the webgui is an abstraction of the faces of a skewb.

Improvement: add a clearer visual input guide.

## 2. The GUI is a 2D net, not a 3D Skewb visualiser

The browser GUI uses a 2D cube-net style layout. This is simple and reliable, but it does not show the true skewed geometry of the Skewb.

Improvement: add a 3D visualisation using WebGL or a graphics library.

## 3. Move notation must remain consistent

The moves `R`, `L`, `D`, and `B` are defined relative to the fixed orientation used by the program. If a physical Skewb is held differently, the user must still enter the stickers according to the program's face labels.

Improvement: add orientation selection or allow the user to rotate the displayed net. Could also describe moves by the clockwise/anti-clockwise turn about the correct corner piece.

## 4. Lookup table requires storage and precomputation time

The lookup-table solver is fast after setup, but the table must first be generated and saved to disk. This uses additional storage and makes the project less lightweight.

Improvement: compress the table rather than storing full sticker states.

## 5. The solver is optimised for correctness, not minimal memory usage

The BFS and lookup-table implementation prioritise clarity and reliability. It uses hash tables and explicit state storage, which are easier to explain but not the most memory-efficient possible design.

Improvement: encode states using better computational methods for smaller memory usage and faster lookup.

## 6. Exact physical validity checking depends on the lookup table

This limitation has been partly addressed. Once the lookup table has been generated, the program can check whether a colour input is actually reachable from a solved Skewb state, not merely whether it has the correct number of colours. This is done by mapping the user's six colours onto the canonical solved colour schemes and testing membership in the precomputed reachable state space.

This catches deeper impossible cases such as valid colour counts with an unreachable sticker arrangement. The command-line option is:

```bash
./build/bin/skewb_solver --validate-any UUUUU RRRRR FFFFF DDDDD LLLLL BBBBB
```

If the lookup table has not been generated, the lightweight input validation still only checks colour counts before running the normal BFS solver. In that case, impossible states are detected when no solution is found.

Improvement: implement direct cubie-level permutation and orientation invariant checks so that exact validity can be tested without needing the lookup table file.

## 7. The lookup table stores a shortest-path policy rather than the full Cayley graph

The project discusses Cayley graphs, but the lookup table does not store every edge of the graph. Instead, it stores enough information to solve optimally: for each state, one move that leads closer to solved.

Improvement: export the full Cayley graph or a sampled subgraph for visualisation and further mathematical analysis. (might be difficult in pure C)