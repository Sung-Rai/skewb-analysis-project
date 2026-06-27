const GRAPH = {
    ringSpacing: 86,
    pathAngle: -Math.PI / 2,
    minScale: 0.18,
    maxScale: 5,
    exploredDotSize: 3.0,
    allDotSize: 2.2,
    solvedDotSize: 6,
    pathNodeSize: 7,
    currentNodeSize: 10,
};

const GRAPH_MODE = {
    SOLUTION: "solution",
    EXPLORED: "explored",
    ALL: "all",
};

const GRAPH_RENDERER = {
    WEBGL: "webgl",
    CANVAS: "canvas",
};

const GRAPH_MOVE_NAMES = ["R", "R'", "L", "L'", "D", "D'", "B", "B'"];

const INVERSE_GRAPH_MOVE = {
    R: "R'",
    "R'": "R",
    L: "L'",
    "L'": "L",
    D: "D'",
    "D'": "D",
    B: "B'",
    "B'": "B",
};

const graphState = {
    canvas: null,
    context: null,
    webglCanvas: null,
    gl: null,
    glProgram: null,
    glLocations: null,
    data: null,
    pathNodes: [],
    adjacentEdges: [],
    activeNode: null,
    pathNodesByState: new Map(),
    explorationNodesByState: new Map(),
    exactNeighbourCache: new Map(),
    exactNeighbourRequests: new Set(),
    nodeDatasets: new Map(),
    progressIndex: 0,
    displayMode: GRAPH_MODE.SOLUTION,
    scale: 1,
    offsetX: 0,
    offsetY: 0,
    isDragging: false,
    lastPointerX: 0,
    lastPointerY: 0,
    pointerMoved: false,
    hoveredRingDepth: null,
    redrawQueued: false,
    renderer: GRAPH_RENDERER.CANVAS,
    lastSize: {width: 0, height: 0, pixelRatio: 1},
    backgroundCanvas: null,
    backgroundContext: null,
    backgroundKey: "",
};

function initialiseStateGraph() {
    graphState.canvas = document.getElementById("stateGraph");
    graphState.webglCanvas = document.getElementById("stateGraphPoints");

    if (!graphState.canvas) {
        return;
    }

    graphState.context = graphState.canvas.getContext("2d");
    initialiseWebGlRenderer();
    bindGraphEvents();
    resetGraphView();
    drawEmptyGraph();
}

function initialiseWebGlRenderer() {
    if (!graphState.webglCanvas) {
        return;
    }

    const gl = graphState.webglCanvas.getContext("webgl", {
        alpha: true,
        antialias: false,
        depth: false,
        stencil: false,
        preserveDrawingBuffer: false,
    });

    if (!gl) {
        return;
    }

    const program = createPointProgram(gl);

    if (!program) {
        return;
    }

    graphState.gl = gl;
    graphState.glProgram = program;
    graphState.glLocations = {
        position: gl.getAttribLocation(program, "a_position"),
        resolution: gl.getUniformLocation(program, "u_resolution"),
        scale: gl.getUniformLocation(program, "u_scale"),
        offset: gl.getUniformLocation(program, "u_offset"),
        pointSize: gl.getUniformLocation(program, "u_point_size"),
        color: gl.getUniformLocation(program, "u_color"),
    };
    graphState.renderer = GRAPH_RENDERER.WEBGL;

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.disable(gl.DEPTH_TEST);
}

function createPointProgram(gl) {
    const vertexSource = `
        attribute vec2 a_position;
        uniform vec2 u_resolution;
        uniform float u_scale;
        uniform vec2 u_offset;
        uniform float u_point_size;

        void main() {
            vec2 screen = a_position * u_scale + u_offset;
            vec2 clip = (screen / u_resolution) * 2.0 - 1.0;
            gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
            gl_PointSize = u_point_size;
        }
    `;

    const fragmentSource = `
        precision mediump float;
        uniform vec4 u_color;

        void main() {
            vec2 distance_from_centre = gl_PointCoord - vec2(0.5, 0.5);
            float distance = length(distance_from_centre);
            float core = 1.0 - smoothstep(0.0, 0.30, distance);
            float edge = 1.0 - smoothstep(0.30, 0.50, distance);
            float alpha = u_color.a * max(core, edge * 0.62);
            gl_FragColor = vec4(u_color.rgb, alpha);
        }
    `;

    const vertexShader = compileShader(gl, gl.VERTEX_SHADER, vertexSource);
    const fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource);

    if (!vertexShader || !fragmentShader) {
        return null;
    }

    const program = gl.createProgram();
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        console.error("Could not link graph WebGL program:", gl.getProgramInfoLog(program));
        return null;
    }

    return program;
}

function compileShader(gl, type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);

    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        console.error("Could not compile graph WebGL shader:", gl.getShaderInfoLog(shader));
        gl.deleteShader(shader);
        return null;
    }

    return shader;
}

function loadStateGraph(data, initialFaceStrings = null) {
    if (!graphState.canvas || !data) {
        return;
    }

    if (data.available === false || data.lookupGraphAvailable !== true) {
        clearStateGraph(data.summary || "Build the lookup table to use the graph.");
        return;
    }

    graphState.data = normaliseGraphData(data, initialFaceStrings);
    graphState.progressIndex = 0;
    graphState.displayMode = currentGraphMode();
    graphState.pathNodes = layoutPathNodes(graphState.data.path || []);
    graphState.pathNodesByState = mapPathNodesByState(graphState.pathNodes);
    graphState.explorationNodesByState = new Map();
    graphState.exactNeighbourCache = new Map();
    graphState.exactNeighbourRequests = new Set();
    graphState.activeNode = null;
    graphState.adjacentEdges = layoutFocusedAdjacentEdges();
    graphState.nodeDatasets = new Map();

    fitGraphToCurrentMode();
    updateGraphStatus();
    requestGraphRedraw();
}

