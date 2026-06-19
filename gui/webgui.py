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
import mimetypes
import os
import subprocess
import sys
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Dict, List, Tuple

PROJECT_ROOT = Path(__file__).resolve().parents[1]
SOLVER_PATH = PROJECT_ROOT / "build" / "bin" / "skewb_solver"
LOOKUP_PATH = PROJECT_ROOT / "build" / "lookup" / "skewb_lookup.bin"
HOST = "127.0.0.1"
PORT = int(os.environ.get("SKEWB_WEBGUI_PORT", "8000"))
STATIC_DIR = Path(__file__).parent / "static"

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
        if self.path != "/solve":
            self.send_json({"ok": False, "error": "Not found"}, status=404)
            return

        try:
            content_length = int(self.headers.get("Content-Length", "0"))
            payload = self.rfile.read(content_length).decode("utf-8")
            data = json.loads(payload)
        except Exception as exc:
            self.send_json({"ok": False, "error": f"Invalid JSON: {exc}"}, status=400)
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
