# Makefile for the modular Skewb solver

CC := gcc
CFLAGS := -O2 -std=c11 -Wall -Wextra -Iinclude

TARGET := build/bin/skewb_solver
OBJ_DIR := build/obj
LOOKUP := build/lookup/skewb_lookup.bin

SRC := src/main.c src/skewb.c src/input.c src/solver.c src/state_counter.c src/lookup_table.c tests/tests.c
OBJ := $(SRC:%.c=$(OBJ_DIR)/%.o)

.PHONY: all run gui tkgui webgui webgui-fast count-states build-lookup solve-example-fast test test-full perf clean rebuild validate-example validate-impossible

all: $(TARGET)

$(TARGET): $(OBJ)
	@mkdir -p $(dir $@)
	$(CC) $(CFLAGS) $^ -o $@

$(OBJ_DIR)/%.o: %.c
	@mkdir -p $(dir $@)
	$(CC) $(CFLAGS) -c $< -o $@

$(LOOKUP): all
	@mkdir -p $(dir $@)
	./$(TARGET) --build-lookup $(LOOKUP)

run: all
	./$(TARGET)

count-states: all
	./$(TARGET) --count-states

build-lookup: $(LOOKUP)

solve-example-fast: all build-lookup
	./$(TARGET) --solve-any-fast WOWYB RGYRO GGBGY YWBBG OROYW WBORR

test: all
	./tests/smoke_test.sh ./$(TARGET)

test-full: all
	./tests/full_test.sh ./$(TARGET)

validate-example: all
	./$(TARGET) --validate-any WOWYB RGYRO GGBGY YWBBG OROYW WBORR

validate-impossible: all
	./$(TARGET) --validate-any WWWWR RRRRW GGGGG YYYYY OOOOO BBBBB

perf: all
	./scripts/performance_compare.sh ./$(TARGET)

gui: webgui

webgui: all
	python3 gui/webgui.py

webgui-fast: all build-lookup
	python3 gui/webgui.py

tkgui: all
	python3 gui/skewb_gui.py

clean:
	rm -rf build

rebuild: clean all
