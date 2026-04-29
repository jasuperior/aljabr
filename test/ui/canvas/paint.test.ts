import { describe, it, expect, beforeAll } from "vitest";
import { paintNode } from "../../../src/ui/canvas/paint.ts";
import {
    CanvasNode,
    zeroBounds,
    type CanvasElementNode,
    type CanvasNode as CanvasNodeT,
    type CanvasTag,
} from "../../../src/ui/canvas/node.ts";

// ---------------------------------------------------------------------------
// Recording mock for CanvasRenderingContext2D
//
// Vitest runs in a Node environment with no DOM; we record every method call
// (and a small set of state mutations) so the tests assert against an ordered
// transcript of canvas operations. Only the surface used by paint.ts is
// implemented — anything missing would surface as a "not a function" error
// rather than silently passing.
// ---------------------------------------------------------------------------

type Call = { fn: string; args: unknown[] };

interface MockCtx {
    calls: Call[];
    fillStyle: string;
    strokeStyle: string;
    lineWidth: number;
    lineCap: CanvasLineCap;
    font: string;
    textAlign: CanvasTextAlign;
    textBaseline: CanvasTextBaseline;

    save(): void;
    restore(): void;
    translate(x: number, y: number): void;
    rotate(angle: number): void;
    scale(x: number, y: number): void;
    beginPath(): void;
    moveTo(x: number, y: number): void;
    lineTo(x: number, y: number): void;
    arc(x: number, y: number, r: number, s: number, e: number): void;
    ellipse(
        x: number, y: number, rx: number, ry: number,
        rotation: number, s: number, e: number,
    ): void;
    fill(path?: Path2D): void;
    stroke(path?: Path2D): void;
    fillRect(x: number, y: number, w: number, h: number): void;
    strokeRect(x: number, y: number, w: number, h: number): void;
    roundRect(x: number, y: number, w: number, h: number, r: number): void;
    fillText(text: string, x: number, y: number): void;
    strokeText(text: string, x: number, y: number): void;
}

function makeCtx(): MockCtx {
    const ctx = {
        calls: [] as Call[],
        fillStyle: "",
        strokeStyle: "",
        lineWidth: 1,
        lineCap: "butt" as CanvasLineCap,
        font: "",
        textAlign: "start" as CanvasTextAlign,
        textBaseline: "alphabetic" as CanvasTextBaseline,
    } as MockCtx;

    const record = (fn: string) => (...args: unknown[]): void => {
        ctx.calls.push({ fn, args });
    };

    ctx.save = record("save");
    ctx.restore = record("restore");
    ctx.translate = record("translate") as MockCtx["translate"];
    ctx.rotate = record("rotate") as MockCtx["rotate"];
    ctx.scale = record("scale") as MockCtx["scale"];
    ctx.beginPath = record("beginPath");
    ctx.moveTo = record("moveTo") as MockCtx["moveTo"];
    ctx.lineTo = record("lineTo") as MockCtx["lineTo"];
    ctx.arc = record("arc") as MockCtx["arc"];
    ctx.ellipse = record("ellipse") as MockCtx["ellipse"];
    ctx.fill = record("fill") as MockCtx["fill"];
    ctx.stroke = record("stroke") as MockCtx["stroke"];
    ctx.fillRect = record("fillRect") as MockCtx["fillRect"];
    ctx.strokeRect = record("strokeRect") as MockCtx["strokeRect"];
    ctx.roundRect = record("roundRect") as MockCtx["roundRect"];
    ctx.fillText = record("fillText") as MockCtx["fillText"];
    ctx.strokeText = record("strokeText") as MockCtx["strokeText"];

    return ctx;
}

function paint(node: CanvasNodeT): MockCtx {
    const ctx = makeCtx();
    paintNode(ctx as unknown as CanvasRenderingContext2D, node);
    return ctx;
}

function fnsOf(ctx: MockCtx): string[] {
    return ctx.calls.map((c) => c.fn);
}

// ---------------------------------------------------------------------------
// Element/Text construction helpers
// ---------------------------------------------------------------------------

function el(
    tag: CanvasTag,
    props: Record<string, unknown> = {},
    children: CanvasNodeT[] = [],
    zIndex = 0,
): CanvasElementNode {
    return CanvasNode.Element({
        tag,
        props,
        children,
        parent: null,
        bounds: zeroBounds(),
        zIndex,
    });
}

