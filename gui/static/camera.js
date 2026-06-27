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

const LAB_LIGHTNESS_WEIGHT = 0.20; /* less sensitivity to shadows */
const LOW_CONFIDENCE_THRESHOLD = 8; /* which stickers get flagged */
const TRIM_RATIO = 0.15; /* how aggressively noisy pixels are ignored */
const MIN_SAMPLE_BRIGHTNESS = 30; /* avoids sampling black borders */
const TARGET_CORNERS_PER_COLOUR = 4; /* each colour must get exactly 4 corner stickers */

const RAW_LAB_WEIGHT = 0.60;
const NORMALIZED_LAB_WEIGHT = 0.40;
const CHROMA_WEIGHT = 0.20;

const NORMALIZED_BRIGHTNESS_TOTAL = 420;
const WHITE_BALANCE_MIN_CHANNEL = 20;
const WHITE_BALANCE_MAX_SCALE = 2.2;

const CAPTURE_FRAME_COUNT = 5;
const CAPTURE_FRAME_DELAY_MS = 75;

let currentScanFaceIndex = 0;
let capturedFaces = createEmptyCapturedFaces();
let isCapturingFace = false;

function createEmptyCapturedFaces() {
    return Object.fromEntries(SCAN_FACE_ORDER.map(colour => [colour, null]));
}

