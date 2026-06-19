const SCAN_FACE_ORDER = ["R", "B", "G", "O", "W", "Y"];

const FACE_INDEX_BY_CENTRE_COLOUR = {
    W: 0,
    R: 1,
    G: 2,
    Y: 3,
    O: 4,
    B: 5,
};

const OVERLAY = {
    size: 400,
    left: 40,
    top: 40,
    right: 360,
    bottom: 360,
    mid: 200,
    lineWidth: 5,
    cornerRadius: 24,
    sampleRadius: 10,
};

const STICKER_POLYGONS = {
    topLeft: [
        [OVERLAY.left, OVERLAY.top],
        [OVERLAY.mid, OVERLAY.top],
        [OVERLAY.left, OVERLAY.mid],
    ],

    topRight: [
        [OVERLAY.mid, OVERLAY.top],
        [OVERLAY.right, OVERLAY.top],
        [OVERLAY.right, OVERLAY.mid],
    ],

    bottomRight: [
        [OVERLAY.right, OVERLAY.mid],
        [OVERLAY.right, OVERLAY.bottom],
        [OVERLAY.mid, OVERLAY.bottom],
    ],

    bottomLeft: [
        [OVERLAY.left, OVERLAY.mid],
        [OVERLAY.mid, OVERLAY.bottom],
        [OVERLAY.left, OVERLAY.bottom],
    ],

    center: [
        [OVERLAY.mid, OVERLAY.top],
        [OVERLAY.right, OVERLAY.mid],
        [OVERLAY.mid, OVERLAY.bottom],
        [OVERLAY.left, OVERLAY.mid],
    ],
};

const POLYGON_SAMPLE_SCALE = 0.55; /* Lower = samples closer to the center */

const CORNER_ORDER = ["topLeft", "topRight", "bottomRight", "bottomLeft"];
const CAPTURE_LABEL_BY_POSITION = {
    topLeft: "TL",
    topRight: "TR",
    bottomRight: "BR",
    bottomLeft: "BL",
};

const LAB_LIGHTNESS_WEIGHT = 0.35; /* less sensitivity to shadows */
const LOW_CONFIDENCE_THRESHOLD = 8; /* which stickers get flagged */
const TRIM_RATIO = 0.15; /* how aggressively noisy pixels are ignored */
const MIN_SAMPLE_BRIGHTNESS = 30; /* avoids sampling black borders */
const TARGET_CORNERS_PER_COLOUR = 4; /* each colour must get exactly 4 corner stickers */

let currentScanFaceIndex = 0;
let capturedFaces = createEmptyCapturedFaces();

function createEmptyCapturedFaces() {
    return Object.fromEntries(SCAN_FACE_ORDER.map(colour => [colour, null]));
}

async function startCamera() {
    const video = document.getElementById("camera");

    stopCamera({silent: true});

    if (!navigator.mediaDevices?.getUserMedia) {
        setOutput("This browser does not support camera access.", "error");
        return;
    }

    try {
        const stream = await navigator.mediaDevices.getUserMedia({
            video: {facingMode: {ideal: "environment"}},
            audio: false,
        });

        video.srcObject = stream;
        drawOverlay();
        setScanStatus();
    } catch (err) {
        setOutput(`Could not start camera: ${err.message || err}`, "error");
    }
}

function stopCamera({silent = false} = {}) {
    const video = document.getElementById("camera");

    if (!video.srcObject) {
        if (!silent) {
            setOutput("Camera is already off.", "help");
        }
        return;
    }

    for (const track of video.srcObject.getTracks()) {
        track.stop();
    }

    video.srcObject = null;
    clearOverlay();

    if (!silent) {
        setOutput("Camera turned off.", "help");
    }
}

function clearOverlay() {
    const canvas = document.getElementById("overlay");

    if (!canvas) {
        return;
    }

    const context = canvas.getContext("2d");
    context.clearRect(0, 0, canvas.width, canvas.height);
}

