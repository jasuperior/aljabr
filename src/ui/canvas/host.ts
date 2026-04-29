/**
 * Canvas implementation of {@link RendererHost}.
 *
 * `canvasHost` adapts the `RendererHost<N, E>` contract used by the core
 * reconciler to a retained-mode canvas scene graph, where `N = CanvasNode`
 * and `E = CanvasElementNode`. The reconciler is unchanged — it sees the same
 * createElement/insert/setProperty/… surface it uses for the DOM.
 *
 * @module
 */

import { match } from "../../match.ts";
import { __, when } from "../../union.ts";
import type { RendererHost } from "../types.ts";
import {
    CanvasNode,
    type CanvasBounds,
    type CanvasElementNode,
    type CanvasNode as CanvasNodeT,
    type CanvasTag,
    type CanvasTextNode,
    zeroBounds,
} from "./node.ts";

// ---------------------------------------------------------------------------
// Parent tracking for Text nodes
//
// The `CanvasTextNode` variant intentionally carries no `parent` field — only
// `content`. To make `remove(textNode)` and `nextSibling(textNode)` work, the
// host keeps a side WeakMap from text nodes to their containing element. The
// map is updated by `insert` and `remove` and is invisible to authors.
// ---------------------------------------------------------------------------

const textParents = new WeakMap<CanvasTextNode, CanvasElementNode>();

// ---------------------------------------------------------------------------
// Geometry props that trigger eager bounds recomputation in setProperty
// ---------------------------------------------------------------------------

const GEOMETRY_KEYS: ReadonlySet<string> = new Set([
    "x", "y", "width", "height",
    "cx", "cy", "r", "rx", "ry",
    "x1", "y1", "x2", "y2",
    "d",
]);

function num(v: unknown, fallback = 0): number {
    return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

// Eager bounds recompute for Element primitives. Path (SVG path-string
// parsing) and group (union of descendants) bounds land in Phase 4 alongside
// viewport culling — until then those tags fall through the `when(__)` arm
// to `zeroBounds()`. The reconciler never calls `recomputeBounds` on a `Text`
// variant (it has no geometry props to set), but the union-level `match`
// keeps the dispatch exhaustive.
function recomputeBounds(node: CanvasNodeT): CanvasBounds {
    return match(node, {
        Element: [
            when({ tag: "rect" }, ({ props }) => ({
                x: num(props.x),
                y: num(props.y),
                width: num(props.width),
                height: num(props.height),
            })),
            when({ tag: "circle" }, ({ props }) => {
                const cx = num(props.cx);
                const cy = num(props.cy);
                const r = num(props.r);
                return { x: cx - r, y: cy - r, width: r * 2, height: r * 2 };
            }),
            when({ tag: "ellipse" }, ({ props }) => {
                const cx = num(props.cx);
                const cy = num(props.cy);
                const rx = num(props.rx);
                const ry = num(props.ry);
                return { x: cx - rx, y: cy - ry, width: rx * 2, height: ry * 2 };
            }),
            when({ tag: "line" }, ({ props }) => {
                const x1 = num(props.x1);
                const y1 = num(props.y1);
                const x2 = num(props.x2);
                const y2 = num(props.y2);
                return {
                    x: Math.min(x1, x2),
                    y: Math.min(y1, y2),
                    width: Math.abs(x2 - x1),
                    height: Math.abs(y2 - y1),
                };
            }),
            when(__, () => zeroBounds()),
        ],
        Text: () => zeroBounds(),
    });
}

// ---------------------------------------------------------------------------
// canvasHost — RendererHost<CanvasNode, CanvasElementNode>
// ---------------------------------------------------------------------------

/**
 * Retained-mode canvas implementation of {@link RendererHost}.
 *
 * Pass to {@link createRenderer} (typically pre-wired by
 * `createCanvasRenderer` from Phase 4) to mount component trees into a
 * `CanvasRenderingContext2D`-backed scene graph.
 *
 * @example
 * import { createRenderer } from "aljabr/ui";
 * import { canvasHost } from "aljabr/ui/canvas";
 *
 * const { mount } = createRenderer(canvasHost);
 */
export const canvasHost: RendererHost<CanvasNodeT, CanvasElementNode> = {
    createElement(tag: string): CanvasElementNode {
        return CanvasNode.Element({
            tag: tag as CanvasTag,
            props: {},
            children: [],
            parent: null,
            bounds: zeroBounds(),
            zIndex: 0,
        });
    },

    createText(text: string): CanvasNodeT {
        return CanvasNode.Text(text);
    },

    insert(parent: CanvasElementNode, child: CanvasNodeT, anchor?: CanvasNodeT | null): void {
        // Detach from any previous parent first — matches DOM `insertBefore`
        // semantics and keeps the scene graph internally consistent under
        // reconciler-driven moves (e.g. keyed list reorders).
        canvasHost.remove(child);

        const idx = anchor != null ? parent.children.indexOf(anchor) : -1;
        if (idx === -1) {
            parent.children.push(child);
        } else {
            parent.children.splice(idx, 0, child);
        }

        match(child, {
            Element: (n) => { n.parent = parent; },
            Text: (n) => { textParents.set(n, parent); },
        });
    },

    remove(child: CanvasNodeT): void {
        const parent = match(child, {
            Element: (n) => n.parent,
            Text: (n) => textParents.get(n) ?? null,
        });
        if (parent === null) return;

        const idx = parent.children.indexOf(child);
        if (idx !== -1) parent.children.splice(idx, 1);

        match(child, {
            Element: (n) => { n.parent = null; },
            Text: (n) => { textParents.delete(n); },
        });
    },

    setProperty(el: CanvasElementNode, key: string, value: unknown): void {
        el.props[key] = value;

        if (key === "zIndex") {
            el.zIndex = num(value);
            return;
        }

        if (GEOMETRY_KEYS.has(key)) {
            el.bounds = recomputeBounds(el);
        }
    },

    setText(node: CanvasNodeT, text: string): void {
        match(node, {
            Text: (n) => { n.content = text; },
            Element: () => { /* no-op — element nodes have no text content */ },
        });
    },

    parentNode(node: CanvasNodeT): CanvasElementNode | null {
        return match(node, {
            Element: (n) => n.parent,
            Text: () => null,
        });
    },

    nextSibling(node: CanvasNodeT): CanvasNodeT | null {
        const parent = match(node, {
            Element: (n) => n.parent,
            Text: (n) => textParents.get(n) ?? null,
        });
        if (parent === null) return null;
        const idx = parent.children.indexOf(node);
        if (idx === -1 || idx === parent.children.length - 1) return null;
        return parent.children[idx + 1];
    },
};
