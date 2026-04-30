/**
 * Hit testing and event dispatch for the canvas renderer.
 *
 * - {@link hitTest} walks the scene graph in **reverse paint order** (topmost
 *   sibling first), accumulating a world-to-screen affine matrix as it
 *   descends through `<group>` transforms. At each non-group `Element` it
 *   inverse-transforms the screen point into the element's local frame and
 *   tests `bounds`; an optional `el.hitTest(lx, ly)` provides pixel-perfect
 *   verification. Groups are transparent — children come on top, the group
 *   itself is never the hit target.
 * - {@link bubbleEvent} dispatches a synthetic {@link CanvasSyntheticEvent}
 *   from a hit target up through `parent` pointers, calling each ancestor's
 *   matching `on*` prop until either the root is reached or
 *   `event.stopPropagation()` is called.
 *
 * The reconciler treats every `on*` prop as a non-reactive callback (it
 * skips functions whose key starts with `"on"`). That's the convention the
 * pixel-perfect override piggybacks on: authors write `onHitTest={…}` and
 * the host hoists it onto `el.hitTest`.
 *
 * @module
 */

import { match } from "../../match.ts";
import type { CanvasElementNode, CanvasNode } from "./node.ts";

// ---------------------------------------------------------------------------
// Affine matrix helpers
//
// Encodes a 2D affine transform as `[a, b, c, d, e, f]`, matching the
// `CanvasRenderingContext2D` setTransform/transform argument order:
//
//   |a c e|
//   |b d f|
//   |0 0 1|
//
// World-to-screen point: `s = (a*w.x + c*w.y + e, b*w.x + d*w.y + f)`.
// ---------------------------------------------------------------------------

type AffineMatrix = readonly [a: number, b: number, c: number, d: number, e: number, f: number];

const IDENTITY: AffineMatrix = [1, 0, 0, 1, 0, 0];

/** `m * n` — apply n first, then m, when transforming a point. */
function compose(m: AffineMatrix, n: AffineMatrix): AffineMatrix {
    const [a1, b1, c1, d1, e1, f1] = m;
    const [a2, b2, c2, d2, e2, f2] = n;
    return [
        a1 * a2 + c1 * b2,
        b1 * a2 + d1 * b2,
        a1 * c2 + c1 * d2,
        b1 * c2 + d1 * d2,
        a1 * e2 + c1 * f2 + e1,
        b1 * e2 + d1 * f2 + f1,
    ];
}

/** Apply `m^-1` to a point — converting screen space back to local space. */
function applyInverse(m: AffineMatrix, x: number, y: number): { x: number; y: number } {
    const [a, b, c, d, e, f] = m;
    const det = a * d - b * c;
    if (det === 0) return { x, y };
    const px = x - e;
    const py = y - f;
    return {
        x: (d * px - c * py) / det,
        y: (-b * px + a * py) / det,
    };
}

/**
 * The `<group>` paint pass does `translate(x, y) → rotate(θ) → scale(s)` in
 * that order, post-multiplying onto the running ctx matrix. We mirror that
 * composition here so the inverse hit walk lines up exactly with what the
 * paint pass renders.
 */
function groupLocalMatrix(props: Record<string, unknown>): AffineMatrix {
    const tx = numProp(props.x);
    const ty = numProp(props.y);
    const rot = (numProp(props.rotate) * Math.PI) / 180;
    const s = numProp(props.scale, 1);
    const cos = Math.cos(rot);
    const sin = Math.sin(rot);
    // T * R * S
    return [
        s * cos,
        s * sin,
        -s * sin,
        s * cos,
        tx,
        ty,
    ];
}