function normaliseGraphData(data, initialFaceStrings = null) {
    const exploredRings = data.exploredRings || data.rings || [];
    const allRings = data.allRings || data.rings || exploredRings;
    const path = attachExactStatesToPath(
        data.path || [],
        data.moves || [],
        initialFaceStrings
    );

    return {
        ...data,
        exploredRings,
        allRings,
        rings: data.rings || exploredRings,
        path,
        initialStateId: path[0]?.stateId || null,
        solvedStateId: path[path.length - 1]?.stateId || null,
    };
}

function attachExactStatesToPath(path, moves, initialFaceStrings) {
    if (!initialFaceStrings || path.length === 0) {
        return path;
    }

    const states = statesAlongSolution(initialFaceStrings, moves);

    return path.map((node, index) => ({
        ...node,
        stateId: states[index] || null,
    }));
}

function statesAlongSolution(initialFaceStrings, moves) {
    const states = [];
    let current = faceStringsToStateId(initialFaceStrings);

    states.push(current);

    for (const move of moves) {
        current = applyGraphMoveToState(current, move);
        states.push(current);
    }

    return states;
}

function mapPathNodesByState(pathNodes) {
    const result = new Map();

    for (const node of pathNodes) {
        if (node.stateId) {
            result.set(node.stateId, node);
        }
    }

    return result;
}

function clearStateGraph(message = "Solve to show the graph.") {
    graphState.data = null;
    graphState.pathNodes = [];
    graphState.adjacentEdges = [];
    graphState.activeNode = null;
    graphState.pathNodesByState = new Map();
    graphState.explorationNodesByState = new Map();
    graphState.nodeDatasets = new Map();
    graphState.progressIndex = 0;
    setGraphStatus(message);
    drawEmptyGraph();
}

function bindGraphEvents() {
    const canvas = graphState.canvas;

    canvas.addEventListener("pointerdown", event => {
        graphState.isDragging = true;
        graphState.lastPointerX = event.clientX;
        graphState.lastPointerY = event.clientY;
        graphState.pointerMoved = false;
        canvas.classList.add("dragging");
        canvas.setPointerCapture(event.pointerId);
    });

    canvas.addEventListener("pointermove", event => {
        if (!graphState.isDragging) {
            updateHoveredRing(event);
            return;
        }

        const dx = event.clientX - graphState.lastPointerX;
        const dy = event.clientY - graphState.lastPointerY;

        if (Math.abs(dx) + Math.abs(dy) > 3) {
            graphState.pointerMoved = true;
        }

        graphState.offsetX += dx * graphState.lastSize.pixelRatio;
        graphState.offsetY += dy * graphState.lastSize.pixelRatio;
        graphState.lastPointerX = event.clientX;
        graphState.lastPointerY = event.clientY;

        requestGraphRedraw();
    });

    canvas.addEventListener("pointerup", event => {
        graphState.isDragging = false;
        canvas.classList.remove("dragging");
        canvas.releasePointerCapture(event.pointerId);
    });

    canvas.addEventListener("pointercancel", () => {
        graphState.isDragging = false;
        canvas.classList.remove("dragging");
    });

    canvas.addEventListener("pointerleave", () => {
        graphState.hoveredRingDepth = null;
        requestGraphRedraw();
    });

    canvas.addEventListener("click", event => {
        if (!graphState.pointerMoved) {
            handleGraphClick(event);
        }
    });

    canvas.addEventListener("wheel", event => {
        event.preventDefault();
        zoomGraphAt(event.offsetX, event.offsetY, event.deltaY < 0 ? 1.12 : 0.88);
    }, {passive: false});

    addGraphClickListener("graphResetBtn", resetGraphView);
    addGraphClickListener("graphFitBtn", fitGraphToCurrentMode);
    addGraphClickListener("graphPrevBtn", previousGraphMove);
    addGraphClickListener("graphNextBtn", nextGraphMove);

    const modeSelect = document.getElementById("graphModeSelect");
    if (modeSelect) {
        modeSelect.addEventListener("change", event => {
            setGraphDisplayMode(event.target.value);
        });
    }
}

function updateHoveredRing(event) {
    if (!graphState.data) {
        return;
    }

    const size = resizeGraphCanvases();
    const x = event.offsetX * size.pixelRatio;
    const y = event.offsetY * size.pixelRatio;
    const world = screenToWorld(x, y);
    const radius = Math.sqrt(world.x * world.x + world.y * world.y);
    const depth = Math.round(radius / GRAPH.ringSpacing);
    const ring = activeRings().find(item => item.depth === depth);
    const distance = Math.abs(radius - depth * GRAPH.ringSpacing);
    const nextHover = ring && distance < 18 / graphState.scale ? depth : null;

    if (graphState.hoveredRingDepth !== nextHover) {
        graphState.hoveredRingDepth = nextHover;
        requestGraphRedraw();
    }
}

function addGraphClickListener(id, handler) {
    const element = document.getElementById(id);

    if (element) {
        element.addEventListener("click", handler);
    }
}

function currentGraphMode() {
    const select = document.getElementById("graphModeSelect");
    return select ? select.value : GRAPH_MODE.SOLUTION;
}

function setGraphDisplayMode(mode) {
    graphState.displayMode = mode;

    if (graphState.data) {
        fitGraphToCurrentMode();
        updateGraphStatus();
        requestGraphRedraw();
    }
}

function activeRings() {
    if (!graphState.data) {
        return [];
    }

    if (graphState.displayMode === GRAPH_MODE.ALL) {
        return graphState.data.allRings || [];
    }

    if (graphState.displayMode === GRAPH_MODE.EXPLORED) {
        return graphState.data.exploredRings || [];
    }

    const ringCounts = new Map();

    for (const node of graphState.pathNodes) {
        ringCounts.set(node.depth, (ringCounts.get(node.depth) || 0) + 1);
    }

    for (const edge of graphState.adjacentEdges) {
        ringCounts.set(edge.target.depth, (ringCounts.get(edge.target.depth) || 0) + 1);
    }

    return Array.from(ringCounts.entries())
        .map(([depth, count]) => ({depth, count}))
        .sort((first, second) => first.depth - second.depth);
}

function activeNodeCount() {
    return activeRings().reduce((sum, ring) => sum + Math.max(0, ring.count || 0), 0);
}

