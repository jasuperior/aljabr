import { describe, it, expect } from "vitest";
import {
    CanvasNode,
    zeroBounds,
    type CanvasElementNode,
} from "../../../src/ui/canvas/node.ts";
import { match } from "../../../src/match.ts";
import { getTag } from "../../../src/union.ts";

describe("CanvasNode union", () => {
    describe("Element variant", () => {
        it("constructs an Element with all payload fields", () => {
            const el = CanvasNode.Element({
                tag: "rect",
                props: { x: 1, y: 2 },
                children: [],
                parent: null,
                bounds: { x: 0, y: 0, width: 10, height: 10 },
                zIndex: 3,
            });
            expect(getTag(el)).toBe("Element");
            expect(el.tag).toBe("rect");
            expect(el.props).toEqual({ x: 1, y: 2 });
            expect(el.children).toEqual([]);
            expect(el.parent).toBeNull();
            expect(el.bounds).toEqual({ x: 0, y: 0, width: 10, height: 10 });
            expect(el.zIndex).toBe(3);
            expect(el.hitTest).toBeUndefined();
        });

        it("preserves an optional hitTest function", () => {
            const hit = (_x: number, _y: number): boolean => true;
            const el = CanvasNode.Element({
                tag: "path",
                props: {},
                children: [],
                parent: null,
                bounds: zeroBounds(),
                zIndex: 0,
                hitTest: hit,
            });
            expect(el.hitTest).toBe(hit);
        });

        it("accepts other Element / Text nodes as children", () => {
            const child: CanvasElementNode = CanvasNode.Element({
                tag: "circle",
                props: {},
                children: [],
                parent: null,
                bounds: zeroBounds(),
                zIndex: 0,
            });
            const text = CanvasNode.Text("label");
            const group = CanvasNode.Element({
                tag: "group",
                props: {},
                children: [child, text],
                parent: null,
                bounds: zeroBounds(),
                zIndex: 0,
            });
            expect(group.children).toHaveLength(2);
            expect(group.children[0]).toBe(child);
            expect(group.children[1]).toBe(text);
        });
    });

    describe("Text variant", () => {
        it("constructs a Text node with the given content", () => {
            const t = CanvasNode.Text("hello");
            expect(getTag(t)).toBe("Text");
            expect(t.content).toBe("hello");
        });
    });

    describe("match dispatch", () => {
        it("routes Element vs Text variants exhaustively", () => {
            const el = CanvasNode.Element({
                tag: "rect",
                props: {},
                children: [],
                parent: null,
                bounds: zeroBounds(),
                zIndex: 0,
            });
            const t = CanvasNode.Text("x");

            const elKind = match(el, {
                Element: ({ tag }) => `el:${tag}`,
                Text: ({ content }) => `text:${content}`,
            });
            const tKind = match(t, {
                Element: ({ tag }) => `el:${tag}`,
                Text: ({ content }) => `text:${content}`,
            });

            expect(elKind).toBe("el:rect");
            expect(tKind).toBe("text:x");
        });
    });

    describe("zeroBounds", () => {
        it("returns a fresh all-zero rect on each call", () => {
            const a = zeroBounds();
            const b = zeroBounds();
            expect(a).toEqual({ x: 0, y: 0, width: 0, height: 0 });
            expect(a).not.toBe(b);
        });
    });
});