async function startCamera() {
    const video = document.getElementById("camera");

    stopCamera({silent: true});

    if (!navigator.mediaDevices?.getUserMedia) {
        setOutput("Camera access is not available in this browser.", "error");
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
        setOutput(`Could not start the camera: ${err.message || err}`, "error");
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
        setOutput("Camera off.", "help");
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

async function captureFace() {
    const video = document.getElementById("camera");

    if (isCapturingFace) {
        return;
    }

    if (!video.srcObject) {
        setOutput("Start the camera first.", "error");
        return;
    }

    if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
        setOutput("Camera is not ready yet.", "help");
        return;
    }

    if (currentScanFaceIndex >= SCAN_FACE_ORDER.length) {
        setOutput("All faces scanned. Reset to scan again.", "help");
        return;
    }

    const centreColour = SCAN_FACE_ORDER[currentScanFaceIndex];
    const captureButton = document.getElementById("captureFaceBtn");

    isCapturingFace = true;

    if (captureButton) {
        captureButton.disabled = true;
    }

    try {
        setScanStatus(`Hold the ${centreColour} centre face still…`);
        setOutput(`Capturing ${centreColour} face…`, "help");

        const frameSamples = await captureFaceOverSeveralFrames(video);
        capturedFaces[centreColour] = mergeFaceSamples(frameSamples);

        currentScanFaceIndex++;

        if (currentScanFaceIndex < SCAN_FACE_ORDER.length) {
            setScanStatus();
            setOutput(`Captured ${centreColour} face.`, "help");
            return;
        }

        setScanStatus("Scan complete. Check the net before solving.");
        applyCapturedFaces();
    } catch (err) {
        setScanStatus();
        setOutput(`Could not capture the face: ${err.message || err}`, "error");
    } finally {
        isCapturingFace = false;

        if (captureButton) {
            captureButton.disabled = false;
        }
    }
}

async function captureFaceOverSeveralFrames(video) {
    const canvas = document.getElementById("captureCanvas");
    const context = canvas.getContext("2d", {willReadFrequently: true});
    const frameSamples = [];

    for (let frameIndex = 0; frameIndex < CAPTURE_FRAME_COUNT; frameIndex++) {
        if (!video.srcObject) {
            throw new Error("Camera was stopped during capture.");
        }

        context.drawImage(
            video,
            0,
            0,
            canvas.width,
            canvas.height
        );

        frameSamples.push(sampleFaceColours(context));

        if (frameIndex < CAPTURE_FRAME_COUNT - 1) {
            await wait(CAPTURE_FRAME_DELAY_MS);
        }
    }

    return frameSamples;
}

function mergeFaceSamples(frameSamples) {
    if (frameSamples.length === 0) {
        throw new Error("No camera frames were captured.");
    }

    return {
        center: medianRgb(
            frameSamples.map(sample => sample.center)
        ),

        corners: CORNER_ORDER.map(position => ({
            position,
            sample: medianRgb(
                frameSamples.map(sample =>
                    cornerSampleForPosition(sample, position)
                )
            ),
        })),
    };
}

function cornerSampleForPosition(faceSample, position) {
    const corner = faceSample.corners.find(
        item => item.position === position
    );

    if (!corner) {
        throw new Error(`Missing ${position} corner sample.`);
    }

    return corner.sample;
}

function medianRgb(samples) {
    return {
        r: median(samples.map(sample => sample.r)),
        g: median(samples.map(sample => sample.g)),
        b: median(samples.map(sample => sample.b)),
    };
}

function median(values) {
    const sorted = values
        .slice()
        .sort((first, second) => first - second);

    const middle = Math.floor(sorted.length / 2);

    if (sorted.length % 2 === 1) {
        return sorted[middle];
    }

    return (sorted[middle - 1] + sorted[middle]) / 2;
}

function wait(milliseconds) {
    return new Promise(resolve => {
        window.setTimeout(resolve, milliseconds);
    });
}

function resetScan() {
    currentScanFaceIndex = 0;
    capturedFaces = createEmptyCapturedFaces();
    setScanStatus();
    setOutput("Scan reset.", "help");
}

function setScanStatus(message = null) {
    const scanStatus = document.getElementById("scanStatus");

    if (message) {
        scanStatus.textContent = message;
        return;
    }

    const colour = SCAN_FACE_ORDER[currentScanFaceIndex];
    scanStatus.textContent = `Scan the ${colour} centre face.`;
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
        setOutput(`Could not read the scan: ${err.message || err}`, "error");
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

function colourDistance(first, second) {
    const whiteBalanceScales = currentWhiteBalanceScales();

    const firstBalanced = applyWhiteBalance(first, whiteBalanceScales);
    const secondBalanced = applyWhiteBalance(second, whiteBalanceScales);

    const firstRawLab = rgbToLab(firstBalanced);
    const secondRawLab = rgbToLab(secondBalanced);

    const firstNormalizedLab = rgbToLab(
        normalizeBrightness(firstBalanced)
    );
    const secondNormalizedLab = rgbToLab(
        normalizeBrightness(secondBalanced)
    );

    const rawDistance = weightedLabDistance(
        firstRawLab,
        secondRawLab
    );

    const normalizedDistance = weightedLabDistance(
        firstNormalizedLab,
        secondNormalizedLab
    );

    const chromaDistance = Math.abs(
        labChroma(firstRawLab) - labChroma(secondRawLab)
    );

    return (
        RAW_LAB_WEIGHT * rawDistance +
        NORMALIZED_LAB_WEIGHT * normalizedDistance +
        CHROMA_WEIGHT * chromaDistance
    );
}

function weightedLabDistance(firstLab, secondLab) {
    const lightness = firstLab.l - secondLab.l;
    const greenRed = firstLab.a - secondLab.a;
    const blueYellow = firstLab.b - secondLab.b;

    return Math.sqrt(
        LAB_LIGHTNESS_WEIGHT * lightness * lightness +
        greenRed * greenRed +
        blueYellow * blueYellow
    );
}

function labChroma(lab) {
    return Math.sqrt(
        lab.a * lab.a +
        lab.b * lab.b
    );
}

function currentWhiteBalanceScales() {
    const whiteFace = capturedFaces.W;

    if (!whiteFace || !whiteFace.center) {
        return neutralWhiteBalanceScales();
    }

    return whiteBalanceScalesFromWhiteSample(whiteFace.center);
}

function neutralWhiteBalanceScales() {
    return {
        r: 1,
        g: 1,
        b: 1,
    };
}

function whiteBalanceScalesFromWhiteSample(whiteSample) {
    const red = Math.max(whiteSample.r, WHITE_BALANCE_MIN_CHANNEL);
    const green = Math.max(whiteSample.g, WHITE_BALANCE_MIN_CHANNEL);
    const blue = Math.max(whiteSample.b, WHITE_BALANCE_MIN_CHANNEL);

    const grey = (red + green + blue) / 3;

    return {
        r: clamp(grey / red, 1 / WHITE_BALANCE_MAX_SCALE, WHITE_BALANCE_MAX_SCALE),
        g: clamp(grey / green, 1 / WHITE_BALANCE_MAX_SCALE, WHITE_BALANCE_MAX_SCALE),
        b: clamp(grey / blue, 1 / WHITE_BALANCE_MAX_SCALE, WHITE_BALANCE_MAX_SCALE),
    };
}

function applyWhiteBalance(rgb, scales) {
    return {
        r: clampRgb(rgb.r * scales.r),
        g: clampRgb(rgb.g * scales.g),
        b: clampRgb(rgb.b * scales.b),
    };
}

function normalizeBrightness(rgb) {
    const total = rgb.r + rgb.g + rgb.b;

    if (total <= 0) {
        return rgb;
    }

    const scale = NORMALIZED_BRIGHTNESS_TOTAL / total;

    return {
        r: clampRgb(rgb.r * scale),
        g: clampRgb(rgb.g * scale),
        b: clampRgb(rgb.b * scale),
    };
}

function clampRgb(value) {
    return clamp(value, 0, 255);
}

function clamp(value, minimum, maximum) {
    return Math.min(
        maximum,
        Math.max(minimum, value)
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
    const sorted = distanceRow
        .slice()
        .sort((first, second) => first.distance - second.distance);

    const assigned = sorted.find(
        item => item.colour === assignedColour
    );

    const nearestOther = sorted.find(
        item => item.colour !== assignedColour
    );

    return {
        margin: nearestOther.distance - assigned.distance,
        nearestOtherColour: nearestOther.colour,
    };
}

function scanSummary(assignments) {
    const lines = [
        "Scan complete.",
        "Detected colours were added to the net.",
        "Check the net before solving.",
    ];

    const lowConfidence = assignments
        .filter(assignment => assignment.confidence.margin < LOW_CONFIDENCE_THRESHOLD)
        .map(assignment => {
            const label = CAPTURE_LABEL_BY_POSITION[assignment.position];
            return `${assignment.faceCentreColour}-${label}`;
        });

    if (lowConfidence.length > 0) {
        lines.push("");
        lines.push(`Please check: ${lowConfidence.join(", ")}`);
    }

    return lines.join("\n");
}

drawOverlay();

document.getElementById("startCameraBtn").addEventListener("click", startCamera);
document.getElementById("stopCameraBtn").addEventListener("click", stopCamera);
document.getElementById("captureFaceBtn").addEventListener("click", captureFace);
document.getElementById("resetScanBtn").addEventListener("click", resetScan);