function resizeGraphCanvases() {
    const canvas = graphState.canvas;
    const pixelRatio = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width * pixelRatio));
    const height = Math.max(1, Math.round(rect.height * pixelRatio));

    resizeCanvasElement(canvas, width, height);

    if (graphState.webglCanvas) {
        resizeCanvasElement(graphState.webglCanvas, width, height);
    }

    graphState.lastSize = {
        width,
        height,
        pixelRatio,
    };

    return graphState.lastSize;
}

function resizeCanvasElement(canvas, width, height) {
    if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
    }
}

function resetGraphView() {
    const size = resizeGraphCanvases();

    graphState.scale = 1;
    graphState.offsetX = size.width / 2;
    graphState.offsetY = size.height / 2;
    requestGraphRedraw();
}

function fitGraphToCurrentMode() {
    const size = resizeGraphCanvases();
    const maxDepth = Math.max(
        1,
        ...activeRings().map(ring => ring.depth),
        ...graphState.pathNodes.map(node => node.depth),
        ...graphState.adjacentEdges.map(edge => edge.target.depth),
        focusedGraphNode()?.depth || 0
    );
    const radius = maxDepth * GRAPH.ringSpacing + 80;
    const usable = Math.min(size.width, size.height) * 0.44;

    graphState.scale = clamp(usable / radius, GRAPH.minScale, GRAPH.maxScale);
    graphState.offsetX = size.width / 2;
    graphState.offsetY = size.height / 2;
    requestGraphRedraw();
}

function zoomGraphAt(screenX, screenY, factor) {
    const size = resizeGraphCanvases();
    const x = screenX * size.pixelRatio;
    const y = screenY * size.pixelRatio;

    const before = screenToWorld(x, y);
    graphState.scale = clamp(
        graphState.scale * factor,
        GRAPH.minScale,
        GRAPH.maxScale
    );
    const after = screenToWorld(x, y);

    graphState.offsetX += (after.x - before.x) * graphState.scale;
    graphState.offsetY += (after.y - before.y) * graphState.scale;
    requestGraphRedraw();
}

function screenToWorld(x, y) {
    return {
        x: (x - graphState.offsetX) / graphState.scale,
        y: (y - graphState.offsetY) / graphState.scale,
    };
}

function visibleWorldBounds(size) {
    const topLeft = screenToWorld(0, 0);
    const bottomRight = screenToWorld(size.width, size.height);
    const margin = 80 / graphState.scale;

    return {
        left: Math.min(topLeft.x, bottomRight.x) - margin,
        right: Math.max(topLeft.x, bottomRight.x) + margin,
        top: Math.min(topLeft.y, bottomRight.y) - margin,
        bottom: Math.max(topLeft.y, bottomRight.y) + margin,
    };
}

function withGraphTransform(context, callback) {
    context.save();
    context.translate(graphState.offsetX, graphState.offsetY);
    context.scale(graphState.scale, graphState.scale);
    callback();
    context.restore();
}

function layoutPathNodes(path) {
    return path.map((node, index) => {
        const radius = node.depth * GRAPH.ringSpacing;
        const curve = (index - (path.length - 1) / 2) * 0.055;
        const angle = GRAPH.pathAngle + curve;

        return {
            ...node,
            pathIndex: index,
            generation: 0,
            x: radius * Math.cos(angle),
            y: radius * Math.sin(angle),
        };
    });
}

function focusedGraphNode() {
    return graphState.activeNode || graphState.pathNodes[graphState.progressIndex] || null;
}

function pathIndexForNode(node) {
    if (!node) {
        return -1;
    }

    if (Number.isInteger(node.pathIndex)) {
        return node.pathIndex;
    }

    return graphState.pathNodes.findIndex(pathNode => pathNode.id === node.id);
}

function layoutFocusedAdjacentEdges() {
    const source = focusedGraphNode();

    if (!source) {
        return [];
    }

    return layoutAdjacentEdgesForNode(source);
}

function layoutAdjacentEdgesForNode(source) {
    const exactNeighbours = exactNeighbourDataForNode(source);

    if (exactNeighbours) {
        return layoutExactAdjacentEdgesForNode(source, exactNeighbours);
    }

    requestExactNeighboursForNode(source);
    return [];
}

function exactNeighbourDataForNode(source) {
    if (!source || !source.stateId) {
        return null;
    }

    return graphState.exactNeighbourCache.get(source.stateId) || null;
}

function layoutExactAdjacentEdgesForNode(source, neighbourData) {
    if (!neighbourData || !Array.isArray(neighbourData.neighbours)) {
        return [];
    }

    if (neighbourData.state) {
        applyExactMetadataToNode(source, neighbourData.state);
    }

    return neighbourData.neighbours.map(neighbour => {
        const pathNode = graphState.pathNodesByState.get(neighbour.stateId);

        if (pathNode) {
            return {
                source,
                move: neighbour.move,
                kind: "path",
                target: pathNode,
            };
        }

        const existingNode = graphState.explorationNodesByState.get(neighbour.stateId);
        if (existingNode) {
            applyExactMetadataToNode(existingNode, neighbour);
            return {
                source,
                move: neighbour.move,
                kind: "branch",
                target: existingNode,
            };
        }

        const target = createLookupAdjacentNode(source, neighbour);
        graphState.explorationNodesByState.set(neighbour.stateId, target);

        return {
            source,
            move: neighbour.move,
            kind: "branch",
            target,
        };
    });
}

function createLookupAdjacentNode(source, neighbour) {
    const position = exactLookupNodePosition(neighbour);

    return {
        id: `lookup-${neighbour.index ?? hashString(neighbour.stateId || `${source.id}:${neighbour.move}`)}`,
        stateId: neighbour.stateId,
        lookupIndex: neighbour.index,
        rankInDepth: neighbour.rankInDepth,
        depthCount: neighbour.depthCount,
        depth: Number.isFinite(neighbour.depth) ? neighbour.depth : outwardAdjacentDepth(source, graphMaximumDepth()),
        label: `${neighbour.move} from ${source.label || source.id}`,
        x: position.x,
        y: position.y,
        parent: source,
        entryMove: neighbour.move,
        generation: (source.generation || 0) + 1,
    };
}

