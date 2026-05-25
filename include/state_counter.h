#ifndef STATE_COUNTER_H
#define STATE_COUNTER_H

#include "skewb.h"

#define MAX_DEPTH_HISTOGRAM 64

typedef struct {
    int total_states;
    int god_number;
    long long depth_counts[MAX_DEPTH_HISTOGRAM + 1];
} StateSpaceStats;

int count_state_space(StateSpaceStats *stats);
void print_state_space_stats(const StateSpaceStats *stats);

#endif
