/**
 * JSX runtime for aljabr/ui/prose.
 *
 * Set `jsxImportSource: "aljabr/ui/prose"` in your `tsconfig.json` (or use a
 * per-file `/** @jsxImportSource aljabr/ui/prose * /` pragma) to type prose
 * components against the closed primitive set.
 *
 * The runtime body is a thin wrapper over `view()` — the renderer
 * (Phase 4: `ProseRenderer.create`) consumes the resulting ViewNodes.
 *
 * @module
 */
import { type ViewNode, type Child, Fragment as FragmentSymbol, view } from "../view-node.ts";
import type { MarkSet } from "./document-model.ts";

export { FragmentSymbol as Fragment };

type JsxProps = Record<string, unknown> & { children?: unknown };

function _jsx(type: typeof FragmentSymbol, props: { children?: unknown }, _key?: string): ViewNode;
function _jsx(type: string, props: JsxProps, _key?: string): ViewNode;
function _jsx<P extends Record<string, unknown>>(type: (props: P) => ViewNode, props: P & { children?: unknown }, _key?: string): ViewNode;
function _jsx(
    type: string | typeof FragmentSymbol | ((props: Record<string, unknown>) => ViewNode),
    props: JsxProps,
    _key?: string,
): ViewNode {
    const { children: rawChildren, ...ownProps } = props;

    if (type === FragmentSymbol) {
        const children = normalizeChildren(rawChildren);
        return view(FragmentSymbol, null, ...children);
    }

    if (typeof type === "function") {
        return view(
            type as (props: Record<string, unknown>) => ViewNode,
            { ...ownProps, ...(rawChildren !== undefined ? { children: rawChildren } : {}) },
        );
    }

    const children = normalizeChildren(rawChildren);
    return view(type, Object.keys(ownProps).length > 0 ? ownProps : null, ...children);
}

function normalizeChildren(raw: unknown): Child[] {
    if (raw === undefined) return [];
    if (Array.isArray(raw)) return raw as Child[];
    return [raw as Child];
}

export const jsx = _jsx;
export const jsxs = _jsx;
export const jsxDEV = _jsx;

// ---------------------------------------------------------------------------
// JSX namespace — prose intrinsic elements
// ---------------------------------------------------------------------------

type Common = { id?: string; children?: unknown };

type TextMarkProps = {
    bold?: boolean;
    italic?: boolean;
    underline?: boolean;
    strike?: boolean;
    code?: boolean;
    link?: { href: string };
    color?: string;
    backgroundColor?: string;
    fontFamily?: string;
    fontSize?: string | number;
    marks?: MarkSet[];
};

// ---------------------------------------------------------------------------
// Embed registry (type-level)
//
// `ProseEmbeds` is an interface that authors augment via TypeScript module
// augmentation to register their embed payloads. The runtime renderer
// (Phase 4) consults a parallel value-level registry; the two are kept in
// sync by `<Prose embeds={…}>` typing.
//
// The package itself ships a default `image` registration on this interface
// (the `image` embed is included automatically by `<Prose>`).
// ---------------------------------------------------------------------------

export interface ProseEmbeds {
    image: { src: string; alt?: string | null; caption?: string | null };
}

type EmbedIntrinsics = {
    [K in keyof ProseEmbeds]: Common & ProseEmbeds[K];
};

type StructuralIntrinsics = {
    document:    Common & { state?: unknown; readonly?: boolean; bindings?: unknown };
    block:       Common;
    heading:     Common & { level: 1 | 2 | 3 | 4 | 5 | 6 };
    quote:       Common;
    code:        Common & { language?: string };
    list:        Common & { ordered?: boolean };
    listItem:    Common;
    text:        Common & TextMarkProps;
    break:       Common;
    hr:          Common;
    blockEmbed:  Common & { name: string; payload: unknown };
    inlineEmbed: Common & { name: string; payload: unknown };
};

export namespace JSX {
    export type Element = ViewNode;

    export interface ElementChildrenAttribute {
        children: unknown;
    }

    export interface IntrinsicElements
        extends StructuralIntrinsics, EmbedIntrinsics {}
}
