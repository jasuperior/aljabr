/**
 * Canvas scene-graph node types — the canvas-renderer parallel to `ViewNode`.
 *
 * `CanvasNode` is an aljabr union with two variants:
 * - **Element** — a host primitive (`rect`, `circle`, `path`, `group`, `text`, …)
 *   carrying tag, props, children, parent pointer, axis-aligned bounds, and
 *   z-index.
 * - **Text** — a leaf string node. Wrapped implicitly by the host into a
 *   synthetic `<text>` element (Phase 5) when inserted as a child of a
 *   non-`text` element.
 *
 * @module
 */

import { union, type Variant } from "../../union.ts";

// ---------------------------------------------------------------------------
// Tag literal + bounds shape
// ---------------------------------------------------------------------------

/** Every canvas primitive supported by the renderer. */
export type CanvasTag =
    | "rect"
    | "circle"
    | "ellipse"
    | "line"
    | "path"
    | "group"
    | "text";

/** Axis-aligned world-space bounding box used for hit testing and culling. */
export interface CanvasBounds {
    x: number;
    y: number;
    width: number;
    height: number;
}

/** All-zero bounds — used as the initial value before geometry props are set. */
export function zeroBounds(): CanvasBounds {
    return { x: 0, y: 0, width: 0, height: 0 };
}

// ---------------------------------------------------------------------------
// Variant payload types
// ---------------------------------------------------------------------------

/**
 * A `CanvasNode` variant describing a host primitive (e.g. `<rect>`, `<group>`).
 *
 * Created by `CanvasNode.Element({ ... })` (typically through the renderer
 * host's `createElement` rather than directly).
 */
export type CanvasElementNode = Variant<
    "Element",
    {
        tag: CanvasTag;
        props: Record<string, unknown>;
        children: CanvasNode[];
        parent: CanvasElementNode | null;
        bounds: CanvasBounds;
        zIndex: number;
        hitTest?: (x: number, y: number) => boolean;
    }
>;

/**
 * A `CanvasNode` variant describing a leaf string node.
 *
 * Created by `CanvasNode.Text("…")`. The host wraps text nodes into synthetic
 * `<text>` elements at insert time (Phase 5); bare text nodes are not painted.
 */
export type CanvasTextNode = Variant<"Text", { content: string }>;

// ---------------------------------------------------------------------------
// CanvasNode — the union type
// ---------------------------------------------------------------------------

/**
 * Tagged union of every node that can appear in the canvas scene graph.
 *
 * Use {@link CanvasNode.Element} / {@link CanvasNode.Text} to construct values,
 * and `match` from `aljabr` to dispatch on the variant.
 */
export type CanvasNode = CanvasElementNode | CanvasTextNode;

// ---------------------------------------------------------------------------
// Internal factory
//
// Children stored as `any[]` internally to break circular inference — the
// public façade tightens the parameter type back to `CanvasNode[]`.
// ---------------------------------------------------------------------------

const _canvasFactory = union({
    Element: (p: {
        tag: CanvasTag;
        props: Record<string, unknown>;
        children: any[];
        parent: CanvasElementNode | null;
        bounds: CanvasBounds;
        zIndex: number;
        hitTest?: (x: number, y: number) => boolean;
    }) => p,
    Text: (content: string) => ({ content }),
});

// ---------------------------------------------------------------------------
// CanvasNode — typed façade (value and type share the name)
// ---------------------------------------------------------------------------

/**
 * Direct variant constructors for {@link CanvasNode}.
 *
 * @example
 * CanvasNode.Element({
 *   tag: "rect",
 *   props: { x: 0, y: 0, width: 10, height: 10 },
 *   children: [],
 *   parent: null,
 *   bounds: { x: 0, y: 0, width: 10, height: 10 },
 *   zIndex: 0,
 * });
 *
 * CanvasNode.Text("hello");
 */
export const CanvasNode = _canvasFactory as unknown as {
    Element(p: {
        tag: CanvasTag;
        props: Record<string, unknown>;
        children: CanvasNode[];
        parent: CanvasElementNode | null;
        bounds: CanvasBounds;
        zIndex: number;
        hitTest?: (x: number, y: number) => boolean;
    }): CanvasElementNode;
    Text(content: string): CanvasTextNode;
};
