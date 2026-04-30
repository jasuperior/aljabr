import { describe, it, expect } from "vitest";
import { hitTest, bubbleEvent, type CanvasSyntheticEvent } from "../../../src/ui/canvas/hit-test.ts";
import { canvasHost } from "../../../src/ui/canvas/host.ts";
import {
    CanvasNode,
    zeroBounds,
    type CanvasElementNode,
    type CanvasTag,
} from "../../../src/ui/canvas/node.ts";

// ---------------------------------------------------------------------------
// Helpers — build elements via the host so bounds reflect production paths.
// ---------------------------------------------------------------------------

function rect(x: number, y: number, w: number, h: number): CanvasElementNode {
    const r = canvasHost.createElement("rect");
    canvasHost.setProperty(r, "x", x);
    canvasHost.setProperty(r, "y", y);
    canvasHost.setProperty(r, "width", w);
    canvasHost.setProperty(r, "height", h);
    return r;
}

function group(props: Record<string, unknown> = {}): CanvasElementNode {
    const g = canvasHost.createElement("group");
    for (const [k, v] of Object.entries(props)) canvasHost.setProperty(g, k, v);
    return g;
}

function bareEl(tag: CanvasTag, props: Record<string, unknown> = {}): CanvasElementNode {
    return CanvasNode.Element({
        tag, props, children: [],
        parent: null, bounds: zeroBounds(), zIndex: 0,
    });
}

// ===========================================================================
// hitTest — bounding box, transforms, reverse paint order, onHitTest override
// ===========================================================================

