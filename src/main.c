#include "input.h"
#include "lookup_table.h"
#include "skewb.h"
#include "solver.h"
#include "state_counter.h"
#include "tests.h"

#include <ctype.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>

static void solve_with_known_scheme(const State *target, const unsigned char face_colours[NUM_FACES]) {
    State solved;
    SolveResult result;

    make_solved_state(&solved, face_colours);

    printf("Searching for an optimal solution...\n");
    if (!solve_fixed_scheme(&solved, target, &result) || !result.found) {
        printf("No solution found. The entered colour state may be impossible, or it may not match this program's sticker order.\n");
        return;
    }

    print_solution(&result);

    if (verify_solution_to_state(target, &result, &solved)) {
        printf("Verification: solved successfully.\n");
    } else {
        printf("Verification failed. There is a bug in the solver.\n");
    }

    printf("States explored: %d\n", result.states_explored);
}

static void solve_with_unknown_scheme(const State *target) {
    SolveResult result;

    printf("Searching for an optimal solution to any valid solved colour scheme...\n");
    if (!solve_any_scheme(target, &result) || !result.found) {
        printf("No solution found. The entered colour state may be impossible, or it may not match this program's sticker order.\n");
        return;
    }

    print_solution(&result);

    if (verify_solution_to_any_solved(target, &result)) {
        printf("Verification: solved successfully.\n");
    } else {
        printf("Verification failed. There is a bug in the solver.\n");
    }

    printf("States explored: %d\n", result.states_explored);
}

static void solve_with_lookup_table(const State *target) {
    LookupTable table;
    SolveResult result;

    printf("Loading lookup table from %s...\n", DEFAULT_LOOKUP_PATH);
    if (!load_lookup_table(&table, DEFAULT_LOOKUP_PATH)) {
        printf("Lookup table not found. Build it first with: make build-lookup\n");
        return;
    }

    printf("Solving using precomputed lookup table...\n");
    if (!solve_any_scheme_fast(&table, target, &result) || !result.found) {
        printf("No solution found in the lookup table. The state may be impossible or may not match the sticker order.\n");
        lookup_table_free(&table);
        return;
    }

    print_solution(&result);

    if (verify_solution_to_any_solved(target, &result)) {
        printf("Verification: solved successfully.\n");
    } else {
        printf("Verification failed. There is a bug in the lookup solver.\n");
    }

    printf("Lookup attempts: %d\n", result.states_explored);
    lookup_table_free(&table);
}

static void print_cli_usage(const char *program_name) {
    printf("Usage:\n");
    printf("  %s\n", program_name);
    printf("  %s --solve-any UUUUU RRRRR FFFFF DDDDD LLLLL BBBBB\n", program_name);
    printf("  %s --solve-any-fast UUUUU RRRRR FFFFF DDDDD LLLLL BBBBB\n", program_name);
    printf("  %s --validate-any UUUUU RRRRR FFFFF DDDDD LLLLL BBBBB\n", program_name);
    printf("  %s --count-states\n", program_name);
    printf("  %s --build-lookup [lookup_file]\n", program_name);
    printf("\n");
    printf("Example:\n");
    printf("  %s --solve-any WOWYB RGYRO GGBGY YWBBG OROYW WBORR\n", program_name);
    printf("  %s --solve-any-fast WOWYB RGYRO GGBGY YWBBG OROYW WBORR\n", program_name);
    printf("  %s --validate-any WOWYB RGYRO GGBGY YWBBG OROYW WBORR\n", program_name);
}

static int parse_face_string(const char *text, State *target, int face) {
    if (strlen(text) != STICKERS_PER_FACE) {
        fprintf(stderr, "ERROR: each face must contain exactly %d colour letters.\n", STICKERS_PER_FACE);
        return 0;
    }

    int base = face * STICKERS_PER_FACE;
    for (int k = 0; k < STICKERS_PER_FACE; k++) {
        unsigned char c = (unsigned char)text[k];
        if (!isalpha(c)) {
            fprintf(stderr, "ERROR: face colours must be letters only.\n");
            return 0;
        }
        target->s[base + k] = (unsigned char)toupper(c);
    }

    return 1;
}

static int validate_unknown_scheme_state(const State *target) {
    int colour_counts[26] = {0};
    int distinct_colours = 0;

    for (int i = 0; i < NUM_STICKERS; i++) {
        unsigned char c = target->s[i];
        if (c < 'A' || c > 'Z') {
            fprintf(stderr, "ERROR: invalid colour letter in input.\n");
            return 0;
        }

        int idx = c - 'A';
        if (colour_counts[idx] == 0) {
            distinct_colours++;
        }
        colour_counts[idx]++;
    }

    if (distinct_colours != NUM_FACES) {
        fprintf(stderr, "ERROR: found %d distinct colours, but a Skewb should have exactly %d.\n",
                distinct_colours, NUM_FACES);
        return 0;
    }

    for (int i = 0; i < 26; i++) {
        if (colour_counts[i] != 0 && colour_counts[i] != STICKERS_PER_FACE) {
            fprintf(stderr, "ERROR: colour %c appears %d times, but each colour should appear %d times.\n",
                    'A' + i, colour_counts[i], STICKERS_PER_FACE);
            return 0;
        }
    }

    return 1;
}