beforeAll(() => {
    // Path2D is unused outside the `path` arm; provide a no-op shim that
    // records nothing — sufficient because the paint code only needs to
    // pass the instance back into `ctx.fill(path)` / `ctx.stroke(path)`.
    if (typeof (globalThis as { Path2D?: unknown }).Path2D === "undefined") {
        class Path2DStub {
            constructor(public d?: string) {}
        }
        (globalThis as unknown as { Path2D: typeof Path2DStub }).Path2D = Path2DStub;
    }
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("paintNode", () => {
    describe("Element wrapping", () => {
        it("wraps each Element in a save/restore pair", () => {
            const ctx = paint(el("rect", { fill: "red", x: 0, y: 0, width: 1, height: 1 }));
            expect(fnsOf(ctx)[0]).toBe("save");
            expect(fnsOf(ctx).at(-1)).toBe("restore");
        });

        it("does not paint Text variants", () => {
            const ctx = paint(CanvasNode.Text("hello"));
            expect(ctx.calls).toEqual([]);
        });

        it("recurses into element children", () => {
            const root = el("group", {}, [
                el("rect", { fill: "red", x: 0, y: 0, width: 1, height: 1 }),
                el("circle", { fill: "blue", cx: 0, cy: 0, r: 1 }),
            ]);
            const ctx = paint(root);
            expect(fnsOf(ctx)).toContain("fillRect");
            expect(fnsOf(ctx)).toContain("arc");
        });
    });

    describe("rect primitive", () => {
        it("emits fillRect when fill is set", () => {
            const ctx = paint(el("rect", { x: 1, y: 2, width: 3, height: 4, fill: "red" }));
            expect(ctx.calls).toContainEqual({ fn: "fillRect", args: [1, 2, 3, 4] });
            expect(ctx.fillStyle).toBe("red");
        });

        it("emits strokeRect when stroke is set", () => {
            const ctx = paint(el("rect", {
                x: 0, y: 0, width: 5, height: 5,
                stroke: "black", strokeWidth: 2,
            }));
            expect(ctx.calls).toContainEqual({ fn: "strokeRect", args: [0, 0, 5, 5] });
            expect(ctx.strokeStyle).toBe("black");
            expect(ctx.lineWidth).toBe(2);
        });

        it("skips fill when fill === \"none\"", () => {
            const ctx = paint(el("rect", {
                x: 0, y: 0, width: 1, height: 1, fill: "none", stroke: "black",
            }));
            expect(fnsOf(ctx)).not.toContain("fillRect");
            expect(fnsOf(ctx)).not.toContain("fill");
            expect(fnsOf(ctx)).toContain("strokeRect");
        });

        it("skips stroke when stroke === \"none\"", () => {
            const ctx = paint(el("rect", {
                x: 0, y: 0, width: 1, height: 1, fill: "red", stroke: "none",
            }));
            expect(fnsOf(ctx)).toContain("fillRect");
            expect(fnsOf(ctx)).not.toContain("strokeRect");
        });

        it("emits no paint when both fill and stroke default to \"none\"", () => {
            const ctx = paint(el("rect", { x: 0, y: 0, width: 1, height: 1 }));
            const ops = fnsOf(ctx).filter((n) => n !== "save" && n !== "restore");
            expect(ops).toEqual([]);
        });

        it("uses roundRect when rx > 0", () => {
            const ctx = paint(el("rect", {
                x: 0, y: 0, width: 10, height: 10, rx: 2, fill: "red",
            }));
            expect(fnsOf(ctx)).toContain("roundRect");
            expect(fnsOf(ctx)).toContain("fill");
            expect(fnsOf(ctx)).not.toContain("fillRect");
        });
    });

    describe("circle primitive", () => {
        it("emits arc with full circle and fills/strokes", () => {
            const ctx = paint(el("circle", {
                cx: 5, cy: 5, r: 3, fill: "red", stroke: "black",
            }));
            const arc = ctx.calls.find((c) => c.fn === "arc");
            expect(arc?.args).toEqual([5, 5, 3, 0, Math.PI * 2]);
            expect(fnsOf(ctx)).toContain("fill");
            expect(fnsOf(ctx)).toContain("stroke");
        });
    });

    describe("ellipse primitive", () => {
        it("emits ellipse with rx/ry", () => {
            const ctx = paint(el("ellipse", {
                cx: 0, cy: 0, rx: 4, ry: 2, fill: "red",
            }));
            const e = ctx.calls.find((c) => c.fn === "ellipse");
            expect(e?.args).toEqual([0, 0, 4, 2, 0, 0, Math.PI * 2]);
        });
    });

    describe("line primitive", () => {
        it("emits moveTo+lineTo+stroke", () => {
            const ctx = paint(el("line", {
                x1: 0, y1: 0, x2: 10, y2: 5, stroke: "black",
            }));
            const fns = fnsOf(ctx);
            expect(fns).toContain("moveTo");
            expect(fns).toContain("lineTo");
            expect(fns).toContain("stroke");
        });

        it("respects lineCap", () => {
            const ctx = paint(el("line", {
                x1: 0, y1: 0, x2: 1, y2: 1, stroke: "black", lineCap: "round",
            }));
            expect(ctx.lineCap).toBe("round");
        });
    });

    describe("path primitive", () => {
        it("constructs a Path2D from `d` and fills/strokes", () => {
            const ctx = paint(el("path", {
                d: "M0 0 L10 10", fill: "red", stroke: "black",
            }));
            const fillCall = ctx.calls.find((c) => c.fn === "fill");
            const strokeCall = ctx.calls.find((c) => c.fn === "stroke");
            expect(fillCall?.args[0]).toBeInstanceOf((globalThis as { Path2D: new (d?: string) => unknown }).Path2D);
            expect(strokeCall?.args[0]).toBeInstanceOf((globalThis as { Path2D: new (d?: string) => unknown }).Path2D);
        });
    });

    describe("text primitive", () => {
        it("sets font/align/baseline and emits fillText (verticalAlign drives baseline)", () => {
            const ctx = paint(el("text", {
                x: 1, y: 2, content: "hi",
                fontFamily: "Arial", fontSize: 16, fontWeight: "bold",
                fill: "black", textAlign: "center", verticalAlign: "middle",
            }));
            expect(ctx.font).toBe("bold 16px Arial");
            expect(ctx.textAlign).toBe("center");
            // Per the v0.3.8 spec, ctx.textBaseline is derived from
            // verticalAlign — "middle" → "middle", everything else → "alphabetic".
            expect(ctx.textBaseline).toBe("middle");
            expect(ctx.calls).toContainEqual({ fn: "fillText", args: ["hi", 1, 2] });
        });

        it("falls back to sans-serif/14px/normal when font props missing", () => {
            const ctx = paint(el("text", { x: 0, y: 0, content: "x", fill: "black" }));
            expect(ctx.font).toBe("normal 14px sans-serif");
        });

        it("emits strokeText when stroke is set", () => {
            const ctx = paint(el("text", {
                x: 0, y: 0, content: "x", stroke: "black",
            }));
            expect(fnsOf(ctx)).toContain("strokeText");
        });
    });

    describe("group transforms", () => {
        it("translates/rotates/scales before painting children", () => {
            const ctx = paint(el("group", { x: 10, y: 20, scale: 2, rotate: 90 }, [
                el("rect", { x: 0, y: 0, width: 1, height: 1, fill: "red" }),
            ]));
            const fns = fnsOf(ctx);
            const tIdx = fns.indexOf("translate");
            const rIdx = fns.indexOf("rotate");
            const sIdx = fns.indexOf("scale");
            const fillIdx = fns.indexOf("fillRect");

            expect(tIdx).toBeGreaterThan(-1);
            expect(rIdx).toBeGreaterThan(tIdx);
            expect(sIdx).toBeGreaterThan(rIdx);
            expect(fillIdx).toBeGreaterThan(sIdx);

            const translate = ctx.calls[tIdx];
            const rotate = ctx.calls[rIdx];
            const scale = ctx.calls[sIdx];
            expect(translate.args).toEqual([10, 20]);
            expect(rotate.args).toEqual([(90 * Math.PI) / 180]);
            expect(scale.args).toEqual([2, 2]);
        });

        it("defaults missing transform props (scale=1, others=0)", () => {
            const ctx = paint(el("group", {}, [
                el("rect", { x: 0, y: 0, width: 1, height: 1, fill: "red" }),
            ]));
            const tx = ctx.calls.find((c) => c.fn === "translate");
            const sx = ctx.calls.find((c) => c.fn === "scale");
            expect(tx?.args).toEqual([0, 0]);
            expect(sx?.args).toEqual([1, 1]);
        });

        it("does not apply transform props for non-group elements", () => {
            const ctx = paint(el("rect", {
                x: 5, y: 5, width: 1, height: 1, scale: 99, rotate: 45, fill: "red",
            }));
            expect(fnsOf(ctx)).not.toContain("translate");
            expect(fnsOf(ctx)).not.toContain("rotate");
            expect(fnsOf(ctx)).not.toContain("scale");
        });

        it("composes nested group transforms via save/restore", () => {
            const ctx = paint(el("group", { x: 10, y: 0 }, [
                el("group", { x: 5, y: 0 }, [
                    el("rect", { x: 0, y: 0, width: 1, height: 1, fill: "red" }),
                ]),
            ]));
            const fns = fnsOf(ctx);
            const saves = fns.filter((n) => n === "save").length;
            const restores = fns.filter((n) => n === "restore").length;
            expect(saves).toBe(3);
            expect(restores).toBe(3);
            const translates = ctx.calls.filter((c) => c.fn === "translate");
            expect(translates.map((c) => c.args)).toEqual([[10, 0], [5, 0]]);
        });
    });

    describe("zIndex sorting", () => {
        it("reorders children in place so lower zIndex paints first", () => {
            const back = el("rect", { x: 0, y: 0, width: 1, height: 1, fill: "back" }, [], 1);
            const front = el("rect", { x: 0, y: 0, width: 1, height: 1, fill: "front" }, [], 2);
            const deepest = el("rect", { x: 0, y: 0, width: 1, height: 1, fill: "deepest" }, [], 0);
            const root = el("group", {}, [back, front, deepest]);
            paint(root);
            expect(root.children).toEqual([deepest, back, front]);
        });

        it("preserves insertion order as a stable tiebreaker for equal zIndex", () => {
            const a = el("rect", { x: 0, y: 0, width: 1, height: 1, fill: "a" }, [], 0);
            const b = el("rect", { x: 0, y: 0, width: 1, height: 1, fill: "b" }, [], 0);
            const c = el("rect", { x: 0, y: 0, width: 1, height: 1, fill: "c" }, [], 0);
            const root = el("group", {}, [a, b, c]);
            paint(root);
            expect(root.children).toEqual([a, b, c]);
        });
    });
});
