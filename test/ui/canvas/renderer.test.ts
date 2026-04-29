import { describe, it, expect, beforeEach, afterEach, vi, beforeAll } from "vitest";
import { createCanvasRenderer } from "../../../src/ui/canvas/renderer.ts";
import { Viewport } from "../../../src/ui/canvas/viewport.ts";
import { view } from "../../../src/ui/view-node.ts";
import { Signal } from "../../../src/prelude/signal.ts";

// ---------------------------------------------------------------------------
// rAF queue — captures every requestAnimationFrame callback so tests can
// flush them deterministically. Vitest's Node environment has no rAF.
// ---------------------------------------------------------------------------

let rafQueue: Array<() => void> = [];

function flushRaf(): void {
    const queue = rafQueue;
    rafQueue = [];
    for (const cb of queue) cb();
}

beforeAll(() => {
    if (typeof (globalThis as { Path2D?: unknown }).Path2D === "undefined") {
        class Path2DStub { constructor(public d?: string) {} }
        (globalThis as unknown as { Path2D: typeof Path2DStub }).Path2D = Path2DStub;
    }
});

beforeEach(() => {
    rafQueue = [];
    vi.stubGlobal("requestAnimationFrame", (cb: () => void) => {
        rafQueue.push(cb);
        return rafQueue.length;
    });
});

