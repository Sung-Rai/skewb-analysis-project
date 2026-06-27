const colours = [
    {letter: "W", name: "White", css: "#ffffff"},
    {letter: "R", name: "Red", css: "#ef4444"},
    {letter: "G", name: "Green", css: "#22c55e"},
    {letter: "Y", name: "Yellow", css: "#fde047"},
    {letter: "O", name: "Orange", css: "#fb923c"},
    {letter: "B", name: "Blue", css: "#60a5fa"},
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

const FACE_INDEX_BY_NAME = Object.fromEntries(
    faces.map((face, index) => [face.name, index])
);

const FACE_GRID_POSITION_BY_NAME = {
    U: {column: 2, row: 1},
    L: {column: 1, row: 2},
    F: {column: 2, row: 2},
    R: {column: 3, row: 2},
    B: {column: 4, row: 2},
    D: {column: 2, row: 3},
};

const STICKER_ROTATION = {
    clockwise: [3, 0, 1, 2, 4],
    anticlockwise: [1, 2, 3, 0, 4],
};

let currentColour = "W";
let draggedFaceName = null;
let state = Array.from({length: 6}, () => Array(5).fill(""));

function colourInfo(letter) {
    return colours.find(colour => colour.letter === letter) || {
        letter,
        css: "#9ca3af",
    };
}

function renderPalette() {
    const palette = document.getElementById("palette");
    palette.replaceChildren();

    for (const colour of colours) {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = colour.letter;
        button.title = colour.name;
        button.style.background = colour.css;
        button.style.color = highContrastTextFor(colour.letter);

        if (colour.letter === currentColour) {
            button.classList.add("selected");
        }

        button.addEventListener("click", () => {
            currentColour = colour.letter;
            renderPalette();
        });

        palette.appendChild(button);
    }
}

function highContrastTextFor(colourLetter) {
    return colourLetter === "W" || colourLetter === "Y"
        ? "#111827"
        : "#ffffff";
}

function renderFaces() {
    const container = document.getElementById("faces");
    container.replaceChildren();

    faces.forEach((face, faceIndex) => {
        const wrapper = createFaceElement(face);
        const grid = createStickerGrid(face, faceIndex);

        wrapper.appendChild(grid);
        container.appendChild(wrapper);
    });
}

function createFaceElement(face) {
    const gridPosition = FACE_GRID_POSITION_BY_NAME[face.name];

    const wrapper = document.createElement("div");
    wrapper.className = `face face-${face.name}`;
    wrapper.style.gridColumn = gridPosition.column;
    wrapper.style.gridRow = gridPosition.row;

    attachFaceDragHandlers(wrapper, face.name);

    const title = document.createElement("div");
    title.className = "face-title";
    title.textContent = face.name;

    wrapper.appendChild(title);
    wrapper.appendChild(createFaceControls(face.name));

    return wrapper;
}

function createStickerGrid(face, faceIndex) {
    const grid = document.createElement("div");
    grid.className = "sticker-grid";

    for (let stickerIndex = 0; stickerIndex < 5; stickerIndex++) {
        grid.appendChild(createStickerButton(face, faceIndex, stickerIndex));
    }

    return grid;
}

function createStickerButton(face, faceIndex, stickerIndex) {
    const letter = state[faceIndex][stickerIndex];
    const button = document.createElement("button");

    button.type = "button";
    button.className = `sticker pos-${stickerIndex}`;
    button.textContent = letter || "";
    button.title = `${face.name}-${face.labels[stickerIndex]}`;
    button.style.background = letter ? colourInfo(letter).css : "#6b7280";
    button.draggable = false;

    button.addEventListener("click", () => {
        state[faceIndex][stickerIndex] = currentColour;
        renderFaces();
    });

    return button;
}

function createFaceControls(faceName) {
    const controls = document.createElement("div");
    controls.className = "face-controls";

    controls.appendChild(createRotateButton(faceName, "anticlockwise"));
    controls.appendChild(createRotateButton(faceName, "clockwise"));

    return controls;
}

function createRotateButton(faceName, direction) {
    const button = document.createElement("button");
    const isClockwise = direction === "clockwise";

    button.type = "button";
    button.textContent = isClockwise ? "↻" : "↺";
    button.title = `Rotate ${faceName} stickers ${direction}`;
    button.draggable = false;

    button.addEventListener("click", event => {
        event.stopPropagation();
        rotateFaceStickers(faceName, direction);
    });

    return button;
}

function attachFaceDragHandlers(wrapper, faceName) {
    wrapper.draggable = true;

    wrapper.addEventListener("dragstart", event => {
        draggedFaceName = faceName;
        wrapper.classList.add("dragging");

        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", faceName);
    });

    wrapper.addEventListener("dragend", () => {
        draggedFaceName = null;
        wrapper.classList.remove("dragging");
    });

    wrapper.addEventListener("dragover", event => {
        event.preventDefault();

        if (draggedFaceName && draggedFaceName !== faceName) {
            wrapper.classList.add("drop-target");
        }
    });

    wrapper.addEventListener("dragleave", () => {
        wrapper.classList.remove("drop-target");
    });

    wrapper.addEventListener("drop", event => {
        event.preventDefault();
        wrapper.classList.remove("drop-target");

        const sourceFaceName = draggedFaceName || event.dataTransfer.getData("text/plain");

        if (!sourceFaceName || sourceFaceName === faceName) {
            return;
        }

        swapFaceStickers(sourceFaceName, faceName);
    });
}

function rotateFaceStickers(faceName, direction) {
    const faceIndex = FACE_INDEX_BY_NAME[faceName];
    const rotation = STICKER_ROTATION[direction];

    state[faceIndex] = rotation.map(stickerIndex => state[faceIndex][stickerIndex] || "");
    renderFaces();
}

function swapFaceStickers(firstFaceName, secondFaceName) {
    const firstIndex = FACE_INDEX_BY_NAME[firstFaceName];
    const secondIndex = FACE_INDEX_BY_NAME[secondFaceName];

    [state[firstIndex], state[secondIndex]] = [
        state[secondIndex],
        state[firstIndex],
    ];

    renderFaces();
}

function setState(faceStrings) {
    state = faceStrings.map(face => face.split(""));
    renderFaces();
}

function clearState() {
    state = Array.from({length: 6}, () => Array(5).fill(""));
    renderFaces();
    setOutput("Pick colours or scan the puzzle, then solve.", "help");
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
    for (let faceIndex = 0; faceIndex < faceStrings.length; faceIndex++) {
        if (faceStrings[faceIndex].length !== 5) {
            return `Face ${faces[faceIndex].name} is incomplete.`;
        }

        if (!/^[A-Z]{5}$/.test(faceStrings[faceIndex])) {
            return `Face ${faces[faceIndex].name} must contain five colour letters.`;
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

    setOutput("Solving…", "help");

    if (window.stateGraph) {
        window.stateGraph.clear("Building graph…");
    }

    try {
        const response = await fetch("/solve", {
            method: "POST",
            headers: {"Content-Type": "application/json"},
            body: JSON.stringify({faces: faceStrings}),
        });
        const data = await response.json();

        if (!response.ok || !data.ok) {
            setOutput(data.error || "Solver failed.", "error");

            if (window.stateGraph) {
                window.stateGraph.clear("Graph unavailable.");
            }

            return;
        }

        const solutionText = data.solution ? data.solution : "Already solved";
        const simpleInstructions = simpleInstructionText(faceStrings, data.solution);
        const outputText = [
            `Solution: ${solutionText}`,
            `Moves: ${data.length}`,
            "",
            "Steps:",
            simpleInstructions,
        ].join("\n");

        setOutput(outputText, "ok");

        if (window.stateGraph && data.graph) {
            window.stateGraph.load(data.graph, faceStrings);
        }
    } catch (err) {
        setOutput("Could not contact the solver.", "error");

        if (window.stateGraph) {
            window.stateGraph.clear("Graph unavailable.");
        }
    }
}

function simpleInstructionText(faceStrings, solutionText) {
    if (!window.skewbInstructions) {
        return "Simple steps unavailable.";
    }

    return window.skewbInstructions.describe(faceStrings, solutionText);
}

function bindAppEvents() {
    document.getElementById("solveBtn").addEventListener("click", solve);

    document.getElementById("exampleBtn").addEventListener("click", () => {
        setState(example);
        setOutput("Example loaded. Press Solve.", "help");
    });

    document.getElementById("solvedBtn").addEventListener("click", () => {
        setState(solved);
        setOutput("Solved state loaded.", "help");
    });

    document.getElementById("clearBtn").addEventListener("click", clearState);
}

renderPalette();
setState(solved);
bindAppEvents();