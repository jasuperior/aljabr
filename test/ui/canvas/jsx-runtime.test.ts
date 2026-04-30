import { describe, it, expect } from "vitest";
import { jsx, jsxs, jsxDEV, Fragment } from "../../../src/ui/canvas/jsx-runtime.ts";
import { match } from "../../../src/match.ts";
import { getTag } from "../../../src/union.ts";

describe("canvas jsx-runtime", () => {
    describe("intrinsic elements", () => {
        it("produces an Element ViewNode for a canvas primitive tag", () => {
            const node = jsx("rect", { x: 0, y: 0, width: 10, height: 10, fill: "red" });
            expect(getTag(node)).toBe("Element");
            match(node, {
                Element: ({ tag, props, children }) => {
                    expect(tag).toBe("rect");
                    expect(props).toEqual({ x: 0, y: 0, width: 10, height: 10, fill: "red" });
                    expect(children).toEqual([]);
                },
                Text: () => { throw new Error("unexpected"); },
                Component: () => { throw new Error("unexpected"); },
                Fragment: () => { throw new Error("unexpected"); },
            });
        });

        it("flows children through the props.children → varargs conversion", () => {
            const inner = jsx("rect", { x: 0, y: 0, width: 1, height: 1 });
            const outer = jsx("group", { children: inner });
            match(outer, {
                Element: ({ tag, children }) => {
                    expect(tag).toBe("group");
                    expect(children).toEqual([inner]);
                },
                Text: () => { throw new Error("unexpected"); },
                Component: () => { throw new Error("unexpected"); },
                Fragment: () => { throw new Error("unexpected"); },
            });
        });

        it("emits an empty props object as null on the ViewNode", () => {
            const node = jsx("group", {});
            match(node, {
                Element: ({ props }) => expect(props).toEqual({}),
                Text: () => { throw new Error("unexpected"); },
                Component: () => { throw new Error("unexpected"); },
                Fragment: () => { throw new Error("unexpected"); },
            });
        });
    });

    describe("multi-child via jsxs", () => {
        it("preserves child order from an array", () => {
            const a = jsx("rect", { x: 0, y: 0, width: 1, height: 1 });
            const b = jsx("circle", { cx: 0, cy: 0, r: 1 });
            const c = jsx("ellipse", { cx: 0, cy: 0, rx: 1, ry: 1 });
            const group = jsxs("group", { children: [a, b, c] });
            match(group, {
                Element: ({ children }) => expect(children).toEqual([a, b, c]),
                Text: () => { throw new Error("unexpected"); },
                Component: () => { throw new Error("unexpected"); },
                Fragment: () => { throw new Error("unexpected"); },
            });
        });
    });

    describe("Fragment", () => {
        it("returns a Fragment ViewNode when type === Fragment", () => {
            const a = jsx("rect", { x: 0, y: 0, width: 1, height: 1 });
            const b = jsx("circle", { cx: 0, cy: 0, r: 1 });
            const frag = jsxs(Fragment, { children: [a, b] });
            expect(getTag(frag)).toBe("Fragment");
            match(frag, {
                Element: () => { throw new Error("unexpected"); },
                Text: () => { throw new Error("unexpected"); },
                Component: () => { throw new Error("unexpected"); },
                Fragment: ({ children }) => expect(children).toEqual([a, b]),
            });
        });
    });

    describe("components", () => {
        it("returns a Component ViewNode when type is a function", () => {
            const Inner = (_props: Record<string, unknown>) => jsx("rect", { x: 0, y: 0, width: 1, height: 1 });
            const node = jsx(Inner, { fill: "red" });
            expect(getTag(node)).toBe("Component");
            match(node, {
                Element: () => { throw new Error("unexpected"); },
                Text: () => { throw new Error("unexpected"); },
                Component: ({ fn, props }) => {
                    expect(fn).toBe(Inner);
                    expect(props).toEqual({ fill: "red" });
                },
                Fragment: () => { throw new Error("unexpected"); },
            });
        });

        it("merges children into the component's props.children", () => {
            const Wrap = (_props: Record<string, unknown>) => jsx("group", {});
            const child = jsx("rect", { x: 0, y: 0, width: 1, height: 1 });
            const node = jsx(Wrap, { children: child });
            match(node, {
                Element: () => { throw new Error("unexpected"); },
                Text: () => { throw new Error("unexpected"); },
                Component: ({ props }) => expect(props.children).toBe(child),
                Fragment: () => { throw new Error("unexpected"); },
            });
        });
    });

    describe("jsxDEV", () => {
        it("is an alias of jsx (no extra instrumentation in this runtime)", () => {
            expect(jsxDEV).toBe(jsx);
        });
    });

    describe("on* handler props pass through unchanged", () => {
        it("forwards onClick / onPointerDown without normalisation", () => {
            const onClick = () => undefined;
            const onPointerDown = () => undefined;
            const node = jsx("rect", {
                x: 0, y: 0, width: 1, height: 1,
                onClick, onPointerDown,
            });
            match(node, {
                Element: ({ props }) => {
                    expect(props.onClick).toBe(onClick);
                    expect(props.onPointerDown).toBe(onPointerDown);
                },
                Text: () => { throw new Error("unexpected"); },
                Component: () => { throw new Error("unexpected"); },
                Fragment: () => { throw new Error("unexpected"); },
            });
        });

        it("forwards onHitTest as a plain function (not a reactive getter)", () => {
            const onHitTest = (_x: number, _y: number): boolean => true;
            const node = jsx("path", { d: "M0 0", onHitTest });
            match(node, {
                Element: ({ props }) => expect(props.onHitTest).toBe(onHitTest),
                Text: () => { throw new Error("unexpected"); },
                Component: () => { throw new Error("unexpected"); },
                Fragment: () => { throw new Error("unexpected"); },
            });
        });
    });
});