describe("hitTest", () => {
    describe("bounding-box at the root", () => {
        it("returns the element when the point is inside its bounds", () => {
            const r = rect(10, 10, 50, 50);
            expect(hitTest(r, 30, 30)).toBe(r);
        });

        it("returns null when the point is outside the bounds", () => {
            const r = rect(10, 10, 50, 50);
            expect(hitTest(r, 5, 5)).toBeNull();
            expect(hitTest(r, 100, 100)).toBeNull();
        });

        it("includes touching edges (the contains check is inclusive)", () => {
            const r = rect(10, 10, 50, 50);
            expect(hitTest(r, 10, 10)).toBe(r); // top-left corner
            expect(hitTest(r, 60, 60)).toBe(r); // bottom-right corner
        });
    });

    describe("group transforms", () => {
        it("applies a parent group's translate to inverse-resolve children", () => {
            const child = rect(0, 0, 10, 10); // local (0,0)-(10,10)
            const g = group({ x: 100, y: 100 });
            canvasHost.insert(g, child);

            // After translate(100, 100), the child paints at screen (100,100)-(110,110).
            expect(hitTest(g, 105, 105)).toBe(child);
            expect(hitTest(g, 50, 50)).toBeNull();
        });

        it("applies a parent group's scale", () => {
            const child = rect(0, 0, 10, 10);
            const g = group({ scale: 2 });
            canvasHost.insert(g, child);

            // After scale(2), the child paints at screen (0,0)-(20,20).
            expect(hitTest(g, 15, 15)).toBe(child);
            expect(hitTest(g, 25, 25)).toBeNull();
        });

        it("composes nested group transforms", () => {
            const child = rect(0, 0, 10, 10);
            const inner = group({ x: 50, y: 0 });
            canvasHost.insert(inner, child);
            const outer = group({ x: 100, y: 0 });
            canvasHost.insert(outer, inner);

            // Outer translate(100,0) ∘ inner translate(50,0): screen origin = (150,0).
            expect(hitTest(outer, 155, 5)).toBe(child);
            expect(hitTest(outer, 100, 5)).toBeNull();
        });

        it("groups are transparent — never the hit target themselves", () => {
            const child = rect(0, 0, 10, 10);
            const g = group();
            canvasHost.insert(g, child);

            // (5, 5) is inside the child's bounds — child wins, not the group.
            expect(hitTest(g, 5, 5)).toBe(child);
        });

        it("returns null when no descendant is hit, even if the group is the entry", () => {
            const g = group();
            canvasHost.insert(g, rect(0, 0, 10, 10));
            expect(hitTest(g, 100, 100)).toBeNull();
        });
    });

    describe("reverse paint order (topmost first)", () => {
        it("higher zIndex sibling wins when both contain the point", () => {
            const back = rect(0, 0, 50, 50);
            const front = rect(0, 0, 50, 50);
            canvasHost.setProperty(front, "zIndex", 1);
            canvasHost.setProperty(back, "zIndex", 0);

            const g = group();
            canvasHost.insert(g, back);
            canvasHost.insert(g, front);

            // Hit-test relies on `el.children` being sorted (paint sorts in
            // place); simulate a paint pass having run by sorting here.
            g.children.sort((a, b) => {
                const az = (a as CanvasElementNode).zIndex ?? 0;
                const bz = (b as CanvasElementNode).zIndex ?? 0;
                return az - bz;
            });

            expect(hitTest(g, 25, 25)).toBe(front);
        });

        it("equal zIndex — last-inserted wins via stable sort + reverse iteration", () => {
            const a = rect(0, 0, 50, 50);
            const b = rect(0, 0, 50, 50);
            const g = group();
            canvasHost.insert(g, a);
            canvasHost.insert(g, b);
            // No paint, no sort needed (insertion order with equal zIndex).
            expect(hitTest(g, 25, 25)).toBe(b);
        });

        it("descendants come on top of their ancestors (depth-first reverse)", () => {
            const child = rect(20, 20, 20, 20);
            const parent = rect(0, 0, 100, 100);
            parent.children.push(child);
            child.parent = parent;
            // (25, 25) is inside both — child wins (it's painted after parent).
            expect(hitTest(parent, 25, 25)).toBe(child);
        });
    });

    describe("Text variants are skipped", () => {
        it("a Text child does not block a hit on its sibling", () => {
            const r = rect(0, 0, 50, 50);
            const text = canvasHost.createText("label");
            const g = group();
            canvasHost.insert(g, text); // wraps into a synthetic <text>
            canvasHost.insert(g, r);
            // The wrapped <text> is itself an Element with zero bounds, so
            // it doesn't claim the hit; the rect does.
            expect(hitTest(g, 25, 25)).toBe(r);
        });
    });

    describe("onHitTest pixel-perfect override", () => {
        it("rejects a hit when the override returns false", () => {
            const r = rect(0, 0, 50, 50);
            canvasHost.setProperty(r, "onHitTest", () => false);
            expect(hitTest(r, 25, 25)).toBeNull();
        });

        it("accepts a hit when the override returns true (and bounds also match)", () => {
            const r = rect(0, 0, 50, 50);
            canvasHost.setProperty(r, "onHitTest", () => true);
            expect(hitTest(r, 25, 25)).toBe(r);
        });

        it("receives local-frame coordinates (post-inverse-transform)", () => {
            const calls: Array<{ x: number; y: number }> = [];
            const r = rect(0, 0, 50, 50);
            canvasHost.setProperty(r, "onHitTest", (x: number, y: number) => {
                calls.push({ x, y });
                return true;
            });
            const g = group({ x: 100, y: 100 });
            canvasHost.insert(g, r);

            hitTest(g, 110, 110);
            expect(calls).toEqual([{ x: 10, y: 10 }]);
        });

        it("the override is authoritative — bounds-miss does not short-circuit it", () => {
            // With `onHitTest` defined, the rect's axis-aligned bounds are
            // not consulted. This is what makes paths (whose bounds are
            // currently zeroBounds() pending the path-string parser)
            // reachable through their own pixel-perfect override.
            const calls: number[] = [];
            const r = rect(0, 0, 10, 10);
            canvasHost.setProperty(r, "onHitTest", (x: number, y: number) => {
                calls.push(x + y);
                return false;
            });
            hitTest(r, 100, 100);
            expect(calls).toEqual([200]);
        });

        it("setting onHitTest to a non-function clears it on the variant payload", () => {
            const r = rect(0, 0, 50, 50);
            canvasHost.setProperty(r, "onHitTest", () => false);
            expect(r.hitTest).toBeTypeOf("function");
            canvasHost.setProperty(r, "onHitTest", null);
            expect(r.hitTest).toBeUndefined();
        });
    });
});

// ===========================================================================
// bubbleEvent — handler invocation, parent walk, stopPropagation, preventDefault
// ===========================================================================