function applyExactMetadataToNode(node, metadata) {
    if (!node || !metadata) {
        return;
    }

    if (Number.isFinite(metadata.depth)) {
        node.depth = metadata.depth;
    }

    if (Number.isFinite(metadata.index)) {
        node.lookupIndex = metadata.index;
    }

    if (Number.isFinite(metadata.rankInDepth)) {
        node.rankInDepth = metadata.rankInDepth;
    }

    if (Number.isFinite(metadata.depthCount)) {
        node.depthCount = metadata.depthCount;
    }

    const position = exactLookupNodePosition(node);
    node.x = position.x;
    node.y = position.y;
}

function exactLookupNodePosition(metadata) {
    const depth = Number.isFinite(metadata.depth) ? metadata.depth : 0;

    if (depth <= 0) {
        return {x: 0, y: 0};
    }

    const count = Number.isFinite(metadata.depthCount) && metadata.depthCount > 0
        ? metadata.depthCount
        : ringCountForDepth(depth);
    const rank = Number.isFinite(metadata.rankInDepth)
        ? metadata.rankInDepth
        : hashString(metadata.stateId || `${depth}`) % Math.max(1, count);

    const angle = (2 * Math.PI * (rank + 0.5)) / Math.max(1, count);
    const radius = depth * GRAPH.ringSpacing;

    return {
        x: radius * Math.cos(angle),
        y: radius * Math.sin(angle),
    };
}

function ringCountForDepth(depth) {
    const ring = (graphState.data?.allRings || []).find(item => item.depth === depth)
        || (graphState.data?.exploredRings || []).find(item => item.depth === depth);

    return Math.max(1, ring?.count || 1);
}

async function requestExactNeighboursForNode(source) {
    if (!source?.stateId || !graphState.data?.lookupGraphAvailable || !graphState.data?.neighbourEndpoint) {
        return;
    }

    if (graphState.exactNeighbourCache.has(source.stateId) || graphState.exactNeighbourRequests.has(source.stateId)) {
        return;
    }

    graphState.exactNeighbourRequests.add(source.stateId);

    try {
        const response = await fetch(graphState.data.neighbourEndpoint, {
            method: "POST",
            headers: {"Content-Type": "application/json"},
            body: JSON.stringify({stateId: source.stateId}),
        });
        const payload = await response.json();

        if (!response.ok || !payload.ok) {
            return;
        }

        graphState.exactNeighbourCache.set(source.stateId, payload);
        applyExactMetadataToNode(source, payload.state);

        const focused = focusedGraphNode();
        if (focused?.stateId === source.stateId) {
            graphState.adjacentEdges = layoutFocusedAdjacentEdges();
            updateGraphStatus();
            requestGraphRedraw();
        }
    } catch (error) {
        console.warn("Could not load exact lookup neighbours:", error);
    } finally {
        graphState.exactNeighbourRequests.delete(source.stateId);
    }
}

function createAdjacentMoveEdge(source, move, branchIndex, branchCount) {
    const targetStateId = source.stateId
        ? applyGraphMoveToState(source.stateId, move)
        : null;

    const pathNode = targetStateId
        ? graphState.pathNodesByState.get(targetStateId)
        : null;

    if (pathNode && isPlausibleAdjacentDepth(source.depth, pathNode.depth)) {
        return {
            source,
            move,
            kind: "path",
            target: pathNode,
        };
    }

    const existingNode = targetStateId
        ? graphState.explorationNodesByState.get(targetStateId)
        : null;

    if (existingNode && isPlausibleAdjacentDepth(source.depth, existingNode.depth)) {
        return {
            source,
            move,
            kind: "branch",
            target: existingNode,
        };
    }

    const target = createExactAdjacentNode(
        source,
        move,
        targetStateId,
        branchIndex,
        branchCount
    );

    if (targetStateId) {
        graphState.explorationNodesByState.set(targetStateId, target);
    }

    return {
        source,
        move,
        kind: "branch",
        target,
    };
}

function createExactAdjacentNode(source, move, stateId, branchIndex, branchCount) {
    const targetDepth = estimatedAdjacentDepth(source, stateId);
    const angle = adjacentNodeAngle(source, move, stateId, branchIndex, branchCount);
    const radius = targetDepth * GRAPH.ringSpacing + adjacentRadiusJitter(stateId, move);

    return {
        id: `state-${hashString(stateId || `${source.id}:${move}`)}`,
        stateId,
        depth: targetDepth,
        label: `${move} from ${source.label || source.id}`,
        x: radius * Math.cos(angle),
        y: radius * Math.sin(angle),
        parent: source,
        entryMove: move,
        generation: (source.generation || 0) + 1,
    };
}

function estimatedAdjacentDepth(source, stateId) {
    const maximumDepth = graphMaximumDepth();

    if (!stateId) {
        return outwardAdjacentDepth(source, maximumDepth);
    }

    if (isSolvedStateId(stateId)) {
        return 0;
    }

    const cachedNeighbours = graphState.exactNeighbourCache.get(source.stateId);
    const exactNeighbour = cachedNeighbours?.neighbours?.find(neighbour => neighbour.stateId === stateId);
    if (exactNeighbour && Number.isFinite(exactNeighbour.depth)) {
        return exactNeighbour.depth;
    }

    if (source.parent && source.parent.stateId === stateId) {
        return source.parent.depth;
    }

    const pathNode = graphState.pathNodesByState.get(stateId);

    if (pathNode && isPlausibleAdjacentDepth(source.depth, pathNode.depth)) {
        return pathNode.depth;
    }

    if (isOneMoveFromSolvedState(stateId)) {
        return Math.min(1, maximumDepth);
    }

    return outwardAdjacentDepth(source, maximumDepth);
}

function outwardAdjacentDepth(source, maximumDepth) {
    return Math.max(
        1,
        Math.min(maximumDepth, source.depth + 1)
    );
}

function isPlausibleAdjacentDepth(sourceDepth, targetDepth) {
    return Math.abs((targetDepth || 0) - (sourceDepth || 0)) <= 1;
}