static int file_exists(const char *path) {
    struct stat st;
    return stat(path, &st) == 0;
}

static int exact_validate_with_lookup_if_available(const State *target) {
    LookupTable table;
    int attempts = 0;
    int best_distance = -1;

    if (!file_exists(DEFAULT_LOOKUP_PATH)) {
        return 1;
    }

    if (!load_lookup_table(&table, DEFAULT_LOOKUP_PATH)) {
        fprintf(stderr, "ERROR: lookup table exists but could not be loaded for exact validation.\n");
        return 0;
    }

    int reachable = lookup_table_contains_any_scheme(&table, target, &attempts, &best_distance);
    lookup_table_free(&table);

    if (!reachable) {
        fprintf(stderr, "ERROR: colour counts are valid, but this state is not reachable from any solved Skewb state.\n");
        fprintf(stderr, "ERROR: exact validation used %d canonical colour-scheme checks.\n", attempts);
        return 0;
    }

    return 1;
}

static int parse_cli_faces(int argc, char *argv[], State *target) {
    if (argc != 8) {
        fprintf(stderr, "ERROR: this command needs exactly six face strings.\n");
        print_cli_usage(argv[0]);
        return 0;
    }

    for (int face = 0; face < NUM_FACES; face++) {
        if (!parse_face_string(argv[2 + face], target, face)) {
            return 0;
        }
    }

    return validate_unknown_scheme_state(target);
}

static int print_cli_solve_result(const State *target, const SolveResult *result) {
    printf("OK\n");
    printf("LENGTH %d\n", result->length);
    printf("SOLUTION");
    for (int i = 0; i < result->length; i++) {
        printf(" %s", MOVE_NAMES[result->path[i]]);
    }
    printf("\n");
    printf("STATES %d\n", result->states_explored);

    if (verify_solution_to_any_solved(target, result)) {
        printf("VERIFIED yes\n");
        return EXIT_SUCCESS;
    }

    printf("VERIFIED no\n");
    return EXIT_FAILURE;
}

static int handle_cli_validate_any(int argc, char *argv[]) {
    State target;
    LookupTable table;
    int attempts = 0;
    int best_distance = -1;

    if (!parse_cli_faces(argc, argv, &target)) {
        return EXIT_FAILURE;
    }

    if (!load_lookup_table(&table, DEFAULT_LOOKUP_PATH)) {
        fprintf(stderr, "ERROR: lookup table not found at %s. Run 'make build-lookup' first.\n", DEFAULT_LOOKUP_PATH);
        return EXIT_FAILURE;
    }

    int reachable = lookup_table_contains_any_scheme(&table, &target, &attempts, &best_distance);
    lookup_table_free(&table);

    printf("OK\n");
    printf("REACHABLE %s\n", reachable ? "yes" : "no");
    printf("LOOKUP_ATTEMPTS %d\n", attempts);
    if (reachable) {
        printf("MIN_DISTANCE %d\n", best_distance);
        return EXIT_SUCCESS;
    }

    return EXIT_FAILURE;
}

static int handle_cli_solve_any(int argc, char *argv[]) {
    State target;
    SolveResult result;

    if (!parse_cli_faces(argc, argv, &target)) {
        return EXIT_FAILURE;
    }

    if (!exact_validate_with_lookup_if_available(&target)) {
        return EXIT_FAILURE;
    }

    if (!solve_any_scheme(&target, &result) || !result.found) {
        fprintf(stderr, "ERROR: no solution found. The state may be impossible, or it may not match the sticker order.\n");
        return EXIT_FAILURE;
    }

    return print_cli_solve_result(&target, &result);
}

static int handle_cli_solve_any_fast(int argc, char *argv[]) {
    State target;
    LookupTable table;
    SolveResult result;

    if (!parse_cli_faces(argc, argv, &target)) {
        return EXIT_FAILURE;
    }

    if (!load_lookup_table(&table, DEFAULT_LOOKUP_PATH)) {
        fprintf(stderr, "ERROR: lookup table not found at %s. Run 'make build-lookup' first.\n", DEFAULT_LOOKUP_PATH);
        return EXIT_FAILURE;
    }

    if (!solve_any_scheme_fast(&table, &target, &result) || !result.found) {
        fprintf(stderr, "ERROR: no solution found in lookup table. The state may be impossible, or it may not match the sticker order.\n");
        lookup_table_free(&table);
        return EXIT_FAILURE;
    }

    lookup_table_free(&table);
    return print_cli_solve_result(&target, &result);
}


