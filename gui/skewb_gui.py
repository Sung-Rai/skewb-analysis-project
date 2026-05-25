#!/usr/bin/env python3
"""
Simple Tkinter GUI for the C Skewb solver.

The GUI is intentionally lightweight: the mathematical model and optimal BFS
solver stay in C. This Python file only collects sticker colours and calls the
compiled executable using its --solve-any command-line mode.
"""

from __future__ import annotations

import os
import subprocess
import sys
import tkinter as tk
from pathlib import Path
from tkinter import messagebox

FACE_NAMES = ["U", "R", "F", "D", "L", "B"]
STICKER_NAMES = [
    ["U-ULB", "U-URB", "U-URF", "U-ULF", "U-centre"],
    ["R-URF", "R-URB", "R-DRB", "R-DRF", "R-centre"],
    ["F-ULF", "F-URF", "F-DRF", "F-DLF", "F-centre"],
    ["D-DLF", "D-DRF", "D-DRB", "D-DLB", "D-centre"],
    ["L-ULB", "L-ULF", "L-DLF", "L-DLB", "L-centre"],
    ["B-URB", "B-ULB", "B-DLB", "B-DRB", "B-centre"],
]

COLOURS = ["W", "R", "G", "Y", "O", "B"]
BUTTON_COLOURS = {
    "W": "white",
    "R": "red",
    "G": "green",
    "Y": "yellow",
    "O": "orange",
    "B": "dodger blue",
}
TEXT_COLOURS = {
    "W": "black",
    "R": "white",
    "G": "white",
    "Y": "black",
    "O": "black",
    "B": "white",
}

EXAMPLE_STATE = [
    "WOWYB",
    "RGYRO",
    "GGBGY",
    "YWBBG",
    "OROYW",
    "WBORR",
]

SOLVED_STATE = [
    "WWWWW",
    "RRRRR",
    "GGGGG",
    "YYYYY",
    "OOOOO",
    "BBBBB",
]


