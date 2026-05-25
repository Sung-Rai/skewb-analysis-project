#include "lookup_table.h"

#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define LOOKUP_HASH_SIZE 8388608u
#define EMPTY_SLOT (-1)
#define LOOKUP_VERSION 1

static const unsigned char CANONICAL_COLOURS[NUM_FACES] = {'W', 'R', 'G', 'Y', 'O', 'B'};

typedef struct {
    char magic[8];
    int version;
    int count;
} LookupFileHeader;

static void initialise_result(SolveResult *result) {
    result->found = 0;
    result->length = 0;
    result->states_explored = 0;
}

void lookup_table_init_empty(LookupTable *table) {
    table->entries = NULL;
    table->count = 0;
    table->capacity = 0;
    table->hash_table = NULL;
    table->hash_size = (int)LOOKUP_HASH_SIZE;
}

void lookup_table_free(LookupTable *table) {
    free(table->entries);
    free(table->hash_table);
    lookup_table_init_empty(table);
}

static int allocate_hash_table(LookupTable *table) {
    table->hash_size = (int)LOOKUP_HASH_SIZE;
    table->hash_table = malloc((size_t)table->hash_size * sizeof(int));
    if (!table->hash_table) {
        fprintf(stderr, "Could not allocate lookup hash table.\n");
        return 0;
    }

    for (int i = 0; i < table->hash_size; i++) {
        table->hash_table[i] = EMPTY_SLOT;
    }

    return 1;
}

static void ensure_capacity(LookupTable *table) {
    if (table->count < table->capacity) {
        return;
    }

    int new_capacity = (table->capacity == 0) ? 1024 : table->capacity * 2;
    LookupEntry *new_entries = realloc(table->entries, (size_t)new_capacity * sizeof(LookupEntry));
    if (!new_entries) {
        fprintf(stderr, "Out of memory while building lookup table.\n");
        lookup_table_free(table);
        exit(EXIT_FAILURE);
    }

    table->entries = new_entries;
    table->capacity = new_capacity;
}

int lookup_table_find(const LookupTable *table, const State *state, int *index_out) {
    uint64_t h = hash_state(state);
    uint32_t slot = (uint32_t)(h & (uint32_t)(table->hash_size - 1));

    while (table->hash_table[slot] != EMPTY_SLOT) {
        int idx = table->hash_table[slot];
        if (same_state(&table->entries[idx].state, state)) {
            if (index_out) {
                *index_out = idx;
            }
            return 1;
        }
        slot = (slot + 1) & (uint32_t)(table->hash_size - 1);
    }

    return 0;
}

static int insert_entry(LookupTable *table, const State *state, unsigned char distance,
                        unsigned char move_to_solved, unsigned char last_move_from_solved) {
    uint64_t h = hash_state(state);
    uint32_t slot = (uint32_t)(h & (uint32_t)(table->hash_size - 1));

    while (table->hash_table[slot] != EMPTY_SLOT) {
        int idx = table->hash_table[slot];
        if (same_state(&table->entries[idx].state, state)) {
            return idx;
        }
        slot = (slot + 1) & (uint32_t)(table->hash_size - 1);
    }

    ensure_capacity(table);

    int idx = table->count++;
    table->entries[idx].state = *state;
    table->entries[idx].distance = distance;
    table->entries[idx].move_to_solved = move_to_solved;
    table->entries[idx].last_move_from_solved = last_move_from_solved;
    table->entries[idx].reserved = 0;
    table->hash_table[slot] = idx;

    return idx;
}

int build_lookup_table(LookupTable *table) {
    State solved;

    lookup_table_init_empty(table);
    if (!allocate_hash_table(table)) {
        return 0;
    }

    make_solved_state(&solved, CANONICAL_COLOURS);
    insert_entry(table, &solved, 0, 255, 255);

    int head = 0;
    while (head < table->count) {
        /* Copy the entry because insert_entry() may realloc table->entries. */
        LookupEntry entry = table->entries[head];

        for (int move = 0; move < NUM_MOVES; move++) {
            if (entry.last_move_from_solved != 255 && move == INVERSE_MOVE[entry.last_move_from_solved]) {
                continue;
            }

            State next;
            apply_move(&entry.state, &next, move);

            if (!lookup_table_find(table, &next, NULL)) {
                unsigned char next_distance = (unsigned char)(entry.distance + 1);
                unsigned char next_move_to_solved = (unsigned char)INVERSE_MOVE[move];
                insert_entry(table, &next, next_distance, next_move_to_solved, (unsigned char)move);
            }
        }

        head++;
    }

    return 1;
}

