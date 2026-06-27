#!/usr/bin/env python3
"""
webgui.py

A small browser-based front-end for the C Skewb solver.
It uses only Python's standard library, so no Flask/Tkinter install is needed.

Run from the project root with:
    make webgui

Then open:
    http://127.0.0.1:8000
"""

from __future__ import annotations

import json
import itertools
import mimetypes
import os
import struct
import subprocess
import sys
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Dict, List, Optional, Tuple

PROJECT_ROOT = Path(__file__).resolve().parents[1]
SOLVER_PATH = PROJECT_ROOT / "build" / "bin" / "skewb_solver"
LOOKUP_PATH = PROJECT_ROOT / "build" / "lookup" / "skewb_lookup.bin"
HOST = "127.0.0.1"
PORT = int(os.environ.get("SKEWB_WEBGUI_PORT", "8000"))
STATIC_DIR = Path(__file__).parent / "static"

LOOKUP_HEADER_STRUCT = struct.Struct("<8sii")
LOOKUP_ENTRY_SIZE = 34
LOOKUP_STATE_SIZE = 30
LOOKUP_DISTANCE_OFFSET = 30
CANONICAL_COLOURS = b"WRGYOB"
GRAPH_MOVE_NAMES = ["R", "R'", "L", "L'", "D", "D'", "B", "B'"]
GRAPH_BASE_MOVE_PERMS: Dict[str, List[int]] = {
    "R": [0, 8, 5, 6, 9, 11, 12, 7, 10, 14, 1, 2, 3, 13, 4, 15, 21, 17, 18, 19, 20, 25, 22, 23, 24, 16, 26, 27, 28, 29],
    "L": [20, 21, 2, 23, 24, 5, 10, 7, 8, 9, 18, 11, 12, 13, 14, 15, 16, 17, 6, 19, 26, 27, 22, 25, 29, 3, 0, 1, 28, 4],
    "D": [0, 1, 2, 8, 4, 5, 6, 7, 27, 9, 16, 11, 18, 15, 19, 22, 23, 17, 21, 24, 20, 12, 13, 10, 14, 25, 26, 3, 28, 29],
    "B": [0, 23, 2, 3, 4, 5, 27, 28, 25, 29, 10, 11, 1, 13, 14, 15, 6, 7, 8, 9, 20, 21, 22, 12, 24, 18, 26, 16, 17, 19],
}


def inverse_permutation(permutation: List[int]) -> List[int]:
    inverse = [0] * len(permutation)
    for source_index, destination_index in enumerate(permutation):
        inverse[destination_index] = source_index
    return inverse


GRAPH_MOVE_PERMS: Dict[str, List[int]] = {}
for _move_name, _permutation in GRAPH_BASE_MOVE_PERMS.items():
    GRAPH_MOVE_PERMS[_move_name] = _permutation
    GRAPH_MOVE_PERMS[f"{_move_name}'"] = inverse_permutation(_permutation)


class LookupGraphIndex:
    def __init__(self, path: Path):
        self.path = path
        self.loaded = False
        self.available = False
        self.entries: Dict[bytes, Dict[str, int]] = {}
        self.depth_counts: Dict[int, int] = {}
        self.metadata_cache: Dict[str, Optional[Dict[str, int]]] = {}

    def ensure_loaded(self) -> bool:
        if self.loaded:
            return self.available

        self.loaded = True
        if not self.path.exists():
            return False

        try:
            data = self.path.read_bytes()
        except OSError:
            return False

        if len(data) < LOOKUP_HEADER_STRUCT.size:
            return False

        magic, version, count = LOOKUP_HEADER_STRUCT.unpack_from(data, 0)
        if not magic.startswith(b"SKLUT1") or version != 1 or count <= 0:
            return False

        depth_ranks: Dict[int, int] = {}
        offset = LOOKUP_HEADER_STRUCT.size

        for index in range(count):
            if offset + LOOKUP_ENTRY_SIZE > len(data):
                break

            state = data[offset:offset + LOOKUP_STATE_SIZE]
            distance = data[offset + LOOKUP_DISTANCE_OFFSET]
            rank = depth_ranks.get(distance, 0)
            depth_ranks[distance] = rank + 1

            self.entries[state] = {
                "index": index,
                "depth": int(distance),
                "rankInDepth": rank,
            }
            offset += LOOKUP_ENTRY_SIZE

        self.depth_counts = depth_ranks
        self.available = bool(self.entries)
        return self.available

    def depth_histogram(self) -> List[Dict[str, int]]:
        if not self.ensure_loaded():
            return []
        return [
            {"depth": depth, "count": self.depth_counts[depth]}
            for depth in sorted(self.depth_counts)
        ]

    def metadata_for_state_id(self, state_id: str) -> Optional[Dict[str, int]]:
        cached = self.metadata_cache.get(state_id)
        if state_id in self.metadata_cache:
            return cached

        if not self.ensure_loaded() or len(state_id) != LOOKUP_STATE_SIZE:
            self.metadata_cache[state_id] = None
            return None

        try:
            state = state_id.encode("ascii")
        except UnicodeEncodeError:
            self.metadata_cache[state_id] = None
            return None

        metadata = self._metadata_for_any_colour_scheme(state)
        self.metadata_cache[state_id] = metadata
        return metadata

    def _metadata_for_any_colour_scheme(self, state: bytes) -> Optional[Dict[str, int]]:
        colours = sorted(set(state))
        if len(colours) != 6:
            return None

        best: Optional[Dict[str, int]] = None
        for actual_for_canonical in itertools.permutations(colours):
            actual_to_canonical = {
                actual_colour: CANONICAL_COLOURS[index]
                for index, actual_colour in enumerate(actual_for_canonical)
            }
            mapped = bytes(actual_to_canonical[colour] for colour in state)
            candidate = self.entries.get(mapped)

            if candidate and (best is None or candidate["depth"] < best["depth"]):
                best = candidate

        return dict(best) if best else None