function captureFace() {
    const video = document.getElementById("camera");

    if (!video.srcObject) {
        setOutput("Start the camera before capturing a face.", "error");
        return;
    }

    if (currentScanFaceIndex >= SCAN_FACE_ORDER.length) {
        setOutput("All six faces have already been captured. Reset the scan to start again.", "help");
        return;
    }

    const canvas = document.getElementById("captureCanvas");
    const context = canvas.getContext("2d", {willReadFrequently: true});

    context.drawImage(video, 0, 0, canvas.width, canvas.height);

    const centreColour = SCAN_FACE_ORDER[currentScanFaceIndex];
    capturedFaces[centreColour] = sampleFaceColours(context);
    currentScanFaceIndex++;

    if (currentScanFaceIndex < SCAN_FACE_ORDER.length) {
        setScanStatus();
        setOutput(`Captured ${centreColour} centre face.`, "help");
        return;
    }

    setScanStatus("Camera scan complete. Review the puzzle net before solving.");
    applyCapturedFaces();
}

function resetScan() {
    currentScanFaceIndex = 0;
    capturedFaces = createEmptyCapturedFaces();
    setScanStatus();
    setOutput("Camera scan reset.", "help");
}

function setScanStatus(message = null) {
    const scanStatus = document.getElementById("scanStatus");

    if (message) {
        scanStatus.textContent = message;
        return;
    }

    const colour = SCAN_FACE_ORDER[currentScanFaceIndex];
    scanStatus.textContent = `Scan the face with the ${colour} centre.`;
}

function sampleFaceColours(context) {
    return {
        center: samplePolygon(context, STICKER_POLYGONS.center),

        corners: CORNER_ORDER.map(position => ({
            position,
            sample: samplePolygon(
                context,
                STICKER_POLYGONS[position]
            ),
        })),
    };
}

function sampleRegion(context, x, y, radius) {
    const image = context.getImageData(
        x - radius,
        y - radius,
        radius * 2,
        radius * 2
    ).data;

    const pixels = [];

    for (let index = 0; index < image.length; index += 4) {
        const red = image[index];
        const green = image[index + 1];
        const blue = image[index + 2];

        if (red + green + blue < MIN_SAMPLE_BRIGHTNESS) {
            continue;
        }

        pixels.push({
            r: red,
            g: green,
            b: blue,
        });
    }

    if (pixels.length === 0) {
        return {r: 0, g: 0, b: 0};
    }

    return trimmedMeanRgb(pixels);
}

function samplePolygon(context, polygon) {
    const safePolygon = shrinkPolygon(
        polygon,
        POLYGON_SAMPLE_SCALE
    );

    const bounds = polygonBounds(safePolygon);
    const image = context.getImageData(
        bounds.left,
        bounds.top,
        bounds.width,
        bounds.height
    ).data;

    const pixels = [];

    for (let localY = 0; localY < bounds.height; localY++) {
        for (let localX = 0; localX < bounds.width; localX++) {
            const x = bounds.left + localX;
            const y = bounds.top + localY;

            if (!pointInPolygon(x, y, safePolygon)) {
                continue;
            }

            const index = 4 * (localY * bounds.width + localX);
            const red = image[index];
            const green = image[index + 1];
            const blue = image[index + 2];

            if (red + green + blue < MIN_SAMPLE_BRIGHTNESS) {
                continue;
            }

            pixels.push({
                r: red,
                g: green,
                b: blue,
            });
        }
    }

    if (pixels.length === 0) {
        return samplePolygonCentre(context, polygon);
    }

    return trimmedMeanRgb(pixels);
}

function shrinkPolygon(points, scale) {
    const centre = polygonCentre(points);

    return points.map(([x, y]) => [
        centre.x + (x - centre.x) * scale,
        centre.y + (y - centre.y) * scale,
    ]);
}