function isOneMoveFromSolvedState(stateId) {
    for (const move of GRAPH_MOVE_NAMES) {
        if (isSolvedStateId(applyGraphMoveToState(stateId, move))) {
            return true;
        }
    }

    return false;
}

function adjacentNodeAngle(source, move, stateId, branchIndex, branchCount) {
    const seed = hashString(stateId || `${source.id}:${move}`);

    if (stateId) {
        return hashUnit(seed) * Math.PI * 2;
    }

    const sourceAngle = Math.atan2(source.y, source.x || 0);
    const fanCentre = source.depth === 0
        ? GRAPH.pathAngle + Math.PI
        : sourceAngle + Math.PI;
    const fanSpread = Math.PI * 0.82;
    const offset = branchCount <= 1
        ? 0
        : (branchIndex / (branchCount - 1) - 0.5) * fanSpread;

    return fanCentre + offset;
}

function adjacentRadiusJitter(stateId, move) {
    if (!stateId) {
        return 0;
    }

    return (hashUnit(hashString(`${stateId}:${move}:radius`)) - 0.5) * 22;
}

function handleGraphClick(event) {
    if (!graphState.data) {
        return;
    }

    const size = resizeGraphCanvases();
    const x = event.offsetX * size.pixelRatio;
    const y = event.offsetY * size.pixelRatio;
    const world = screenToWorld(x, y);
    const hit = hitTestGraphNode(world);

    if (!hit) {
        return;
    }

    if (hit.type === "path") {
        graphState.progressIndex = hit.index;
        graphState.activeNode = null;
    } else {
        graphState.activeNode = hit.node;
    }

    graphState.adjacentEdges = layoutFocusedAdjacentEdges();
    updateGraphStatus();
    requestGraphRedraw();
}

function hitTestGraphNode(world) {
    const pathHitRadius = (GRAPH.currentNodeSize + 7) / graphState.scale;
    let bestHit = null;
    let bestDistance = Infinity;

    graphState.pathNodes.forEach((node, index) => {
        const distance = distanceBetween(world, node);

        if (distance <= pathHitRadius && distance < bestDistance) {
            bestDistance = distance;
            bestHit = {type: "path", node, index};
        }
    });

    const adjacentHitRadius = 11 / graphState.scale;

    for (const edge of graphState.adjacentEdges) {
        const distance = distanceBetween(world, edge.target);

        if (distance <= adjacentHitRadius && distance < bestDistance) {
            bestDistance = distance;
            bestHit = {
                type: (edge.kind === "return" || edge.kind === "path") && Number.isInteger(edge.target.pathIndex)
                    ? "path"
                    : "adjacent",
                node: edge.target,
                index: Number.isInteger(edge.target.pathIndex) ? edge.target.pathIndex : -1,
            };
        }
    }

    return bestHit;
}

function distanceBetween(first, second) {
    const dx = first.x - second.x;
    const dy = first.y - second.y;
    return Math.sqrt(dx * dx + dy * dy);
}

const GRAPH_MOVE_PERMS = buildGraphMovePermutations();

function faceStringsToStateId(faceStrings) {
    return faceStrings.join("");
}

function applyGraphMoveToState(stateId, moveName) {
    const permutation = GRAPH_MOVE_PERMS[moveName];

    if (!permutation) {
        return stateId;
    }

    const next = Array(stateId.length);

    for (let index = 0; index < permutation.length; index++) {
        next[permutation[index]] = stateId[index];
    }

    return next.join("");
}

function buildGraphMovePermutations() {
    const basePermutations = {
        R: [0, 8, 5, 6, 9, 11, 12, 7, 10, 14, 1, 2, 3, 13, 4, 15, 21, 17, 18, 19, 20, 25, 22, 23, 24, 16, 26, 27, 28, 29],
        L: [20, 21, 2, 23, 24, 5, 10, 7, 8, 9, 18, 11, 12, 13, 14, 15, 16, 17, 6, 19, 26, 27, 22, 25, 29, 3, 0, 1, 28, 4],
        D: [0, 1, 2, 8, 4, 5, 6, 7, 27, 9, 16, 11, 18, 15, 19, 22, 23, 17, 21, 24, 20, 12, 13, 10, 14, 25, 26, 3, 28, 29],
        B: [0, 23, 2, 3, 4, 5, 27, 28, 25, 29, 10, 11, 1, 13, 14, 15, 6, 7, 8, 9, 20, 21, 22, 12, 24, 18, 26, 16, 17, 19],
    };
    const result = {};

    for (const [moveName, permutation] of Object.entries(basePermutations)) {
        result[moveName] = permutation;
        result[`${moveName}'`] = inversePermutation(permutation);
    }

    return result;
}

function inversePermutation(permutation) {
    const inverse = Array(permutation.length);

    for (let index = 0; index < permutation.length; index++) {
        inverse[permutation[index]] = index;
    }

    return inverse;
}

function isSolvedStateId(stateId) {
    if (!stateId || stateId.length !== 30) {
        return false;
    }

    const seen = new Set();

    for (let face = 0; face < 6; face++) {
        const colour = stateId[face * 5];

        for (let sticker = 1; sticker < 5; sticker++) {
            if (stateId[face * 5 + sticker] !== colour) {
                return false;
            }
        }

        if (seen.has(colour)) {
            return false;
        }

        seen.add(colour);
    }

    return true;
}

function hashString(text) {
    let hash = 2166136261;

    for (let index = 0; index < text.length; index++) {
        hash ^= text.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }

    return hash >>> 0;
}

function requestGraphRedraw() {
    if (graphState.redrawQueued) {
        return;
    }

    graphState.redrawQueued = true;

    window.requestAnimationFrame(() => {
        graphState.redrawQueued = false;
        renderGraphNow();
    });
}

function renderGraphNow() {
    if (!graphState.canvas || !graphState.context) {
        return;
    }

    const size = resizeGraphCanvases();
    const context = graphState.context;

    clearPointLayer(size);
    context.clearRect(0, 0, size.width, size.height);

    if (!graphState.data) {
        drawEmptyGraphText(context, size);
        return;
    }

    if (graphState.displayMode !== GRAPH_MODE.SOLUTION) {
        drawActiveNodeCloud(size);
    }

    withGraphTransform(context, () => {
        drawRings(context);

        if (graphState.pathNodes.length > 0) {
            drawAdjacentMoveEdges(context);
            drawPathEdges(context);
            drawPathNodes(context);
            drawFocusedExplorationNode(context);
        } else {
            drawSolvedMarker(context);
        }
    });

    drawGraphLegend(context, size);
}

