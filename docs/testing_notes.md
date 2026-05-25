# Testing Notes

This document records the main tests used to check the Skewb solver. The aim is to verify both correctness and usability: the mathematical model should generate valid Skewb states, the solver should return optimal move sequences, invalid inputs should be rejected, and the graphical interface should call the C solver correctly.

## Running the automated tests

The standard smoke tests can be run with:

```bash
make test
```

These tests are designed to be quick. They do not build the lookup table automatically and they do not run the full state-space count.

A longer test, including the full state-space count, can be run with:

```bash
make test-full
```

This confirms the total number of reachable states and the maximum BFS depth.

## Test cases

### Test 1: solved state

Command:

```bash
./build/bin/skewb_solver --solve-any WWWWW RRRRR GGGGG YYYYY OOOOO BBBBB
```

Expected result:

```text
OK
LENGTH 0
VERIFIED yes
```

Purpose: checks that the solver recognises an already solved puzzle.

### Test 2: single-move scramble

The state produced by applying one `R` move to the solved Skewb is:

```text
U: W G G G G
R: W W R W W
F: R R G R R
D: Y B Y Y Y
L: O Y O O O
B: O B B B B
```

Command:

```bash
./build/bin/skewb_solver --solve-any WGGGG WWRWW RRRGR YBYYY OYOOO OBBBB
```

Expected result:

```text
LENGTH 1
SOLUTION R'
VERIFIED yes
```

Purpose: checks a simple known inverse move.

### Test 3: known multi-move scramble

Scramble:

```text
R D L B R' D' L'
```

Corresponding face input:

```text
U: W O W Y B
R: R G Y R O
F: G G B G Y
D: Y W B B G
L: O R O Y W
B: W B O R R
```

Command:

```bash
./build/bin/skewb_solver --solve-any WOWYB RGYRO GGBGY YWBBG OROYW WBORR
```

Expected result:

```text
LENGTH 7
SOLUTION L D R B' L' D' R'
VERIFIED yes
```

Purpose: checks the main example used in the portfolio and GUI.

### Test 4: invalid colour counts

Command:

```bash
./build/bin/skewb_solver --solve-any WWWWW RRRRR GGGGG YYYYY OOOOB BBBBB
```

Expected result: the program should reject the input and return a non-zero exit code.

Purpose: checks that impossible colour counts are detected before the solver runs.

### Test 5: lookup-table solve

Build the lookup table:

```bash
make build-lookup
```

Then run:

```bash
./build/bin/skewb_solver --solve-any-fast WOWYB RGYRO GGBGY YWBBG OROYW WBORR
```

Expected result:

```text
LENGTH 7
SOLUTION L D R B' L' D' R'
STATES 720
VERIFIED yes
```

Purpose: checks that the precomputed lookup table agrees with the live BFS solver. 

### Test 6: state-space count

Command:

```bash
./build/bin/skewb_solver --count-states
```

Expected result:

```text
Total unique states: 3149280
God number: 11 moves
```

Purpose: checks that the generated state space has the expected size and maximum depth for the implemented move set.

### Test 7: web GUI fallback behaviour

Steps:

1. Remove the lookup table if it exists:

   ```bash
   rm -f build/lookup/skewb_lookup.bin
   ```

2. Run:

   ```bash
   make webgui
   ```

3. Open `http://127.0.0.1:8000`.
4. Click **Load Example**.
5. Click **Solve**.

Expected result: the GUI should solve the example using normal BFS rather than failing.

Purpose: checks that the GUI remains usable even when the lookup table has not been generated.

### Test 8: web GUI lookup mode

Steps:

1. Build the lookup table:

   ```bash
   make build-lookup
   ```

2. Run:

   ```bash
   make webgui
   ```

3. Open `http://127.0.0.1:8000`.
4. Click **Load Example**.
5. Click **Solve**.

Expected result: the GUI should solve the example using lookup-table mode.

Purpose: checks that the GUI uses the faster solver automatically when the lookup file exists.