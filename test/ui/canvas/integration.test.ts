/**
 * End-to-end integration through the public `aljabr/ui/canvas` surface.
 *
 * Each test reaches all the way from the JSX runtime (constructing
 * `ViewNode`s via `view`/`jsx`) through `createCanvasRenderer` (rAF
 * protocol, paint pass, viewport culling, hit-test, event dispatch). The
 * intent is to validate the *shape* of the public API one more time — if a
 * future change shifts an internal contract, these tests are the canary.
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";
import {
    createCanvasRenderer,
    Viewport,
    type CanvasSyntheticEvent,
} from "../../../src/ui/canvas/index.ts";
import { jsx, jsxs } from "../../../src/ui/canvas/jsx-runtime.ts";
import { Signal } from "../../../src/prelude/signal.ts";

// ---------------------------------------------------------------------------
// rAF + Path2D + canvas / ctx mocks
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
        "fillText", "strokeText", "clearRect",
    ]) {
        ctx[fn] = record(fn);
    }
    return ctx;
}

function makeCanvas(width = 200, height = 200): { canvas: HTMLCanvasElement; ctx: ReturnType<typeof makeCtx> } {
    const ctx = makeCtx();
    const listeners = new Map<string, Set<(ev: Event) => void>>();
    const canvas = {
        width, height,
        getContext: (kind: string) => (kind === "2d" ? ctx : null),
        addEventListener(type: string, listener: (ev: Event) => void) {
            let set = listeners.get(type);
            if (!set) listeners.set(type, set = new Set());
            set.add(listener);
        },
        removeEventListener(type: string, listener: (ev: Event) => void) {
            listeners.get(type)?.delete(listener);
        },
        dispatchEvent(ev: Event): boolean {
            listeners.get(ev.type)?.forEach((l) => l(ev));
            return true;
        },
    } as unknown as HTMLCanvasElement;
    return { canvas, ctx };
}

function fakeEvent(type: string, fields: Partial<MouseEvent> = {}): Event {
    const ev: any = {
        type, offsetX: 0, offsetY: 0,
        clientX: 0, clientY: 0,
        buttons: 0, button: 0,
        ctrlKey: false, shiftKey: false, altKey: false, metaKey: false,
        ...fields,
        defaultPrevented: false,
    };
    ev.preventDefault = () => { ev.defaultPrevented = true; };
    return ev as Event;
}

// ===========================================================================
// Tests
// ===========================================================================

describe("aljabr/ui/canvas — end-to-end via the public API", () => {
    it("paints a JSX tree built with jsx() through the public renderer", () => {
        const { canvas, ctx } = makeCanvas();
        const r = createCanvasRenderer(canvas);
        r.mount(() => jsx("rect", { x: 10, y: 10, width: 50, height: 50, fill: "red" }));

        expect(ctx.calls.some((c: Call) => c.fn === "clearRect")).toBe(true);
        expect(ctx.calls.some((c: Call) => c.fn === "fillRect")).toBe(true);
        expect(ctx.fillStyle).toBe("red");
    });

    it("propagates a group's fill into a descendant rect via JSX nesting", () => {
        const { canvas, ctx } = makeCanvas();
        const r = createCanvasRenderer(canvas);
        r.mount(() =>
            jsxs("group", {
                fill: "purple",
                children: [
                    jsx("rect", { x: 0, y: 0, width: 10, height: 10 }),
                ],
            }),
        );

        expect(ctx.fillStyle).toBe("purple");
    });

    it("centers wrapped label text inside a shape parent via layout props", () => {
        const { canvas, ctx } = makeCanvas();
        const r = createCanvasRenderer(canvas);
        r.mount(() =>
            jsx("rect", {
                x: 0, y: 0, width: 100, height: 40,
                textAlign: "center", verticalAlign: "middle",
                fill: "white",
                children: jsx("text", { content: "label", fill: "black" }),
            }),
        );

        const fillText = ctx.calls.find((c: Call) => c.fn === "fillText");
        expect(fillText).toBeDefined();
        expect(fillText?.args).toEqual(["label", 50, 20]); // (width/2, height/2)
        expect(ctx.textAlign).toBe("center");
        expect(ctx.textBaseline).toBe("middle");
    });

    it("re-paints on the next rAF tick after a Signal write reaches a JSX prop", () => {
        const { canvas, ctx } = makeCanvas();
        const r = createCanvasRenderer(canvas);

        const fill = Signal.create<string>("red");
        r.mount(() =>
            jsx("rect", {
                x: 0, y: 0, width: 10, height: 10,
                fill: () => fill.get() ?? "none",
            }),
        );

        const before = ctx.calls.filter((c: Call) => c.fn === "fillRect").length;
        fill.set("blue");
        flushRaf();
        const after = ctx.calls.filter((c: Call) => c.fn === "fillRect").length;
        expect(after).toBeGreaterThan(before);
        expect(ctx.fillStyle).toBe("blue");
    });

    it("culls off-screen children when a Viewport is configured", () => {
        const { canvas, ctx } = makeCanvas(100, 100);
        const vp = Viewport(canvas);
        const r = createCanvasRenderer(canvas, { viewport: vp });

        r.mount(() =>
            jsxs("group", {
                children: [
                    jsx("rect", { x: 0, y: 0, width: 10, height: 10, fill: "near" }),
                    jsx("rect", { x: 5000, y: 5000, width: 10, height: 10, fill: "far" }),
                ],
            }),
        );

        // Only the near rect paints; the far one culls.
        expect(ctx.calls.filter((c: Call) => c.fn === "fillRect")).toHaveLength(1);
    });

    it("dispatches a click that bubbles from rect → enclosing group", () => {
        const { canvas } = makeCanvas();
        const r = createCanvasRenderer(canvas);

        const log: string[] = [];
        r.mount(() =>
            jsxs("group", {
                onClick: () => log.push("group"),
                children: [
                    jsx("rect", {
                        x: 0, y: 0, width: 50, height: 50, fill: "red",
                        onClick: () => log.push("rect"),
                    }),
                ],
            }),
        );

        canvas.dispatchEvent(fakeEvent("click", { offsetX: 25, offsetY: 25 }));
        expect(log).toEqual(["rect", "group"]);
    });

    it("an onHitTest function on a path is honoured (and not invoked as a reactive getter)", () => {
        const { canvas } = makeCanvas();
        const r = createCanvasRenderer(canvas);

        const log: string[] = [];
        const onHitTest = (_x: number, _y: number): boolean => {
            log.push("hit-test");
            return false; // reject the hit
        };

        r.mount(() =>
            jsx("path", {
                d: "M0 0 L100 100",
                fill: "red",
                onClick: () => log.push("click"),
                onHitTest,
            }),
        );

        // Dispatch a click somewhere — onHitTest will be called, return
        // false, so the click never reaches the rect. log = ["hit-test"].
        canvas.dispatchEvent(fakeEvent("click", { offsetX: 50, offsetY: 50 }));
        // (path bounds are zeroBounds — non-cullable — so the hit-test
        // walker reaches it; onHitTest's `false` rejects.)
        expect(log).toContain("hit-test");
        expect(log).not.toContain("click");
    });

    it("listener teardown on unmount clears handlers and stops further dispatch", () => {
        const { canvas } = makeCanvas();
        const r = createCanvasRenderer(canvas);

        const log: number[] = [];
        const unmount = r.mount(() =>
            jsx("rect", {
                x: 0, y: 0, width: 50, height: 50, fill: "red",
                onClick: () => log.push(1),
            }),
        );

        canvas.dispatchEvent(fakeEvent("click", { offsetX: 10, offsetY: 10 }));
        expect(log).toEqual([1]);

        unmount();

        canvas.dispatchEvent(fakeEvent("click", { offsetX: 10, offsetY: 10 }));
        expect(log).toEqual([1]); // no new entry
    });
});