function clearPointLayer(size) {
    if (!graphState.gl) {
        return;
    }

    const gl = graphState.gl;
    gl.viewport(0, 0, size.width, size.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
}

function drawCachedBackground(context, size) {
    const cacheKey = `${size.width}x${size.height}`;

    if (!graphState.backgroundCanvas || graphState.backgroundKey !== cacheKey) {
        graphState.backgroundCanvas = document.createElement("canvas");
        graphState.backgroundCanvas.width = size.width;
        graphState.backgroundCanvas.height = size.height;
        graphState.backgroundContext = graphState.backgroundCanvas.getContext("2d");
        graphState.backgroundKey = cacheKey;
        drawGraphBackground(graphState.backgroundContext, size);
    }

    context.drawImage(graphState.backgroundCanvas, 0, 0);
}

function drawGraphBackground(context, size) {
    const gradient = context.createRadialGradient(
        size.width / 2,
        size.height / 2,
        0,
        size.width / 2,
        size.height / 2,
        Math.max(size.width, size.height) / 2
    );

    gradient.addColorStop(0, "#111827");
    gradient.addColorStop(1, "#020617");
    context.fillStyle = gradient;
    context.fillRect(0, 0, size.width, size.height);
}

function drawEmptyGraph() {
    if (!graphState.canvas || !graphState.context) {
        return;
    }

    const size = resizeGraphCanvases();
    const context = graphState.context;

    clearPointLayer(size);
    context.clearRect(0, 0, size.width, size.height);
    drawEmptyGraphText(context, size);
}

function drawEmptyGraphText(context, size) {
    context.save();
    context.fillStyle = "#d1d5db";
    context.font = `${16 * (window.devicePixelRatio || 1)}px Arial, Helvetica, sans-serif`;
    context.textAlign = "center";
    context.fillText(
        "Solve to show the graph.",
        size.width / 2,
        size.height / 2
    );
    context.restore();
}

function drawActiveNodeCloud(size) {
    const dataset = nodeDatasetForMode(graphState.displayMode);

    if (!dataset || dataset.count === 0) {
        return;
    }

    if (graphState.renderer === GRAPH_RENDERER.WEBGL && graphState.gl) {
        drawNodeCloudWebGl(dataset, size);
        return;
    }

    drawNodeCloudCanvas(dataset, size);
}

function nodeDatasetForMode(mode) {
    const cacheKey = `${mode}:${graphState.data?.type || "none"}:${activeNodeCount()}`;

    if (graphState.nodeDatasets.has(cacheKey)) {
        return graphState.nodeDatasets.get(cacheKey);
    }

    const rings = activeRings();
    setGraphStatus(`Loading ${formatInteger(activeNodeCount())} nodes…`);
    const dataset = buildNodeDataset(rings, mode);
    graphState.nodeDatasets.set(cacheKey, dataset);
    updateGraphStatus();

    return dataset;
}

function buildNodeDataset(rings, mode) {
    const totalCount = rings.reduce((sum, ring) => sum + Math.max(0, ring.count || 0), 0);
    const positions = new Float32Array(totalCount * 2);
    const depths = new Uint8Array(totalCount);
    let offset = 0;

    for (const ring of rings) {
        const depth = Math.max(0, ring.depth || 0);
        const count = Math.max(0, ring.count || 0);

        for (let index = 0; index < count; index++) {
            const node = graphNodePosition(depth, index, count, mode);
            positions[offset * 2] = node.x;
            positions[offset * 2 + 1] = node.y;
            depths[offset] = Math.min(255, depth);
            offset++;
        }
    }

    return {
        mode,
        positions,
        depths,
        count: totalCount,
        glBuffer: null,
    };
}

function graphNodePosition(depth, index, count, mode) {
    if (depth === 0) {
        return {x: 0, y: 0};
    }

    const angle = (2 * Math.PI * (index + 0.5)) / Math.max(1, count);
    const radius = depth * GRAPH.ringSpacing;

    return {
        x: radius * Math.cos(angle),
        y: radius * Math.sin(angle),
    };
}

function graphMaximumDepth() {
    const depths = [
        ...(graphState.data?.allRings || []).map(ring => ring.depth || 0),
        ...(graphState.data?.exploredRings || []).map(ring => ring.depth || 0),
        ...graphState.pathNodes.map(node => node.depth || 0),
        ...graphState.adjacentEdges.map(edge => edge.target.depth || 0),
    ];

    return Math.max(1, ...depths);
}

function hashUnit(value) {
    let hash = value | 0;
    hash ^= hash >>> 16;
    hash = Math.imul(hash, 0x7feb352d);
    hash ^= hash >>> 15;
    hash = Math.imul(hash, 0x846ca68b);
    hash ^= hash >>> 16;
    return (hash >>> 0) / 4294967296;
}

function drawNodeCloudWebGl(dataset, size) {
    const gl = graphState.gl;
    const locations = graphState.glLocations;

    if (!dataset.glBuffer) {
        dataset.glBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, dataset.glBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, dataset.positions, gl.STATIC_DRAW);
    } else {
        gl.bindBuffer(gl.ARRAY_BUFFER, dataset.glBuffer);
    }

    gl.viewport(0, 0, size.width, size.height);
    gl.useProgram(graphState.glProgram);
    gl.enableVertexAttribArray(locations.position);
    gl.vertexAttribPointer(locations.position, 2, gl.FLOAT, false, 0, 0);

    gl.uniform2f(locations.resolution, size.width, size.height);
    gl.uniform1f(locations.scale, graphState.scale);
    gl.uniform2f(locations.offset, graphState.offsetX, graphState.offsetY);
    gl.uniform1f(locations.pointSize, currentPointSize(dataset.mode, size.pixelRatio));

    const color = dataset.mode === GRAPH_MODE.ALL
        ? [0.650, 0.790, 1.000, 0.62]
        : [1.000, 0.690, 0.360, 0.78];

    gl.uniform4f(locations.color, color[0], color[1], color[2], color[3]);
    gl.drawArrays(gl.POINTS, 0, dataset.count);
}