int save_lookup_table(const LookupTable *table, const char *path) {
    FILE *file = fopen(path, "wb");
    if (!file) {
        fprintf(stderr, "Could not open lookup file for writing: %s\n", path);
        return 0;
    }

    LookupFileHeader header;
    memset(&header, 0, sizeof(header));
    memcpy(header.magic, "SKLUT1", 6);
    header.version = LOOKUP_VERSION;
    header.count = table->count;

    if (fwrite(&header, sizeof(header), 1, file) != 1) {
        fprintf(stderr, "Could not write lookup table header.\n");
        fclose(file);
        return 0;
    }

    if (fwrite(table->entries, sizeof(LookupEntry), (size_t)table->count, file) != (size_t)table->count) {
        fprintf(stderr, "Could not write lookup table entries.\n");
        fclose(file);
        return 0;
    }

    fclose(file);
    return 1;
}

static int rebuild_hash_table(LookupTable *table) {
    if (!allocate_hash_table(table)) {
        return 0;
    }

    for (int idx = 0; idx < table->count; idx++) {
        uint64_t h = hash_state(&table->entries[idx].state);
        uint32_t slot = (uint32_t)(h & (uint32_t)(table->hash_size - 1));

        while (table->hash_table[slot] != EMPTY_SLOT) {
            slot = (slot + 1) & (uint32_t)(table->hash_size - 1);
        }

        table->hash_table[slot] = idx;
    }

    return 1;
}

int load_lookup_table(LookupTable *table, const char *path) {
    FILE *file = fopen(path, "rb");
    LookupFileHeader header;

    lookup_table_init_empty(table);

    if (!file) {
        return 0;
    }

    if (fread(&header, sizeof(header), 1, file) != 1) {
        fprintf(stderr, "Could not read lookup table header.\n");
        fclose(file);
        return 0;
    }

    if (memcmp(header.magic, "SKLUT1", 6) != 0 || header.version != LOOKUP_VERSION || header.count <= 0) {
        fprintf(stderr, "Lookup table file has an invalid format or version.\n");
        fclose(file);
        return 0;
    }

    table->entries = malloc((size_t)header.count * sizeof(LookupEntry));
    if (!table->entries) {
        fprintf(stderr, "Could not allocate memory for lookup table entries.\n");
        fclose(file);
        return 0;
    }

    table->count = header.count;
    table->capacity = header.count;

    if (fread(table->entries, sizeof(LookupEntry), (size_t)table->count, file) != (size_t)table->count) {
        fprintf(stderr, "Could not read lookup table entries.\n");
        fclose(file);
        lookup_table_free(table);
        return 0;
    }

    fclose(file);

    if (!rebuild_hash_table(table)) {
        lookup_table_free(table);
        return 0;
    }

    return 1;
}

int lookup_table_contains_known_scheme(const LookupTable *table, const State *target, int *distance_out) {
    int idx;
    if (!lookup_table_find(table, target, &idx)) {
        return 0;
    }

    if (distance_out) {
        *distance_out = table->entries[idx].distance;
    }

    return 1;
}

int solve_known_scheme_fast(const LookupTable *table, const State *target, SolveResult *result) {
    State current = *target;
    initialise_result(result);

    for (int step = 0; step < MAX_SOLUTION_LENGTH; step++) {
        int idx;
        if (!lookup_table_find(table, &current, &idx)) {
            return 1;
        }

        const LookupEntry *entry = &table->entries[idx];
        if (entry->distance == 0) {
            result->found = 1;
            result->length = step;
            result->states_explored = step + 1;
            return 1;
        }

        if (entry->move_to_solved >= NUM_MOVES) {
            return 1;
        }

        result->path[step] = entry->move_to_solved;
        State next;
        apply_move(&current, &next, entry->move_to_solved);
        current = next;
    }

    return 1;
}

static int collect_distinct_colours(const State *state, unsigned char colours[NUM_FACES]) {
    int seen[26] = {0};
    int count = 0;

    for (int i = 0; i < NUM_STICKERS; i++) {
        unsigned char c = state->s[i];
        if (c < 'A' || c > 'Z') {
            return 0;
        }

        int idx = c - 'A';
        if (!seen[idx]) {
            if (count >= NUM_FACES) {
                return 0;
            }
            seen[idx] = 1;
            colours[count++] = c;
        }
    }

    return count == NUM_FACES;
}

