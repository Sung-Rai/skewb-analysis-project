#include "solver.h"

#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>

#define HASH_SIZE 8388608u
#define EMPTY_SLOT (-1)

typedef struct {
    State state;
    int parent;
    unsigned char move;
} Node;

typedef struct {
    Node *nodes;
    int *hash_table;
    int node_count;
    int node_capacity;
} SolverContext;

static void initialise_result(SolveResult *result) {
    result->found = 0;
    result->length = 0;
    result->states_explored = 0;
}

static int initialise_context(SolverContext *ctx) {
    ctx->nodes = NULL;
    ctx->node_count = 0;
    ctx->node_capacity = 0;
    ctx->hash_table = malloc((size_t)HASH_SIZE * sizeof(int));

    if (!ctx->hash_table) {
        fprintf(stderr, "Could not allocate hash table.\n");
        return 0;
    }

    for (uint32_t i = 0; i < HASH_SIZE; i++) {
        ctx->hash_table[i] = EMPTY_SLOT;
    }

    return 1;
}

static void free_context(SolverContext *ctx) {
    free(ctx->hash_table);
    free(ctx->nodes);
    ctx->hash_table = NULL;
    ctx->nodes = NULL;
    ctx->node_count = 0;
    ctx->node_capacity = 0;
}

static void ensure_node_capacity(SolverContext *ctx) {
    if (ctx->node_count < ctx->node_capacity) return;

    int new_capacity = (ctx->node_capacity == 0) ? 1024 : ctx->node_capacity * 2;
    Node *new_nodes = realloc(ctx->nodes, (size_t)new_capacity * sizeof(Node));

    if (!new_nodes) {
        fprintf(stderr, "Out of memory while expanding BFS nodes.\n");
        free_context(ctx);
        exit(EXIT_FAILURE);
    }

    ctx->nodes = new_nodes;
    ctx->node_capacity = new_capacity;
}

static int find_in_hash(const SolverContext *ctx, const State *st) {
    uint64_t h = hash_state(st);
    uint32_t slot = (uint32_t)(h & (HASH_SIZE - 1));

    while (ctx->hash_table[slot] != EMPTY_SLOT) {
        int idx = ctx->hash_table[slot];
        if (same_state(&ctx->nodes[idx].state, st)) {
            return idx;
        }
        slot = (slot + 1) & (HASH_SIZE - 1);
    }

    return EMPTY_SLOT;
}

static int insert_node(SolverContext *ctx, const State *st, int parent, unsigned char move) {
    uint64_t h = hash_state(st);
    uint32_t slot = (uint32_t)(h & (HASH_SIZE - 1));

    while (ctx->hash_table[slot] != EMPTY_SLOT) {
        int idx = ctx->hash_table[slot];
        if (same_state(&ctx->nodes[idx].state, st)) {
            return idx;
        }
        slot = (slot + 1) & (HASH_SIZE - 1);
    }

    ensure_node_capacity(ctx);

    int idx = ctx->node_count++;
    ctx->nodes[idx].state = *st;
    ctx->nodes[idx].parent = parent;
    ctx->nodes[idx].move = move;
    ctx->hash_table[slot] = idx;

    return idx;
}

static int reconstruct_root_to_node_path(const SolverContext *ctx, int target_idx,
                                         unsigned char path[], int max_len) {
    int len = 0;
    int current = target_idx;

    while (ctx->nodes[current].parent != -1) {
        if (len >= max_len) {
            fprintf(stderr, "Internal error: path too long.\n");
            exit(EXIT_FAILURE);
        }

        path[len++] = ctx->nodes[current].move;
        current = ctx->nodes[current].parent;
    }

    for (int i = 0; i < len / 2; i++) {
        unsigned char tmp = path[i];
        path[i] = path[len - 1 - i];
        path[len - 1 - i] = tmp;
    }

    return len;
}

int solve_fixed_scheme(const State *solved, const State *target, SolveResult *result) {
    SolverContext ctx;
    initialise_result(result);

    if (!initialise_context(&ctx)) {
        return 0;
    }

    insert_node(&ctx, solved, -1, 255);

    int head = 0;
    while (head < ctx.node_count) {
        if (same_state(&ctx.nodes[head].state, target)) {
            unsigned char solved_to_target[MAX_SOLUTION_LENGTH];
            int len = reconstruct_root_to_node_path(&ctx, head, solved_to_target, MAX_SOLUTION_LENGTH);

            result->found = 1;
            result->length = len;
            result->states_explored = ctx.node_count;

            for (int i = 0; i < len; i++) {
                result->path[i] = (unsigned char)INVERSE_MOVE[solved_to_target[len - 1 - i]];
            }

            free_context(&ctx);
            return 1;
        }

        for (int move = 0; move < NUM_MOVES; move++) {
            if (ctx.nodes[head].parent != -1 && move == INVERSE_MOVE[ctx.nodes[head].move]) {
                continue;
            }

            State next;
            apply_move(&ctx.nodes[head].state, &next, move);

            if (find_in_hash(&ctx, &next) == EMPTY_SLOT) {
                insert_node(&ctx, &next, head, (unsigned char)move);
            }
        }
        head++;
    }

    result->states_explored = ctx.node_count;
    free_context(&ctx);
    return 1;
}

int solve_any_scheme(const State *start, SolveResult *result) {
    SolverContext ctx;
    initialise_result(result);

    if (!initialise_context(&ctx)) {
        return 0;
    }

    insert_node(&ctx, start, -1, 255);

    int head = 0;
    while (head < ctx.node_count) {
        if (is_any_solved_state(&ctx.nodes[head].state)) {
            result->found = 1;
            result->length = reconstruct_root_to_node_path(&ctx, head, result->path, MAX_SOLUTION_LENGTH);
            result->states_explored = ctx.node_count;
            free_context(&ctx);
            return 1;
        }

        for (int move = 0; move < NUM_MOVES; move++) {
            if (ctx.nodes[head].parent != -1 && move == INVERSE_MOVE[ctx.nodes[head].move]) {
                continue;
            }

            State next;
            apply_move(&ctx.nodes[head].state, &next, move);

            if (find_in_hash(&ctx, &next) == EMPTY_SLOT) {
                insert_node(&ctx, &next, head, (unsigned char)move);
            }
        }
        head++;
    }

    result->states_explored = ctx.node_count;
    free_context(&ctx);
    return 1;
}

void print_solution(const SolveResult *result) {
    if (!result->found) {
        printf("No solution found.\n");
        return;
    }

    if (result->length == 0) {
        printf("Already solved.\n");
        return;
    }

    printf("Optimal solution (%d moves):\n", result->length);

    for (int i = 0; i < result->length; i++) {
        printf("%s", MOVE_NAMES[result->path[i]]);
        if (i < result->length - 1) {
            printf(" ");
        }
    }
    printf("\n");
}

int verify_solution_to_state(const State *start, const SolveResult *result, const State *expected) {
    State current = *start;

    for (int i = 0; i < result->length; i++) {
        State next;
        apply_move(&current, &next, result->path[i]);
        current = next;
    }

    return same_state(&current, expected);
}

int verify_solution_to_any_solved(const State *start, const SolveResult *result) {
    State current = *start;

    for (int i = 0; i < result->length; i++) {
        State next;
        apply_move(&current, &next, result->path[i]);
        current = next;
    }

    return is_any_solved_state(&current);
}