function drawNodeCloudCanvas(dataset, size) {
    const context = graphState.context;
    const bounds = visibleWorldBounds(size);
    const positions = dataset.positions;
    const dotSize = currentPointSize(dataset.mode, size.pixelRatio) / graphState.scale;

    context.save();
    context.translate(graphState.offsetX, graphState.offsetY);
    context.scale(graphState.scale, graphState.scale);
    context.fillStyle = dataset.mode === GRAPH_MODE.ALL
        ? "rgba(166, 202, 255, 0.56)"
        : "rgba(255, 176, 92, 0.70)";

    for (let index = 0; index < dataset.count; index++) {
        const x = positions[index * 2];
        const y = positions[index * 2 + 1];

        if (!pointIsVisible(x, y, bounds)) {
            continue;
        }

        context.fillRect(x - dotSize / 2, y - dotSize / 2, dotSize, dotSize);
    }

    context.restore();
}

function currentPointSize(mode, pixelRatio) {
    const base = mode === GRAPH_MODE.ALL ? GRAPH.allDotSize : GRAPH.exploredDotSize;
    const scaled = base * Math.sqrt(graphState.scale) * pixelRatio;
    const minimum = mode === GRAPH_MODE.ALL ? 1.8 * pixelRatio : 2.2 * pixelRatio;
    const maximum = mode === GRAPH_MODE.ALL ? 9 * pixelRatio : 11 * pixelRatio;
    return clamp(scaled, minimum, maximum);
}

function pointIsVisible(x, y, bounds) {
    return x >= bounds.left && x <= bounds.right && y >= bounds.top && y <= bounds.bottom;
}

function drawRings(context) {
    const rings = activeRings();
    const pathDepths = new Set(graphState.pathNodes.map(node => node.depth));

    for (const ring of rings) {
        const radius = ring.depth * GRAPH.ringSpacing;

        context.beginPath();
        context.arc(0, 0, radius, 0, Math.PI * 2);
        const isHovered = graphState.hoveredRingDepth === ring.depth;
        const isPathRing = pathDepths.has(ring.depth);
        context.strokeStyle = ring.depth === 0
            ? "rgba(134, 239, 172, 0.9)"
            : isHovered
                ? "rgba(249, 250, 251, 0.65)"
                : isPathRing
                    ? "rgba(96, 165, 250, 0.42)"
                    : "rgba(148, 163, 184, 0.18)";
        context.lineWidth = ring.depth === 0 || isHovered ? 3 / graphState.scale : 1 / graphState.scale;
        context.stroke();

        if (ring.depth > 0 && graphState.scale > 0.35) {
            context.fillStyle = "rgba(209, 213, 219, 0.8)";
            context.font = `${12 / graphState.scale}px Arial, Helvetica, sans-serif`;
            context.fillText(`d${ring.depth}`, radius + 8 / graphState.scale, -6 / graphState.scale);
        }
    }
}

function drawSolvedMarker(context) {
    context.beginPath();
    context.arc(0, 0, GRAPH.solvedDotSize / graphState.scale, 0, Math.PI * 2);
    context.fillStyle = "rgba(134, 239, 172, 0.98)";
    context.fill();
    context.strokeStyle = "#111827";
    context.lineWidth = 2 / graphState.scale;
    context.stroke();
}

function drawAdjacentMoveEdges(context) {
    const edges = graphState.adjacentEdges;

    if (edges.length === 0) {
        return;
    }

    context.save();
    context.lineCap = "round";
    context.lineJoin = "round";

    for (const edge of edges) {
        context.beginPath();
        context.moveTo(edge.source.x, edge.source.y);
        context.lineTo(edge.target.x, edge.target.y);
        context.strokeStyle = edge.kind === "return" || edge.kind === "path"
            ? "rgba(134, 239, 172, 0.36)"
            : "rgba(251, 146, 60, 0.48)";
        context.lineWidth = 1.6 / graphState.scale;
        context.stroke();
    }

    for (const edge of edges) {
        const radius = 4.2 / graphState.scale;

        context.beginPath();
        context.arc(edge.target.x, edge.target.y, radius, 0, Math.PI * 2);
        context.fillStyle = edge.kind === "return" || edge.kind === "path"
            ? "rgba(134, 239, 172, 0.84)"
            : "rgba(251, 146, 60, 0.90)";
        context.fill();
        context.strokeStyle = "rgba(15, 23, 42, 0.9)";
        context.lineWidth = 1.4 / graphState.scale;
        context.stroke();

        if (graphState.scale > 0.48) {
            const midX = (edge.source.x + edge.target.x) / 2;
            const midY = (edge.source.y + edge.target.y) / 2;
            context.fillStyle = "rgba(253, 186, 116, 0.92)";
            context.font = `${11 / graphState.scale}px Arial, Helvetica, sans-serif`;
            context.fillText(edge.move, midX + 5 / graphState.scale, midY - 5 / graphState.scale);
        }
    }

    context.restore();
}

function drawPathEdges(context) {
    const nodes = graphState.pathNodes;

    if (nodes.length < 2) {
        return;
    }

    context.lineCap = "round";
    context.lineJoin = "round";

    for (let index = 0; index < nodes.length - 1; index++) {
        const from = nodes[index];
        const to = nodes[index + 1];
        const completed = index < graphState.progressIndex;

        context.beginPath();
        context.moveTo(from.x, from.y);
        context.lineTo(to.x, to.y);
        context.strokeStyle = completed
            ? "rgba(134, 239, 172, 0.95)"
            : "rgba(96, 165, 250, 0.75)";
        context.lineWidth = (completed ? 6 : 4) / graphState.scale;
        context.stroke();
    }
}