static void map_state_to_canonical(const State *source, const unsigned char actual_for_canonical[NUM_FACES],
                                   State *mapped) {
    for (int i = 0; i < NUM_STICKERS; i++) {
        unsigned char c = source->s[i];
        unsigned char mapped_colour = '?';

        for (int j = 0; j < NUM_FACES; j++) {
            if (actual_for_canonical[j] == c) {
                mapped_colour = CANONICAL_COLOURS[j];
                break;
            }
        }

        mapped->s[i] = mapped_colour;
    }
}

static void try_permutations_recursive(const LookupTable *table, const State *target,
                                       const unsigned char colours[NUM_FACES], int used[NUM_FACES],
                                       unsigned char actual_for_canonical[NUM_FACES], int depth,
                                       SolveResult *best, int *lookups) {
    if (depth == NUM_FACES) {
        State mapped;
        SolveResult candidate;

        map_state_to_canonical(target, actual_for_canonical, &mapped);
        (*lookups)++;

        if (solve_known_scheme_fast(table, &mapped, &candidate) && candidate.found) {
            if (!best->found || candidate.length < best->length) {
                *best = candidate;
            }
        }
        return;
    }

    for (int i = 0; i < NUM_FACES; i++) {
        if (!used[i]) {
            used[i] = 1;
            actual_for_canonical[depth] = colours[i];
            try_permutations_recursive(table, target, colours, used, actual_for_canonical,
                                       depth + 1, best, lookups);
            used[i] = 0;
        }
    }
}

typedef struct {
    int reachable;
    int attempts;
    int best_distance;
} ReachabilityCheck;

static void check_permutations_recursive(const LookupTable *table, const State *target,
                                         const unsigned char colours[NUM_FACES], int used[NUM_FACES],
                                         unsigned char actual_for_canonical[NUM_FACES], int depth,
                                         ReachabilityCheck *check) {
    if (depth == NUM_FACES) {
        State mapped;
        int distance;

        map_state_to_canonical(target, actual_for_canonical, &mapped);
        check->attempts++;

        if (lookup_table_contains_known_scheme(table, &mapped, &distance)) {
            check->reachable = 1;
            if (check->best_distance < 0 || distance < check->best_distance) {
                check->best_distance = distance;
            }
        }
        return;
    }

    for (int i = 0; i < NUM_FACES; i++) {
        if (!used[i]) {
            used[i] = 1;
            actual_for_canonical[depth] = colours[i];
            check_permutations_recursive(table, target, colours, used, actual_for_canonical,
                                         depth + 1, check);
            used[i] = 0;
        }
    }
}

int lookup_table_contains_any_scheme(const LookupTable *table, const State *target,
                                     int *attempts_out, int *best_distance_out) {
    unsigned char colours[NUM_FACES];
    unsigned char actual_for_canonical[NUM_FACES];
    int used[NUM_FACES] = {0};
    ReachabilityCheck check;

    check.reachable = 0;
    check.attempts = 0;
    check.best_distance = -1;

    if (!collect_distinct_colours(target, colours)) {
        if (attempts_out) {
            *attempts_out = 0;
        }
        if (best_distance_out) {
            *best_distance_out = -1;
        }
        return 0;
    }

    check_permutations_recursive(table, target, colours, used, actual_for_canonical, 0, &check);

    if (attempts_out) {
        *attempts_out = check.attempts;
    }
    if (best_distance_out) {
        *best_distance_out = check.best_distance;
    }

    return check.reachable;
}

int solve_any_scheme_fast(const LookupTable *table, const State *target, SolveResult *result) {
    unsigned char colours[NUM_FACES];
    unsigned char actual_for_canonical[NUM_FACES];
    int used[NUM_FACES] = {0};
    int lookups = 0;

    initialise_result(result);

    if (!collect_distinct_colours(target, colours)) {
        return 1;
    }

    try_permutations_recursive(table, target, colours, used, actual_for_canonical, 0, result, &lookups);
    result->states_explored = lookups;
    return 1;
}

void print_lookup_table_summary(const LookupTable *table) {
    int god_number = 0;
    long long depth_counts[MAX_SOLUTION_LENGTH + 1] = {0};

    for (int i = 0; i < table->count; i++) {
        int depth = table->entries[i].distance;
        if (depth >= 0 && depth <= MAX_SOLUTION_LENGTH) {
            depth_counts[depth]++;
        }
        if (depth > god_number) {
            god_number = depth;
        }
    }

    printf("Lookup table summary\n");
    printf("====================\n");
    printf("Stored states: %d\n", table->count);
    printf("God number: %d moves\n", god_number);
    printf("\nDepth histogram:\n");
    for (int depth = 0; depth <= god_number; depth++) {
        printf("Depth %2d: %lld\n", depth, depth_counts[depth]);
    }
}
