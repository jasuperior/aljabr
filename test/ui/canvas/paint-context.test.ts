import { describe, it, expect, beforeAll } from "vitest";
import { paintNode } from "../../../src/ui/canvas/paint.ts";
import {
    deriveContext,
    normalizePadding,
    rootPaintContext,
} from "../../../src/ui/canvas/paint-context.ts";
import { canvasHost } from "../../../src/ui/canvas/host.ts";
import {
    CanvasNode,
    zeroBounds,
    type CanvasElementNode,
    type CanvasNode as CanvasNodeT,
    type CanvasTag,
} from "../../../src/ui/canvas/node.ts";

// ---------------------------------------------------------------------------
// Recording mock — stripped down twin of paint.test.ts so tests stay
// independent.
// ---------------------------------------------------------------------------

type Call = { fn: string; args: unknown[] };

function makeCtx(): { calls: Call[]; fillStyle: string; strokeStyle: string; lineWidth: number; font: string } & Record<string, any> {
    const ctx: any = {
        calls: [], fillStyle: "", strokeStyle: "", lineWidth: 1,
        font: "", textAlign: "start", textBaseline: "alphabetic",
    };
    const record = (fn: string) => (...args: unknown[]) => ctx.calls.push({ fn, args });
    for (const fn of [
        "save", "restore", "translate", "rotate", "scale",
        "beginPath", "moveTo", "lineTo", "arc", "ellipse",
        "fill", "stroke", "fillRect", "strokeRect", "roundRect",
        "fillText", "strokeText",
    ]) {
        ctx[fn] = record(fn);
    }
    return ctx;
}

beforeAll(() => {
    if (typeof (globalThis as { Path2D?: unknown }).Path2D === "undefined") {
        class Path2DStub { constructor(public d?: string) {} }
        (globalThis as unknown as { Path2D: typeof Path2DStub }).Path2D = Path2DStub;
    }
});

// ---------------------------------------------------------------------------
// Helpers — build via the host so bounds match production behaviour.
// ---------------------------------------------------------------------------

function el(
    tag: CanvasTag,
    props: Record<string, unknown> = {},
    children: CanvasNodeT[] = [],
): CanvasElementNode {
    return CanvasNode.Element({
        tag, props, children,
        parent: null,
        bounds: zeroBounds(),
        zIndex: 0,
    });
}

/** Wire children → parent the way `canvasHost.insert` would. */
function attach(parent: CanvasElementNode, children: CanvasElementNode[]): CanvasElementNode {
    for (const child of children) {
        child.parent = parent;
    }
    parent.children = children as CanvasNodeT[];
    return parent;
}

// ===========================================================================
// Pure deriveContext / normalizePadding tests
// ===========================================================================

describe("PaintContext", () => {
    describe("rootPaintContext", () => {
        it("provides the documented defaults", () => {
            const c = rootPaintContext();
            expect(c.fontFamily).toBe("sans-serif");
            expect(c.fontSize).toBe(14);
            expect(c.fontWeight).toBe("normal");
            expect(c.fill).toBe("none");
            expect(c.stroke).toBe("none");
            expect(c.strokeWidth).toBe(1);
            expect(c.textAlign).toBe("left");
            expect(c.verticalAlign).toBe("top");
            expect(c.padding).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
        });
    });

    describe("normalizePadding", () => {
        it("expands a uniform number into all four sides", () => {
            expect(normalizePadding(8)).toEqual({ top: 8, right: 8, bottom: 8, left: 8 });
        });

        it("merges a partial object with zero defaults", () => {
            expect(normalizePadding({ top: 2, left: 4 })).toEqual({
                top: 2, right: 0, bottom: 0, left: 4,
            });
        });

        it("returns the zero rect for unsupported shapes", () => {
            expect(normalizePadding("nope")).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
            expect(normalizePadding(undefined)).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
        });
    });

    describe("deriveContext", () => {
        it("returns the parent unchanged when no inheritable key is overridden", () => {
            const root = rootPaintContext();
            const derived = deriveContext(root, { width: 100, x: 5 });
            expect(derived).toBe(root);
        });

        it("overrides only the keys present on props", () => {
            const root = rootPaintContext();
            const derived = deriveContext(root, { fill: "red", fontSize: 20 });
            expect(derived).not.toBe(root);
            expect(derived.fill).toBe("red");
            expect(derived.fontSize).toBe(20);
            expect(derived.fontFamily).toBe(root.fontFamily);
            expect(derived.stroke).toBe(root.stroke);
        });

        it("ignores invalid string-literal values for textAlign/verticalAlign", () => {
            const root = rootPaintContext();
            const derived = deriveContext(root, { textAlign: "justify", verticalAlign: "baseline" });
            expect(derived.textAlign).toBe("left");
            expect(derived.verticalAlign).toBe("top");
        });

        it("normalises padding shapes", () => {
            const root = rootPaintContext();
            const derived = deriveContext(root, { padding: 4 });
            expect(derived.padding).toEqual({ top: 4, right: 4, bottom: 4, left: 4 });
        });
    });
});

