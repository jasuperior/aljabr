import { union, type Variant } from "../union.ts";
import type { ReactiveArray } from "../prelude/reactive-array.ts";

// ---------------------------------------------------------------------------
// Explicit variant payload types
// (declared before Child/ViewNode to allow forward reference)
// ---------------------------------------------------------------------------

type ComponentFn = (props: Record<string, unknown>) => ViewNode;

export type ElementViewNode = Variant<
    "Element",
    {
        tag: string;
        props: Record<string, unknown>;
        children: Child[];
    }
>;

export type TextViewNode = Variant<"Text", { content: string }>;

export type ComponentViewNode = Variant<
    "Component",
    {
        fn: ComponentFn;
        props: Record<string, unknown>;
    }
>;

export type FragmentViewNode = Variant<"Fragment", { children: Child[] }>;

// ---------------------------------------------------------------------------
// ViewNode — typed intermediate representation
//
// Variants are consumed synchronously on creation. There is no accumulation
// step and no tree diffing. Reactivity is handled by the signal layer —
// ViewNode is a typed dispatch mechanism, not a shadow DOM.
// ---------------------------------------------------------------------------

export type ViewNode =
    | ElementViewNode
    | TextViewNode
    | ComponentViewNode
    | FragmentViewNode;

// ---------------------------------------------------------------------------
// Child — everything view() accepts as a child argument
// ---------------------------------------------------------------------------

export type Child =
    | string
    | number
    | boolean
    | null
    | undefined
    | ViewNode
    | (() => Child)
    | ReactiveArray<any>; // invariant class — accepts any ReactiveArray regardless of item type

// ---------------------------------------------------------------------------
// Fragment — special symbol for the JSX Fragment type
// ---------------------------------------------------------------------------

export const Fragment: unique symbol = Symbol("aljabr.Fragment");
export type Fragment = typeof Fragment;

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

export function view(
    tag: string,
    props?: Record<string, unknown> | null,
    ...children: Child[]
): ElementViewNode;
export function view(
    tag: Fragment,
    props?: null,
    ...children: Child[]
): FragmentViewNode;
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
        return _factory.Fragment(children);
    }
    if (typeof tagOrFn === "function") {
        const mergedProps: Record<string, unknown> = { ...(props ?? {}) };
        if (children.length > 0) {
            mergedProps.children =
                children.length === 1 ? children[0] : children;
        }
        return _factory.Component({
            fn: tagOrFn as ComponentFn,
            props: mergedProps,
        });
    }
    return _factory.Element({ tag: tagOrFn, props: props ?? {}, children });
}