function numProp(v: unknown, fallback = 0): number {
    return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

// ---------------------------------------------------------------------------
// Hit test
// ---------------------------------------------------------------------------

function isElement(node: CanvasNode): node is CanvasElementNode {
    return match(node, {
        Element: () => true,
        Text: () => false,
    });
}

function boundsContains(b: { x: number; y: number; width: number; height: number }, x: number, y: number): boolean {
    return x >= b.x && x <= b.x + b.width && y >= b.y && y <= b.y + b.height;
}

/**
 * Walk the scene graph rooted at `root` and return the topmost `Element`
 * whose bounds (in its own local frame) contain the given screen-space point.
 *
 * `root` is typically the synthetic `<group>` allocated by
 * `createCanvasRenderer`; pass any element to constrain the search.
 *
 * Returns `null` when no element is hit.
 */
export function hitTest(
    root: CanvasElementNode,
    sx: number,
    sy: number,
): CanvasElementNode | null {
    return hitTestNode(root, sx, sy, IDENTITY);
}

function hitTestNode(
    el: CanvasElementNode,
    sx: number,
    sy: number,
    parentMatrix: AffineMatrix,
): CanvasElementNode | null {
    // Compose this element's local transform if it's a group; otherwise the
    // element shares its parent's frame.
    const local = el.tag === "group"
        ? compose(parentMatrix, groupLocalMatrix(el.props))
        : parentMatrix;

    // Children are stored sorted ascending zIndex (the paint pass sorts in
    // place). Reverse iteration walks topmost → bottommost, which is the
    // reverse paint order the hit test wants.
    for (let i = el.children.length - 1; i >= 0; i--) {
        const child = el.children[i];
        if (!isElement(child)) continue;
        const hit = hitTestNode(child, sx, sy, local);
        if (hit !== null) return hit;
    }

    // Groups are transparent — only their descendants can be hit.
    if (el.tag === "group") return null;

    // Inverse-transform the screen point into the element's local frame.
    const { x: lx, y: ly } = applyInverse(local, sx, sy);

    // When an `onHitTest` override is provided, it is authoritative — the
    // axis-aligned `bounds` rect is skipped. This is the only path
    // available for tags whose bounds are not yet computed (`path` reports
    // `zeroBounds()` until path-string parsing lands), and it matches the
    // intent of the override: "the bounds rect doesn't describe me, ask
    // this function instead."
    if (typeof el.hitTest === "function") {
        return el.hitTest(lx, ly) ? el : null;
    }

    // Otherwise the element is hit when its bounds contain the point.
    if (!boundsContains(el.bounds, lx, ly)) return null;
    return el;
}

// ---------------------------------------------------------------------------
// Event bubbling and synthetic event shape
// ---------------------------------------------------------------------------

/**
 * Native event types the canvas renderer listens for, paired with the
 * camel-cased `on*` prop name handlers must declare.
 */
export const EVENT_HANDLER_MAP: Readonly<Record<string, string>> = {
    pointerdown: "onPointerDown",
    pointerup: "onPointerUp",
    pointermove: "onPointerMove",
    pointerenter: "onPointerEnter",
    pointerleave: "onPointerLeave",
    click: "onClick",
    dblclick: "onDblClick",
    contextmenu: "onContextMenu",
    wheel: "onWheel",
};

/**
 * The synthetic event passed to each `on*` handler during bubbling.
 *
 * Mirrors the most-used fields of `PointerEvent` and `WheelEvent`. Handlers
 * receive both the resolved `target` (the deepest hit element) and a
 * reference to the underlying `nativeEvent`. `stopPropagation()` halts the
 * bubble; `preventDefault()` forwards to the native event.
 */
export interface CanvasSyntheticEvent {
    type: string;
    target: CanvasElementNode;
    offsetX: number;
    offsetY: number;
    clientX: number;
    clientY: number;
    buttons: number;
    button: number;
    ctrlKey: boolean;
    shiftKey: boolean;
    altKey: boolean;
    metaKey: boolean;
    /** PointerEvent-only — `undefined` for non-pointer events like `wheel`. */
    pointerType?: string;
    /** PointerEvent-only. */
    pointerId?: number;
    /** WheelEvent-only. */
    deltaX?: number;
    /** WheelEvent-only. */
    deltaY?: number;
    /** WheelEvent-only. */
    deltaZ?: number;
    /** WheelEvent-only. */
    deltaMode?: number;
    nativeEvent: Event;
    stopPropagation(): void;
    preventDefault(): void;
}

/**
 * Build a synthetic event from the native pointer/wheel/mouse event.
 *
 * `target` is the deepest hit `CanvasElementNode`. The `propagationStopped`
 * closure is captured so {@link bubbleEvent} can read whether a handler
 * called `stopPropagation()` on this synthetic.
 */
function buildSynthetic(
    type: string,
    target: CanvasElementNode,
    native: Event,
): { event: CanvasSyntheticEvent; isStopped: () => boolean } {
    let stopped = false;
    const m = native as MouseEvent & WheelEvent & PointerEvent;
    const event: CanvasSyntheticEvent = {
        type,
        target,
        offsetX: m.offsetX ?? 0,
        offsetY: m.offsetY ?? 0,
        clientX: m.clientX ?? 0,
        clientY: m.clientY ?? 0,
        buttons: m.buttons ?? 0,
        button: m.button ?? 0,
        ctrlKey: m.ctrlKey ?? false,
        shiftKey: m.shiftKey ?? false,
        altKey: m.altKey ?? false,
        metaKey: m.metaKey ?? false,
        pointerType: (m as PointerEvent).pointerType,
        pointerId: (m as PointerEvent).pointerId,
        deltaX: (m as WheelEvent).deltaX,
        deltaY: (m as WheelEvent).deltaY,
        deltaZ: (m as WheelEvent).deltaZ,
        deltaMode: (m as WheelEvent).deltaMode,
        nativeEvent: native,
        stopPropagation() {
            stopped = true;
        },
        preventDefault() {
            native.preventDefault();
        },
    };
    return { event, isStopped: () => stopped };
}

/**
 * Bubble a native event from a hit target up through `parent` pointers,
 * invoking each ancestor's matching `on*` prop until either the root is
 * reached or a handler calls `event.stopPropagation()`.
 *
 * Returns `true` if any handler ran (for downstream tooling), `false`
 * otherwise.
 */
export function bubbleEvent(
    target: CanvasElementNode,
    native: Event,
): boolean {
    const handlerKey = EVENT_HANDLER_MAP[native.type];
    if (!handlerKey) return false;

    const { event, isStopped } = buildSynthetic(native.type, target, native);

    let any = false;
    let cur: CanvasElementNode | null = target;
    while (cur !== null && !isStopped()) {
        const handler = cur.props[handlerKey];
        if (typeof handler === "function") {
            (handler as (e: CanvasSyntheticEvent) => void)(event);
            any = true;
        }
        cur = cur.parent;
    }
    return any;
}
