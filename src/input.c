#include "input.h"

#include <ctype.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static int colour_to_index(unsigned char c, const unsigned char face_colours[NUM_FACES]) {
    for (int i = 0; i < NUM_FACES; i++) {
        if ((unsigned char)toupper(c) == face_colours[i]) return i;
    }
    return -1;
}

void clear_input_line(void) {
    int ch;
    while ((ch = getchar()) != '\n' && ch != EOF) {
        /* discard */
    }
}

static unsigned char read_colour_char(void) {
    char buffer[64];

    while (1) {
        if (scanf("%63s", buffer) != 1) {
            fprintf(stderr, "Input error.\n");
            exit(EXIT_FAILURE);
        }

        if (strlen(buffer) == 1 && isalpha((unsigned char)buffer[0])) {
            return (unsigned char)toupper((unsigned char)buffer[0]);
        }

        printf("Please enter one letter only, for example W, R, G, Y, O, or B: ");
    }
}

void print_input_guide(void) {
    printf("\nSticker order used by this program:\n\n");
    printf("U face: U-ULB  U-URB  U-URF  U-ULF  U-centre\n");
    printf("R face: R-URF  R-URB  R-DRB  R-DRF  R-centre\n");
    printf("F face: F-ULF  F-URF  F-DRF  F-DLF  F-centre\n");
    printf("D face: D-DLF  D-DRF  D-DRB  D-DLB  D-centre\n");
    printf("L face: L-ULB  L-ULF  L-DLF  L-DLB  L-centre\n");
    printf("B face: B-URB  B-ULB  B-DLB  B-DRB  B-centre\n\n");
    printf("Corner labels mean: U=up, D=down, R=right, L=left, F=front, B=back.\n");
    printf("Example: U-URF means the sticker on the Up face at the Up-Right-Front corner.\n\n");
}

static void print_face_prompt(int face) {
    int base = face * STICKERS_PER_FACE;

    printf("%s face in this order: ", FACE_NAMES[face]);
    for (int k = 0; k < STICKERS_PER_FACE; k++) {
        printf("%s", STICKER_NAMES[base + k]);
        if (k < STICKERS_PER_FACE - 1) {
            printf(", ");
        }
    }
    printf("\n");
    printf("Enter %s face: ", FACE_NAMES[face]);
}

int read_state_from_user(State *target, unsigned char face_colours[NUM_FACES]) {
    int colour_counts[NUM_FACES] = {0};

    printf("Enter the solved colour scheme.\n");
    printf("Use one letter per face. Example: U=W R=R F=G D=Y L=O B=B\n");

    for (int face = 0; face < NUM_FACES; face++) {
        printf("Solved colour for %s face: ", FACE_NAMES[face]);
        face_colours[face] = read_colour_char();

        for (int prev = 0; prev < face; prev++) {
            if (face_colours[prev] == face_colours[face]) {
                printf("That colour has already been used. Restart and use six distinct colour letters.\n");
                return 0;
            }
        }
    }

    print_input_guide();

    printf("Now enter the CURRENT scrambled stickers.\n");
    printf("For each face, type five colour letters separated by spaces.\n");
    printf("Example for one face: W O W Y B\n");

    for (int face = 0; face < NUM_FACES; face++) {
        int base = face * STICKERS_PER_FACE;
        print_face_prompt(face);

        for (int k = 0; k < STICKERS_PER_FACE; k++) {
            unsigned char c = read_colour_char();
            int colour_idx = colour_to_index(c, face_colours);

            if (colour_idx < 0) {
                printf("Colour %c is not in the solved colour scheme. Restart and try again.\n", c);
                return 0;
            }

            target->s[base + k] = c;
            colour_counts[colour_idx]++;
        }
        printf("\n");
    }

    for (int i = 0; i < NUM_FACES; i++) {
        if (colour_counts[i] != STICKERS_PER_FACE) {
            printf("Invalid colour count: colour %c appears %d times, but it should appear 5 times.\n",
                   face_colours[i], colour_counts[i]);
            return 0;
        }
    }

    return 1;
}

int read_state_unknown_scheme(State *target) {
    int colour_counts[26] = {0};
    int distinct_colours = 0;

    print_input_guide();

    printf("Enter the CURRENT scrambled stickers.\n");
    printf("You do not need to know the solved colour scheme.\n");
    printf("For each face, type five colour letters separated by spaces.\n");
    printf("Example for one face: W O W Y B\n");

    for (int face = 0; face < NUM_FACES; face++) {
        int base = face * STICKERS_PER_FACE;
        print_face_prompt(face);

        for (int k = 0; k < STICKERS_PER_FACE; k++) {
            unsigned char c = read_colour_char();
            target->s[base + k] = c;

            int idx = c - 'A';
            if (colour_counts[idx] == 0) {
                distinct_colours++;
            }
            colour_counts[idx]++;
        }
        printf("\n");
    }

    if (distinct_colours != NUM_FACES) {
        printf("Invalid input: found %d distinct colours, but a Skewb should have exactly 6.\n",
               distinct_colours);
        return 0;
    }

    for (int i = 0; i < 26; i++) {
        if (colour_counts[i] != 0 && colour_counts[i] != STICKERS_PER_FACE) {
            printf("Invalid input: colour %c appears %d times, but each colour should appear 5 times.\n",
                   'A' + i, colour_counts[i]);
            return 0;
        }
    }

    return 1;
}

void run_demo(State *target, unsigned char face_colours[NUM_FACES]) {
    const unsigned char demo_colours[NUM_FACES] = {'W', 'R', 'G', 'Y', 'O', 'B'};
    memcpy(face_colours, demo_colours, NUM_FACES);

    State current;
    make_solved_state(&current, face_colours);

    int demo_scramble[] = {0, 4, 2, 6, 1}; /* R D L B R' */
    int demo_len = (int)(sizeof(demo_scramble) / sizeof(demo_scramble[0]));

    for (int i = 0; i < demo_len; i++) {
        State next;
        apply_move(&current, &next, demo_scramble[i]);
        current = next;
    }

    *target = current;

    printf("Demo scramble used: R D L B R'\n");
    printf("The program will solve this generated position.\n\n");
    printf("Generated scrambled state:\n");
    print_state_by_faces(target);
    printf("\n");
}

int run_scramble_input(State *target, unsigned char face_colours[NUM_FACES]) {
    const unsigned char default_colours[NUM_FACES] = {'W', 'R', 'G', 'Y', 'O', 'B'};
    memcpy(face_colours, default_colours, NUM_FACES);

    State current;
    make_solved_state(&current, face_colours);

    printf("Enter a scramble using these moves only:\n");
    printf("R R' L L' D D' B B'\n\n");
    printf("Example: R D L B R'\n");
    printf("Scramble: ");

    char line[512];
    if (!fgets(line, sizeof(line), stdin)) {
        printf("Could not read scramble.\n");
        return 0;
    }

    char *token = strtok(line, " \t\r\n");
    int move_count = 0;

    while (token) {
        int move = parse_move_token(token);
        if (move < 0) {
            printf("Unknown move '%s'. Use only R R' L L' D D' B B'.\n", token);
            return 0;
        }

        State next;
        apply_move(&current, &next, move);
        current = next;
        move_count++;

        token = strtok(NULL, " \t\r\n");
    }

    *target = current;

    printf("Generated state after %d scramble moves:\n", move_count);
    print_state_by_faces(target);
    printf("\n");

    return 1;
}