describe("bubbleEvent", () => {
    function fakeEvent(type: string, fields: Partial<MouseEvent> = {}): Event {
        let defaultPrevented = false;
        return {
            type,
            offsetX: 10, offsetY: 10,
            clientX: 100, clientY: 100,
            buttons: 0, button: 0,
            ctrlKey: false, shiftKey: false, altKey: false, metaKey: false,
            ...fields,
            preventDefault() { defaultPrevented = true; },
            get defaultPrevented() { return defaultPrevented; },
        } as unknown as Event;
    }

    it("invokes the matching on* handler on the target", () => {
        const r = rect(0, 0, 10, 10);
        const calls: CanvasSyntheticEvent[] = [];
        canvasHost.setProperty(r, "onClick", (e: CanvasSyntheticEvent) => calls.push(e));
        bubbleEvent(r, fakeEvent("click"));
        expect(calls).toHaveLength(1);
        expect(calls[0].target).toBe(r);
        expect(calls[0].type).toBe("click");
    });

    it("walks up through `parent` pointers", () => {
        const child = rect(0, 0, 10, 10);
        const parent = rect(0, 0, 100, 100);
        const grand = rect(0, 0, 1000, 1000);
        child.parent = parent;
        parent.parent = grand;

        const log: string[] = [];
        canvasHost.setProperty(child, "onClick", () => log.push("child"));
        canvasHost.setProperty(parent, "onClick", () => log.push("parent"));
        canvasHost.setProperty(grand, "onClick", () => log.push("grand"));

        bubbleEvent(child, fakeEvent("click"));
        expect(log).toEqual(["child", "parent", "grand"]);
    });

    it("stopPropagation halts the bubble at the calling handler's level", () => {
        const child = rect(0, 0, 10, 10);
        const parent = rect(0, 0, 100, 100);
        child.parent = parent;

        const log: string[] = [];
        canvasHost.setProperty(child, "onClick", (e: CanvasSyntheticEvent) => {
            log.push("child");
            e.stopPropagation();
        });
        canvasHost.setProperty(parent, "onClick", () => log.push("parent"));

        bubbleEvent(child, fakeEvent("click"));
        expect(log).toEqual(["child"]);
    });

    it("preventDefault forwards to the native event", () => {
        const r = rect(0, 0, 10, 10);
        canvasHost.setProperty(r, "onContextMenu", (e: CanvasSyntheticEvent) => e.preventDefault());
        const native = fakeEvent("contextmenu");
        bubbleEvent(r, native);
        expect((native as Event & { defaultPrevented: boolean }).defaultPrevented).toBe(true);
    });

    it("returns false when no handler ran (no on* prop along the chain)", () => {
        const r = rect(0, 0, 10, 10);
        expect(bubbleEvent(r, fakeEvent("click"))).toBe(false);
    });

    it("returns false for an unknown event type (no handler-key mapping)", () => {
        const r = rect(0, 0, 10, 10);
        canvasHost.setProperty(r, "onClick", () => undefined);
        expect(bubbleEvent(r, fakeEvent("nonsense"))).toBe(false);
    });

    it("event includes pointer-specific fields when present", () => {
        const r = rect(0, 0, 10, 10);
        let captured: CanvasSyntheticEvent | null = null;
        canvasHost.setProperty(r, "onPointerDown", (e: CanvasSyntheticEvent) => { captured = e; });
        const native = fakeEvent("pointerdown", {
            // PointerEvent fields are valid on the duck-typed mock.
        });
        (native as unknown as { pointerType: string; pointerId: number }).pointerType = "mouse";
        (native as unknown as { pointerType: string; pointerId: number }).pointerId = 42;
        bubbleEvent(r, native);
        expect(captured).not.toBeNull();
        expect((captured as CanvasSyntheticEvent | null)!.pointerType).toBe("mouse");
        expect((captured as CanvasSyntheticEvent | null)!.pointerId).toBe(42);
    });

    it("event includes wheel-specific fields when present", () => {
        const r = rect(0, 0, 10, 10);
        let captured: CanvasSyntheticEvent | null = null;
        canvasHost.setProperty(r, "onWheel", (e: CanvasSyntheticEvent) => { captured = e; });
        const native = fakeEvent("wheel");
        (native as unknown as { deltaX: number; deltaY: number }).deltaX = 0;
        (native as unknown as { deltaX: number; deltaY: number }).deltaY = -120;
        bubbleEvent(r, native);
        expect((captured as CanvasSyntheticEvent | null)!.deltaY).toBe(-120);
    });

    it("falls through to the next ancestor when the current one has no handler", () => {
        const child = rect(0, 0, 10, 10);
        const parent = rect(0, 0, 100, 100);
        child.parent = parent;

        const log: string[] = [];
        // child has no handler — should fall through to parent.
        canvasHost.setProperty(parent, "onClick", () => log.push("parent"));
        bubbleEvent(child, fakeEvent("click"));
        expect(log).toEqual(["parent"]);
    });
});

// silence unused-import warning when adding more cases later
type _Keep = { _: ReturnType<typeof bareEl> };
