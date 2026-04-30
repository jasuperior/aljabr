/** @jsxImportSource aljabr/ui/canvas */

import { union, match, type Union } from "aljabr";
import { RefArray, Signal } from "aljabr/prelude";
import {
    createCanvasRenderer,
    Viewport,
    type CanvasSyntheticEvent,
} from "aljabr/ui/canvas";

// ─── Domain: Tagged Union for Diagram Nodes ───────────────────────────────
const GraphNode = union({
    RectNode: (
        id: number,
        x: number,
        y: number,
        w: number,
        h: number,
        label: string,
    ) => ({ id, x, y, w, h, label }) as const,
    CircleNode: (
        id: number,
        cx: number,
        cy: number,
        r: number,
        label: string,
    ) => ({ id, cx, cy, r, label }) as const,
});
type GraphNode = Union<typeof GraphNode>;

interface Edge {
    fromId: number;
    toId: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────
function getNodeId(node: GraphNode): number {
    return match(node, {
        RectNode: (n) => n.id,
        CircleNode: (n) => n.id,
    });
}

function getCenter(node: GraphNode): { x: number; y: number } {
    return match(node, {
        RectNode: (n) => ({ x: n.x + n.w / 2, y: n.y + n.h / 2 }),
        CircleNode: (n) => ({ x: n.cx, y: n.cy }),
    });
}

function getOrigin(node: GraphNode): { x: number; y: number } {
    return match(node, {
        RectNode: (n) => n,
        CircleNode: (n) => ({ x: n.cx, y: n.cy }),
    });
}
// ─── Reactive State ───────────────────────────────────────────────────────
let nextId = 3;
const nodes = RefArray.create<GraphNode>([]);
const edges = RefArray.create<Edge>([]);
const selectedNodeId = Signal.create<number | null>(null);
const draggingNodeId = Signal.create<number | null>(null);
const dragOffset = Signal.create({ x: 0, y: 0 });

// Seed a few nodes and an edge
nodes.push(GraphNode.RectNode(1, 200, 200, 100, 60, "React"));
nodes.push(GraphNode.CircleNode(2, 450, 300, 40, "Signal"));
edges.push({ fromId: 1, toId: 2 });

// ─── Canvas & Viewport ────────────────────────────────────────────────────
const canvas = document.getElementById("diagram-canvas") as HTMLCanvasElement;
const vp = Viewport(canvas); // retained‑mode viewport with pan & zoom
const renderer = createCanvasRenderer(canvas, { viewport: vp });

// Zoom with wheel
canvas.addEventListener("wheel", (e) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    vp.scale.set((vp.scale.peek() ?? 1) * factor);
});

// Pan with secondary (right) mouse button or two‑finger drag handled by Viewport internals.
// Initial view: pan so (0,0) is visible
// vp.translation.set({ x: 0, y: 0 });
vp.x.set(0);
vp.y.set(0);
// ─── Drag Logic ───────────────────────────────────────────────────────────
function startDrag(e: CanvasSyntheticEvent, node: GraphNode) {
    const origin = getOrigin(node);
    const world = canvasToWorld(e);
    dragOffset.set({ x: world.x - origin.x, y: world.y - origin.y });
    draggingNodeId.set(getNodeId(node));
    selectedNodeId.set(getNodeId(node));
    e.stopPropagation();
}

function onDragMove(e: PointerEvent) {
    const id = draggingNodeId.get();
    if (id === null) return;
    const world = canvasToWorld(e);
    const off = dragOffset.get() ?? { x: 0, y: 0 };
    const index = nodes.findIndex((n) => getNodeId(n) === id);
    match(index, {
        Some: ({ value: index }) => {
            const node = nodes.get(index)!;
            const newPos = { x: world.x - off.x, y: world.y - off.y };
            // console.log(off);
            const updated = match(node, {
                RectNode: (n) =>
                    GraphNode.RectNode(
                        n.id,
                        newPos.x,
                        newPos.y,
                        n.w,
                        n.h,
                        n.label,
                    ),
                CircleNode: (n) =>
                    GraphNode.CircleNode(
                        n.id,
                        newPos.x,
                        newPos.y,
                        n.r,
                        n.label,
                    ),
            });
            nodes.set(index, updated);
        },
        None: () => undefined,
    });
}

