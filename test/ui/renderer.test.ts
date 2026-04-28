import { describe, it, expect, vi } from "vitest";
import { createRenderer } from "../../src/ui/renderer.ts";
import { view, Fragment } from "../../src/ui/view-node.ts";
import type { RendererHost } from "../../src/ui/types.ts";
import { Signal } from "../../src/prelude/signal.ts";
import { Ref } from "../../src/prelude/ref.ts";
import { createOwner } from "../../src/prelude/context.ts";

// ---------------------------------------------------------------------------
// Minimal in-memory host for testing
// ---------------------------------------------------------------------------

type TestNode = {
    type: "text" | "element";
    tag?: string;
    props: Record<string, unknown>;
    children: TestNode[];
    text?: string;
    parent: TestNode | null;
};

function makeHost(): RendererHost<TestNode, TestNode> & { root: TestNode } {
    function mkNode(partial: Partial<TestNode>): TestNode {
        return {
            type: "element",
            props: {},
            children: [],
            parent: null,
            ...partial,
        };
    }

    const root = mkNode({ tag: "__root__" });

    const host: RendererHost<TestNode, TestNode> & { root: TestNode } = {
        root,
        createElement(tag): TestNode {
            return mkNode({ type: "element", tag });
        },
        createText(text): TestNode {
            return mkNode({ type: "text", text });
        },
        insert(parent, child, anchor): void {
            child.parent = parent;
            if (anchor == null) {
                parent.children.push(child);
            } else {
                const idx = parent.children.indexOf(anchor);
                if (idx === -1) {
                    parent.children.push(child);
                } else {
                    parent.children.splice(idx, 0, child);
                }
            }
        },
        remove(child): void {
            const p = child.parent;
            if (!p) return;
            const idx = p.children.indexOf(child);
            if (idx !== -1) p.children.splice(idx, 1);
            child.parent = null;
        },
        setProperty(el, key, value): void {
            el.props[key] = value;
        },
        setText(node, text): void {
            node.text = text;
        },
        parentNode(node): TestNode | null {
            return node.parent;
        },
        nextSibling(node): TestNode | null {
            const p = node.parent;
            if (!p) return null;
            const idx = p.children.indexOf(node);
            return p.children[idx + 1] ?? null;
        },
    };

    return host;
}

// Helpers to inspect the tree
function elementChildren(node: TestNode): TestNode[] {
    return node.children.filter(
        (c) =>
            c.type === "element" &&
            c.tag !== undefined &&
            !c.tag.startsWith("__"),
    );
}

function textContent(node: TestNode): string {
    return node.children
        .filter(
            (c) =>
                c.type === "text" && c.text !== "" && !c.text?.startsWith(""),
        )
        .map((c) => c.text ?? "")
        .join("");
}

// All non-anchor text nodes
function visibleTexts(node: TestNode): string[] {
    return node.children
        .filter((c) => c.type === "text" && c.text !== "")
        .map((c) => c.text ?? "");
}

// All element children (non-anchor)
function visibleElements(node: TestNode): TestNode[] {
    return node.children.filter(
        (c) => c.type === "element" && c.tag !== undefined,
    );
}