static void ensure_default_lookup_directory(const char *path) {
    if (strcmp(path, DEFAULT_LOOKUP_PATH) == 0) {
        mkdir("build", 0755);
        mkdir("build/lookup", 0755);
    }
}

static int handle_build_lookup(int argc, char *argv[]) {
    const char *path = DEFAULT_LOOKUP_PATH;
    LookupTable table;

    if (argc >= 3) {
        path = argv[2];
    }

    printf("Building lookup table from the solved Skewb...\n");
    printf("This stores every reachable state and the first move back toward solved.\n\n");

    if (!build_lookup_table(&table)) {
        return EXIT_FAILURE;
    }

    print_lookup_table_summary(&table);

    ensure_default_lookup_directory(path);

    printf("\nSaving lookup table to %s...\n", path);
    if (!save_lookup_table(&table, path)) {
        lookup_table_free(&table);
        return EXIT_FAILURE;
    }

    printf("Saved successfully.\n");
    lookup_table_free(&table);
    return EXIT_SUCCESS;
}

int main(int argc, char *argv[]) {
    State target;
    unsigned char face_colours[NUM_FACES];

    build_move_tables();

    if (!run_internal_tests()) {
        return EXIT_FAILURE;
    }

    if (argc > 1) {
        if (strcmp(argv[1], "--solve-any") == 0) {
            return handle_cli_solve_any(argc, argv);
        }

        if (strcmp(argv[1], "--solve-any-fast") == 0) {
            return handle_cli_solve_any_fast(argc, argv);
        }

        if (strcmp(argv[1], "--validate-any") == 0) {
            return handle_cli_validate_any(argc, argv);
        }

        if (strcmp(argv[1], "--count-states") == 0) {
            StateSpaceStats stats;
            printf("Counting all reachable states from the solved Skewb...\n");
            printf("This may take a few seconds.\n\n");
            if (!count_state_space(&stats)) {
                return EXIT_FAILURE;
            }
            print_state_space_stats(&stats);
            return EXIT_SUCCESS;
        }

        if (strcmp(argv[1], "--build-lookup") == 0) {
            return handle_build_lookup(argc, argv);
        }

        if (strcmp(argv[1], "--help") == 0 || strcmp(argv[1], "-h") == 0) {
            print_cli_usage(argv[0]);
            return EXIT_SUCCESS;
        }

        fprintf(stderr, "ERROR: unknown command-line option '%s'.\n", argv[1]);
        print_cli_usage(argv[0]);
        return EXIT_FAILURE;
    }

    printf("Skewb optimal solver\n");
    printf("====================\n\n");
    printf("Choose input mode:\n");
    printf("1 = demo scramble generated by the program\n");
    printf("2 = enter my own Skewb colours, solved scheme inferred automatically\n");
    printf("3 = enter a scramble sequence\n");
    printf("4 = enter my own Skewb colours with a known solved colour scheme\n");
    printf("5 = count all unique states from the solved position\n");
    printf("6 = enter colours and solve using precomputed lookup table\n");
    printf("7 = build precomputed lookup table\n");
    printf("Choice: ");

    int choice = 0;
    if (scanf("%d", &choice) != 1) {
        fprintf(stderr, "Invalid choice.\n");
        return EXIT_FAILURE;
    }
    clear_input_line();

    if (choice == 1) {
        run_demo(&target, face_colours);
        solve_with_known_scheme(&target, face_colours);
    } else if (choice == 2) {
        if (read_state_unknown_scheme(&target)) {
            solve_with_unknown_scheme(&target);
        }
    } else if (choice == 3) {
        if (run_scramble_input(&target, face_colours)) {
            solve_with_known_scheme(&target, face_colours);
        }
    } else if (choice == 4) {
        if (read_state_from_user(&target, face_colours)) {
            solve_with_known_scheme(&target, face_colours);
        }
    } else if (choice == 5) {
        StateSpaceStats stats;
        printf("Counting all reachable states from the solved Skewb...\n");
        printf("This may take a few seconds.\n\n");
        if (!count_state_space(&stats)) {
            return EXIT_FAILURE;
        }
        print_state_space_stats(&stats);
    } else if (choice == 6) {
        if (read_state_unknown_scheme(&target)) {
            solve_with_lookup_table(&target);
        }
    } else if (choice == 7) {
        char *fake_argv[] = {argv[0], "--build-lookup", DEFAULT_LOOKUP_PATH};
        return handle_build_lookup(3, fake_argv);
    } else {
        printf("Unknown choice.\n");
        return EXIT_FAILURE;
    }

    return EXIT_SUCCESS;
}