LOOKUP_GRAPH_INDEX = LookupGraphIndex(LOOKUP_PATH)

def apply_graph_move_to_state_id(state_id: str, move: str) -> str:
    permutation = GRAPH_MOVE_PERMS.get(move)
    if not permutation or len(state_id) != LOOKUP_STATE_SIZE:
        return state_id

    next_state = [""] * len(state_id)
    for source_index, destination_index in enumerate(permutation):
        next_state[destination_index] = state_id[source_index]
    return "".join(next_state)

# Exact depth histogram for the implemented Skewb move set.
# This matches the output of `skewb_solver --count-states` and lets the
# browser draw an uncapped full-state view without recomputing the state
# space on every solve request.
FULL_STATE_SPACE_RINGS: List[Dict[str, int]] = [
    {"depth": 0, "count": 1},
    {"depth": 1, "count": 8},
    {"depth": 2, "count": 48},
    {"depth": 3, "count": 288},
    {"depth": 4, "count": 1728},
    {"depth": 5, "count": 10248},
    {"depth": 6, "count": 59304},
    {"depth": 7, "count": 315198},
    {"depth": 8, "count": 1225483},
    {"depth": 9, "count": 1455856},
    {"depth": 10, "count": 81028},
    {"depth": 11, "count": 90},
]
def parse_solution_moves(solution: object) -> List[str]:
    if not isinstance(solution, str) or not solution.strip():
        return []
    return solution.split()



def lookup_depth_histogram() -> List[Dict[str, int]]:
    return LOOKUP_GRAPH_INDEX.depth_histogram()


def fallback_lookup_rings(solution_length: int) -> List[Dict[str, int]]:
    max_depth = max(solution_length, 0)
    return [
        {"depth": depth, "count": 1 if depth == 0 else 8 ** min(depth, 5)}
        for depth in range(max_depth + 1)
    ]


def full_state_space_rings() -> List[Dict[str, int]]:
    return lookup_depth_histogram()


def lookup_explored_rings(solution_length: int) -> List[Dict[str, int]]:
    # A lookup solve follows one stored state per solution step. The lookup
    # table itself is shown by the "Every node" mode.
    return [
        {"depth": depth, "count": 1}
        for depth in range(0, max(solution_length, 0) + 1)
    ]


def bfs_visual_rings(solution_length: int, states_explored: object) -> List[Dict[str, int]]:
    max_depth = max(int(solution_length or 0), 0)
    total = max(int(states_explored or 0), 1)

    if max_depth == 0:
        return [{"depth": 0, "count": 1}]

    rings: List[Dict[str, int]] = [{"depth": 0, "count": 1}]
    remaining = max(total - 1, 0)

    for depth in range(1, max_depth + 1):
        ideal = 8 * (7 ** (depth - 1))
        count = max(1, min(remaining, ideal))
        rings.append({"depth": depth, "count": count})
        remaining -= count

    if remaining > 0:
        rings[-1]["count"] += remaining

    return rings


