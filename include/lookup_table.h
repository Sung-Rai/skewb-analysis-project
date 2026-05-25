#ifndef LOOKUP_TABLE_H
#define LOOKUP_TABLE_H

#include "solver.h"
#include "skewb.h"

#define DEFAULT_LOOKUP_PATH "build/lookup/skewb_lookup.bin"

typedef struct {
    State state;
    unsigned char distance;
    unsigned char move_to_solved;
    unsigned char last_move_from_solved;
    unsigned char reserved;
} LookupEntry;

typedef struct {
    LookupEntry *entries;
    int count;
    int capacity;
    int *hash_table;
    int hash_size;
} LookupTable;

void lookup_table_init_empty(LookupTable *table);
void lookup_table_free(LookupTable *table);

int build_lookup_table(LookupTable *table);
int save_lookup_table(const LookupTable *table, const char *path);
int load_lookup_table(LookupTable *table, const char *path);

int lookup_table_find(const LookupTable *table, const State *state, int *index_out);
int lookup_table_contains_known_scheme(const LookupTable *table, const State *target, int *distance_out);
int lookup_table_contains_any_scheme(const LookupTable *table, const State *target, int *attempts_out, int *best_distance_out);

int solve_known_scheme_fast(const LookupTable *table, const State *target, SolveResult *result);
int solve_any_scheme_fast(const LookupTable *table, const State *target, SolveResult *result);

void print_lookup_table_summary(const LookupTable *table);

#endif
