import { union, type Variant } from "../union.ts";
import { DerivedArray } from "../prelude/derived-array.ts";
import { RefArray } from "../prelude/ref.ts";

// ---------------------------------------------------------------------------
// Explicit variant payload types
// (declared before Child/ViewNode to allow forward reference)
// ---------------------------------------------------------------------------

type ComponentFn = (props: Record<string, unknown>) => ViewNode;

/**
 * A `ViewNode` variant describing a host element (e.g. `<div>`, `<button>`).
 *
 * Created by `view("div", props, ...children)` or the equivalent JSX.
 * @see {@link view}
 */
export type ElementViewNode = Variant<
    "Element",
    {
        tag: string;
        props: Record<string, unknown>;
        children: Child[];
    }
>;

/**
 * A `ViewNode` variant describing a static text node.
 *
 * Created automatically when a string or number is passed as a child.
 * @see {@link ViewNode.Text}
 */
export type TextViewNode = Variant<"Text", { content: string }>;

/**
 * A `ViewNode` variant describing a function component invocation.
 *
 * Created by `view(MyComponent, props)` or the equivalent JSX.
 * The component function receives its props (including `children`) as a
 * single object and returns a `ViewNode`.
 * @see {@link view}
 */
export type ComponentViewNode = Variant<
    "Component",
    {
        fn: ComponentFn;
        props: Record<string, unknown>;
    }
>;

/**
 * A `ViewNode` variant that groups multiple children without a wrapping element.
 *
 * Created by `view(Fragment, null, ...children)` or `<>...</>` in JSX.
 * The reconciler flattens fragment children directly into the parent.
 * @see {@link Fragment}
 */
export type FragmentViewNode = Variant<"Fragment", { children: Child[] }>;

// ---------------------------------------------------------------------------
// ViewNode — typed intermediate representation
//
// Variants are consumed synchronously on creation. There is no accumulation
// step and no tree diffing. Reactivity is handled by the signal layer —
// ViewNode is a typed dispatch mechanism, not a shadow DOM.
// ---------------------------------------------------------------------------

/**
 * The typed intermediate representation of renderable content.
 *
 * `ViewNode` is a tagged union with four variants:
 * - **Element** — a host element with a tag, props, and children
 * - **Text** — a static text node
 * - **Component** — a function component invocation
 * - **Fragment** — a grouping of children without a wrapping element
 *
 * `ViewNode` values are consumed synchronously by the reconciler; they are
 * not diffed or accumulated. Reactivity lives in the signal layer — function
 * children (`() => Child`) are the boundary between the static tree and the
 * reactive graph.
 *
 * Use {@link view} to create `ViewNode` values. The {@link ViewNode} object
 * (same name, different TypeScript namespace) exposes direct variant
 * constructors for lower-level use.
 *
 * @example
 * const node = view("div", { class: "app" },
 *   view("h1", null, "Hello"),
 *   view("p", null, () => count.get()),
 * );
 */
export type ViewNode =
    | ElementViewNode
    | TextViewNode
    | ComponentViewNode
    | FragmentViewNode;

// ---------------------------------------------------------------------------
// Child — everything view() accepts as a child argument
// ---------------------------------------------------------------------------

/**
 * Everything that can appear as a child of a `ViewNode`.
 *
 * | Type | Behavior |
 * |---|---|
 * | `string \| number \| boolean` | Rendered as a static text node |
 * | `null \| undefined \| false` | Rendered as nothing (skipped) |
 * | `ViewNode` | Mounted as-is |
 * | `() => Child` | **Reactive region** — re-evaluated when dependencies change |
 * | `DerivedArray<any>` | **Reactive list** — re-rendered when the array mutates |
 * | `RefArray<any>` | **Reactive list** — re-rendered when the array mutates |
 * | `{ get(): Child }` | **Readable shorthand** — normalized to `() => r.get()` by `view()` |
 *
 * @example
 * // Static text
 * view("p", null, "hello")
 *
 * // Reactive text via signal getter
 * view("p", null, () => name.get())
 *
 * // Conditional rendering
 * view("div", null, () => isOpen.get() ? view("span", null, "open") : null)
 *
 * // Reactive list
 * const items = ref.at("list").map(item => view("li", null, item.name));
 * view("ul", null, items)
 */