afterEach(() => {
    vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// Mock canvas — exposes `width`/`height` and a `getContext("2d")` returning a
// recording context. The renderer reads this exact shape.
// ---------------------------------------------------------------------------

type Call = { fn: string; args: unknown[] };

function makeCtx(): { calls: Call[] } & Record<string, any> {
    const ctx: any = {
        calls: [] as Call[],
        fillStyle: "", strokeStyle: "", lineWidth: 1,
        font: "", textAlign: "start", textBaseline: "alphabetic",
    };
    const record = (fn: string) => (...args: unknown[]) => ctx.calls.push({ fn, args });
    for (const fn of [
        "save", "restore", "translate", "rotate", "scale",
        "beginPath", "moveTo", "lineTo", "arc", "ellipse",
        "fill", "stroke", "fillRect", "strokeRect", "roundRect",
        "fillText", "strokeText", "clearRect",
    ]) {
        ctx[fn] = record(fn);
    }
    return ctx;
}

function makeCanvas(width = 800, height = 600): { canvas: HTMLCanvasElement; ctx: ReturnType<typeof makeCtx> } {
    const ctx = makeCtx();
    const listeners = new Map<string, Set<(ev: Event) => void>>();
    const canvas = {
        width,
        height,
        getContext: (kind: string) => (kind === "2d" ? ctx : null),
        addEventListener(type: string, listener: (ev: Event) => void) {
            let set = listeners.get(type);
            if (!set) listeners.set(type, set = new Set());
            set.add(listener);
        },
        removeEventListener(type: string, listener: (ev: Event) => void) {
            listeners.get(type)?.delete(listener);
        },
    } as unknown as HTMLCanvasElement;
    return { canvas, ctx };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("createCanvasRenderer", () => {
    describe("initial paint", () => {
        it("clears the canvas and paints synchronously after mount", () => {
            const { canvas, ctx } = makeCanvas();
            const r = createCanvasRenderer(canvas);

            r.mount(() => view("rect", { x: 10, y: 10, width: 50, height: 50, fill: "red" }));

            const fns = ctx.calls.map((c: Call) => c.fn);
            expect(fns).toContain("clearRect");
            expect(fns).toContain("fillRect");
            // clearRect must precede the first paint operation.
            expect(fns.indexOf("clearRect")).toBeLessThan(fns.indexOf("fillRect"));
        });

        it("does not require a rAF tick for the initial paint", () => {
            const { canvas, ctx } = makeCanvas();
            const r = createCanvasRenderer(canvas);

            r.mount(() => view("rect", { x: 0, y: 0, width: 1, height: 1, fill: "red" }));
            expect(ctx.calls.some((c: Call) => c.fn === "fillRect")).toBe(true);
            // No rAF callbacks were queued by the initial mount.
            expect(rafQueue).toHaveLength(0);
        });

        it("throws when the canvas can't yield a 2d context", () => {
            const canvas = {
                width: 100,
                height: 100,
                getContext: () => null,
            } as unknown as HTMLCanvasElement;
            expect(() => createCanvasRenderer(canvas)).toThrow(/2d context/);
        });
    });

    describe("rAF protocol", () => {
        it("repaints on the next rAF tick after a reactive prop update", () => {
            const { canvas, ctx } = makeCanvas();
            const r = createCanvasRenderer(canvas);

            const fill = Signal.create<string>("red");
            r.mount(() => view("rect", {
                x: 0, y: 0, width: 1, height: 1,
                fill: () => fill.get() ?? "none",
            }));

            const initialFillCount = ctx.calls.filter((c: Call) => c.fn === "fillRect").length;

            // Mutate — this schedules a flush but does not paint synchronously.
            fill.set("blue");
            expect(rafQueue.length).toBeGreaterThan(0);
            const beforeFlush = ctx.calls.filter((c: Call) => c.fn === "fillRect").length;
            expect(beforeFlush).toBe(initialFillCount);

            // Drive the rAF callback — flush applies the prop, repaint emits a new fill.
            flushRaf();
            const afterFlush = ctx.calls.filter((c: Call) => c.fn === "fillRect").length;
            expect(afterFlush).toBeGreaterThan(initialFillCount);
        });

        it("clears before each repaint", () => {
            const { canvas, ctx } = makeCanvas();
            const r = createCanvasRenderer(canvas);

            const x = Signal.create<number>(0);
            r.mount(() => view("rect", {
                x: () => x.get() ?? 0,
                y: 0, width: 1, height: 1, fill: "red",
            }));

            const initialClears = ctx.calls.filter((c: Call) => c.fn === "clearRect").length;
            x.set(5);
            flushRaf();
            const afterClears = ctx.calls.filter((c: Call) => c.fn === "clearRect").length;
            expect(afterClears).toBeGreaterThan(initialClears);
        });

        it("coalesces multiple writes within a single rAF tick into one repaint", () => {
            const { canvas, ctx } = makeCanvas();
            const r = createCanvasRenderer(canvas);

            const x = Signal.create<number>(0);
            const y = Signal.create<number>(0);
            r.mount(() => view("rect", {
                x: () => x.get() ?? 0,
                y: () => y.get() ?? 0,
                width: 1, height: 1, fill: "red",
            }));

            const clearsAfterMount = ctx.calls.filter((c: Call) => c.fn === "clearRect").length;
            x.set(1);
            y.set(2);
            x.set(3);
            // Multiple writes — but the protocol queues a single rAF callback.
            expect(rafQueue.length).toBe(1);
            flushRaf();
            const clearsAfterFlush = ctx.calls.filter((c: Call) => c.fn === "clearRect").length;
            // Exactly one additional clear — confirms a single repaint.
            expect(clearsAfterFlush - clearsAfterMount).toBe(1);
        });
    });

    describe("unmount", () => {
        it("clears the canvas and stops responding to subsequent updates", () => {
            const { canvas, ctx } = makeCanvas();
            const r = createCanvasRenderer(canvas);

            const fill = Signal.create<string>("red");
            const unmount = r.mount(() => view("rect", {
                x: 0, y: 0, width: 1, height: 1,
                fill: () => fill.get() ?? "none",
            }));

            const fillsBeforeUnmount = ctx.calls.filter((c: Call) => c.fn === "fillRect").length;
            unmount();
            // Final clear emitted by the renderer itself.
            const clearsAfterUnmount = ctx.calls.filter((c: Call) => c.fn === "clearRect").length;
            expect(clearsAfterUnmount).toBeGreaterThan(0);

            // After unmount, mutations don't drive new fills — the reactive
            // owner is disposed.
            fill.set("blue");
            flushRaf();
            const fillsAfter = ctx.calls.filter((c: Call) => c.fn === "fillRect").length;
            expect(fillsAfter).toBe(fillsBeforeUnmount);
        });
    });

    describe("viewport integration", () => {
        it("threads viewport.bounds() into culling decisions", () => {
            const { canvas, ctx } = makeCanvas(100, 100);
            const vp = Viewport(canvas);
            const r = createCanvasRenderer(canvas, { viewport: vp });

            r.mount(() =>
                view("group", null,
                    view("rect", { x: 0, y: 0, width: 10, height: 10, fill: "near" }),
                    view("rect", { x: 5000, y: 5000, width: 10, height: 10, fill: "far" }),
                ),
            );

            // Only one rect is painted — the far rect culls.
            const fillRects = ctx.calls.filter((c: Call) => c.fn === "fillRect");
            expect(fillRects).toHaveLength(1);
        });

        it("paints both rects when no viewport is configured", () => {
            const { canvas, ctx } = makeCanvas(100, 100);
            const r = createCanvasRenderer(canvas);

            r.mount(() =>
                view("group", null,
                    view("rect", { x: 0, y: 0, width: 10, height: 10, fill: "near" }),
                    view("rect", { x: 5000, y: 5000, width: 10, height: 10, fill: "far" }),
                ),
            );

            const fillRects = ctx.calls.filter((c: Call) => c.fn === "fillRect");
            expect(fillRects).toHaveLength(2);
        });
    });
});
