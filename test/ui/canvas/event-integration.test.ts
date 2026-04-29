import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";
import { createCanvasRenderer } from "../../../src/ui/canvas/renderer.ts";
import { view } from "../../../src/ui/view-node.ts";
import type { CanvasSyntheticEvent } from "../../../src/ui/canvas/hit-test.ts";

// ---------------------------------------------------------------------------
// rAF stub — same pattern as renderer.test.ts. We don't need to drive the
// rAF queue in this file (mounts are static), but the mocked rAF prevents
// `createCanvasRenderer` from blowing up when the protocol fires.
// ---------------------------------------------------------------------------

beforeEach(() => {
    vi.stubGlobal("requestAnimationFrame", () => 0);
});

afterEach(() => {
    vi.unstubAllGlobals();
});

beforeAll(() => {
    if (typeof (globalThis as { Path2D?: unknown }).Path2D === "undefined") {
        class Path2DStub { constructor(public d?: string) {} }
        (globalThis as unknown as { Path2D: typeof Path2DStub }).Path2D = Path2DStub;
    }
});

// ---------------------------------------------------------------------------
// Mock canvas with a real EventTarget so dispatchEvent walks the listeners
// the renderer attached. The 2d context is a minimal recording stub; for
// these tests we only care about events, not pixels.
// ---------------------------------------------------------------------------

type Listener = (ev: Event) => void;

function makeCanvas(width = 200, height = 200): HTMLCanvasElement {
    const listeners = new Map<string, Set<Listener>>();
    const ctx = new Proxy({} as Record<string, unknown>, {
        get(target, key) {
            if (typeof key === "string" && !target[key]) target[key] = () => undefined;
            return target[key];
        },
    });
    const canvas = {
        width,
        height,
        getContext: (kind: string) => (kind === "2d" ? ctx : null),
        addEventListener(type: string, listener: Listener) {
            let set = listeners.get(type);
            if (!set) listeners.set(type, set = new Set());
            set.add(listener);
        },
        removeEventListener(type: string, listener: Listener) {
            listeners.get(type)?.delete(listener);
        },
        dispatchEvent(ev: Event) {
            listeners.get(ev.type)?.forEach((l) => l(ev));
            return true;
        },
        _listenerCounts(): Record<string, number> {
            const counts: Record<string, number> = {};
            for (const [type, set] of listeners) counts[type] = set.size;
            return counts;
        },
    };
    return canvas as unknown as HTMLCanvasElement;
}

function fakePointerEvent(type: string, fields: Partial<MouseEvent> = {}): Event {
    const ev: Record<string, unknown> = {
        type,
        offsetX: 10, offsetY: 10,
        clientX: 100, clientY: 100,
        buttons: 0, button: 0,
        ctrlKey: false, shiftKey: false, altKey: false, metaKey: false,
        ...fields,
        defaultPrevented: false,
    };
    ev.preventDefault = () => { ev.defaultPrevented = true; };
    return ev as unknown as Event;
}

// ===========================================================================
// Listener attachment / removal lifecycle
// ===========================================================================

describe("createCanvasRenderer — event listener lifecycle", () => {
    it("attaches listeners for every supported event type on mount", () => {
        const canvas = makeCanvas();
        const r = createCanvasRenderer(canvas);
        r.mount(() => view("rect", { x: 0, y: 0, width: 100, height: 100, fill: "red" }));

        const counts = (canvas as unknown as { _listenerCounts(): Record<string, number> })._listenerCounts();
        for (const type of [
            "pointerdown", "pointerup", "pointermove", "pointerenter", "pointerleave",
            "click", "dblclick", "contextmenu", "wheel",
        ]) {
            expect(counts[type]).toBe(1);
        }
    });

    it("removes every listener on unmount", () => {
        const canvas = makeCanvas();
        const r = createCanvasRenderer(canvas);
        const unmount = r.mount(() => view("rect", { x: 0, y: 0, width: 100, height: 100, fill: "red" }));

        unmount();

        const counts = (canvas as unknown as { _listenerCounts(): Record<string, number> })._listenerCounts();
        for (const type of [
            "pointerdown", "pointerup", "pointermove", "pointerenter", "pointerleave",
            "click", "dblclick", "contextmenu", "wheel",
        ]) {
            expect(counts[type] ?? 0).toBe(0);
        }
    });
});

// ===========================================================================
// End-to-end dispatch through the canvas DOM element
// ===========================================================================

