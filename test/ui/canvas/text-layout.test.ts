import { describe, it, expect, beforeAll } from "vitest";
import { paintNode } from "../../../src/ui/canvas/paint.ts";
import { canvasHost } from "../../../src/ui/canvas/host.ts";
import {
    CanvasNode,
    zeroBounds,
    type CanvasElementNode,
    type CanvasNode as CanvasNodeT,
} from "../../../src/ui/canvas/node.ts";

type Call = { fn: string; args: unknown[] };

function makeCtx(): { calls: Call[] } & Record<string, any> {
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

/**
 * Build a `<rect>` with a `<text>` child via `canvasHost.insert` so the
 * parent pointer + bounds are set the way the reconciler would set them in
 * production. Returns the rect (caller paints from there).
 */
function rectWithText(rectProps: Record<string, unknown>, textProps: Record<string, unknown>): CanvasElementNode {
    const rect = canvasHost.createElement("rect");
    for (const [k, v] of Object.entries(rectProps)) canvasHost.setProperty(rect, k, v);
    const text = canvasHost.createElement("text");
    for (const [k, v] of Object.entries(textProps)) canvasHost.setProperty(text, k, v);
    canvasHost.insert(rect, text);
    return rect;
}

function findFillText(ctx: ReturnType<typeof makeCtx>): { content: string; x: number; y: number } | null {
    const c = ctx.calls.find((c: Call) => c.fn === "fillText");
    if (!c) return null;
    return { content: c.args[0] as string, x: c.args[1] as number, y: c.args[2] as number };
}

describe("text layout positioning (Phase 5.2)", () => {
    describe("textAlign within a shape parent's bounds", () => {
        it('"left" anchors at parent.x + padding.left', () => {
            const rect = rectWithText(
                { x: 100, y: 0, width: 50, height: 20, fill: "white" },
                { content: "hi", fill: "black", textAlign: "left", padding: 5 },
            );
            const ctx = makeCtx();
            paintNode(ctx as any, rect);
            const ft = findFillText(ctx);
            expect(ft?.x).toBe(105); // 100 + 5
        });

        it('"center" anchors at parent.x + parent.width / 2', () => {
            const rect = rectWithText(
                { x: 100, y: 0, width: 50, height: 20, fill: "white" },
                { content: "hi", fill: "black", textAlign: "center" },
            );
            const ctx = makeCtx();
            paintNode(ctx as any, rect);
            const ft = findFillText(ctx);
            expect(ft?.x).toBe(125); // 100 + 25
        });

        it('"right" anchors at parent.x + parent.width - padding.right', () => {
            const rect = rectWithText(
                { x: 100, y: 0, width: 50, height: 20, fill: "white" },
                { content: "hi", fill: "black", textAlign: "right", padding: 5 },
            );
            const ctx = makeCtx();
            paintNode(ctx as any, rect);
            const ft = findFillText(ctx);
            expect(ft?.x).toBe(145); // 100 + 50 - 5
        });
    });

    describe("verticalAlign within a shape parent's bounds", () => {
        it('"top" baseline-offsets by fontSize from the top edge + padding', () => {
            const rect = rectWithText(
                { x: 0, y: 100, width: 50, height: 20, fill: "white" },
                { content: "hi", fill: "black", verticalAlign: "top", padding: 5, fontSize: 12 },
            );
            const ctx = makeCtx();
            paintNode(ctx as any, rect);
            const ft = findFillText(ctx);
            expect(ft?.y).toBe(117); // 100 + 5 + 12
        });

        it('"middle" sets ctx.textBaseline = "middle" and y = parent.y + parent.height / 2', () => {
            const rect = rectWithText(
                { x: 0, y: 100, width: 50, height: 40, fill: "white" },
                { content: "hi", fill: "black", verticalAlign: "middle" },
            );
            const ctx = makeCtx();
            paintNode(ctx as any, rect);
            const ft = findFillText(ctx);
            expect(ft?.y).toBe(120); // 100 + 20
            expect(ctx.textBaseline).toBe("middle");
        });

        it('"bottom" anchors at parent.y + parent.height - padding.bottom', () => {
            const rect = rectWithText(
                { x: 0, y: 100, width: 50, height: 20, fill: "white" },
                { content: "hi", fill: "black", verticalAlign: "bottom", padding: 3 },
            );
            const ctx = makeCtx();
            paintNode(ctx as any, rect);
            const ft = findFillText(ctx);
            expect(ft?.y).toBe(117); // 100 + 20 - 3
        });
    });

    describe("layout-prop inheritance through shape parent", () => {
        it("text inherits textAlign / padding directly from a shape parent's props", () => {
            const rect = canvasHost.createElement("rect");
            canvasHost.setProperty(rect, "x", 0);
            canvasHost.setProperty(rect, "y", 0);
            canvasHost.setProperty(rect, "width", 100);
            canvasHost.setProperty(rect, "height", 50);
            canvasHost.setProperty(rect, "textAlign", "center");
            const text = canvasHost.createElement("text");
            canvasHost.setProperty(text, "content", "label");
            canvasHost.setProperty(text, "fill", "black");
            canvasHost.insert(rect, text);

            const ctx = makeCtx();
            paintNode(ctx as any, rect);
            const ft = findFillText(ctx);
            expect(ft?.x).toBe(50); // centered: 0 + 100/2
            expect(ctx.textAlign).toBe("center");
        });
    });

    describe("text without a shape parent uses its own x/y", () => {
        it("standalone <text> uses its props.x and props.y directly", () => {
            const text = CanvasNode.Element({
                tag: "text",
                props: { content: "raw", x: 42, y: 17, fill: "black" },
                children: [],
                parent: null,
                bounds: zeroBounds(),
                zIndex: 0,
            });
            const ctx = makeCtx();
            paintNode(ctx as any, text);
            const ft = findFillText(ctx);
            expect(ft?.x).toBe(42);
            expect(ft?.y).toBe(17);
        });

        it("text under a <group> is treated as standalone (no layout fallback)", () => {
            const text = CanvasNode.Element({
                tag: "text",
                props: { content: "raw", x: 11, y: 22, fill: "black", textAlign: "center" },
                children: [],
                parent: null,
                bounds: zeroBounds(),
                zIndex: 0,
            });
            const group = CanvasNode.Element({
                tag: "group",
                props: {},
                children: [text],
                parent: null,
                bounds: zeroBounds(),
                zIndex: 0,
            });
            text.parent = group;

            const ctx = makeCtx();
            paintNode(ctx as any, group);
            const ft = findFillText(ctx);
            // Under a group, text falls back to its own x/y; layout props
            // still set ctx.textAlign but the position is (11, 22) verbatim.
            expect(ft?.x).toBe(11);
            expect(ft?.y).toBe(22);
        });
    });
});

// ===========================================================================
// Standalone unit checks against the rectWithText helper to make sure it
// reflects what canvasHost.insert actually does (defensive — guards against
// regressions in the helper itself).
// ===========================================================================

describe("rectWithText helper", () => {
    it("attaches the text element with its parent pointer set", () => {
        const rect = rectWithText(
            { x: 0, y: 0, width: 10, height: 10 },
            { content: "x" },
        );
        expect(rect.children).toHaveLength(1);
        const child = rect.children[0] as CanvasElementNode;
        expect(child.tag).toBe("text");
        expect(child.parent).toBe(rect);
    });

    it("populates the rect bounds via setProperty's geometry path", () => {
        const rect = rectWithText(
            { x: 5, y: 6, width: 7, height: 8 },
            { content: "x" },
        );
        expect(rect.bounds).toEqual({ x: 5, y: 6, width: 7, height: 8 });
    });
});

// Suppress unused-import warning for CanvasNodeT — kept for future expansion.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
type _Keep = CanvasNodeT;
