#include "tests.h"

#include "skewb.h"

#include <stdio.h>

int run_internal_tests(void) {
    unsigned char colours[NUM_FACES] = {'W', 'R', 'G', 'Y', 'O', 'B'};
    State solved;
    make_solved_state(&solved, colours);

    for (int move = 0; move < NUM_MOVES; move++) {
        State after_move, after_inverse;
        apply_move(&solved, &after_move, move);
        apply_move(&after_move, &after_inverse, INVERSE_MOVE[move]);

        if (!same_state(&solved, &after_inverse)) {
            fprintf(stderr, "Internal test failed: move followed by inverse did not return to solved state.\n");
            return 0;
        }
    }

    for (int move = 0; move < NUM_MOVES; move++) {
        State current = solved;

        for (int i = 0; i < 3; i++) {
            State next;
            apply_move(&current, &next, move);
            current = next;
        }

        if (!same_state(&solved, &current)) {
            fprintf(stderr, "Internal test failed: applying a Skewb move three times did not return to solved state.\n");
            return 0;
        }
    }

    return 1;
}
