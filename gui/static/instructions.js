const SIMPLE_MOVE_INFO = {
    R: {corner: "URF", direction: "clockwise"},
    "R'": {corner: "URF", direction: "counterclockwise"},
    L: {corner: "ULB", direction: "clockwise"},
    "L'": {corner: "ULB", direction: "counterclockwise"},
    D: {corner: "DLF", direction: "clockwise"},
    "D'": {corner: "DLF", direction: "counterclockwise"},
    B: {corner: "DRB", direction: "clockwise"},
    "B'": {corner: "DRB", direction: "counterclockwise"},
};

const SIMPLE_CORNER_STICKERS = {
    URF: [2, 5, 11],
    ULB: [0, 20, 26],
    DLF: [15, 13, 22],
    DRB: [17, 7, 28],
};

const SIMPLE_COLOUR_NAMES = {
    W: "white",
    R: "red",
    G: "green",
    Y: "yellow",
    O: "orange",
    B: "blue",
};

const SIMPLE_MOVE_PERMS = buildSimpleMovePermutations();

function describeSimpleInstructions(faceStrings, solutionText) {
    const moves = parseInstructionMoves(solutionText);

    if (moves.length === 0) {
        return "No turns needed.";
    }

    let stateId = faceStrings.join("");

    return moves.map((move, index) => {
        const instruction = describeSimpleMove(stateId, move, index + 1);
        stateId = applySimpleMoveToState(stateId, move);
        return instruction;
    }).join("\n");
}

function parseInstructionMoves(solutionText) {
    if (typeof solutionText !== "string" || solutionText.trim() === "") {
        return [];
    }

    return solutionText.trim().split(/\s+/);
}

function describeSimpleMove(stateId, move, stepNumber) {
    const info = SIMPLE_MOVE_INFO[move];

    if (!info) {
        return `${stepNumber}. Do ${move}.`;
    }

    const cornerColours = coloursAtSimpleCorner(stateId, info.corner);
    return `${stepNumber}. Turn the ${cornerColours} corner ${info.direction}.`;
}

function coloursAtSimpleCorner(stateId, cornerName) {
    const stickerIndexes = SIMPLE_CORNER_STICKERS[cornerName] || [];
    const names = stickerIndexes.map(index => colourNameForInstruction(stateId[index]));

    return names.join(" ");
}

function colourNameForInstruction(letter) {
    return SIMPLE_COLOUR_NAMES[letter] || (letter ? letter.toLowerCase() : "unknown");
}

function applySimpleMoveToState(stateId, moveName) {
    const permutation = SIMPLE_MOVE_PERMS[moveName];

    if (!permutation || stateId.length !== permutation.length) {
        return stateId;
    }

    const next = Array(stateId.length);

    for (let index = 0; index < permutation.length; index++) {
        next[permutation[index]] = stateId[index];
    }

    return next.join("");
}

function buildSimpleMovePermutations() {
    const basePermutations = {
        R: [0, 8, 5, 6, 9, 11, 12, 7, 10, 14, 1, 2, 3, 13, 4, 15, 21, 17, 18, 19, 20, 25, 22, 23, 24, 16, 26, 27, 28, 29],
        L: [20, 21, 2, 23, 24, 5, 10, 7, 8, 9, 18, 11, 12, 13, 14, 15, 16, 17, 6, 19, 26, 27, 22, 25, 29, 3, 0, 1, 28, 4],
        D: [0, 1, 2, 8, 4, 5, 6, 7, 27, 9, 16, 11, 18, 15, 19, 22, 23, 17, 21, 24, 20, 12, 13, 10, 14, 25, 26, 3, 28, 29],
        B: [0, 23, 2, 3, 4, 5, 27, 28, 25, 29, 10, 11, 1, 13, 14, 15, 6, 7, 8, 9, 20, 21, 22, 12, 24, 18, 26, 16, 17, 19],
    };
    const result = {};

    for (const [moveName, permutation] of Object.entries(basePermutations)) {
        result[moveName] = permutation;
        result[`${moveName}'`] = inverseSimplePermutation(permutation);
    }

    return result;
}

function inverseSimplePermutation(permutation) {
    const inverse = Array(permutation.length);

    for (let index = 0; index < permutation.length; index++) {
        inverse[permutation[index]] = index;
    }

    return inverse;
}

window.skewbInstructions = {
    describe: describeSimpleInstructions,
};
