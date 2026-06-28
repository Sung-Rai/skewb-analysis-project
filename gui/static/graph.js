const GRAPH = {
    ringSpacing: 86,
    stackedLayerGap: 68,
    stackedYScale: 0.32,
    stackedMinRadius: 36,
    pathAngle: -Math.PI / 2,
    minScale: 0.18,
    maxScale: 5,
    exploredDotSize: 3.0,
    allDotSize: 2.2,
    solvedDotSize: 6,
    pathNodeSize: 7,
    currentNodeSize: 10,
    adjacentNodeSize: 6.5,
    adjacentRingSpread: Math.PI * 0.9,
    explorationFadeAlpha: 0.28,
};

const GRAPH_MODE = {
    SOLUTION: "solution",
    EXPLORED: "explored",
    ALL: "all",
};

const GRAPH_LAYOUT = {
    FLAT: "flat",
    STACKED: "stacked",
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
    moveExplorationActive: false,
    pathNodesByState: new Map(),
    explorationNodesByState: new Map(),
    exactNeighbourCache: new Map(),
    exactNeighbourRequests: new Set(),
    nodeDatasets: new Map(),
    progressIndex: 0,
    displayMode: GRAPH_MODE.SOLUTION,
    layoutMode: GRAPH_LAYOUT.STACKED,
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
    graphState.layoutMode = currentGraphLayout();
    graphState.pathNodes = layoutPathNodes(graphState.data.path || []);
    graphState.pathNodesByState = mapPathNodesByState(graphState.pathNodes);
    graphState.explorationNodesByState = new Map();
    graphState.exactNeighbourCache = new Map();
    graphState.exactNeighbourRequests = new Set();
    graphState.activeNode = null;
    graphState.moveExplorationActive = false;
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
    graphState.moveExplorationActive = false;
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

    const layoutSelect = document.getElementById("graphLayoutSelect");
    if (layoutSelect) {
        layoutSelect.addEventListener("change", event => {
            setGraphLayoutMode(event.target.value);
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
    const rings = activeRings();
    let nextHover = null;

    if (graphState.layoutMode === GRAPH_LAYOUT.STACKED) {
        let bestDistance = Infinity;

        for (const ring of rings) {
            const layerY = stackedLayerY(ring.depth);
            const distance = Math.abs(world.y - layerY);

            if (distance < bestDistance) {
                bestDistance = distance;
                nextHover = ring.depth;
            }
        }

        if (bestDistance > 20 / graphState.scale) {
            nextHover = null;
        }
    } else {
        const radius = Math.sqrt(world.x * world.x + world.y * world.y);
        const depth = Math.round(radius / GRAPH.ringSpacing);
        const ring = rings.find(item => item.depth === depth);
        const distance = Math.abs(radius - depth * GRAPH.ringSpacing);
        nextHover = ring && distance < 18 / graphState.scale ? depth : null;
    }

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

function currentGraphLayout() {
    const select = document.getElementById("graphLayoutSelect");
    return select ? select.value : GRAPH_LAYOUT.STACKED;
}

function setGraphLayoutMode(layout) {
    graphState.layoutMode = layout;
    graphState.nodeDatasets = new Map();
    relayoutInteractiveGraphNodes();

    if (graphState.data) {
        fitGraphToCurrentMode();
        updateGraphStatus();
        requestGraphRedraw();
    }
}

function relayoutInteractiveGraphNodes() {
    graphState.pathNodes = layoutPathNodes(graphState.data?.path || []);
    graphState.pathNodesByState = mapPathNodesByState(graphState.pathNodes);

    graphState.explorationNodesByState = new Map();
    graphState.adjacentEdges = layoutFocusedAdjacentEdges();
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
    graphState.offsetY = graphState.layoutMode === GRAPH_LAYOUT.STACKED
        ? size.height * 0.76
        : size.height / 2;
    requestGraphRedraw();
}

function fitGraphToCurrentMode() {
    const size = resizeGraphCanvases();
    const extents = graphWorldExtents();
    const usableX = size.width * 0.45;
    const usableY = size.height * 0.43;

    graphState.scale = clamp(
        Math.min(usableX / extents.width, usableY / extents.height),
        GRAPH.minScale,
        GRAPH.maxScale
    );

    graphState.offsetX = size.width / 2;
    graphState.offsetY = graphState.layoutMode === GRAPH_LAYOUT.STACKED
        ? size.height * 0.76
        : size.height / 2;
    requestGraphRedraw();
}

function graphWorldExtents() {
    const maxDepth = Math.max(
        1,
        ...activeRings().map(ring => ring.depth),
        ...graphState.pathNodes.map(node => node.depth),
        ...graphState.adjacentEdges.map(edge => edge.target.depth),
        focusedGraphNode()?.depth || 0
    );

    if (graphState.layoutMode === GRAPH_LAYOUT.STACKED) {
        const maxRadius = maxDepth * GRAPH.ringSpacing + 80;
        return {
            width: maxRadius,
            height: maxDepth * GRAPH.stackedLayerGap + maxRadius * GRAPH.stackedYScale + 90,
        };
    }

    const radius = maxDepth * GRAPH.ringSpacing + 80;
    return {
        width: radius,
        height: radius,
    };
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
        const position = hasExactLookupPosition(node)
            ? exactLookupNodePosition(node)
            : fallbackPathNodePosition(node, index, path.length);

        return {
            ...node,
            pathIndex: index,
            generation: 0,
            x: position.x,
            y: position.y,
        };
    });
}

function hasExactLookupPosition(node) {
    return Number.isFinite(node?.depth)
        && Number.isFinite(node?.rankInDepth)
        && Number.isFinite(node?.depthCount)
        && node.depthCount > 0;
}

function fallbackPathNodePosition(node, index, pathLength) {
    const count = Math.max(1, pathLength);
    const rank = Math.max(0, index);
    return graphPositionForDepthRank(node.depth, rank, count);
}

function graphPositionForDepthRank(depth, rank, count) {
    const safeDepth = Math.max(0, depth || 0);

    if (safeDepth <= 0) {
        return {x: 0, y: 0};
    }

    const safeCount = Math.max(1, count || 1);
    const angle = (2 * Math.PI * (rank + 0.5)) / safeCount;

    if (graphState.layoutMode === GRAPH_LAYOUT.STACKED) {
        return stackedGraphPosition(safeDepth, angle);
    }

    const radius = safeDepth * GRAPH.ringSpacing;
    return {
        x: radius * Math.cos(angle),
        y: radius * Math.sin(angle),
    };
}

function applyExactMetadataToNode(node, metadata, {updatePosition = true} = {}) {
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

    if (updatePosition && !node.positionLocked && hasExactLookupPosition(node)) {
        const position = exactLookupNodePosition(node);
        node.x = position.x;
        node.y = position.y;
    }
}

function exactLookupNodePosition(node) {
    const depth = Number.isFinite(node?.depth) ? node.depth : 0;
    const rank = Number.isFinite(node?.rankInDepth) ? node.rankInDepth : 0;
    const count = Number.isFinite(node?.depthCount) && node.depthCount > 0
        ? node.depthCount
        : 1;

    return graphPositionForDepthRank(depth, rank, count);
}

function stackedGraphPosition(depth, angle) {
    const radius = Math.max(GRAPH.stackedMinRadius, depth * GRAPH.ringSpacing);

    return {
        x: radius * Math.cos(angle),
        y: radius * Math.sin(angle) * GRAPH.stackedYScale + stackedLayerY(depth),
    };
}

function stackedLayerY(depth) {
    return -depth * GRAPH.stackedLayerGap;
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
        applyExactMetadataToNode(source, payload.state, {updatePosition: false});

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

function layoutExactAdjacentEdgesForNode(source, neighbourData) {
    if (!neighbourData || !Array.isArray(neighbourData.neighbours)) {
        return [];
    }

    if (neighbourData.state) {
        applyExactMetadataToNode(source, neighbourData.state, {updatePosition: false});
    }

    const edges = neighbourData.neighbours.map(neighbour => {
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
            applyExactMetadataToNode(existingNode, neighbour, {updatePosition: !existingNode.positionLocked});
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

    return applyAdjacentFanLayout(source, edges);
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


function applyAdjacentFanLayout(source, edges) {
    const branchEdges = edges
        .filter(edge => edge.kind === "branch")
        .sort(compareAdjacentEdges);

    const depthGroups = new Map();

    for (const edge of branchEdges) {
        const depth = Math.max(0, edge.target.depth || 0);

        if (!depthGroups.has(depth)) {
            depthGroups.set(depth, []);
        }

        depthGroups.get(depth).push(edge);
    }

    for (const group of depthGroups.values()) {
        layoutAdjacentRingGroup(source, group);
    }

    return edges;
}

function compareAdjacentEdges(first, second) {
    const firstDepth = first.target.depth || 0;
    const secondDepth = second.target.depth || 0;

    if (firstDepth !== secondDepth) {
        return firstDepth - secondDepth;
    }

    return GRAPH_MOVE_NAMES.indexOf(first.move) - GRAPH_MOVE_NAMES.indexOf(second.move);
}

function layoutAdjacentRingGroup(source, edges) {
    const count = Math.max(1, edges.length);
    const centreAngle = adjacentRingCentreAngle(source, edges[0]?.target?.depth || source.depth || 0);
    const spread = adjacentRingSpread(count);

    edges.forEach((edge, index) => {
        const angle = count === 1
            ? centreAngle
            : centreAngle + (index / (count - 1) - 0.5) * spread;

        const position = positionForDepthAndAngle(edge.target.depth || 0, angle);
        edge.target.x = position.x;
        edge.target.y = position.y;
        edge.target.positionLocked = true;
        edge.ringIndex = index;
        edge.ringCount = count;
    });
}

function adjacentRingCentreAngle(source, targetDepth) {
    if ((targetDepth || 0) <= 0) {
        return GRAPH.pathAngle;
    }

    if ((source.depth || 0) <= 0) {
        return GRAPH.pathAngle;
    }

    return Math.atan2(source.y - stackedLayerY(source.depth || 0), source.x || 0);
}

function adjacentRingSpread(count) {
    if (count <= 1) {
        return 0;
    }

    return Math.min(
        Math.PI * 1.65,
        Math.PI * 0.35 + count * 0.22
    );
}

function positionForDepthAndAngle(depth, angle) {
    const safeDepth = Math.max(0, depth || 0);

    if (safeDepth <= 0) {
        return {x: 0, y: 0};
    }

    if (graphState.layoutMode === GRAPH_LAYOUT.STACKED) {
        return stackedGraphPosition(safeDepth, angle);
    }

    const radius = safeDepth * GRAPH.ringSpacing;
    return {
        x: radius * Math.cos(angle),
        y: radius * Math.sin(angle),
    };
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
        graphState.moveExplorationActive = false;
        requestGraphRedraw();
        return;
    }

    graphState.moveExplorationActive = true;

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
    const cacheKey = `${mode}:${graphState.layoutMode}:${graphState.data?.type || "none"}:${activeNodeCount()}`;

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
    return graphPositionForDepthRank(depth, index, count);
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


function backgroundCloudAlphaFactor() {
    return graphState.moveExplorationActive ? GRAPH.explorationFadeAlpha : 1;
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

    const alphaFactor = backgroundCloudAlphaFactor();
    const color = dataset.mode === GRAPH_MODE.ALL
        ? [0.650, 0.790, 1.000, 0.62 * alphaFactor]
        : [1.000, 0.690, 0.360, 0.78 * alphaFactor];

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
    const alphaFactor = backgroundCloudAlphaFactor();
    context.fillStyle = dataset.mode === GRAPH_MODE.ALL
        ? `rgba(166, 202, 255, ${0.56 * alphaFactor})`
        : `rgba(255, 176, 92, ${0.70 * alphaFactor})`;

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
        const depth = ring.depth;
        const isHovered = graphState.hoveredRingDepth === depth;
        const isPathRing = pathDepths.has(depth);

        context.beginPath();

        if (graphState.layoutMode === GRAPH_LAYOUT.STACKED && depth > 0) {
            const radius = Math.max(GRAPH.stackedMinRadius, depth * GRAPH.ringSpacing);
            context.ellipse(
                0,
                stackedLayerY(depth),
                radius,
                radius * GRAPH.stackedYScale,
                0,
                0,
                Math.PI * 2
            );
        } else {
            const radius = depth * GRAPH.ringSpacing;
            context.arc(0, 0, radius, 0, Math.PI * 2);
        }

        context.strokeStyle = depth === 0
            ? "rgba(134, 239, 172, 0.9)"
            : isHovered
                ? "rgba(249, 250, 251, 0.65)"
                : isPathRing
                    ? "rgba(96, 165, 250, 0.42)"
                    : "rgba(148, 163, 184, 0.18)";
        context.lineWidth = depth === 0 || isHovered ? 3 / graphState.scale : 1 / graphState.scale;
        context.stroke();

        if (depth > 0 && graphState.scale > 0.35) {
            const label = ringLabelPosition(depth);
            context.fillStyle = "rgba(209, 213, 219, 0.8)";
            context.font = `${12 / graphState.scale}px Arial, Helvetica, sans-serif`;
            context.fillText(`d${depth}`, label.x, label.y);
        }
    }
}

function ringLabelPosition(depth) {
    if (graphState.layoutMode === GRAPH_LAYOUT.STACKED) {
        const radius = Math.max(GRAPH.stackedMinRadius, depth * GRAPH.ringSpacing);
        return {
            x: radius + 8 / graphState.scale,
            y: stackedLayerY(depth) - 6 / graphState.scale,
        };
    }

    const radius = depth * GRAPH.ringSpacing;
    return {
        x: radius + 8 / graphState.scale,
        y: -6 / graphState.scale,
    };
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

    edges.forEach(edge => {
        drawStraightMoveEdge(context, edge);
    });

    edges.forEach(edge => {
        const isPathTarget = edge.kind === "return" || edge.kind === "path";
        const radius = GRAPH.adjacentNodeSize / graphState.scale;
        const fill = isPathTarget
            ? "#86efac"
            : "#fb923c";
        const halo = isPathTarget
            ? "rgba(134, 239, 172, 0.22)"
            : "rgba(251, 146, 60, 0.28)";

        drawHaloedCircle(
            context,
            edge.target.x,
            edge.target.y,
            radius,
            fill,
            "rgba(15, 23, 42, 0.95)",
            halo,
            radius * 2.25
        );

        if (graphState.scale > 0.34) {
            const label = edgeLabelPosition(edge);
            drawGraphLabel(
                context,
                edge.move,
                label.x,
                label.y,
                "rgba(255, 237, 213, 0.98)",
                11
            );
        }
    });

    context.restore();
}

function drawStraightMoveEdge(context, edge) {
    const isPathTarget = edge.kind === "return" || edge.kind === "path";

    context.beginPath();
    context.moveTo(edge.source.x, edge.source.y);
    context.lineTo(edge.target.x, edge.target.y);
    context.strokeStyle = isPathTarget
        ? "rgba(134, 239, 172, 0.50)"
        : "rgba(251, 146, 60, 0.62)";
    context.lineWidth = (isPathTarget ? 2.1 : 1.9) / graphState.scale;
    context.stroke();
}

function edgeLabelPosition(edge) {
    return {
        x: (edge.source.x + edge.target.x) / 2 + 4 / graphState.scale,
        y: (edge.source.y + edge.target.y) / 2 - 4 / graphState.scale,
    };
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
        context.strokeStyle = "rgba(15, 23, 42, 0.78)";
        context.lineWidth = (completed ? 9 : 7) / graphState.scale;
        context.stroke();

        context.beginPath();
        context.moveTo(from.x, from.y);
        context.lineTo(to.x, to.y);
        context.strokeStyle = completed
            ? "rgba(134, 239, 172, 0.98)"
            : "rgba(96, 165, 250, 0.88)";
        context.lineWidth = (completed ? 5.8 : 4.2) / graphState.scale;
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
        const fill = isSolved
            ? "#86efac"
            : isCurrent
                ? "#fef08a"
                : "#60a5fa";
        const halo = isSolved
            ? "rgba(134, 239, 172, 0.28)"
            : isCurrent
                ? "rgba(254, 240, 138, 0.32)"
                : "rgba(96, 165, 250, 0.24)";

        drawHaloedCircle(
            context,
            node.x,
            node.y,
            radius,
            fill,
            "#111827",
            halo,
            radius * (isCurrent ? 2.35 : 2.0)
        );

        if (node.moveToNext && index < nodes.length - 1 && graphState.scale > 0.34) {
            const next = nodes[index + 1];
            const midX = (node.x + next.x) / 2;
            const midY = (node.y + next.y) / 2;
            drawGraphLabel(
                context,
                node.moveToNext,
                midX + 8 / graphState.scale,
                midY - 8 / graphState.scale,
                "rgba(249, 250, 251, 0.96)",
                13
            );
        }
    }
}


function drawFocusedExplorationNode(context) {
    const node = graphState.activeNode;

    if (!node) {
        return;
    }

    const radius = GRAPH.currentNodeSize / graphState.scale;

    drawHaloedCircle(
        context,
        node.x,
        node.y,
        radius,
        "#fef08a",
        "#111827",
        "rgba(254, 240, 138, 0.36)",
        radius * 2.55
    );

    if (graphState.scale > 0.42) {
        drawGraphLabel(
            context,
            "current",
            node.x + 10 / graphState.scale,
            node.y - 10 / graphState.scale,
            "rgba(254, 240, 138, 0.98)",
            12
        );
    }
}

function drawHaloedCircle(context, x, y, radius, fillStyle, strokeStyle, haloStyle, haloRadius) {
    context.beginPath();
    context.arc(x, y, haloRadius, 0, Math.PI * 2);
    context.fillStyle = haloStyle;
    context.fill();

    context.beginPath();
    context.arc(x, y, radius * 1.28, 0, Math.PI * 2);
    context.fillStyle = "rgba(15, 23, 42, 0.88)";
    context.fill();

    context.beginPath();
    context.arc(x, y, radius, 0, Math.PI * 2);
    context.fillStyle = fillStyle;
    context.fill();
    context.strokeStyle = strokeStyle;
    context.lineWidth = 2 / graphState.scale;
    context.stroke();
}

function drawGraphLabel(context, text, x, y, fillStyle, size) {
    context.save();
    context.font = `${size / graphState.scale}px Arial, Helvetica, sans-serif`;
    const paddingX = 4 / graphState.scale;
    const paddingY = 3 / graphState.scale;
    const metrics = context.measureText(text);
    const width = metrics.width + paddingX * 2;
    const height = (size + 4) / graphState.scale;

    roundedRect(
        context,
        x - paddingX,
        y - height + paddingY,
        width,
        height,
        5 / graphState.scale
    );
    context.fillStyle = "rgba(15, 23, 42, 0.72)";
    context.fill();

    context.fillStyle = fillStyle;
    context.fillText(text, x, y);
    context.restore();
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
    context.fillText(`${graphModeLabel(graphState.displayMode)} · ${graphLayoutLabel(graphState.layoutMode)}`, 30, 42);

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
    graphState.moveExplorationActive = false;
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
    graphState.moveExplorationActive = false;
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
    const layoutText = graphLayoutLabel(graphState.layoutMode);
    const pathText = nextMove
        ? `Next move: ${nextMove}.`
        : "Solved.";

    if (graphState.displayMode === GRAPH_MODE.SOLUTION) {
        setGraphStatus(`${viewMode} · ${layoutText}. ${pathText} Click a node to explore moves.`);
        return;
    }

    setGraphStatus(`${viewMode} · ${layoutText}. ${formatInteger(activeNodeCount())} nodes shown. ${pathText}`);
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

function graphLayoutLabel(layout) {
    return layout === GRAPH_LAYOUT.FLAT ? "Flat" : "Stacked";
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
    setLayout: setGraphLayoutMode,
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