def solution_path_nodes(solution_moves: List[str]) -> List[Dict[str, object]]:
    length = len(solution_moves)
    nodes: List[Dict[str, object]] = []

    for index in range(length + 1):
        depth = length - index
        if index == 0:
            label = "Current state"
        elif index == length:
            label = "Solved state"
        else:
            label = f"After move {index}"

        node: Dict[str, object] = {
            "id": f"path-{index}",
            "depth": depth,
            "label": label,
        }

        if index < length:
            node["moveToNext"] = solution_moves[index]

        nodes.append(node)

    return nodes


def build_graph_payload(parsed: Dict[str, object], use_lookup: bool) -> Dict[str, object]:
    solution_moves = parse_solution_moves(parsed.get("solution"))
    solution_length = int(parsed.get("length") or len(solution_moves))

    lookup_available = LOOKUP_GRAPH_INDEX.ensure_loaded()

    if not lookup_available:
        return {
            "available": False,
            "lookupRequired": True,
            "lookupGraphAvailable": False,
            "type": "unavailable",
            "title": "Graph unavailable",
            "summary": "Build the lookup table to use the graph.",
            "rings": [],
            "exploredRings": [],
            "allRings": [],
            "path": [],
            "moves": solution_moves,
            "solutionLength": solution_length,
            "states": parsed.get("states"),
            "totalStates": 0,
            "neighbourEndpoint": None,
        }

    all_rings = full_state_space_rings()
    explored_rings = lookup_explored_rings(solution_length)

    if not any(ring["depth"] == 0 for ring in explored_rings):
        explored_rings.insert(0, {"depth": 0, "count": 1})

    if not any(ring["depth"] == 0 for ring in all_rings):
        all_rings.insert(0, {"depth": 0, "count": 1})

    if use_lookup:
        title = "Solve graph"
        summary = "Ready."
        graph_type = "lookup"
    else:
        title = "Solve graph"
        summary = "Ready."
        graph_type = "lookup-backed-bfs"

    return {
        "available": True,
        "lookupRequired": True,
        "type": graph_type,
        "title": title,
        "summary": summary,
        "rings": explored_rings,
        "exploredRings": explored_rings,
        "allRings": all_rings,
        "path": solution_path_nodes(solution_moves),
        "moves": solution_moves,
        "solutionLength": solution_length,
        "states": parsed.get("states"),
        "totalStates": sum(ring["count"] for ring in all_rings),
        "lookupGraphAvailable": True,
        "neighbourEndpoint": "/graph/neighbours",
    }


def parse_solver_output(stdout: str) -> Dict[str, object]:
    result: Dict[str, object] = {
        "ok": False,
        "length": None,
        "solution": "",
        "states": None,
        "verified": "no",
        "raw": stdout,
    }

    for line in stdout.splitlines():
        line = line.strip()
        if line == "OK":
            result["ok"] = True
        elif line.startswith("LENGTH "):
            result["length"] = int(line.split(maxsplit=1)[1])
        elif line.startswith("SOLUTION"):
            parts = line.split(maxsplit=1)
            result["solution"] = parts[1] if len(parts) > 1 else ""
        elif line.startswith("STATES "):
            result["states"] = int(line.split(maxsplit=1)[1])
        elif line.startswith("VERIFIED "):
            result["verified"] = line.split(maxsplit=1)[1]

    return result


def validate_faces(faces: object) -> Tuple[bool, str, List[str]]:
    if not isinstance(faces, list) or len(faces) != 6:
        return False, "Expected exactly six face strings.", []

    cleaned: List[str] = []
    for face in faces:
        if not isinstance(face, str):
            return False, "Each face must be a string.", []
        face = face.strip().upper()
        if len(face) != 5:
            return False, "Each face must contain exactly five letters.", []
        if not face.isalpha():
            return False, "Face strings must contain letters only.", []
        cleaned.append(face)

    return True, "", cleaned


def lookup_graph_neighbours_payload(state_id: str) -> Dict[str, object]:
    if not isinstance(state_id, str) or len(state_id) != LOOKUP_STATE_SIZE:
        return {"ok": False, "error": "Expected a 30-character stateId."}

    if not LOOKUP_GRAPH_INDEX.ensure_loaded():
        return {"ok": False, "error": "Lookup table is not available. Run make build-lookup first."}

    current_metadata = LOOKUP_GRAPH_INDEX.metadata_for_state_id(state_id)
    if current_metadata is None:
        return {"ok": False, "error": "State was not found in the lookup table under any colour scheme."}

    neighbours: List[Dict[str, object]] = []
    for move in GRAPH_MOVE_NAMES:
        next_state_id = apply_graph_move_to_state_id(state_id, move)
        metadata = LOOKUP_GRAPH_INDEX.metadata_for_state_id(next_state_id)

        if metadata is None:
            continue

        neighbours.append({
            "move": move,
            "stateId": next_state_id,
            "index": metadata["index"],
            "depth": metadata["depth"],
            "rankInDepth": metadata["rankInDepth"],
            "depthCount": LOOKUP_GRAPH_INDEX.depth_counts.get(metadata["depth"], 0),
        })

    return {
        "ok": True,
        "state": {
            "stateId": state_id,
            "index": current_metadata["index"],
            "depth": current_metadata["depth"],
            "rankInDepth": current_metadata["rankInDepth"],
            "depthCount": LOOKUP_GRAPH_INDEX.depth_counts.get(current_metadata["depth"], 0),
        },
        "neighbours": neighbours,
    }


