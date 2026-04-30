import { describe, it, expect, beforeAll } from "vitest";
import { paintNode } from "../../../src/ui/canvas/paint.ts";
import { canvasHost } from "../../../src/ui/canvas/host.ts";
import {
    CanvasNode,
    zeroBounds,
    type CanvasBounds,
    type CanvasElementNode,
    type CanvasNode as CanvasNodeT,
    type CanvasTag,
} from "../../../src/ui/canvas/node.ts";

// ---------------------------------------------------------------------------
// Lightweight context mock — same shape as paint.test.ts but inline so the
// two suites stay independent.
// ---------------------------------------------------------------------------

type Call = { fn: string; args: unknown[] };

function makeCtx(): { calls: Call[] } & Record<string, any> {
    const ctx: any = {
        calls: [] as Call[],
        fillStyle: "",
        strokeStyle: "",
        lineWidth: 1,
        font: "",
        textAlign: "start",
        textBaseline: "alphabetic",
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
// Helpers — build elements via the host so `bounds` is computed for real,
// matching how the reconciler would populate them in production.
// ---------------------------------------------------------------------------

function rect(x: number, y: number, w: number, h: number, fill = "red"): CanvasElementNode {
    const r = canvasHost.createElement("rect");
    canvasHost.setProperty(r, "x", x);
    canvasHost.setProperty(r, "y", y);
    canvasHost.setProperty(r, "width", w);
    canvasHost.setProperty(r, "height", h);
    canvasHost.setProperty(r, "fill", fill);
    return r;
}

function elNode(
    tag: CanvasTag,
    children: CanvasNodeT[] = [],
    props: Record<string, unknown> = {},
): CanvasElementNode {
    return CanvasNode.Element({
        tag,
        props,
        children,
        parent: null,
        bounds: zeroBounds(),
        zIndex: 0,
    });
}

function viewport(b: CanvasBounds): CanvasBounds {
    return b;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("paintNode viewport culling", () => {
    it("paints a node whose bounds intersect the viewport", () => {
        const ctx = makeCtx();
        paintNode(ctx as any, rect(10, 10, 50, 50), viewport({ x: 0, y: 0, width: 100, height: 100 }));
        expect(ctx.calls.some((c: Call) => c.fn === "fillRect")).toBe(true);
    });

    it("skips a node whose bounds do not intersect the viewport", () => {
        const ctx = makeCtx();
        paintNode(ctx as any, rect(500, 500, 10, 10), viewport({ x: 0, y: 0, width: 100, height: 100 }));
        // Subtree skipped entirely — no save/restore, no fill.
        expect(ctx.calls).toEqual([]);
    });

    it("includes a node whose edge touches the viewport", () => {
        const ctx = makeCtx();
        // Rect at (100,0)-(150,50); viewport at (0,0)-(100,100). Touching x=100.
        paintNode(ctx as any, rect(100, 0, 50, 50), viewport({ x: 0, y: 0, width: 100, height: 100 }));
        expect(ctx.calls.some((c: Call) => c.fn === "fillRect")).toBe(true);
    });

    it("paints everything when no viewport bounds are provided", () => {
        const ctx = makeCtx();
        paintNode(ctx as any, rect(10000, 10000, 10, 10));
        expect(ctx.calls.some((c: Call) => c.fn === "fillRect")).toBe(true);
    });

    it("recurses into a group whose own bounds are zero (always paints groups)", () => {
        const onScreen = rect(0, 0, 10, 10);
        const offScreen = rect(500, 500, 10, 10);
        const root = elNode("group", [onScreen, offScreen]);
        const ctx = makeCtx();
        paintNode(ctx as any, root, viewport({ x: 0, y: 0, width: 100, height: 100 }));
        // The group is recursed into (zero bounds → always paint), and inside
        // it the on-screen rect paints while the off-screen rect culls.
        expect(ctx.calls.filter((c: Call) => c.fn === "fillRect")).toHaveLength(1);
    });

    it("paints `path` elements regardless of viewport (zero bounds → always paint)", () => {
        const path = canvasHost.createElement("path");
        canvasHost.setProperty(path, "d", "M0 0 L10 10");
        canvasHost.setProperty(path, "fill", "red");
        const ctx = makeCtx();
        paintNode(ctx as any, path, viewport({ x: 1000, y: 1000, width: 10, height: 10 }));
        // Path always paints (no real bounds parser yet).
        expect(ctx.calls.some((c: Call) => c.fn === "fill")).toBe(true);
    });

    it("culls the entire subtree of an Element that doesn't intersect", () => {
        const offScreen = rect(500, 500, 100, 100);
        const child = rect(0, 0, 10, 10); // would be visible if reached
        offScreen.children.push(child);
        child.parent = offScreen;
        const ctx = makeCtx();
        paintNode(ctx as any, offScreen, viewport({ x: 0, y: 0, width: 100, height: 100 }));
        // Outer rect culls — its child is unreachable even though its own
        // bounds would intersect the viewport.
        expect(ctx.calls).toEqual([]);
    });
});
