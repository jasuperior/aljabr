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

const __DEV__ =
    (globalThis as { process?: { env?: { NODE_ENV?: string } } })
        .process?.env?.["NODE_ENV"] !== "production";

// ---------------------------------------------------------------------------
// Implicit `<text>` wrapping (Phase 5.3)
//
// When the reconciler inserts a `CanvasTextNode` into a non-`text`
// `CanvasElementNode`, the host wraps the text in a synthetic
// `<text>` element and stores *that* in the parent's `children` array. The
// reconciler keeps holding the original Text reference; the host translates
// every subsequent operation (`remove`, `setText`, `nextSibling`) through
// the maps below so the synthetic wrapper stays an internal detail.
//
// `textWrappers` — Text → its synthetic `<text>` wrapper.
// `wrapperToText` — wrapper → original Text. Lets `nextSibling` return the
//   reference the reconciler already holds, instead of a wrapper Element it
//   never authored. Without this, mountReactiveRegion's `cur !== end`
//   anchor walk would silently fail to terminate.
// ---------------------------------------------------------------------------

const textWrappers = new WeakMap<CanvasTextNode, CanvasElementNode>();
const wrapperToText = new WeakMap<CanvasElementNode, CanvasTextNode>();

function isWrapper(el: CanvasElementNode): boolean {
    return wrapperToText.has(el);
}

/** What's actually stored in `parent.children` for the given reconciler node. */
function actualNode(node: CanvasNodeT): CanvasNodeT {
    return match(node, {
        Element: () => node,
        Text: (t) => textWrappers.get(t) ?? node,
    });
}

/** What reference the reconciler should see — re-collapsing wrappers. */
function unwrap(node: CanvasNodeT): CanvasNodeT {
    return match(node, {
        Element: (e) => wrapperToText.get(e) ?? node,
        Text: () => node,
    });
}

function wrapText(textNode: CanvasTextNode): CanvasElementNode {
    const wrapper = CanvasNode.Element({
        tag: "text",
        props: { content: textNode.content },
        children: [],
        parent: null,
        bounds: zeroBounds(),
        zIndex: 0,
    });
    textWrappers.set(textNode, wrapper);
    wrapperToText.set(wrapper, textNode);
    return wrapper;
}

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
// parsing) and group (union of descendants) bounds remain deferred — those
// tags fall through the `when(__)` arm to `zeroBounds()`. The reconciler
// never calls `recomputeBounds` on a `Text` variant (it has no geometry
// props to set), but the union-level `match` keeps the dispatch exhaustive.
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

        // Phase 5.3: wrap a Text variant into a synthetic `<text>` element
        // when its parent isn't already a `<text>`. The wrapper is what
        // physically lives in `parent.children` from now on; the original
        // Text reference is held only as the reconciler's handle.
        const inserted: CanvasNodeT = match(child, {
            Element: () => child,
            Text: (textNode) => {
                if (parent.tag === "text") return child;
                if (__DEV__ && (parent.tag === "path" || parent.tag === "line")) {
                    console.warn(
                        `[aljabr/canvas] Text inserted into <${parent.tag}> — ` +
                        `no meaningful layout bounds, position will fall back to (0, 0).`,
                    );
                }
                return wrapText(textNode);
            },
        });

        const anchorActual = anchor != null ? actualNode(anchor) : null;
        const idx = anchorActual !== null ? parent.children.indexOf(anchorActual) : -1;
        if (idx === -1) {
            parent.children.push(inserted);
        } else {
            parent.children.splice(idx, 0, inserted);
        }

        match(inserted, {
            Element: (n) => { n.parent = parent; },
            // A bare Text (parent was `<text>`, no wrap) gets no parent
            // tracking — the spec keeps `parentNode(textNode)` returning
            // null and that branch never participates in scene-graph walks.
            Text: () => undefined,
        });
    },

    remove(child: CanvasNodeT): void {
        const target = actualNode(child);
        const parent = match(target, {
            Element: (n) => n.parent,
            Text: () => null,
        });
        if (parent === null) return;

        const idx = parent.children.indexOf(target);
        if (idx !== -1) parent.children.splice(idx, 1);

        match(target, {
            Element: (n) => { n.parent = null; },
            Text: () => undefined,
        });

        // For wrapped Text, drop both map entries.
        match(child, {
            Text: (t) => {
                const wrapper = textWrappers.get(t);
                if (wrapper !== undefined) {
                    textWrappers.delete(t);
                    wrapperToText.delete(wrapper);
                }
            },
            Element: () => undefined,
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
            Text: (n) => {
                n.content = text;
                const wrapper = textWrappers.get(n);
                if (wrapper !== undefined) wrapper.props.content = text;
            },
            Element: () => { /* no-op — element nodes have no text content */ },
        });
    },

    parentNode(node: CanvasNodeT): CanvasElementNode | null {
        return match(node, {
            Element: (n) => (isWrapper(n) ? null : n.parent),
            Text: () => null,
        });
    },

    nextSibling(node: CanvasNodeT): CanvasNodeT | null {
        const target = actualNode(node);
        const parent = match(target, {
            Element: (n) => n.parent,
            Text: () => null,
        });
        if (parent === null) return null;
        const idx = parent.children.indexOf(target);
        if (idx === -1 || idx === parent.children.length - 1) return null;
        return unwrap(parent.children[idx + 1]);
    },
};
