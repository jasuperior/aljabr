import { describe, it, expect } from "vitest";
import {
    view,
    ViewNode,
    Fragment,
    type Child,
} from "../../src/ui/view-node.ts";
import { match } from "../../src/match.ts";
import { getTag } from "../../src/union.ts";

describe("view()", () => {
    describe("Element", () => {
        it("creates Element variant with tag, props, children", () => {
            const node = view("div", { class: "app" }, "hello") as ViewNode;
            expect(getTag(node)).toBe("Element");
            match(node, {
                Element: ({ tag, props, children }) => {
                    expect(tag).toBe("div");
                    expect(props).toEqual({ class: "app" });
                    expect(children).toEqual(["hello"]);
                },
                Text: () => {
                    throw new Error("unexpected");
                },
                Component: () => {
                    throw new Error("unexpected");
                },
                Fragment: () => {
                    throw new Error("unexpected");
                },
            });
        });

        it("accepts null props", () => {
            const node = view("span", null, "text") as ViewNode;
            match(node, {
                Element: ({ props }) => expect(props).toEqual({}),
                Text: () => {
                    throw new Error("unexpected");
                },
                Component: () => {
                    throw new Error("unexpected");
                },
                Fragment: () => {
                    throw new Error("unexpected");
                },
            });
        });

        it("accepts no children", () => {
            const node = view("hr") as ViewNode;
            match(node, {
                Element: ({ children }) => expect(children).toEqual([]),
                Text: () => {
                    throw new Error("unexpected");
                },
                Component: () => {
                    throw new Error("unexpected");
                },
                Fragment: () => {
                    throw new Error("unexpected");
                },
            });
        });

        it("accepts multiple children", () => {
            const child1 = view("span", null, "a");
            const child2 = view("span", null, "b");
            const node = view("div", null, child1, child2) as ViewNode;
            match(node, {
                Element: ({ children }) => {
                    expect(children).toHaveLength(2);
                    expect(getTag(children[0] as ViewNode)).toBe("Element");
                    expect(getTag(children[1] as ViewNode)).toBe("Element");
                },
                Text: () => {
                    throw new Error("unexpected");
                },
                Component: () => {
                    throw new Error("unexpected");
                },
                Fragment: () => {
                    throw new Error("unexpected");
                },
            });
        });

        it("accepts function children (reactive getters)", () => {
            const getter = () => "dynamic";
            const node = view("p", null, getter) as ViewNode;
            match(node, {
                Element: ({ children }) => {
                    expect(children[0]).toBe(getter);
                },
                Text: () => {
                    throw new Error("unexpected");
                },
                Component: () => {
                    throw new Error("unexpected");
                },
                Fragment: () => {
                    throw new Error("unexpected");
                },
            });
        });
    });

    describe("Text via ViewNode.Text", () => {
        it("creates Text variant", () => {
            const node = ViewNode.Text("hello") as ViewNode;
            expect(getTag(node)).toBe("Text");
            match(node, {
                Element: () => {
                    throw new Error("unexpected");
                },
                Text: ({ content }) => expect(content).toBe("hello"),
                Component: () => {
                    throw new Error("unexpected");
                },
                Fragment: () => {
                    throw new Error("unexpected");
                },
            });
        });
    });

    describe("Component", () => {
        it("wraps a component function", () => {
            const Button = (props: { label: string }) =>
                view("button", null, props.label);
            const node = view(Button, { label: "Click" }) as ViewNode;
            expect(getTag(node)).toBe("Component");
            match(node, {
                Element: () => {
                    throw new Error("unexpected");
                },
                Text: () => {
                    throw new Error("unexpected");
                },
                Component: ({ fn, props }) => {
                    expect(fn).toBe(Button);
                    expect(props).toEqual({ label: "Click" });
                },
                Fragment: () => {
                    throw new Error("unexpected");
                },
            });
        });

        it("merges rest children into props.children", () => {
            const Wrap = (props: Record<string, unknown>) =>
                view("div", null, props.children as Child);
            const node = view(Wrap, {}, "inner") as ViewNode;
            match(node, {
                Element: () => {
                    throw new Error("unexpected");
                },
                Text: () => {
                    throw new Error("unexpected");
                },
                Component: ({ props }) => {
                    expect(props.children).toBe("inner");
                },
                Fragment: () => {
                    throw new Error("unexpected");
                },
            });
        });

        it("merges multiple rest children into array in props.children", () => {
            const Wrap = (props: Record<string, unknown>) =>
                view("div", null, ...(props.children as Child[]));
            const node = view(Wrap, {}, "a", "b") as ViewNode;
            match(node, {
                Element: () => {
                    throw new Error("unexpected");
                },
                Text: () => {
                    throw new Error("unexpected");
                },
                Component: ({ props }) => {
                    expect(props.children).toEqual(["a", "b"]);
                },
                Fragment: () => {
                    throw new Error("unexpected");
                },
            });
        });
    });

    describe("Fragment", () => {
        it("creates Fragment variant", () => {
            const a = view("span", null, "a");
            const b = view("span", null, "b");
            const node = view(Fragment, null, a, b) as ViewNode;
            expect(getTag(node)).toBe("Fragment");
            match(node, {
                Element: () => {
                    throw new Error("unexpected");
                },
                Text: () => {
                    throw new Error("unexpected");
                },
                Component: () => {
                    throw new Error("unexpected");
                },
                Fragment: ({ children }) => {
                    expect(children).toHaveLength(2);
                },
            });
        });
    });
});