function drawPathNodes(context) {
    const nodes = graphState.pathNodes;

    for (let index = 0; index < nodes.length; index++) {
        const node = nodes[index];
        const isCurrent = !graphState.activeNode && index === graphState.progressIndex;
        const isSolved = index === nodes.length - 1;
        const radius = (isCurrent ? GRAPH.currentNodeSize : GRAPH.pathNodeSize) / graphState.scale;

        context.beginPath();
        context.arc(node.x, node.y, radius, 0, Math.PI * 2);
        context.fillStyle = isSolved
            ? "#86efac"
            : isCurrent
                ? "#fef08a"
                : "#60a5fa";
        context.fill();
        context.strokeStyle = "#111827";
        context.lineWidth = 2 / graphState.scale;
        context.stroke();

        if (node.moveToNext && index < nodes.length - 1) {
            const next = nodes[index + 1];
            const midX = (node.x + next.x) / 2;
            const midY = (node.y + next.y) / 2;
            context.fillStyle = "rgba(249, 250, 251, 0.9)";
            context.font = `${13 / graphState.scale}px Arial, Helvetica, sans-serif`;
            context.fillText(node.moveToNext, midX + 8 / graphState.scale, midY - 8 / graphState.scale);
        }
    }
}


function drawFocusedExplorationNode(context) {
    const node = graphState.activeNode;

    if (!node) {
        return;
    }

    const radius = GRAPH.currentNodeSize / graphState.scale;

    context.beginPath();
    context.arc(node.x, node.y, radius, 0, Math.PI * 2);
    context.fillStyle = "#fef08a";
    context.fill();
    context.strokeStyle = "#111827";
    context.lineWidth = 2 / graphState.scale;
    context.stroke();

    if (graphState.scale > 0.42) {
        context.fillStyle = "rgba(254, 240, 138, 0.95)";
        context.font = `${12 / graphState.scale}px Arial, Helvetica, sans-serif`;
        context.fillText("current", node.x + 10 / graphState.scale, node.y - 10 / graphState.scale);
    }
}

function drawGraphLegend(context, size) {
    context.save();
    context.fillStyle = "rgba(15, 23, 42, 0.84)";
    context.strokeStyle = "rgba(148, 163, 184, 0.32)";
    context.lineWidth = 1;
    roundedRect(context, 16, 16, 330, 116, 12);
    context.fill();
    context.stroke();

    const current = focusedGraphNode();
    const distance = current ? current.depth : 0;
    const pathLength = Math.max(0, graphState.pathNodes.length - 1);
    const nodeCount = graphState.displayMode === GRAPH_MODE.SOLUTION
        ? graphState.pathNodes.length
        : activeNodeCount();

    context.fillStyle = "#f9fafb";
    context.font = "bold 14px Arial, Helvetica, sans-serif";
    context.fillText(graphModeLabel(graphState.displayMode), 30, 42);

    context.fillStyle = "#d1d5db";
    context.font = "12px Arial, Helvetica, sans-serif";
    context.fillText(`Step ${graphState.progressIndex} of ${pathLength}`, 30, 66);
    context.fillText(`Distance: ${distance}`, 30, 88);
    context.fillText(`Nodes shown: ${formatInteger(nodeCount)}`, 30, 110);

    context.restore();
}

function roundedRect(context, x, y, width, height, radius) {
    if (typeof context.roundRect === "function") {
        context.beginPath();
        context.roundRect(x, y, width, height, radius);
        return;
    }

    context.beginPath();
    context.moveTo(x + radius, y);
    context.lineTo(x + width - radius, y);
    context.quadraticCurveTo(x + width, y, x + width, y + radius);
    context.lineTo(x + width, y + height - radius);
    context.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
    context.lineTo(x + radius, y + height);
    context.quadraticCurveTo(x, y + height, x, y + height - radius);
    context.lineTo(x, y + radius);
    context.quadraticCurveTo(x, y, x + radius, y);
}

function previousGraphMove() {
    if (!graphState.data || graphState.pathNodes.length === 0) {
        return;
    }

    graphState.progressIndex = Math.max(0, graphState.progressIndex - 1);
    graphState.activeNode = null;
    graphState.adjacentEdges = layoutFocusedAdjacentEdges();
    updateGraphStatus();
    requestGraphRedraw();
}

function nextGraphMove() {
    if (!graphState.data || graphState.pathNodes.length === 0) {
        return;
    }

    graphState.progressIndex = Math.min(
        graphState.pathNodes.length - 1,
        graphState.progressIndex + 1
    );
    graphState.activeNode = null;
    graphState.adjacentEdges = layoutFocusedAdjacentEdges();
    updateGraphStatus();
    requestGraphRedraw();
}

function updateGraphStatus() {
    const data = graphState.data;

    if (!data) {
        return;
    }

    const current = focusedGraphNode();
    const nextMove = current?.moveToNext;
    const viewMode = graphModeLabel(graphState.displayMode);
    const pathText = nextMove
        ? `Next move: ${nextMove}.`
        : "Solved.";

    if (graphState.displayMode === GRAPH_MODE.SOLUTION) {
        setGraphStatus(`${viewMode}. ${pathText} Click a node to explore moves.`);
        return;
    }

    setGraphStatus(`${viewMode}. ${formatInteger(activeNodeCount())} nodes shown. ${pathText}`);
}

function graphModeLabel(mode) {
    switch (mode) {
        case GRAPH_MODE.EXPLORED:
            return "Visited states";
        case GRAPH_MODE.ALL:
            return "All states";
        case GRAPH_MODE.SOLUTION:
        default:
            return "Solution path";
    }
}

function setGraphStatus(message) {
    const status = document.getElementById("graphStatus");

    if (status) {
        status.textContent = message;
    }
}

function formatInteger(value) {
    return Number(value || 0).toLocaleString();
}

function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, value));
}

window.stateGraph = {
    load: loadStateGraph,
    clear: clearStateGraph,
    next: nextGraphMove,
    previous: previousGraphMove,
    setMode: setGraphDisplayMode,
};

window.addEventListener("resize", () => {
    graphState.backgroundKey = "";

    if (graphState.data) {
        fitGraphToCurrentMode();
    } else {
        resetGraphView();
    }
});

initialiseStateGraph();