class SkewbGUI:
    def __init__(self, root: tk.Tk) -> None:
        self.root = root
        self.root.title("Skewb Solver")
        self.buttons: list[list[tk.Button]] = []
        self.status = tk.StringVar(value="Enter the sticker colours, then press Solve.")
        self.solution = tk.StringVar(value="Solution: —")
        self.details = tk.StringVar(value="")

        self._build_layout()
        self.load_solved()

    def _build_layout(self) -> None:
        title = tk.Label(self.root, text="Skewb Optimal Solver", font=("Arial", 18, "bold"))
        title.pack(padx=10, pady=(10, 2))

        subtitle = tk.Label(
            self.root,
            text="Click stickers to cycle colours. The C solver computes the optimal solution.",
            font=("Arial", 10),
        )
        subtitle.pack(padx=10, pady=(0, 10))

        faces_frame = tk.Frame(self.root)
        faces_frame.pack(padx=10, pady=5)

        for face_index, face_name in enumerate(FACE_NAMES):
            frame = tk.LabelFrame(faces_frame, text=f"{face_name} face", padx=8, pady=8)
            frame.grid(row=face_index // 3, column=face_index % 3, padx=8, pady=8, sticky="nsew")

            face_buttons: list[tk.Button] = []
            for sticker_index, sticker_name in enumerate(STICKER_NAMES[face_index]):
                label = tk.Label(frame, text=sticker_name, font=("Arial", 8))
                label.grid(row=sticker_index, column=0, padx=3, pady=2, sticky="w")

                button = tk.Button(
                    frame,
                    text="W",
                    width=4,
                    command=lambda f=face_index, s=sticker_index: self.cycle_colour(f, s),
                )
                button.grid(row=sticker_index, column=1, padx=3, pady=2)
                face_buttons.append(button)

            self.buttons.append(face_buttons)

        controls = tk.Frame(self.root)
        controls.pack(padx=10, pady=10)

        tk.Button(controls, text="Solve", width=14, command=self.solve).grid(row=0, column=0, padx=5)
        tk.Button(controls, text="Load Example", width=14, command=self.load_example).grid(row=0, column=1, padx=5)
        tk.Button(controls, text="Load Solved", width=14, command=self.load_solved).grid(row=0, column=2, padx=5)
        tk.Button(controls, text="Clear", width=14, command=self.clear).grid(row=0, column=3, padx=5)

        output = tk.LabelFrame(self.root, text="Output", padx=10, pady=10)
        output.pack(fill="x", padx=10, pady=(0, 10))

        tk.Label(output, textvariable=self.solution, font=("Arial", 12, "bold"), anchor="w").pack(fill="x")
        tk.Label(output, textvariable=self.details, anchor="w").pack(fill="x")
        tk.Label(output, textvariable=self.status, anchor="w", fg="gray25").pack(fill="x")

    def cycle_colour(self, face: int, sticker: int) -> None:
        button = self.buttons[face][sticker]
        current = button.cget("text")
        try:
            index = COLOURS.index(current)
        except ValueError:
            index = 0
        self.set_button_colour(button, COLOURS[(index + 1) % len(COLOURS)])

    def set_button_colour(self, button: tk.Button, colour: str) -> None:
        button.config(
            text=colour,
            bg=BUTTON_COLOURS.get(colour, "light gray"),
            fg=TEXT_COLOURS.get(colour, "black"),
            activebackground=BUTTON_COLOURS.get(colour, "light gray"),
            activeforeground=TEXT_COLOURS.get(colour, "black"),
        )

    def set_state(self, faces: list[str]) -> None:
        for face_index, face in enumerate(faces):
            for sticker_index, colour in enumerate(face):
                self.set_button_colour(self.buttons[face_index][sticker_index], colour)

    def load_example(self) -> None:
        self.set_state(EXAMPLE_STATE)
        self.solution.set("Solution: —")
        self.details.set("")
        self.status.set("Loaded example state from the known test scramble.")

    def load_solved(self) -> None:
        self.set_state(SOLVED_STATE)
        self.solution.set("Solution: —")
        self.details.set("")
        self.status.set("Loaded solved state.")

    def clear(self) -> None:
        for face_buttons in self.buttons:
            for button in face_buttons:
                self.set_button_colour(button, "W")
        self.solution.set("Solution: —")
        self.details.set("")
        self.status.set("Cleared all stickers to W. Set the colours before solving.")

    def current_faces(self) -> list[str]:
        faces = []
        for face_buttons in self.buttons:
            faces.append("".join(button.cget("text") for button in face_buttons))
        return faces

    def solver_path(self) -> Path:
        project_root = Path(__file__).resolve().parents[1]
        executable = "skewb_solver.exe" if os.name == "nt" else "skewb_solver"
        return project_root / "build" / "bin" / executable

    def solve(self) -> None:
        faces = self.current_faces()
        exe = self.solver_path()

        if not exe.exists():
            messagebox.showerror(
                "Solver not found",
                f"Could not find the C solver executable:\n{exe}\n\nRun 'make' in the project folder first.",
            )
            return

        self.status.set("Solving...")
        self.root.update_idletasks()

        command = [str(exe), "--solve-any", *faces]
        try:
            completed = subprocess.run(
                command,
                check=False,
                text=True,
                capture_output=True,
            )
        except OSError as exc:
            messagebox.showerror("Could not run solver", str(exc))
            self.status.set("Solver failed to start.")
            return

        if completed.returncode != 0:
            messagebox.showerror("Solver error", completed.stderr or completed.stdout)
            self.status.set("Solver returned an error.")
            return

        solution = ""
        length = ""
        states = ""
        verified = ""

        for line in completed.stdout.splitlines():
            if line.startswith("SOLUTION"):
                solution = line.removeprefix("SOLUTION").strip()
            elif line.startswith("LENGTH"):
                length = line.removeprefix("LENGTH").strip()
            elif line.startswith("STATES"):
                states = line.removeprefix("STATES").strip()
            elif line.startswith("VERIFIED"):
                verified = line.removeprefix("VERIFIED").strip()

        if not solution:
            solution = "Already solved"

        self.solution.set(f"Solution: {solution}")
        self.details.set(f"Length: {length} moves    States explored: {states}    Verified: {verified}")
        self.status.set("Done.")


def main() -> None:
    root = tk.Tk()
    app = SkewbGUI(root)
    root.mainloop()


if __name__ == "__main__":
    main()