function polygonCentre(points) {
    const total = points.reduce(
        (sum, [x, y]) => ({
            x: sum.x + x,
            y: sum.y + y,
        }),
        {x: 0, y: 0}
    );

    return {
        x: total.x / points.length,
        y: total.y / points.length,
    };
}

function polygonBounds(points) {
    const xs = points.map(point => point[0]);
    const ys = points.map(point => point[1]);

    const left = Math.floor(Math.min(...xs));
    const right = Math.ceil(Math.max(...xs));
    const top = Math.floor(Math.min(...ys));
    const bottom = Math.ceil(Math.max(...ys));

    return {
        left,
        top,
        width: right - left + 1,
        height: bottom - top + 1,
    };
}

function pointInPolygon(x, y, polygon) {
    let inside = false;

    for (
        let current = 0, previous = polygon.length - 1;
        current < polygon.length;
        previous = current++
    ) {
        const [currentX, currentY] = polygon[current];
        const [previousX, previousY] = polygon[previous];

        const crossesY =
            currentY > y !== previousY > y;

        if (!crossesY) {
            continue;
        }

        const intersectionX =
            ((previousX - currentX) * (y - currentY)) /
            (previousY - currentY) +
            currentX;

        if (x < intersectionX) {
            inside = !inside;
        }
    }

    return inside;
}

function samplePolygonCentre(context, polygon) {
    const centre = polygonCentre(polygon);

    return sampleRegion(
        context,
        Math.round(centre.x),
        Math.round(centre.y),
        8
    );
}

function trimmedMeanRgb(pixels) {
    return {
        r: trimmedMean(pixels.map(pixel => pixel.r), TRIM_RATIO),
        g: trimmedMean(pixels.map(pixel => pixel.g), TRIM_RATIO),
        b: trimmedMean(pixels.map(pixel => pixel.b), TRIM_RATIO),
    };
}

function trimmedMean(values, trimRatio) {
    const sorted = values.slice().sort((first, second) => first - second);
    const trimCount = Math.floor(sorted.length * trimRatio);
    const kept = sorted.slice(trimCount, sorted.length - trimCount);

    if (kept.length === 0) {
        return sorted[Math.floor(sorted.length / 2)];
    }

    const total = kept.reduce((sum, value) => sum + value, 0);
    return total / kept.length;
}

function drawOverlay() {
    const canvas = document.getElementById("overlay");

    if (!canvas) {
        return;
    }

    const context = canvas.getContext("2d");

    context.clearRect(
        0,
        0,
        canvas.width,
        canvas.height
    );

    context.strokeStyle = "#00ff00";
    context.fillStyle = "rgba(0, 255, 0, 0.18)";
    context.lineWidth = 4;
    context.lineJoin = "round";

    drawPolygonOutline(
        context,
        [
            [40, 40],
            [360, 40],
            [360, 360],
            [40, 360],
        ]
    );

    for (const polygon of Object.values(STICKER_POLYGONS)) {
        drawPolygonOutline(context, polygon);
    }

    for (const polygon of Object.values(STICKER_POLYGONS)) {
        drawSamplingArea(context, polygon);
    }
}

function drawPolygonOutline(context, points) {
    context.beginPath();
    context.moveTo(points[0][0], points[0][1]);

    for (let index = 1; index < points.length; index++) {
        context.lineTo(points[index][0], points[index][1]);
    }

    context.closePath();
    context.stroke();
}

function drawSamplingArea(context, polygon) {
    const safePolygon = shrinkPolygon(
        polygon,
        POLYGON_SAMPLE_SCALE
    );

    context.beginPath();
    context.moveTo(safePolygon[0][0], safePolygon[0][1]);

    for (let index = 1; index < safePolygon.length; index++) {
        context.lineTo(safePolygon[index][0], safePolygon[index][1]);
    }

    context.closePath();
    context.fill();
    context.stroke();
}

