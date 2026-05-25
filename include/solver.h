#ifndef SOLVER_H
#define SOLVER_H

#include "skewb.h"

typedef struct {
    int found;
    int length;
    unsigned char path[MAX_SOLUTION_LENGTH];
    int states_explored;
} SolveResult;

int solve_fixed_scheme(const State *solved, const State *target, SolveResult *result);
int solve_any_scheme(const State *start, SolveResult *result);
void print_solution(const SolveResult *result);
int verify_solution_to_state(const State *start, const SolveResult *result, const State *expected);
int verify_solution_to_any_solved(const State *start, const SolveResult *result);

#endif
