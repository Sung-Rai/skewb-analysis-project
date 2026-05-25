#include "state_counter.h"

#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define COUNT_HASH_SIZE 8388608u
#define EMPTY_SLOT (-1)

typedef struct {
    State state;
    unsigned char depth;
    unsigned char last_move;
} CountNode;

typedef struct {
    CountNode *nodes;
    int *hash_table;
    int node_count;
    int node_capacity;
} CounterContext;

static void initialise_stats(StateSpaceStats *stats) {
    stats->total_states = 0;
    stats->god_number = 0;
    for (int i = 0; i <= MAX_DEPTH_HISTOGRAM; i++) {
        stats->depth_counts[i] = 0;
    }
}

static int initialise_context(CounterContext *ctx) {
    ctx->nodes = NULL;
    ctx->node_count = 0;
    ctx->node_capacity = 0;
    ctx->hash_table = malloc((size_t)COUNT_HASH_SIZE * sizeof(int));

    if (!ctx->hash_table) {
        fprintf(stderr, "Could not allocate state counter hash table.\n");
        return 0;
    }

    for (uint32_t i = 0; i < COUNT_HASH_SIZE; i++) {
        ctx->hash_table[i] = EMPTY_SLOT;
    }

    return 1;
}

static void free_context(CounterContext *ctx) {
    free(ctx->hash_table);
    free(ctx->nodes);
    ctx->hash_table = NULL;
    ctx->nodes = NULL;
    ctx->node_count = 0;
    ctx->node_capacity = 0;
}

static void ensure_node_capacity(CounterContext *ctx) {
    if (ctx->node_count < ctx->node_capacity) {
        return;
    }

    int new_capacity = (ctx->node_capacity == 0) ? 1024 : ctx->node_capacity * 2;
    CountNode *new_nodes = realloc(ctx->nodes, (size_t)new_capacity * sizeof(CountNode));

    if (!new_nodes) {
        fprintf(stderr, "Out of memory while counting Skewb states.\n");
        free_context(ctx);
        exit(EXIT_FAILURE);
    }

    ctx->nodes = new_nodes;
    ctx->node_capacity = new_capacity;
}

static int find_in_hash(const CounterContext *ctx, const State *st) {
    uint64_t h = hash_state(st);
    uint32_t slot = (uint32_t)(h & (COUNT_HASH_SIZE - 1));

    while (ctx->hash_table[slot] != EMPTY_SLOT) {
        int idx = ctx->hash_table[slot];
        if (same_state(&ctx->nodes[idx].state, st)) {
            return idx;
        }
        slot = (slot + 1) & (COUNT_HASH_SIZE - 1);
    }

    return EMPTY_SLOT;
}

static int insert_node(CounterContext *ctx, const State *st, unsigned char depth, unsigned char last_move) {
    uint64_t h = hash_state(st);
    uint32_t slot = (uint32_t)(h & (COUNT_HASH_SIZE - 1));

    while (ctx->hash_table[slot] != EMPTY_SLOT) {
        int idx = ctx->hash_table[slot];
        if (same_state(&ctx->nodes[idx].state, st)) {
            return idx;
        }
        slot = (slot + 1) & (COUNT_HASH_SIZE - 1);
    }

    ensure_node_capacity(ctx);

    int idx = ctx->node_count++;
    ctx->nodes[idx].state = *st;
    ctx->nodes[idx].depth = depth;
    ctx->nodes[idx].last_move = last_move;
    ctx->hash_table[slot] = idx;

    return idx;
}

int count_state_space(StateSpaceStats *stats) {
    CounterContext ctx;
    const unsigned char default_colours[NUM_FACES] = {'W', 'R', 'G', 'Y', 'O', 'B'};
    State solved;

    initialise_stats(stats);

    if (!initialise_context(&ctx)) {
        return 0;
    }

    make_solved_state(&solved, default_colours);
    insert_node(&ctx, &solved, 0, 255);
    stats->depth_counts[0] = 1;

    int head = 0;
    while (head < ctx.node_count) {
        State current_state = ctx.nodes[head].state;
        unsigned char current_depth = ctx.nodes[head].depth;
        unsigned char last_move = ctx.nodes[head].last_move;

        for (int move = 0; move < NUM_MOVES; move++) {
            if (last_move != 255 && move == INVERSE_MOVE[last_move]) {
                continue;
            }

            State next;
            apply_move(&current_state, &next, move);

            if (find_in_hash(&ctx, &next) == EMPTY_SLOT) {
                unsigned char next_depth = (unsigned char)(current_depth + 1);

                if (next_depth > MAX_DEPTH_HISTOGRAM) {
                    fprintf(stderr, "Depth exceeded MAX_DEPTH_HISTOGRAM. Increase the constant.\n");
                    free_context(&ctx);
                    return 0;
                }

                insert_node(&ctx, &next, next_depth, (unsigned char)move);
                stats->depth_counts[next_depth]++;

                if (next_depth > stats->god_number) {
                    stats->god_number = next_depth;
                }
            }
        }

        head++;
    }

    stats->total_states = ctx.node_count;
    free_context(&ctx);
    return 1;
}

void print_state_space_stats(const StateSpaceStats *stats) {
    printf("Skewb state-space analysis\n");
    printf("==========================\n");
    printf("Total unique states: %d\n", stats->total_states);
    printf("God number: %d moves\n", stats->god_number);
    printf("\nDepth histogram:\n");

    for (int depth = 0; depth <= stats->god_number; depth++) {
        printf("Depth %2d: %lld\n", depth, stats->depth_counts[depth]);
    }
}
