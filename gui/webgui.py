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

INDEX_HTML = r"""<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Skewb Solver</title>
    <style>
        :root {
            --bg: #111827;
            --panel: #1f2937;
            --panel-2: #374151;
            --text: #f9fafb;
            --muted: #d1d5db;
            --accent: #60a5fa;
            --danger: #fca5a5;
            --ok: #86efac;
            --border: #4b5563;
            --empty: #6b7280;
            --face-size: 150px;
            --sticker-size: 42px;
        }

        * {
            box-sizing: border-box;
        }

        body {
            margin: 0;
            font-family: Arial, Helvetica, sans-serif;
            background: var(--bg);
            color: var(--text);
        }

        main {
            max-width: 1120px;
            margin: 0 auto;
            padding: 28px 18px 48px;
        }

        h1 {
            margin: 0 0 8px;
            font-size: 2rem;
        }

        .subtitle {
            margin: 0 0 24px;
            color: var(--muted);
            line-height: 1.5;
        }

        .layout {
            display: grid;
            grid-template-columns: minmax(0, 1fr) 300px;
            gap: 20px;
            align-items: start;
        }

        .card {
            background: var(--panel);
            border: 1px solid var(--border);
            border-radius: 16px;
            padding: 18px;
            box-shadow: 0 10px 30px rgba(0, 0, 0, 0.25);
        }

        .net-wrap {
            overflow-x: auto;
            padding-bottom: 8px;
        }

        .cube-net {
            display: grid;
            grid-template-columns: repeat(4, var(--face-size));
            grid-template-rows: repeat(3, var(--face-size));
            gap: 12px;
            justify-content: center;
            min-width: calc(4 * var(--face-size) + 3 * 12px);
        }

        .face {
            position: relative;
            width: var(--face-size);
            height: var(--face-size);
            border: 2px solid var(--border);
            border-radius: 14px;
            background: #111827;
            padding: 10px;
        }

        .face-U { grid-column: 2; grid-row: 1; }
        .face-L { grid-column: 1; grid-row: 2; }
        .face-F { grid-column: 2; grid-row: 2; }
        .face-R { grid-column: 3; grid-row: 2; }
        .face-B { grid-column: 4; grid-row: 2; }
        .face-D { grid-column: 2; grid-row: 3; }

        .face-title {
            position: absolute;
            left: 8px;
            top: 6px;
            z-index: 2;
            padding: 2px 7px;
            border-radius: 999px;
            background: rgba(17, 24, 39, 0.82);
            color: var(--text);
            font-size: 0.78rem;
            font-weight: bold;
            border: 1px solid rgba(255, 255, 255, 0.12);
        }

        .sticker-grid {
            display: grid;
            grid-template-columns: repeat(3, var(--sticker-size));
            grid-template-rows: repeat(3, var(--sticker-size));
            gap: 4px;
            justify-content: center;
            align-content: center;
            height: 100%;
        }

        .sticker {
            width: var(--sticker-size);
            height: var(--sticker-size);
            border: 2px solid #111827;
            border-radius: 8px;
            cursor: pointer;
            font-weight: bold;
            color: #111827;
            box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.35);
        }

        .sticker:focus {
            outline: 3px solid var(--accent);
            outline-offset: 2px;
        }

        .pos-0 { grid-column: 1; grid-row: 1; }
        .pos-1 { grid-column: 3; grid-row: 1; }
        .pos-2 { grid-column: 3; grid-row: 3; }
        .pos-3 { grid-column: 1; grid-row: 3; }
        .pos-4 { grid-column: 2; grid-row: 2; }

        .face-hint {
            position: absolute;
            right: 8px;
            bottom: 6px;
            color: var(--muted);
            font-size: 0.68rem;
            letter-spacing: 0.02em;
        }

        .palette {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 8px;
            margin-bottom: 18px;
        }

        .palette button {
            min-height: 42px;
            border: 2px solid transparent;
            border-radius: 10px;
            font-weight: bold;
            cursor: pointer;
        }

        .palette button.selected {
            border-color: var(--accent);
            box-shadow: 0 0 0 2px rgba(96, 165, 250, 0.35);
        }

        .actions {
            display: grid;
            gap: 10px;
        }

        .actions button {
            border: 0;
            border-radius: 10px;
            padding: 12px 14px;
            font-weight: bold;
            cursor: pointer;
            background: var(--panel-2);
            color: var(--text);
        }

        .actions button.primary {
            background: var(--accent);
            color: #0f172a;
        }

        .actions button:hover,
        .palette button:hover,
        .sticker:hover {
            filter: brightness(1.08);
        }

        .output {
            margin-top: 18px;
            padding: 14px;
            border-radius: 12px;
            background: #111827;
            border: 1px solid var(--border);
            min-height: 110px;
            white-space: pre-wrap;
            line-height: 1.5;
        }

        .ok {
            color: var(--ok);
        }

        .error {
            color: var(--danger);
        }

        .help {
            color: var(--muted);
            font-size: 0.92rem;
            line-height: 1.5;
        }

        code {
            background: #111827;
            padding: 2px 5px;
            border-radius: 6px;
        }

        @media (max-width: 920px) {
            .layout {
                grid-template-columns: 1fr;
            }
        }

        @media (max-width: 700px) {
            :root {
                --face-size: 128px;
                --sticker-size: 36px;
            }
        }
    </style>
</head>
<body>
<main>
    <h1>Skewb Solver</h1>
    <p class="subtitle">
        Enter the visible colours of the Skewb on a 2D open cube net. The C solver searches the Skewb group and returns an optimal move sequence.
    </p>

    <div class="layout">
        <section class="card net-wrap">
            <div id="faces" class="cube-net"></div>
        </section>

        <aside class="card">
            <h2>Colour palette</h2>
            <div id="palette" class="palette"></div>

            <div class="actions">
                <button class="primary" id="solveBtn">Solve</button>
                <button id="exampleBtn">Load Example</button>
                <button id="solvedBtn">Load Solved</button>
                <button id="clearBtn">Clear</button>
            </div>

            <div id="output" class="output help">Choose a colour, click stickers, then press Solve.</div>

            <p class="help">
                Net layout: <code>U</code> above <code>F</code>, <code>D</code> below <code>F</code>, with <code>L F R B</code> across the middle.<br>
                Each mini-face uses corner stickers plus a centre sticker.
            </p>
        </aside>
    </div>
</main>

<script>
const colours = [
    {letter: "W", name: "White",  css: "#ffffff"},
    {letter: "R", name: "Red",    css: "#ef4444"},
    {letter: "G", name: "Green",  css: "#22c55e"},
    {letter: "Y", name: "Yellow", css: "#fde047"},
    {letter: "O", name: "Orange", css: "#fb923c"},
    {letter: "B", name: "Blue",   css: "#60a5fa"},
];

const faces = [
    {name: "U", labels: ["ULB", "URB", "URF", "ULF", "C"]},
    {name: "R", labels: ["URF", "URB", "DRB", "DRF", "C"]},
    {name: "F", labels: ["ULF", "URF", "DRF", "DLF", "C"]},
    {name: "D", labels: ["DLF", "DRF", "DRB", "DLB", "C"]},
    {name: "L", labels: ["ULB", "ULF", "DLF", "DLB", "C"]},
    {name: "B", labels: ["URB", "ULB", "DLB", "DRB", "C"]},
];

const example = ["WOWYB", "RGYRO", "GGBGY", "YWBBG", "OROYW", "WBORR"];
const solved = ["WWWWW", "RRRRR", "GGGGG", "YYYYY", "OOOOO", "BBBBB"];
let currentColour = "W";
let state = Array.from({length: 6}, () => Array(5).fill(""));

function colourInfo(letter) {
    return colours.find(c => c.letter === letter) || {letter, css: "#9ca3af"};
}

function renderPalette() {
    const palette = document.getElementById("palette");
    palette.innerHTML = "";
    for (const colour of colours) {
        const button = document.createElement("button");
        button.textContent = colour.letter;
        button.title = colour.name;
        button.style.background = colour.css;
        button.style.color = colour.letter === "W" || colour.letter === "Y" ? "#111827" : "#ffffff";
        if (colour.letter === currentColour) button.classList.add("selected");
        button.addEventListener("click", () => {
            currentColour = colour.letter;
            renderPalette();
        });
        palette.appendChild(button);
    }
}

function renderFaces() {
    const container = document.getElementById("faces");
    container.innerHTML = "";

    faces.forEach((face, faceIndex) => {
        const wrapper = document.createElement("div");
        wrapper.className = `face face-${face.name}`;

        const title = document.createElement("div");
        title.className = "face-title";
        title.textContent = face.name;
        wrapper.appendChild(title);

        const grid = document.createElement("div");
        grid.className = "sticker-grid";

        for (let i = 0; i < 5; i++) {
            const button = document.createElement("button");
            const letter = state[faceIndex][i];
            button.className = `sticker pos-${i}`;
            button.textContent = letter || "";
            button.title = `${face.name}-${face.labels[i]}`;
            button.style.background = letter ? colourInfo(letter).css : "#6b7280";
            button.addEventListener("click", () => {
                state[faceIndex][i] = currentColour;
                renderFaces();
            });
            grid.appendChild(button);
        }

        const hint = document.createElement("div");
        hint.className = "face-hint";
        hint.textContent = "TL TR BR BL C";

        wrapper.appendChild(grid);
        wrapper.appendChild(hint);
        container.appendChild(wrapper);
    });
}

function setState(faceStrings) {
    state = faceStrings.map(face => face.split(""));
    renderFaces();
}

function clearState() {
    state = Array.from({length: 6}, () => Array(5).fill(""));
    renderFaces();
    setOutput("Choose a colour, click stickers, then press Solve.", "help");
}

function getFaceStrings() {
    return state.map(face => face.join(""));
}

function setOutput(text, className = "") {
    const output = document.getElementById("output");
    output.className = `output ${className}`.trim();
    output.textContent = text;
}

function validateBeforeSend(faceStrings) {
    for (let i = 0; i < faceStrings.length; i++) {
        if (faceStrings[i].length !== 5) {
            return `Face ${faces[i].name} is incomplete.`;
        }
        if (!/^[A-Z]{5}$/.test(faceStrings[i])) {
            return `Face ${faces[i].name} must contain five colour letters.`;
        }
    }
    return null;
}

async function solve() {
    const faceStrings = getFaceStrings();
    const validationError = validateBeforeSend(faceStrings);
    if (validationError) {
        setOutput(validationError, "error");
        return;
    }

    setOutput("Solving...", "help");

    try {
        const response = await fetch("/solve", {
            method: "POST",
            headers: {"Content-Type": "application/json"},
            body: JSON.stringify({faces: faceStrings})
        });
        const data = await response.json();

        if (!response.ok || !data.ok) {
            setOutput(data.error || "Solver failed.", "error");
            return;
        }

        const solutionText = data.solution ? data.solution : "Already solved";
        setOutput(
            `Solution: ${solutionText}\nLength: ${data.length}\nMode: ${data.mode}\n${data.stateLabel}: ${data.states}\nVerified: ${data.verified}`,
            "ok"
        );
    } catch (err) {
        setOutput(`Could not contact web server: ${err}`, "error");
    }
}

renderPalette();
setState(solved);

document.getElementById("solveBtn").addEventListener("click", solve);
document.getElementById("exampleBtn").addEventListener("click", () => {
    setState(example);
    setOutput("Example loaded. Press Solve.", "help");
});
document.getElementById("solvedBtn").addEventListener("click", () => {
    setState(solved);
    setOutput("Solved state loaded. Press Solve to test.", "help");
});
document.getElementById("clearBtn").addEventListener("click", clearState);
</script>
</body>
</html>
"""


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
        if self.path not in ("/", "/index.html"):
            self.send_error(404, "Not found")
            return

        body = INDEX_HTML.encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

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