export type Child =
    | string
    | number
    | boolean
    | null
    | undefined
    | ViewNode
    | (() => Child)
    | DerivedArray<any> // invariant — accepts any DerivedArray regardless of item type
    | RefArray<any>      // invariant — accepts any RefArray regardless of item type
    | { get(): Child };  // any readable (Signal, Derived, custom) — normalized to () => r.get() in view()

// ---------------------------------------------------------------------------
// Fragment — special symbol for the JSX Fragment type
// ---------------------------------------------------------------------------

/**
 * Special symbol used as the `type` argument to `view()` (and in JSX as `<>`)
 * to create a {@link FragmentViewNode} — a group of children with no wrapping element.
 *
 * @example
 * // Direct API
 * view(Fragment, null, view("span", null, "a"), view("span", null, "b"))
 *
 * // JSX (requires jsxImportSource: "aljabr/ui" in tsconfig)
 * const el = <><span>a</span><span>b</span></>;
 */
export const Fragment: unique symbol = Symbol("aljabr.Fragment");
export type Fragment = typeof Fragment;

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Dev-mode flag — false in production builds (tree-shakeable)
// ---------------------------------------------------------------------------

const __DEV__ =
    (globalThis as { process?: { env?: { NODE_ENV?: string } } })
        .process?.env?.["NODE_ENV"] !== "production";

// ---------------------------------------------------------------------------
// Normalization helpers — called by view() before building ViewNode payloads
// ---------------------------------------------------------------------------

function isReadable(v: unknown): v is { get(): unknown } {
    return (
        v !== null &&
        typeof v === "object" &&
        !(v instanceof DerivedArray) &&
        !(v instanceof RefArray) &&
        typeof (v as Record<string, unknown>).get === "function"
    );
}

function normalizeChild(child: Child): Child {
    if (isReadable(child)) return () => (child as { get(): Child }).get();
    return child;
}

function normalizeProps(props: Record<string, unknown> | null): Record<string, unknown> {
    if (!props) return {};
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(props)) {
        out[key] = !key.startsWith("on") && isReadable(value)
            ? () => (value as { get(): unknown }).get()
            : value;
    }
    return out;
}

// ---------------------------------------------------------------------------
// Internal runtime factory
// Children stored as `any[]` internally to break the circular inference — the
// public `view()` API enforces `Child[]` at call sites.
// ---------------------------------------------------------------------------

const _factory = union({
    Element: (p: {
        tag: string;
        props: Record<string, unknown>;
        children: any[];
    }) => p,
    Text: (content: string) => ({ content }),
    Component: (p: { fn: ComponentFn; props: Record<string, unknown> }) => p,
    Fragment: (children: any[]) => ({ children }),
});

/**
 * Direct variant constructors for `ViewNode`.
 *
 * Prefer {@link view} for typical usage. These constructors are useful when
 * you need to build a `ViewNode` programmatically without the `view()` API,
 * or when implementing a custom renderer or transform.
 *
 * @example
 * ViewNode.Element({ tag: "div", props: { class: "box" }, children: [] })
 * ViewNode.Text("hello")
 * ViewNode.Component({ fn: MyComp, props: { label: "click" } })
 * ViewNode.Fragment([view("span", null, "a"), view("span", null, "b")])
 */
// Typed façade — value and type share the name (different TypeScript namespaces)
export const ViewNode = _factory as unknown as {
    Element(p: {
        tag: string;
        props: Record<string, unknown>;
        children: Child[];
    }): ElementViewNode;
    Text(content: string): TextViewNode;
    Component(p: {
        fn: ComponentFn;
        props: Record<string, unknown>;
    }): ComponentViewNode;
    Fragment(children: Child[]): FragmentViewNode;
};

// ---------------------------------------------------------------------------
// view() — primary authoring primitive and JSX factory target
// ---------------------------------------------------------------------------