function applyCapturedFaces() {
    try {
        const cornerSamples = getCapturedCornerSamples();
        const assignments = assignCornerColours(cornerSamples);
        const nextState = Array.from({length: 6}, () => Array(5).fill(""));

        for (const centreColour of SCAN_FACE_ORDER) {
            const faceIndex = FACE_INDEX_BY_CENTRE_COLOUR[centreColour];
            nextState[faceIndex][4] = centreColour;
        }

        for (const assignment of assignments) {
            const faceIndex =
                FACE_INDEX_BY_CENTRE_COLOUR[assignment.faceCentreColour];

            const stickerIndex =
                stickerIndexForPosition(assignment.position);

            nextState[faceIndex][stickerIndex] =
                assignment.assignedColour;
        }

        setState(nextState.map(face => face.join("")));
        setOutput(scanSummary(assignments), "ok");
    } catch (err) {
        setOutput(`Could not process camera scan: ${err.message || err}`, "error");
    }
}

function stickerIndexForPosition(position) {
    switch (position) {
        case "topLeft":
            return 0;
        case "topRight":
            return 1;
        case "bottomRight":
            return 2;
        case "bottomLeft":
            return 3;
        default:
            throw new Error(`Unknown sticker position: ${position}`);
    }
}

function nearestCentreColour(sample) {
    let bestColour = null;
    let bestDistance = Infinity;

    for (const centreColour of SCAN_FACE_ORDER) {
        const centreSample = capturedFaces[centreColour].center;
        const distance = colourDistance(sample, centreSample);

        if (distance < bestDistance) {
            bestDistance = distance;
            bestColour = centreColour;
        }
    }

    return bestColour;
}

function colourDistance(first, second) {
    const labA = rgbToLab(first);
    const labB = rgbToLab(second);

    const lightness = labA.l - labB.l;
    const greenRed = labA.a - labB.a;
    const blueYellow = labA.b - labB.b;

    return Math.sqrt(
        LAB_LIGHTNESS_WEIGHT * lightness * lightness +
        greenRed * greenRed +
        blueYellow * blueYellow
    );
}

function rgbToLab(rgb) {
    const xyz = rgbToXyz(rgb);
    return xyzToLab(xyz);
}

function rgbToXyz(rgb) {
    const red = srgbToLinear(rgb.r / 255);
    const green = srgbToLinear(rgb.g / 255);
    const blue = srgbToLinear(rgb.b / 255);

    return {
        x: red * 0.4124 + green * 0.3576 + blue * 0.1805,
        y: red * 0.2126 + green * 0.7152 + blue * 0.0722,
        z: red * 0.0193 + green * 0.1192 + blue * 0.9505,
    };
}

function srgbToLinear(value) {
    if (value <= 0.04045) {
        return value / 12.92;
    }

    return Math.pow((value + 0.055) / 1.055, 2.4);
}

function xyzToLab(xyz) {
    const whitePoint = {x: 0.95047, y: 1.00000, z: 1.08883};
    const x = labPivot(xyz.x / whitePoint.x);
    const y = labPivot(xyz.y / whitePoint.y);
    const z = labPivot(xyz.z / whitePoint.z);

    return {
        l: 116 * y - 16,
        a: 500 * (x - y),
        b: 200 * (y - z),
    };
}

function labPivot(value) {
    if (value > 0.008856) {
        return Math.cbrt(value);
    }

    return 7.787 * value + 16 / 116;
}

function getCapturedCornerSamples() {
    const samples = [];

    for (const centreColour of SCAN_FACE_ORDER) {
        const face = capturedFaces[centreColour];

        if (!face) {
            throw new Error(`Missing scan for ${centreColour} centre face.`);
        }

        for (const corner of face.corners) {
            samples.push({
                faceCentreColour: centreColour,
                position: corner.position,
                sample: corner.sample,
            });
        }
    }

    return samples;
}

function distanceRowsForCorners(cornerSamples) {
    return cornerSamples.map(corner =>
        SCAN_FACE_ORDER.map(centreColour => ({
            colour: centreColour,
            distance: colourDistance(
                corner.sample,
                capturedFaces[centreColour].center
            ),
        }))
    );
}

