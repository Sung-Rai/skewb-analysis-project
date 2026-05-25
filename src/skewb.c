#include "skewb.h"

#include <ctype.h>
#include <stdio.h>
#include <string.h>

const char *FACE_NAMES[NUM_FACES] = {"U", "R", "F", "D", "L", "B"};

const char *STICKER_NAMES[NUM_STICKERS] = {
    "U-ULB", "U-URB", "U-URF", "U-ULF", "U-centre",
    "R-URF", "R-URB", "R-DRB", "R-DRF", "R-centre",
    "F-ULF", "F-URF", "F-DRF", "F-DLF", "F-centre",
    "D-DLF", "D-DRF", "D-DRB", "D-DLB", "D-centre",
    "L-ULB", "L-ULF", "L-DLF", "L-DLB", "L-centre",
    "B-URB", "B-ULB", "B-DLB", "B-DRB", "B-centre"
};

/*
 * Permutations are stored as old_index -> new_index.
 * apply_move() performs: new_state[perm[old]] = old_state[old].
 *
 * Move axes used by this program:
 * R  = turn around the URF corner
 * L  = turn around the ULB corner
 * D  = turn around the DLF corner
 * B  = turn around the DRB corner
 */
static const int BASE_MOVE_PERMS[4][NUM_STICKERS] = {
    /* R */
    {0, 8, 5, 6, 9, 11, 12, 7, 10, 14, 1, 2, 3, 13, 4, 15, 21, 17, 18, 19, 20, 25, 22, 23, 24, 16, 26, 27, 28, 29},
    /* L */
    {20, 21, 2, 23, 24, 5, 10, 7, 8, 9, 18, 11, 12, 13, 14, 15, 16, 17, 6, 19, 26, 27, 22, 25, 29, 3, 0, 1, 28, 4},
    /* D */
    {0, 1, 2, 8, 4, 5, 6, 7, 27, 9, 16, 11, 18, 15, 19, 22, 23, 17, 21, 24, 20, 12, 13, 10, 14, 25, 26, 3, 28, 29},
    /* B */
    {0, 23, 2, 3, 4, 5, 27, 28, 25, 29, 10, 11, 1, 13, 14, 15, 6, 7, 8, 9, 20, 21, 22, 12, 24, 18, 26, 16, 17, 19}
};

static int MOVE_PERMS[NUM_MOVES][NUM_STICKERS];

const char *MOVE_NAMES[NUM_MOVES] = {"R", "R'", "L", "L'", "D", "D'", "B", "B'"};
const int INVERSE_MOVE[NUM_MOVES] = {1, 0, 3, 2, 5, 4, 7, 6};

void build_move_tables(void) {
    for (int m = 0; m < 4; m++) {
        int normal_move = 2 * m;
        int inverse_move = 2 * m + 1;

        for (int i = 0; i < NUM_STICKERS; i++) {
            MOVE_PERMS[normal_move][i] = BASE_MOVE_PERMS[m][i];
        }

        for (int i = 0; i < NUM_STICKERS; i++) {
            int destination = BASE_MOVE_PERMS[m][i];
            MOVE_PERMS[inverse_move][destination] = i;
        }
    }
}

void apply_move(const State *src, State *dst, int move) {
    for (int i = 0; i < NUM_STICKERS; i++) {
        dst->s[MOVE_PERMS[move][i]] = src->s[i];
    }
}

int same_state(const State *a, const State *b) {
    return memcmp(a->s, b->s, NUM_STICKERS) == 0;
}

uint64_t hash_state(const State *st) {
    /* 64-bit FNV-1a hash */
    uint64_t h = 1469598103934665603ull;
    for (int i = 0; i < NUM_STICKERS; i++) {
        h ^= (uint64_t)st->s[i];
        h *= 1099511628211ull;
    }
    return h;
}

void make_solved_state(State *st, const unsigned char face_colours[NUM_FACES]) {
    for (int face = 0; face < NUM_FACES; face++) {
        for (int k = 0; k < STICKERS_PER_FACE; k++) {
            st->s[face * STICKERS_PER_FACE + k] = face_colours[face];
        }
    }
}

int is_any_solved_state(const State *st) {
    unsigned char face_colour[NUM_FACES];

    for (int face = 0; face < NUM_FACES; face++) {
        int base = face * STICKERS_PER_FACE;
        face_colour[face] = st->s[base];

        for (int k = 1; k < STICKERS_PER_FACE; k++) {
            if (st->s[base + k] != face_colour[face]) {
                return 0;
            }
        }

        for (int previous = 0; previous < face; previous++) {
            if (face_colour[previous] == face_colour[face]) {
                return 0;
            }
        }
    }

    return 1;
}

int parse_move_token(const char *token) {
    for (int i = 0; i < NUM_MOVES; i++) {
        if (strcmp(token, MOVE_NAMES[i]) == 0) return i;
    }

    /* Allow lowercase input as a small convenience. */
    char upper[16];
    size_t n = strlen(token);
    if (n >= sizeof(upper)) return -1;

    for (size_t i = 0; i <= n; i++) {
        upper[i] = (char)toupper((unsigned char)token[i]);
    }

    for (int i = 0; i < NUM_MOVES; i++) {
        if (strcmp(upper, MOVE_NAMES[i]) == 0) return i;
    }

    return -1;
}

void print_state_by_faces(const State *st) {
    for (int face = 0; face < NUM_FACES; face++) {
        printf("%s:", FACE_NAMES[face]);
        for (int k = 0; k < STICKERS_PER_FACE; k++) {
            printf(" %c", st->s[face * STICKERS_PER_FACE + k]);
        }
        printf("\n");
    }
}
