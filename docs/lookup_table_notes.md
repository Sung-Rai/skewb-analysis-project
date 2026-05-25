# Precomputed Skewb Lookup Table

The lookup table is a development step between a direct BFS solver and a full Cayley graph representation.

The program performs one complete breadth-first traversal from the canonical solved state. For every newly discovered state, it stores:

- the sticker state;
- the distance from the solved state;
- the first move that should be applied to move the state closer to solved.

This means that, after the table has been built and loaded, solving does not require a fresh BFS. The solver repeatedly looks up the current state, applies the stored best move, and stops when the solved state is reached.

For user input where the solved colour scheme is unknown, the program tries all 720 possible assignments of the six observed colours to the six canonical face colours. Each assignment is checked using the lookup table, and the shortest valid solution is returned.

This is not the full Cayley graph because the program does not store every outgoing edge from every state. Instead, it stores a shortest-path policy: one best next move per state. This is much smaller than storing all graph edges and is enough for fast optimal solving.
