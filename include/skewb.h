#ifndef SKEWB_H
#define SKEWB_H

#include <stdint.h>

#define NUM_STICKERS 30
#define NUM_FACES 6
#define STICKERS_PER_FACE 5
#define NUM_MOVES 8
#define MAX_SOLUTION_LENGTH 64

typedef struct {
    unsigned char s[NUM_STICKERS];
} State;

extern const char *FACE_NAMES[NUM_FACES];
extern const char *STICKER_NAMES[NUM_STICKERS];
extern const char *MOVE_NAMES[NUM_MOVES];
extern const int INVERSE_MOVE[NUM_MOVES];

void build_move_tables(void);
void apply_move(const State *src, State *dst, int move);
int same_state(const State *a, const State *b);
uint64_t hash_state(const State *st);
void make_solved_state(State *st, const unsigned char face_colours[NUM_FACES]);
int is_any_solved_state(const State *st);
int parse_move_token(const char *token);
void print_state_by_faces(const State *st);

#endif