class SkewbHandler(BaseHTTPRequestHandler):
    def do_GET(self) -> None:  # noqa: N802 - BaseHTTPRequestHandler method name
        requested_path = "/index.html" if self.path == "/" else self.path
        static_root = STATIC_DIR.resolve()
        file_path = (static_root / requested_path.lstrip("/")).resolve()

        if not file_path.is_file() or static_root not in file_path.parents:
            self.send_error(404, "Not found")
            return

        content = file_path.read_bytes()
        mime_type, _ = mimetypes.guess_type(file_path)

        self.send_response(200)
        self.send_header("Content-Type", mime_type or "application/octet-stream")
        self.send_header("Content-Length", str(len(content)))
        self.end_headers()
        self.wfile.write(content)

    def do_POST(self) -> None:  # noqa: N802 - BaseHTTPRequestHandler method name
        if self.path not in ("/solve", "/graph/neighbours"):
            self.send_json({"ok": False, "error": "Not found"}, status=404)
            return

        try:
            content_length = int(self.headers.get("Content-Length", "0"))
            payload = self.rfile.read(content_length).decode("utf-8")
            data = json.loads(payload)
        except Exception as exc:
            self.send_json({"ok": False, "error": f"Invalid JSON: {exc}"}, status=400)
            return

        if self.path == "/graph/neighbours":
            result = lookup_graph_neighbours_payload(str(data.get("stateId", "")))
            self.send_json(result, status=200 if result.get("ok") else 400)
            return

        valid, message, faces = validate_faces(data.get("faces"))
        if not valid:
            self.send_json({"ok": False, "error": message}, status=400)
            return

        if not SOLVER_PATH.exists():
            self.send_json({
                "ok": False,
                "error": "C solver not found. Run 'make' in the project root first."
            }, status=500)
            return

        use_lookup = LOOKUP_PATH.exists()
        solver_mode = "lookup table" if use_lookup else "normal BFS"
        state_label = "Lookup attempts" if use_lookup else "States explored"
        command = "--solve-any-fast" if use_lookup else "--solve-any"

        try:
            completed = subprocess.run(
                [str(SOLVER_PATH), command, *faces],
                cwd=str(PROJECT_ROOT),
                text=True,
                capture_output=True,
                timeout=120,
                check=False,
            )
        except subprocess.TimeoutExpired:
            self.send_json({"ok": False, "error": "Solver timed out after 120 seconds."}, status=500)
            return

        if completed.returncode != 0:
            error_text = completed.stderr.strip() or completed.stdout.strip() or "Unknown solver error."
            self.send_json({"ok": False, "error": error_text}, status=400)
            return

        parsed = parse_solver_output(completed.stdout)
        if not parsed.get("ok"):
            self.send_json({"ok": False, "error": "Unexpected solver output.", "raw": completed.stdout}, status=500)
            return

        parsed["mode"] = solver_mode
        parsed["stateLabel"] = state_label
        parsed["graph"] = build_graph_payload(parsed, use_lookup)
        self.send_json(parsed)

    def send_json(self, data: Dict[str, object], status: int = 200) -> None:
        body = json.dumps(data).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt: str, *args: object) -> None:
        # Keep the terminal clean, but still show server startup text.
        return


def main() -> int:
    if not SOLVER_PATH.exists():
        print("The C solver has not been built yet.")
        print("Run 'make' first, then run 'make webgui'.")
        return 1

    server = ThreadingHTTPServer((HOST, PORT), SkewbHandler)
    url = f"http://{HOST}:{PORT}"

    print("Skewb web GUI running.")
    print(f"Open this address in your browser: {url}")
    print("Press Ctrl+C in this terminal to stop the server.")

    try:
        webbrowser.open(url)
    except Exception:
        pass

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping web GUI.")
    finally:
        server.server_close()

    return 0


if __name__ == "__main__":
    sys.exit(main())
