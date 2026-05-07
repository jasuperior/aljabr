import { describe, it, expect, vi, afterEach } from "vitest";
import { CanvasHost } from "../../../src/ui/canvas/host.ts";
import { CanvasNode } from "../../../src/ui/canvas/node.ts";

afterEach(() => {
    vi.restoreAllMocks();
});

describe("implicit Text wrapping (Phase 5.3)", () => {
    describe("wrapping behaviour", () => {
        it("wraps a Text child of a non-text Element into a synthetic <text> element", () => {
            const rect = CanvasHost.createElement("rect");
            const t = CanvasHost.createText("hello");
            CanvasHost.insert(rect, t);

            // The Text node itself is NOT in parent.children — its synthetic
            // wrapper is.
            expect(rect.children).toHaveLength(1);
            const wrapper = rect.children[0];
            expect(wrapper).not.toBe(t);
            // The wrapper is an Element with tag="text" and the original
            // content carried over to props.
            expect((wrapper as { tag: string }).tag).toBe("text");
            expect((wrapper as { props: Record<string, unknown> }).props.content).toBe("hello");
        });

        it("re-renders the wrapper when setText is called on the original Text node", () => {
            const rect = CanvasHost.createElement("rect");
            const t = CanvasHost.createText("a");
            CanvasHost.insert(rect, t);

            CanvasHost.setText(t, "b");
            const wrapper = rect.children[0] as { props: Record<string, unknown> };
            expect(wrapper.props.content).toBe("b");
            // The original Text node's content is also kept in sync — useful
            // for any consumer holding the Text reference.
            expect((t as { content: string }).content).toBe("b");
        });

        it("removes the wrapper when remove() is called with the original Text node", () => {
            const rect = CanvasHost.createElement("rect");
            const t = CanvasHost.createText("hi");
            CanvasHost.insert(rect, t);
            expect(rect.children).toHaveLength(1);

            CanvasHost.remove(t);
            expect(rect.children).toHaveLength(0);
        });

        it("nextSibling on a Text node returns the unwrapped Text reference of the next slot", () => {
            const rect = CanvasHost.createElement("rect");
            const a = CanvasHost.createText("a");
            const b = CanvasHost.createText("b");
            CanvasHost.insert(rect, a);
            CanvasHost.insert(rect, b);

            // The reconciler holds (a, b) — `nextSibling(a)` must return `b`,
            // not the synthetic wrapper of `b`. Without unwrap, the
            // mountReactiveRegion `cur !== end` walk would silently fail.
            expect(CanvasHost.nextSibling(a)).toBe(b);
        });

        it("nextSibling returns the Element reference when the next slot is an Element", () => {
            const rect = CanvasHost.createElement("rect");
            const t = CanvasHost.createText("hi");
            const after = CanvasHost.createElement("rect");
            CanvasHost.insert(rect, t);
            CanvasHost.insert(rect, after);

            expect(CanvasHost.nextSibling(t)).toBe(after);
        });

        it("inserting after an anchor Text node inserts before that text's wrapper", () => {
            const rect = CanvasHost.createElement("rect");
            const a = CanvasHost.createText("a");
            const b = CanvasHost.createText("b");
            const c = CanvasHost.createText("c");
            CanvasHost.insert(rect, a);
            CanvasHost.insert(rect, b);
            // Insert `c` before `b` (anchored at b's Text reference).
            CanvasHost.insert(rect, c, b);

            // Order in parent.children: wrapper(a), wrapper(c), wrapper(b)
            const tags = rect.children.map((n) => (n as { props: { content: string } }).props.content);
            expect(tags).toEqual(["a", "c", "b"]);
        });
    });

    describe("does NOT wrap when the parent is itself a <text>", () => {
        it("Text inserted into <text> sits directly in children (no wrapper)", () => {
            const text = CanvasHost.createElement("text");
            const t = CanvasHost.createText("inside");
            CanvasHost.insert(text, t);

            // The Text node is the literal child — no synthetic wrapper.
            expect(text.children).toHaveLength(1);
            expect(text.children[0]).toBe(t);
        });
    });

    describe("dev warnings", () => {
        it("warns when a Text is inserted into a <line>", () => {
            const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
            const line = CanvasHost.createElement("line");
            const t = CanvasHost.createText("hi");
            CanvasHost.insert(line, t);
            expect(warn).toHaveBeenCalled();
            expect(String(warn.mock.calls[0][0])).toMatch(/<line>/);
        });

        it("warns when a Text is inserted into a <path>", () => {
            const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
            const path = CanvasHost.createElement("path");
            const t = CanvasHost.createText("hi");
            CanvasHost.insert(path, t);
            expect(warn).toHaveBeenCalled();
            expect(String(warn.mock.calls[0][0])).toMatch(/<path>/);
        });

        it("does NOT warn for <rect>, <circle>, <ellipse>, or <group>", () => {
            const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
            for (const tag of ["rect", "circle", "ellipse", "group"] as const) {
                const parent = CanvasHost.createElement(tag);
                const t = CanvasHost.createText("hi");
                CanvasHost.insert(parent, t);
            }
            expect(warn).not.toHaveBeenCalled();
        });
    });

    describe("interactions with parentNode", () => {
        it("returns null for a wrapped Text reference (per spec)", () => {
            const rect = CanvasHost.createElement("rect");
            const t = CanvasHost.createText("hi");
            CanvasHost.insert(rect, t);
            expect(CanvasHost.parentNode(t)).toBeNull();
        });

        it("returns null when called on the synthetic wrapper itself", () => {
            const rect = CanvasHost.createElement("rect");
            const t = CanvasHost.createText("hi");
            CanvasHost.insert(rect, t);
            const wrapper = rect.children[0];
            // Wrappers are an internal detail — `parentNode` reports null
            // even though the wrapper does have a parent reference. This
            // guarantees the reconciler never reasons about wrappers.
            expect(CanvasHost.parentNode(wrapper)).toBeNull();
        });
    });

    describe("interaction with the existing setText test suite", () => {
        it("setText on an unwrapped Text node still updates content (back-compat)", () => {
            const t = CanvasNode.Text("a");
            CanvasHost.setText(t, "b");
            expect(t.content).toBe("b");
        });
    });
});