function assignCornerColours(cornerSamples) {
    const distanceRows = distanceRowsForCorners(cornerSamples);
    const memo = new Map();
    const choices = new Map();

    function stateKey(index, counts) {
        return `${index}|${counts.join(",")}`;
    }

    function search(index, counts) {
        if (index === cornerSamples.length) {
            return counts.every(count => count === TARGET_CORNERS_PER_COLOUR)
                ? 0
                : Infinity;
        }

        const key = stateKey(index, counts);

        if (memo.has(key)) {
            return memo.get(key);
        }

        let bestCost = Infinity;
        let bestColourIndex = -1;

        for (let colourIndex = 0; colourIndex < SCAN_FACE_ORDER.length; colourIndex++) {
            if (counts[colourIndex] >= TARGET_CORNERS_PER_COLOUR) {
                continue;
            }

            const nextCounts = counts.slice();
            nextCounts[colourIndex]++;

            const cost =
                distanceRows[index][colourIndex].distance +
                search(index + 1, nextCounts);

            if (cost < bestCost) {
                bestCost = cost;
                bestColourIndex = colourIndex;
            }
        }

        memo.set(key, bestCost);
        choices.set(key, bestColourIndex);

        return bestCost;
    }

    const counts = Array(SCAN_FACE_ORDER.length).fill(0);
    const bestTotalCost = search(0, counts);

    if (!Number.isFinite(bestTotalCost)) {
        throw new Error("Could not assign scanned colours.");
    }

    const assignments = [];

    for (let index = 0; index < cornerSamples.length; index++) {
        const key = stateKey(index, counts);
        const colourIndex = choices.get(key);
        const assignedColour = SCAN_FACE_ORDER[colourIndex];

        assignments.push({
            ...cornerSamples[index],
            assignedColour,
            confidence: confidenceForAssignment(
                distanceRows[index],
                assignedColour
            ),
        });

        counts[colourIndex]++;
    }

    return assignments;
}

function confidenceForAssignment(distanceRow, assignedColour) {
    const assignedDistance = distanceRow.find(
        item => item.colour === assignedColour
    ).distance;

    const bestOtherDistance = Math.min(
        ...distanceRow
            .filter(item => item.colour !== assignedColour)
            .map(item => item.distance)
    );

    return bestOtherDistance - assignedDistance;
}

function scanSummary(assignments) {
    const lines = [
        "Camera scan complete.",
        "Detected colours have been applied to the puzzle net.",
        "Check the stickers before pressing Solve.",
        "",
    ];

    for (const centreColour of SCAN_FACE_ORDER) {
        const faceAssignments = assignments
            .filter(assignment => assignment.faceCentreColour === centreColour)
            .map(assignment => {
                const label = CAPTURE_LABEL_BY_POSITION[assignment.position];
                return `${label}:${assignment.assignedColour}`;
            });

        lines.push(`${centreColour} centre face: ${faceAssignments.join(" ")}`);
    }

    const lowConfidence = assignments
        .filter(assignment => assignment.confidence < LOW_CONFIDENCE_THRESHOLD)
        .map(assignment => {
            const label = CAPTURE_LABEL_BY_POSITION[assignment.position];
            const score = assignment.confidence.toFixed(1);
            return `${assignment.faceCentreColour}-${label} (${score})`;
        });

    if (lowConfidence.length > 0) {
        lines.push("");
        lines.push("Low confidence stickers:");
        lines.push(lowConfidence.join(", "));
    }

    return lines.join("\n");
}

drawOverlay();

document.getElementById("startCameraBtn").addEventListener("click", startCamera);
document.getElementById("stopCameraBtn").addEventListener("click", stopCamera);
document.getElementById("captureFaceBtn").addEventListener("click", captureFace);
document.getElementById("resetScanBtn").addEventListener("click", resetScan);