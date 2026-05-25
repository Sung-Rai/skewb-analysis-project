#ifndef INPUT_H
#define INPUT_H

#include "skewb.h"

void clear_input_line(void);
void print_input_guide(void);
int read_state_from_user(State *target, unsigned char face_colours[NUM_FACES]);
int read_state_unknown_scheme(State *target);
void run_demo(State *target, unsigned char face_colours[NUM_FACES]);
int run_scramble_input(State *target, unsigned char face_colours[NUM_FACES]);

#endif