describe("createCanvasRenderer — pointer event dispatch", () => {
    it("dispatches a click on a rect to its onClick handler", () => {
        const canvas = makeCanvas();
        const r = createCanvasRenderer(canvas);

        const calls: CanvasSyntheticEvent[] = [];
        r.mount(() => view("rect", {
            x: 5, y: 5, width: 50, height: 50, fill: "red",
            onClick: (e: CanvasSyntheticEvent) => calls.push(e),
        }));

        canvas.dispatchEvent(fakePointerEvent("click", { offsetX: 25, offsetY: 25 }));
        expect(calls).toHaveLength(1);
        expect(calls[0].offsetX).toBe(25);
    });

    it("a click outside the rect's bounds doesn't fire the handler", () => {
        const canvas = makeCanvas();
        const r = createCanvasRenderer(canvas);
        const calls: CanvasSyntheticEvent[] = [];
        r.mount(() => view("rect", {
            x: 5, y: 5, width: 50, height: 50, fill: "red",
            onClick: () => calls.push({} as CanvasSyntheticEvent),
        }));

        canvas.dispatchEvent(fakePointerEvent("click", { offsetX: 200, offsetY: 200 }));
        expect(calls).toHaveLength(0);
    });

    it("bubbles a click on a child rect through its parent group's onClick", () => {
        const canvas = makeCanvas();
        const r = createCanvasRenderer(canvas);

        const log: string[] = [];
        r.mount(() => view("group", { onClick: () => log.push("group") },
            view("rect", {
                x: 0, y: 0, width: 50, height: 50, fill: "red",
                onClick: () => log.push("rect"),
            }),
        ));

        canvas.dispatchEvent(fakePointerEvent("click", { offsetX: 25, offsetY: 25 }));
        expect(log).toEqual(["rect", "group"]);
    });

    it("stopPropagation halts the bubble before reaching ancestors", () => {
        const canvas = makeCanvas();
        const r = createCanvasRenderer(canvas);

        const log: string[] = [];
        r.mount(() => view("group", { onClick: () => log.push("group") },
            view("rect", {
                x: 0, y: 0, width: 50, height: 50, fill: "red",
                onClick: (e: CanvasSyntheticEvent) => {
                    log.push("rect");
                    e.stopPropagation();
                },
            }),
        ));

        canvas.dispatchEvent(fakePointerEvent("click", { offsetX: 25, offsetY: 25 }));
        expect(log).toEqual(["rect"]);
    });

    it("respects group transforms when hit-testing the click point", () => {
        const canvas = makeCanvas();
        const r = createCanvasRenderer(canvas);

        const calls: CanvasSyntheticEvent[] = [];
        r.mount(() => view("group", { x: 100, y: 100 },
            view("rect", {
                x: 0, y: 0, width: 50, height: 50, fill: "red",
                onClick: (e: CanvasSyntheticEvent) => calls.push(e),
            }),
        ));

        // (25, 25) lies before the translate — no hit.
        canvas.dispatchEvent(fakePointerEvent("click", { offsetX: 25, offsetY: 25 }));
        expect(calls).toHaveLength(0);

        // (125, 125) lies inside the post-translate rect — hit.
        canvas.dispatchEvent(fakePointerEvent("click", { offsetX: 125, offsetY: 125 }));
        expect(calls).toHaveLength(1);
    });

    it("forwards preventDefault on contextmenu through to the native event", () => {
        const canvas = makeCanvas();
        const r = createCanvasRenderer(canvas);

        r.mount(() => view("rect", {
            x: 0, y: 0, width: 50, height: 50, fill: "red",
            onContextMenu: (e: CanvasSyntheticEvent) => e.preventDefault(),
        }));

        const native = fakePointerEvent("contextmenu", { offsetX: 25, offsetY: 25 });
        canvas.dispatchEvent(native);
        expect((native as Event & { defaultPrevented: boolean }).defaultPrevented).toBe(true);
    });

    it("dispatches wheel events with deltaY on the synthetic event", () => {
        const canvas = makeCanvas();
        const r = createCanvasRenderer(canvas);

        const calls: CanvasSyntheticEvent[] = [];
        r.mount(() => view("rect", {
            x: 0, y: 0, width: 50, height: 50, fill: "red",
            onWheel: (e: CanvasSyntheticEvent) => calls.push(e),
        }));

        const native = fakePointerEvent("wheel", { offsetX: 25, offsetY: 25 });
        (native as unknown as { deltaY: number }).deltaY = -120;
        canvas.dispatchEvent(native);
        expect(calls).toHaveLength(1);
        expect(calls[0].deltaY).toBe(-120);
    });

    it("a click on empty canvas (no hit) is a no-op", () => {
        const canvas = makeCanvas();
        const r = createCanvasRenderer(canvas);

        // Mount nothing visible (a tiny rect far off-screen).
        r.mount(() => view("rect", {
            x: 1000, y: 1000, width: 1, height: 1, fill: "red",
            onClick: () => { throw new Error("should not fire"); },
        }));

        expect(() => {
            canvas.dispatchEvent(fakePointerEvent("click", { offsetX: 25, offsetY: 25 }));
        }).not.toThrow();
    });

    it("after unmount, dispatched events do not fire any handler", () => {
        const canvas = makeCanvas();
        const r = createCanvasRenderer(canvas);

        const calls: number[] = [];
        const unmount = r.mount(() => view("rect", {
            x: 0, y: 0, width: 50, height: 50, fill: "red",
            onClick: () => calls.push(1),
        }));

        canvas.dispatchEvent(fakePointerEvent("click", { offsetX: 25, offsetY: 25 }));
        expect(calls).toEqual([1]);

        unmount();
        canvas.dispatchEvent(fakePointerEvent("click", { offsetX: 25, offsetY: 25 }));
        expect(calls).toEqual([1]); // no new entry
    });
});