/**
 * Create an {@link ElementViewNode} for a host element.
 *
 * @param tag - The HTML/XML tag name (e.g. `"div"`, `"button"`).
 * @param props - Element props/attributes, or `null` for none.
 * @param children - Zero or more {@link Child} values.
 * @returns An `ElementViewNode`.
 *
 * @example
 * view("div", { class: "card" },
 *   view("h2", null, title),
 *   view("p", null, () => body.get()),
 * )
 */
export function view(
    tag: string,
    props?: Record<string, unknown> | null,
    ...children: Child[]
): ElementViewNode;

/**
 * Create a {@link FragmentViewNode} — children with no wrapping element.
 *
 * @param tag - Must be {@link Fragment}.
 * @param props - Must be `null`.
 * @param children - Zero or more {@link Child} values to group.
 * @returns A `FragmentViewNode`.
 *
 * @example
 * view(Fragment, null, view("dt", null, "Term"), view("dd", null, "Definition"))
 */
export function view(
    tag: Fragment,
    props?: null,
    ...children: Child[]
): FragmentViewNode;

/**
 * Create a {@link ComponentViewNode} for a function component.
 *
 * Children passed as rest arguments are merged into `props.children`
 * (single child as a value, multiple children as an array).
 *
 * @param fn - The component function `(props: P) => ViewNode`.
 * @param props - Props to pass to the component, or `null` for none.
 * @param children - Zero or more children; merged into `props.children`.
 * @returns A `ComponentViewNode`.
 *
 * @remarks
 * **Component props are not auto-wrapped.** Unlike host element props,
 * readables (signals, deriveds) passed as component props are forwarded
 * as-is — the component receives the `Signal` object and decides where
 * reactivity goes. In development builds (`NODE_ENV !== "production"`), a
 * `console.warn` fires when a readable is detected as a component prop, to
 * surface this common mistake early.
 *
 * To re-run the whole component when an external signal changes, wrap the
 * invocation in a reactive region:
 * ```ts
 * () => view(Counter, { count: n.get() })
 * ```
 * To pass the signal through and let the component place reactivity
 * granularly, type the prop as `Signal<T>` and call `.get()` inside:
 * ```ts
 * function Counter({ count }: { count: Signal<number> }) {
 *   return view("strong", null, () => String(count.get()));
 * }
 * view(Counter, { count: n })
 * ```
 *
 * @example
 * const Button = ({ label, onClick }: { label: string; onClick: () => void }) =>
 *   view("button", { onClick }, label);
 *
 * view(Button, { label: "Save", onClick: handleSave })
 *
 * @example
 * // Children merged into props.children
 * const Card = ({ children }: { children: Child }) => view("div", { class: "card" }, children);
 * view(Card, {}, view("p", null, "content"))
 */
export function view<P extends Record<string, unknown>>(
    fn: (props: P) => ViewNode,
    props?: P | null,
    ...children: Child[]
): ComponentViewNode;

export function view(
    tagOrFn: string | Fragment | ComponentFn,
    props?: Record<string, unknown> | null,
    ...children: Child[]
): ViewNode {
    if (tagOrFn === Fragment) {
        return _factory.Fragment(children.map(normalizeChild));
    }
    if (typeof tagOrFn === "function") {
        const mergedProps: Record<string, unknown> = { ...(props ?? {}) };
        if (children.length > 0) {
            mergedProps.children =
                children.length === 1 ? children[0] : children;
        }
        if (__DEV__) {
            for (const [key, value] of Object.entries(mergedProps)) {
                if (isReadable(value)) {
                    console.warn(
                        `[aljabr] Signal/readable passed as component prop "${key}". ` +
                        `Components receive the raw value — call .get() inside the component body ` +
                        `to read it reactively, or use () => view(Component, { ${key}: signal.get() }) ` +
                        `to make the whole component reactive.`,
                    );
                }
            }
        }
        return _factory.Component({
            fn: tagOrFn as ComponentFn,
            props: mergedProps,
        });
    }
    return _factory.Element({
        tag: tagOrFn,
        props: normalizeProps(props ?? null),
        children: children.map(normalizeChild),
    });
}