function stopDrag() {
    draggingNodeId.set(null);
}

// Utility: convert event coordinates to world coordinates
function canvasToWorld(e: { clientX: number; clientY: number }) {
    const rect = canvas.getBoundingClientRect();
    const scale = vp.scale.get() ?? 1;
    const trans = { x: vp.x.get() ?? 0, y: vp.y.get() ?? 0 };
    const cssToCanvas = {
        x: canvas.width / rect.width,
        y: canvas.height / rect.height,
    };
    const pixelX = (e.clientX - rect.left) * cssToCanvas.x;
    const pixelY = (e.clientY - rect.top) * cssToCanvas.y;

    // viewport transform: world -> pixel = (world + trans) * scale
    // invert: world = pixel/scale - trans
    return { x: (pixelX - trans.x) / scale, y: (pixelY - trans.y) / scale };
}

// Attach global pointer listeners (needed when dragging outside a shape)
canvas.addEventListener("pointermove", onDragMove);
canvas.addEventListener("pointerup", stopDrag);
canvas.addEventListener("pointerleave", stopDrag); // safety

// ─── Components (Canvas JSX) ──────────────────────────────────────────────
function EdgeLine({ edge }: { edge: Edge }) {
    const centerCoord = (dir: "from" | "to", coord: "x" | "y") => () =>
        match(
            nodes.find((n) => getNodeId(n) === edge[`${dir}Id`]),
            {
                Some: ({ value }) => getCenter(value)[coord],
                None: () => 0,
            },
        );
    return (
        <line
            x1={centerCoord("from", "x")}
            y1={centerCoord("from", "y")}
            x2={centerCoord("to", "x")}
            y2={centerCoord("to", "y")}
            stroke="#94a3b8"
            strokeWidth={2}
        />
    );
}

function DiagramNode({ node }: { node: GraphNode }) {
    const id = getNodeId(node);
    const isSelected = () => selectedNodeId.get() === id;
    const fill = () => (isSelected() ? "#dbeafe" : "#f8fafc");
    const stroke = () => (isSelected() ? "#2563eb" : "#475569");

    // Build shape with label and hit‑tested pointer events
    return match(node, {
        RectNode: ({ x, y, w, h, label }) => (
            <rect
                x={x}
                y={y}
                width={w}
                height={h}
                rx={8}
                fill={fill}
                stroke={stroke}
                strokeWidth={1.5}
                textAlign="center"
                verticalAlign="middle"
                onPointerDown={(e) => startDrag(e, node)}
                onHitTest={(X, Y) =>
                    X >= x && X <= x + w && Y >= y && Y <= y + h
                }
            >
                {label}
            </rect>
        ),
        CircleNode: ({ cx, cy, r, label }) => (
            <circle
                cx={cx}
                cy={cy}
                r={r}
                fill={fill}
                stroke={stroke}
                strokeWidth={1.5}
                textAlign="center"
                verticalAlign="middle"
                onPointerDown={(e) => startDrag(e, node)}
                onHitTest={(x, y) => Math.hypot(x - cx, y - cy) <= r}
            >
                {label}
            </circle>
        ),
    });
}

function Scene() {
    // Map reactive arrays to JSX elements – changes to nodes/edges automatically re‑render these.
    const edgeElements = edges.map((edge) => <EdgeLine edge={edge} />);
    const nodeElements = nodes.map((node) => <DiagramNode node={node} />);

    return (
        <group x={vp.x} y={vp.y} scale={vp.scale} fill="#1e293b">
            {edgeElements}
            {nodeElements}
        </group>
    );
}

// Mount the reactive scene
renderer.mount(() => <Scene />);

// ─── Optional: Add nodes on double‑click (example of extending the demo) ──
canvas.addEventListener("dblclick", (e) => {
    const world = canvasToWorld(e);
    const id = nextId++;
    const newNode = GraphNode.RectNode(
        id,
        world.x - 50,
        world.y - 25,
        100,
        50,
        `Box ${id}`,
    );
    nodes.push(newNode);
    const selId = selectedNodeId.get();
    selectedNodeId.set(id);
    // Connect to last selected node if any
    console.log(edges);
    if (selId !== null && selId !== id) {
        edges.push({ fromId: selId, toId: id });
    }
});