// ===========================================================================
// Inheritance through the paint pass
// ===========================================================================

describe("paint pass — inherited paint props", () => {
    it("a group's fill propagates to descendant rects", () => {
        const child = el("rect", { x: 0, y: 0, width: 1, height: 1 });
        const group = attach(el("group", { fill: "red" }), [child]);
        const ctx = makeCtx();
        paintNode(ctx as any, group);
        expect(ctx.fillStyle).toBe("red");
        expect(ctx.calls.some((c: Call) => c.fn === "fillRect")).toBe(true);
    });

    it("a child's own fill prop wins over the inherited group fill", () => {
        const child = el("rect", { x: 0, y: 0, width: 1, height: 1, fill: "blue" });
        const group = attach(el("group", { fill: "red" }), [child]);
        const ctx = makeCtx();
        paintNode(ctx as any, group);
        expect(ctx.fillStyle).toBe("blue");
    });

    it("nested groups override only the keys they touch", () => {
        const inner = attach(el("group", { stroke: "green" }), [
            el("rect", { x: 0, y: 0, width: 1, height: 1 }),
        ]);
        const outer = attach(el("group", { fill: "red" }), [inner]);
        const ctx = makeCtx();
        paintNode(ctx as any, outer);
        // The leaf rect inherits fill="red" from the outer group and
        // stroke="green" from the inner group.
        expect(ctx.fillStyle).toBe("red");
        expect(ctx.strokeStyle).toBe("green");
    });

    it("non-group elements do NOT propagate inheritable props", () => {
        // A <rect> setting `fill="red"` should NOT propagate into a wrapped
        // text child — the spec is explicit that only <group> is a context
        // boundary. The text inherits `fill="none"` from the root context
        // and therefore does not paint.
        const text = el("text", { content: "label" });
        text.parent = null; // explicit text element, no shape parent layout
        const rect = attach(el("rect", { x: 0, y: 0, width: 100, height: 50, fill: "red" }), [text]);
        const ctx = makeCtx();
        paintNode(ctx as any, rect);
        // The rect itself paints red. The text does not paint at all because
        // its resolved fill is the root default "none".
        expect(ctx.calls.some((c: Call) => c.fn === "fillRect")).toBe(true);
        expect(ctx.calls.some((c: Call) => c.fn === "fillText")).toBe(false);
    });

    it("group fontSize/fontFamily propagate into the resolved text font", () => {
        const text = el("text", { content: "hi", x: 0, y: 0, fill: "black" });
        const group = attach(el("group", { fontSize: 24, fontFamily: "Arial", fontWeight: "bold" }), [text]);
        const ctx = makeCtx();
        paintNode(ctx as any, group);
        expect(ctx.font).toBe("bold 24px Arial");
    });

    it("uses canvasHost-driven scene graph end-to-end", () => {
        const root = canvasHost.createElement("group");
        canvasHost.setProperty(root, "fill", "purple");
        const child = canvasHost.createElement("rect");
        canvasHost.setProperty(child, "x", 0);
        canvasHost.setProperty(child, "y", 0);
        canvasHost.setProperty(child, "width", 10);
        canvasHost.setProperty(child, "height", 10);
        canvasHost.insert(root, child);
        const ctx = makeCtx();
        paintNode(ctx as any, root);
        expect(ctx.fillStyle).toBe("purple");
    });
});