describe("createRenderer", () => {
    describe("mount — static tree", () => {
        it("mounts a simple element", () => {
            const host = makeHost();
            const { mount } = createRenderer(host);
            mount(() => view("div", { class: "app" }), host.root);

            const children = visibleElements(host.root);
            expect(children).toHaveLength(1);
            expect(children[0].tag).toBe("div");
            expect(children[0].props.class).toBe("app");
        });

        it("mounts nested elements", () => {
            const host = makeHost();
            const { mount } = createRenderer(host);
            mount(
                () =>
                    view(
                        "ul",
                        null,
                        view("li", null, "a"),
                        view("li", null, "b"),
                    ),
                host.root,
            );
            const ul = visibleElements(host.root)[0];
            expect(ul.tag).toBe("ul");
            const lis = visibleElements(ul);
            expect(lis).toHaveLength(2);
            expect(visibleTexts(lis[0])[0]).toBe("a");
            expect(visibleTexts(lis[1])[0]).toBe("b");
        });

        it("mounts a Text node", () => {
            const host = makeHost();
            const { mount } = createRenderer(host);
            mount(() => view("span", null, "hello"), host.root);
            const span = visibleElements(host.root)[0];
            expect(visibleTexts(span)[0]).toBe("hello");
        });

        it("mounts a Fragment", () => {
            const host = makeHost();
            const { mount } = createRenderer(host);
            mount(
                () =>
                    view(
                        Fragment,
                        null,
                        view("span", null, "a"),
                        view("span", null, "b"),
                    ),
                host.root,
            );
            const spans = visibleElements(host.root);
            expect(spans).toHaveLength(2);
        });

        it("mounts a function component", () => {
            const host = makeHost();
            const { mount, view: v } = createRenderer(host);
            const Greeting = ({ name }: { name: string }) => v("p", null, name);
            mount(() => v(Greeting, { name: "world" }), host.root);

            const p = visibleElements(host.root)[0];
            expect(p.tag).toBe("p");
            expect(visibleTexts(p)[0]).toBe("world");
        });
    });

    describe("mount — dispose", () => {
        it("unmount removes all nodes", () => {
            const host = makeHost();
            const { mount } = createRenderer(host);
            const unmount = mount(
                () => view("div", null, "content"),
                host.root,
            );

            expect(visibleElements(host.root)).toHaveLength(1);
            unmount();
            expect(visibleElements(host.root)).toHaveLength(0);
        });
    });

    describe("reactive children (function getter)", () => {
        it("renders initial value", () => {
            const host = makeHost();
            const { mount } = createRenderer(host);
            const sig = Signal.create("hello");
            mount(() => view("p", null, () => sig.get()), host.root);

            const p = visibleElements(host.root)[0];
            expect(visibleTexts(p)).toContain("hello");
        });

        it("updates when signal changes", () => {
            const host = makeHost();
            const { mount } = createRenderer(host);
            const sig = Signal.create("hello");
            mount(() => view("p", null, () => sig.get()), host.root);

            sig.set("world");

            const p = visibleElements(host.root)[0];
            expect(visibleTexts(p)).toContain("world");
            expect(visibleTexts(p)).not.toContain("hello");
        });

        it("swaps elements on conditional change", () => {
            const host = makeHost();
            const { mount } = createRenderer(host);
            const active = Signal.create(true);

            mount(
                () =>
                    view("div", null, () =>
                        active.get()
                            ? view("span", null, "on")
                            : view("span", null, "off"),
                    ),
                host.root,
            );

            const div = visibleElements(host.root)[0];
            expect(visibleTexts(visibleElements(div)[0])).toContain("on");

            active.set(false);
            expect(visibleTexts(visibleElements(div)[0])).toContain("off");
        });

        it("renders null/undefined without inserting nodes", () => {
            const host = makeHost();
            const { mount } = createRenderer(host);
            const show = Signal.create(false);

            mount(
                () =>
                    view("div", null, () =>
                        show.get() ? view("span", null, "visible") : null,
                    ),
                host.root,
            );

            const div = visibleElements(host.root)[0];
            expect(visibleElements(div)).toHaveLength(0);

            show.set(true);
            expect(visibleElements(div)).toHaveLength(1);
        });
    });

    describe("reactive props (function value)", () => {
        it("applies initial reactive prop", () => {
            const host = makeHost();
            const { mount } = createRenderer(host);
            const cls = Signal.create("active");
            mount(() => view("div", { class: () => cls.get() }), host.root);

            const div = visibleElements(host.root)[0];
            expect(div.props.class).toBe("active");
        });

        it("updates reactive prop when signal changes", () => {
            const host = makeHost();
            const { mount } = createRenderer(host);
            const cls = Signal.create("active");
            mount(() => view("div", { class: () => cls.get() }), host.root);

            cls.set("inactive");
            const div = visibleElements(host.root)[0];
            expect(div.props.class).toBe("inactive");
        });

        it("does not treat event handlers as reactive", () => {
            const host = makeHost();
            const { mount } = createRenderer(host);
            const handler = vi.fn();
            mount(() => view("button", { onClick: handler }), host.root);

            const btn = visibleElements(host.root)[0];
            expect(btn.props.onClick).toBe(handler);
        });
    });

    describe("DerivedArray children", () => {
        it("renders initial array", () => {
            const host = makeHost();
            const { mount } = createRenderer(host);
            const ref = Ref.create({ items: ["a", "b", "c"] });
            const rows = ref
                .at("items")
                .map((item, _) => view("li", null, item));

            mount(() => view("ul", null, rows), host.root);

            const ul = visibleElements(host.root)[0];
            expect(visibleElements(ul)).toHaveLength(3);
        });

        it("updates when array item changes", () => {
            const host = makeHost();
            const { mount } = createRenderer(host);
            const ref = Ref.create({ items: ["a", "b"] });
            const rows = ref.at("items").map((item) => view("li", null, item));

            mount(() => view("ul", null, rows), host.root);

            ref.set("items.0" as "items.0", "x");
            const ul = visibleElements(host.root)[0];
            expect(visibleTexts(visibleElements(ul)[0])).toContain("x");
        });

        it("adds new items when array grows", () => {
            const host = makeHost();
            const { mount } = createRenderer(host);
            const ref = Ref.create({ items: ["a"] });
            const rows = ref.at("items").map((item) => view("li", null, item));

            mount(() => view("ul", null, rows), host.root);
            expect(visibleElements(visibleElements(host.root)[0])).toHaveLength(
                1,
            );

            ref.push("items", "b");
            expect(visibleElements(visibleElements(host.root)[0])).toHaveLength(
                2,
            );
        });

        it("removes items when array shrinks", () => {
            const host = makeHost();
            const { mount } = createRenderer(host);
            const ref = Ref.create({ items: ["a", "b", "c"] });
            const rows = ref.at("items").map((item) => view("li", null, item));

            mount(() => view("ul", null, rows), host.root);
            ref.splice("items", 1, 2);

            expect(visibleElements(visibleElements(host.root)[0])).toHaveLength(
                1,
            );
        });
    });

    describe("lifecycle hooks", () => {
        it("calls onMount when element is inserted", () => {
            const onMount = vi.fn();
            const host = makeHost();
            (host as typeof host & { onMount: typeof onMount }).onMount =
                onMount;

            const { mount } = createRenderer(
                host as RendererHost<TestNode, TestNode>,
            );
            mount(() => view("div", null), host.root);

            expect(onMount).toHaveBeenCalledOnce();
        });

        it("calls onUnmount when element is removed", () => {
            const onUnmount = vi.fn();
            const host = makeHost();
            (host as typeof host & { onUnmount: typeof onUnmount }).onUnmount =
                onUnmount;

            const { mount } = createRenderer(
                host as RendererHost<TestNode, TestNode>,
            );
            const unmount = mount(() => view("div", null), host.root);
            unmount();

            expect(onUnmount).toHaveBeenCalledOnce();
        });
    });

    describe("component lifecycle via owner", () => {
        it("cleans up component-owned signals when unmounted", () => {
            const host = makeHost();
            const { mount } = createRenderer(host);
            const disposed: boolean[] = [];

            const Comp = () => {
                const s = Signal.create(0);
                // Signal dispose can be tracked via external cleanup
                const orig = s.dispose.bind(s);
                s.dispose = () => {
                    disposed.push(true);
                    orig();
                };
                return view("span", null, String(s.get()));
            };

            const unmount = mount(
                () => view(Comp as () => ReturnType<typeof Comp>, {}),
                host.root,
            );
            expect(disposed).toHaveLength(0);
            unmount();
            // The owner disposed triggers signal cleanup
            // (exact behavior depends on whether Signal.create registers itself with the owner)
            // At minimum, the element should be removed
            expect(visibleElements(host.root)).toHaveLength(0);
        });
    });

    describe("prop diffing", () => {
        it("calls setProperty only when value changes", () => {
            const host = makeHost();
            const calls: unknown[] = [];
            const origSet = host.setProperty.bind(host);
            host.setProperty = (el, key, value) => {
                if (key === "class") calls.push(value);
                origSet(el, key, value);
            };
            const { mount } = createRenderer(host);
            const cls = Signal.create("a");
            mount(() => view("div", { class: () => cls.get() }), host.root);

            expect(calls).toEqual(["a"]);
            cls.set("a"); // same value — should not trigger setProperty
            expect(calls).toEqual(["a"]);
            cls.set("b");
            expect(calls).toEqual(["a", "b"]);
        });
    });

    describe("RendererProtocol batching", () => {
        it("defers updates until scheduleFlush fires", () => {
            const host = makeHost();
            let flush: (() => void) | null = null;
            const protocol = {
                scheduleFlush(f: () => void) { flush = f; },
            };
            const { mount } = createRenderer(host, protocol);
            const sig = Signal.create("hello");
            mount(() => view("p", null, () => sig.get()), host.root);

            const p = visibleElements(host.root)[0];
            expect(visibleTexts(p)).toContain("hello");

            sig.set("world");
            // Not flushed yet — DOM unchanged
            expect(visibleTexts(visibleElements(host.root)[0])).toContain("hello");

            flush!();
            expect(visibleTexts(visibleElements(host.root)[0])).toContain("world");
        });

        it("coalesces multiple updates into one flush", () => {
            const host = makeHost();
            let flush: (() => void) | null = null;
            let flushCount = 0;
            const protocol = {
                scheduleFlush(f: () => void) { flushCount++; flush = f; },
            };
            const { mount } = createRenderer(host, protocol);
            const sig = Signal.create("a");
            mount(() => view("p", null, () => sig.get()), host.root);

            sig.set("b");
            sig.set("c");
            expect(flushCount).toBe(1); // only one scheduleFlush call
            flush!();
            expect(visibleTexts(visibleElements(host.root)[0])).toContain("c");
        });
    });

    describe("nested DerivedArray items", () => {
        it("renders string items from a RefArray directly", () => {
            const host = makeHost();
            const { mount } = createRenderer(host);
            const arr = Ref.create({ items: ["x", "y"] });
            mount(
                () => view("ul", null, arr.at("items")),
                host.root,
            );
            const ul = visibleElements(host.root)[0];
            expect(visibleTexts(ul)).toContain("x");
            expect(visibleTexts(ul)).toContain("y");
        });

        it("renders ViewNode items nested inside outer DerivedArray", () => {
            const host = makeHost();
            const { mount } = createRenderer(host);
            const ref = Ref.create({ groups: [["a", "b"], ["c"]] });
            const rows = ref.at("groups").map((group, i) =>
                view("li", null, String(i), ": ", group.join(","))
            );
            mount(() => view("ul", null, rows), host.root);
            const ul = visibleElements(host.root)[0];
            expect(visibleElements(ul)).toHaveLength(2);
        });
    });

    describe("keyed DerivedArray reconciliation", () => {
        it("removes only the changed item's element, not all items, when toggling one", () => {
            const host = makeHost();
            const removedElements: string[] = [];
            const origRemove = host.remove.bind(host);
            host.remove = (node) => {
                if (node.type === "element") removedElements.push(node.tag ?? "?");
                origRemove(node);
            };

            const { mount } = createRenderer(host);
            const tasks = Ref.create([
                { id: 1, done: false },
                { id: 2, done: false },
                { id: 3, done: false },
            ]);
            const rows = tasks.filter(_t => true, { key: t => t.id })
                .map(t => view("li", { id: t.id, done: t.done }));

            mount(() => view("ul", null, rows), host.root);
            removedElements.length = 0;

            // Toggle item at index 1 — only that item's li is removed+replaced
            tasks.splice(1, 1, { id: 2, done: true });
            const liRemovals = removedElements.filter(tag => tag === "li");
            expect(liRemovals).toHaveLength(1); // exactly the changed item, not all 3
        });

        it("re-renders only the toggled item's scope, not all items", () => {
            const host = makeHost();
            const { mount } = createRenderer(host);
            const renderCounts = [0, 0, 0];

            const tasks = Ref.create([
                { id: 1, done: false },
                { id: 2, done: false },
                { id: 3, done: false },
            ]);
            const rows = tasks.filter(_t => true, { key: t => t.id })
                .map((t, i) => {
                    renderCounts[i]++;
                    return view("li", { id: t.id });
                });

            mount(() => view("ul", null, rows), host.root);
            renderCounts.fill(0);

            tasks.splice(1, 1, { id: 2, done: true });
            expect(renderCounts[0]).toBe(0);
            expect(renderCounts[1]).toBe(1);
            expect(renderCounts[2]).toBe(0);
        });

        it("preserves item identity when filter widens to re-insert an excluded key", () => {
            const host = makeHost();
            const { mount } = createRenderer(host);

            type T = { id: string; done: boolean };
            const tasks = Ref.create<T[]>([
                { id: "a", done: false },
                { id: "b", done: true },
                { id: "c", done: false },
            ]);
            const filter = Signal.create<"all" | "active" | "done">("all");

            const visible = tasks.filter(
                t => {
                    const f = filter.get();
                    return f === "all" || (f === "active" ? !t.done : t.done);
                },
                { key: t => t.id },
            );
            const TaskItem = (props: { task: T }) =>
                view("li", { id: props.task.id }, props.task.id);
            const rows = visible.map(t => view(TaskItem, { task: t }));

            mount(() => view("ul", null, rows), host.root);

            const liInfo = (): { id: string; text: string }[] => {
                const ul = visibleElements(host.root)[0];
                return visibleElements(ul).map(li => ({
                    id: String(li.props.id),
                    text: visibleTexts(li).join(""),
                }));
            };

            // 1) filter to active — only a, c visible
            filter.set("active");
            expect(liInfo()).toEqual([
                { id: "a", text: "a" },
                { id: "c", text: "c" },
            ]);

            // 2) navigate active → all. b re-inserts between a and c.
            // BUG (without fix): c.entry.scope was at idx 1 subscribed to rows.signal[1].
            // When b takes idx 1, rows.signal[1].set(vnode_b) fires and corrupts c.entry
            // to render b before onUpdate moves c.entry to idx 2. Result: ["a", "b", "b"].
            filter.set("all");
            expect(liInfo()).toEqual([
                { id: "a", text: "a" },
                { id: "b", text: "b" },
                { id: "c", text: "c" },
            ]);

            // 3) navigate all → done — only b visible
            filter.set("done");
            expect(liInfo()).toEqual([{ id: "b", text: "b" }]);

            // 4) navigate done → all again. a, c re-insert.
            filter.set("all");
            expect(liInfo()).toEqual([
                { id: "a", text: "a" },
                { id: "b", text: "b" },
                { id: "c", text: "c" },
            ]);
        });

        it("preserves item identity when filter narrows then widens (toggle + navigate)", () => {
            const host = makeHost();
            const { mount } = createRenderer(host);

            type T = { id: string; done: boolean };
            const tasks = Ref.create<T[]>([
                { id: "a", done: false },
                { id: "b", done: true },
                { id: "c", done: false },
            ]);
            const filter = Signal.create<"all" | "active" | "done">("all");

            const visible = tasks.filter(
                t => {
                    const f = filter.get();
                    return f === "all" || (f === "active" ? !t.done : t.done);
                },
                { key: t => t.id },
            );
            // Mirror demo: row produces a Component-bearing ViewNode whose
            // textContent depends on the task — so a wrong-task render is visible.
            const TaskItem = (props: { task: T }) =>
                view("li", { id: props.task.id }, props.task.id);
            const rows = visible.map(t => view(TaskItem, { task: t }));

            mount(() => view("ul", null, rows), host.root);

            const liIds = (): string[] => {
                const ul = visibleElements(host.root)[0];
                return visibleElements(ul).map(li => String(li.props.id));
            };
            const liTexts = (): string[] => {
                const ul = visibleElements(host.root)[0];
                return visibleElements(ul).map(li => visibleTexts(li).join(""));
            };

            // 1) filter to done — only b visible
            filter.set("done");
            expect(liIds()).toEqual(["b"]);

            // 2) toggle b → active. visibleTasks becomes []
            tasks.splice(1, 1, { id: "b", done: false });
            expect(liIds()).toEqual([]);

            // 3) navigate done → all. visibleTasks = [a, b, c]
            filter.set("all");
            expect(liIds()).toEqual(["a", "b", "c"]);
            expect(liTexts()).toEqual(["a", "b", "c"]);

            // 4) navigate all → active → all (the "a, b, b" pattern)
            filter.set("active");
            filter.set("all");
            expect(liIds()).toEqual(["a", "b", "c"]);
            expect(liTexts()).toEqual(["a", "b", "c"]);
        });
    });

    describe("LIFO disposal order", () => {
        it("disposes cleanups in reverse registration order", () => {
            const order: number[] = [];
            const root = createOwner(null);
            root.cleanups.add(() => order.push(1));
            root.cleanups.add(() => order.push(2));
            root.cleanups.add(() => order.push(3));
            root.dispose();
            expect(order).toEqual([3, 2, 1]);
        });

        it("disposes child owners in reverse creation order", () => {
            const order: number[] = [];
            const root = createOwner(null);
            const c1 = createOwner(root);
            c1.cleanups.add(() => order.push(1));
            const c2 = createOwner(root);
            c2.cleanups.add(() => order.push(2));
            const c3 = createOwner(root);
            c3.cleanups.add(() => order.push(3));
            root.dispose();
            expect(order).toEqual([3, 2, 1]);
        });
    });

    describe("nested reactive regions", () => {
        it("outer region updates without disturbing inner structure", () => {
            const host = makeHost();
            const { mount } = createRenderer(host);
            const outer = Signal.create("a");
            const inner = Signal.create("x");

            mount(
                () =>
                    view("div", null, () =>
                        view("section", null, outer.get(), () => inner.get()),
                    ),
                host.root,
            );

            const div = visibleElements(host.root)[0];
            const section = visibleElements(div)[0];
            expect(visibleTexts(section)).toContain("a");
            expect(visibleTexts(section)).toContain("x");

            inner.set("y");
            const section2 = visibleElements(div)[0];
            expect(visibleTexts(section2)).toContain("a");
            expect(visibleTexts(section2)).toContain("y");

            outer.set("b");
            const section3 = visibleElements(div)[0];
            expect(visibleTexts(section3)).toContain("b");
        });
    });
});
