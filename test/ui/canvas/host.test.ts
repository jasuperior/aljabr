import { describe, it, expect } from "vitest";
import { CanvasHost } from "../../../src/ui/canvas/host.ts";
import {
    CanvasNode,
    zeroBounds,
    type CanvasElementNode,
} from "../../../src/ui/canvas/node.ts";
import { getTag } from "../../../src/union.ts";

function root(): CanvasElementNode {
    return CanvasNode.Element({
        tag: "group",
        props: {},
        children: [],
        parent: null,
        bounds: zeroBounds(),
        zIndex: 0,
    });
}

describe("CanvasHost", () => {
    describe("createElement", () => {
        it("creates an empty Element variant for the given tag", () => {
            const el = CanvasHost.createElement("rect");
            expect(getTag(el)).toBe("Element");
            expect(el.tag).toBe("rect");
            expect(el.props).toEqual({});
            expect(el.children).toEqual([]);
            expect(el.parent).toBeNull();
            expect(el.bounds).toEqual(zeroBounds());
            expect(el.zIndex).toBe(0);
            expect(el.hitTest).toBeUndefined();
        });
    });

    describe("createText", () => {
        it("creates a Text variant with the given content", () => {
            const t = CanvasHost.createText("hi");
            expect(getTag(t)).toBe("Text");
            if (getTag(t) === "Text") {
                expect((t as { content: string }).content).toBe("hi");
            }
        });
    });

    describe("insert", () => {
        it("appends to parent.children when no anchor is given", () => {
            const parent = root();
            const a = CanvasHost.createElement("rect");
            const b = CanvasHost.createElement("circle");
            CanvasHost.insert(parent, a);
            CanvasHost.insert(parent, b);
            expect(parent.children).toEqual([a, b]);
        });

        it("inserts before the anchor when one is given", () => {
            const parent = root();
            const a = CanvasHost.createElement("rect");
            const b = CanvasHost.createElement("circle");
            const c = CanvasHost.createElement("ellipse");
            CanvasHost.insert(parent, a);
            CanvasHost.insert(parent, b);
            CanvasHost.insert(parent, c, b);
            expect(parent.children).toEqual([a, c, b]);
        });

        it("sets `parent` on Element children", () => {
            const parent = root();
            const child = CanvasHost.createElement("rect");
            CanvasHost.insert(parent, child);
            expect(child.parent).toBe(parent);
        });

        it("tracks parents for Text children so nextSibling/remove work", () => {
            const parent = root();
            const t = CanvasHost.createText("hello");
            CanvasHost.insert(parent, t);
            expect(CanvasHost.parentNode(t)).toBeNull(); // Text reports null per spec
            expect(CanvasHost.nextSibling(t)).toBeNull();
            CanvasHost.remove(t);
            expect(parent.children).toEqual([]);
        });

        it("re-parents a node that's already attached elsewhere", () => {
            const parentA = root();
            const parentB = root();
            const child = CanvasHost.createElement("rect");
            CanvasHost.insert(parentA, child);
            CanvasHost.insert(parentB, child);
            expect(parentA.children).toEqual([]);
            expect(parentB.children).toEqual([child]);
            expect(child.parent).toBe(parentB);
        });
    });

    describe("remove", () => {
        it("detaches an Element from its parent and clears its parent pointer", () => {
            const parent = root();
            const a = CanvasHost.createElement("rect");
            const b = CanvasHost.createElement("circle");
            CanvasHost.insert(parent, a);
            CanvasHost.insert(parent, b);
            CanvasHost.remove(a);
            expect(parent.children).toEqual([b]);
            expect(a.parent).toBeNull();
        });

        it("is a no-op for an already-detached node", () => {
            const a = CanvasHost.createElement("rect");
            expect(() => CanvasHost.remove(a)).not.toThrow();
            expect(a.parent).toBeNull();
        });
    });

    describe("setProperty", () => {
        it("assigns to el.props[key]", () => {
            const el = CanvasHost.createElement("rect");
            CanvasHost.setProperty(el, "fill", "red");
            expect(el.props.fill).toBe("red");
        });

        it("recomputes rect bounds from x/y/width/height", () => {
            const el = CanvasHost.createElement("rect");
            CanvasHost.setProperty(el, "x", 5);
            CanvasHost.setProperty(el, "y", 10);
            CanvasHost.setProperty(el, "width", 20);
            CanvasHost.setProperty(el, "height", 30);
            expect(el.bounds).toEqual({ x: 5, y: 10, width: 20, height: 30 });
        });

        it("recomputes circle bounds from cx/cy/r", () => {
            const el = CanvasHost.createElement("circle");
            CanvasHost.setProperty(el, "cx", 10);
            CanvasHost.setProperty(el, "cy", 20);
            CanvasHost.setProperty(el, "r", 5);
            expect(el.bounds).toEqual({ x: 5, y: 15, width: 10, height: 10 });
        });

        it("recomputes ellipse bounds from cx/cy/rx/ry", () => {
            const el = CanvasHost.createElement("ellipse");
            CanvasHost.setProperty(el, "cx", 0);
            CanvasHost.setProperty(el, "cy", 0);
            CanvasHost.setProperty(el, "rx", 4);
            CanvasHost.setProperty(el, "ry", 2);
            expect(el.bounds).toEqual({ x: -4, y: -2, width: 8, height: 4 });
        });

        it("normalises line bounds when x2/y2 < x1/y1", () => {
            const el = CanvasHost.createElement("line");
            CanvasHost.setProperty(el, "x1", 10);
            CanvasHost.setProperty(el, "y1", 20);
            CanvasHost.setProperty(el, "x2", 0);
            CanvasHost.setProperty(el, "y2", 5);
            expect(el.bounds).toEqual({ x: 0, y: 5, width: 10, height: 15 });
        });

        it("does not recompute bounds for non-geometry keys", () => {
            const el = CanvasHost.createElement("rect");
            CanvasHost.setProperty(el, "x", 1);
            CanvasHost.setProperty(el, "y", 1);
            CanvasHost.setProperty(el, "width", 2);
            CanvasHost.setProperty(el, "height", 2);
            const before = el.bounds;
            CanvasHost.setProperty(el, "fill", "blue");
            expect(el.bounds).toBe(before);
        });

        it("updates zIndex when key === 'zIndex'", () => {
            const el = CanvasHost.createElement("rect");
            CanvasHost.setProperty(el, "zIndex", 7);
            expect(el.zIndex).toBe(7);
            expect(el.props.zIndex).toBe(7);
        });
    });

    describe("setText", () => {
        it("updates the content of a Text node", () => {
            const t = CanvasHost.createText("a");
            CanvasHost.setText(t, "b");
            if (getTag(t) === "Text") {
                expect((t as { content: string }).content).toBe("b");
            }
        });

        it("is a no-op on an Element node", () => {
            const el = CanvasHost.createElement("rect");
            expect(() => CanvasHost.setText(el, "x")).not.toThrow();
        });
    });

    describe("parentNode", () => {
        it("returns parent for an attached Element", () => {
            const parent = root();
            const child = CanvasHost.createElement("rect");
            CanvasHost.insert(parent, child);
            expect(CanvasHost.parentNode(child)).toBe(parent);
        });

        it("returns null for a detached Element", () => {
            const el = CanvasHost.createElement("rect");
            expect(CanvasHost.parentNode(el)).toBeNull();
        });

        it("returns null for a Text node (per spec)", () => {
            const t = CanvasHost.createText("x");
            expect(CanvasHost.parentNode(t)).toBeNull();
        });
    });

    describe("nextSibling", () => {
        it("walks parent.children to find the next node", () => {
            const parent = root();
            const a = CanvasHost.createElement("rect");
            const b = CanvasHost.createElement("circle");
            const c = CanvasHost.createElement("ellipse");
            CanvasHost.insert(parent, a);
            CanvasHost.insert(parent, b);
            CanvasHost.insert(parent, c);
            expect(CanvasHost.nextSibling(a)).toBe(b);
            expect(CanvasHost.nextSibling(b)).toBe(c);
            expect(CanvasHost.nextSibling(c)).toBeNull();
        });

        it("works for Text nodes via the host's parent map", () => {
            const parent = root();
            const t = CanvasHost.createText("hi");
            const after = CanvasHost.createElement("rect");
            CanvasHost.insert(parent, t);
            CanvasHost.insert(parent, after);
            expect(CanvasHost.nextSibling(t)).toBe(after);
        });

        it("returns null for a detached node", () => {
            const el = CanvasHost.createElement("rect");
            expect(CanvasHost.nextSibling(el)).toBeNull();
        });
    });
});
