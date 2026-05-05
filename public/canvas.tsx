/** @jsxImportSource aljabr/ui/canvas */

import { union, match, type Union } from "aljabr";
import { List, Signal } from "aljabr/prelude";
import {
    createCanvasRenderer,
    Viewport,
    type CanvasSyntheticEvent,
} from "aljabr/ui/canvas";

// ─── Domain ───────────────────────────────────────────────────────────────

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

function getNodeId(node: GraphNode): number {
    return match(node, { RectNode: (n) => n.id, CircleNode: (n) => n.id });
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

// ─── Reactive State (module-level — persists across tab switches) ──────────

let nextId = 3;
const nodes = List.create<GraphNode>([]);
const edges = List.create<Edge>([]);
const selectedNodeId = Signal.create<number | null>(null);
const draggingNodeId = Signal.create<number | null>(null);
const dragOffset = Signal.create({ x: 0, y: 0 });

nodes.push(GraphNode.RectNode(1, 200, 200, 100, 60, "React"));
nodes.push(GraphNode.CircleNode(2, 450, 300, 40, "Signal"));
edges.push({ fromId: 1, toId: 2 });

// ─── Mount ────────────────────────────────────────────────────────────────

export function mountDiagram(canvasEl: HTMLCanvasElement): () => void {
    const vp = Viewport(canvasEl);
    const renderer = createCanvasRenderer(canvasEl, { viewport: vp });

    vp.x.set(0);
    vp.y.set(0);

    // ── Coordinate conversion ──────────────────────────────────────────────

    function canvasToWorld(e: { clientX: number; clientY: number }) {
        const rect = canvasEl.getBoundingClientRect();
        const scale = vp.scale.get() ?? 1;
        const tx = vp.x.get() ?? 0;
        const ty = vp.y.get() ?? 0;
        const cssToCanvas = {
            x: canvasEl.width / rect.width,
            y: canvasEl.height / rect.height,
        };
        const pixelX = (e.clientX - rect.left) * cssToCanvas.x;
        const pixelY = (e.clientY - rect.top) * cssToCanvas.y;
        return { x: (pixelX - tx) / scale, y: (pixelY - ty) / scale };
    }

    // ── Drag logic ────────────────────────────────────────────────────────

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

    // ── Components ────────────────────────────────────────────────────────

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
        const edgeElements = edges.map((edge) => <EdgeLine edge={edge} />);
        const nodeElements = nodes.map((node) => <DiagramNode node={node} />);
        return (
            <group x={vp.x} y={vp.y} scale={vp.scale} fill="#1e293b">
                {edgeElements}
                {nodeElements}
            </group>
        );
    }

    // ── Event listeners ───────────────────────────────────────────────────

    const onWheel = (e: WheelEvent) => {
        e.preventDefault();
        const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
        vp.scale.set((vp.scale.peek() ?? 1) * factor);
    };

    const onDblClick = (e: MouseEvent) => {
        const world = canvasToWorld(e);
        const id = nextId++;
        nodes.push(
            GraphNode.RectNode(
                id,
                world.x - 50,
                world.y - 25,
                100,
                50,
                `Box ${id}`,
            ),
        );
        const selId = selectedNodeId.get();
        selectedNodeId.set(id);
        if (selId !== null && selId !== id) {
            edges.push({ fromId: selId, toId: id });
        }
    };

    canvasEl.addEventListener("wheel", onWheel, { passive: false });
    canvasEl.addEventListener("pointermove", onDragMove);
    canvasEl.addEventListener("pointerup", stopDrag);
    canvasEl.addEventListener("pointerleave", stopDrag);
    canvasEl.addEventListener("dblclick", onDblClick);

    const unmount = renderer.mount(() => <Scene />);

    return () => {
        unmount();
        canvasEl.removeEventListener("wheel", onWheel);
        canvasEl.removeEventListener("pointermove", onDragMove);
        canvasEl.removeEventListener("pointerup", stopDrag);
        canvasEl.removeEventListener("pointerleave", stopDrag);
        canvasEl.removeEventListener("dblclick", onDblClick);
    };
}
