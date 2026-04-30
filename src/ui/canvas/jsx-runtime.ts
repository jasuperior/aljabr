/**
 * JSX runtime for aljabr/ui/canvas.
 *
 * Set `jsxImportSource: "aljabr/ui/canvas"` in your `tsconfig.json` (or use
 * a per-file `/** @jsxImportSource aljabr/ui/canvas *\/` pragma) to have
 * TypeScript automatically import `jsx` and `Fragment` from this module.
 *
 * The factory is identical to the DOM runtime — both ultimately produce
 * `ViewNode` values that the core reconciler consumes. Only the
 * `JSX.IntrinsicElements` namespace differs: this runtime declares the
 * canvas-primitive tags (`rect`, `circle`, `ellipse`, `line`, `path`,
 * `group`, `text`) with structurally-typed props.
 *
 * @module
 */

import { type ViewNode, type Child, Fragment as FragmentSymbol, view } from "../view-node.ts";
import type { CanvasSyntheticEvent } from "./hit-test.ts";
import type { PaddingRect } from "./paint-context.ts";

export { FragmentSymbol as Fragment };

// ---------------------------------------------------------------------------
// JSX element factory — same shape as the DOM runtime. The behaviour split
// (DOM elements vs canvas primitives) lives at the host level, not here.
// ---------------------------------------------------------------------------

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

/** JSX factory for static and single-child expressions. */
export const jsx = _jsx;
/** JSX factory for multi-child expressions. */
export const jsxs = _jsx;
/** JSX dev-mode factory — no extra instrumentation. */
export const jsxDEV = _jsx;

// ---------------------------------------------------------------------------
// Reactive prop type
//
// Any prop value can be plain, a getter function, or a readable object
// (Signal/Derived/etc.). The renderer's normalizeProps + reactive-prop
// tracking handle all three uniformly.
// ---------------------------------------------------------------------------

type Reactive<T> = T | (() => T | null | undefined) | { get(): T | null };

// ---------------------------------------------------------------------------
// Shared canvas prop types
// ---------------------------------------------------------------------------

/** Inheritable paint props every canvas primitive accepts. */
interface InheritablePaintProps {
    fill?: Reactive<string>;
    stroke?: Reactive<string>;
    strokeWidth?: Reactive<number>;
    lineCap?: Reactive<"butt" | "round" | "square">;
    fontFamily?: Reactive<string>;
    fontSize?: Reactive<number>;
    fontWeight?: Reactive<string>;
    textAlign?: Reactive<"left" | "center" | "right">;
    verticalAlign?: Reactive<"top" | "middle" | "bottom">;
    padding?: Reactive<number | PaddingRect>;
}

/** Pointer / mouse / wheel handler set bubbled by the canvas hit-test. */
interface CanvasEventHandlers {
    onPointerDown?: (event: CanvasSyntheticEvent) => void;
    onPointerUp?: (event: CanvasSyntheticEvent) => void;
    onPointerMove?: (event: CanvasSyntheticEvent) => void;
    onPointerEnter?: (event: CanvasSyntheticEvent) => void;
    onPointerLeave?: (event: CanvasSyntheticEvent) => void;
    onClick?: (event: CanvasSyntheticEvent) => void;
    onDblClick?: (event: CanvasSyntheticEvent) => void;
    onContextMenu?: (event: CanvasSyntheticEvent) => void;
    onWheel?: (event: CanvasSyntheticEvent) => void;
    /** Pixel-perfect hit-test override; receives local-frame coords. */
    onHitTest?: (x: number, y: number) => boolean;
}

interface CommonCanvasProps extends InheritablePaintProps, CanvasEventHandlers {
    zIndex?: Reactive<number>;
    children?: Child | Child[];
}

// ---------------------------------------------------------------------------
// Per-tag prop interfaces
// ---------------------------------------------------------------------------

/**
 * `<rect>` — axis-aligned rectangle. A non-zero `rx` (corner radius) triggers
 * `ctx.roundRect`; otherwise the renderer uses `fillRect`/`strokeRect`.
 *
 * Doubles as a layout container for wrapped `<text>` children: see the
 * inheritable `textAlign` / `verticalAlign` / `padding` props on
 * {@link CommonCanvasProps} (via {@link InheritablePaintProps}) for the
 * label-positioning rules.
 *
 * @example
 * ```tsx
 * <rect x={10} y={10} width={120} height={40} rx={6}
 *       fill="white" stroke="black"
 *       textAlign="center" verticalAlign="middle">
 *   Click me
 * </rect>
 * ```
 */
export interface RectProps extends CommonCanvasProps {
    x?: Reactive<number>;
    y?: Reactive<number>;
    width?: Reactive<number>;
    height?: Reactive<number>;
    rx?: Reactive<number>;
}

/** `<circle cx cy r>`. */
export interface CircleProps extends CommonCanvasProps {
    cx?: Reactive<number>;
    cy?: Reactive<number>;
    r?: Reactive<number>;
}

/** `<ellipse cx cy rx ry>`. */
export interface EllipseProps extends CommonCanvasProps {
    cx?: Reactive<number>;
    cy?: Reactive<number>;
    rx?: Reactive<number>;
    ry?: Reactive<number>;
}

/** `<line x1 y1 x2 y2>`. */
export interface LineProps extends CommonCanvasProps {
    x1?: Reactive<number>;
    y1?: Reactive<number>;
    x2?: Reactive<number>;
    y2?: Reactive<number>;
}

/**
 * `<path>` — SVG path string consumed via `Path2D`.
 *
 * Note: in the current release a `<path>`'s `bounds` are not derived from
 * `d`; viewport culling treats paths as non-cullable (always paints) and the
 * AABB hit-test rejects them. Use `onHitTest` to make a path hittable —
 * typically `(x, y) => ctx.isPointInPath(path2D, x, y)`. The v0.3.9 roadmap
 * lifts this with a path-string parser.
 *
 * @example
 * ```tsx
 * const triangle = new Path2D("M 0 0 L 100 0 L 50 100 Z");
 * <path d="M 0 0 L 100 0 L 50 100 Z" fill="orange"
 *       onHitTest={(x, y) => ctx.isPointInPath(triangle, x, y)}
 *       onClick={() => console.log("triangle hit")} />
 * ```
 */
export interface PathProps extends CommonCanvasProps {
    d?: Reactive<string>;
}

/**
 * `<group>` — transform-only container.
 *
 * Two roles in one element:
 * - **Transform composition.** `x`, `y`, `scale`, and `rotate` (degrees)
 *   nest with the parent's accumulated transform via `ctx.save()` /
 *   `ctx.restore()`. Authors compose by nesting groups; there is no matrix
 *   prop.
 * - **Paint-context boundary.** A group whose props override any inheritable
 *   key (`fill`, `stroke`, `strokeWidth`, `fontFamily`, `fontSize`,
 *   `fontWeight`, `textAlign`, `verticalAlign`, `padding`) provides a new
 *   resolved context to its descendants. Non-group elements forward their
 *   parent's context unchanged.
 *
 * Groups are also transparent to hit testing — children come on top, the
 * group itself is never the hit target. Bubble handlers placed on the group
 * still run when a descendant is hit.
 *
 * @example
 * ```tsx
 * <group x={vp.x} y={vp.y} scale={vp.scale} fontSize={14}>
 *   <rect x={0} y={0} width={100} height={40}>Node A</rect>
 *   <rect x={120} y={0} width={100} height={40}>Node B</rect>
 * </group>
 * ```
 */
export interface GroupProps extends CommonCanvasProps {
    x?: Reactive<number>;
    y?: Reactive<number>;
    scale?: Reactive<number>;
    /** Rotation in degrees. */
    rotate?: Reactive<number>;
}

/**
 * `<text x y content>` — single-line text. When this element's parent is a
 * shape (rect/circle/ellipse/line/path), `x` and `y` are computed from the
 * parent's bounds + layout props; the props on this element are used only
 * for explicit positioning under non-shape parents (e.g. directly under
 * `<group>`).
 */
export interface TextProps extends CommonCanvasProps {
    x?: Reactive<number>;
    y?: Reactive<number>;
    content?: Reactive<string>;
}

// ---------------------------------------------------------------------------
// JSX namespace
// ---------------------------------------------------------------------------

/**
 * TypeScript JSX namespace for aljabr/ui/canvas.
 *
 * Consumed automatically when `jsxImportSource: "aljabr/ui/canvas"` is set
 * in `tsconfig.json`. The intrinsic-element interface is a closed set of
 * canvas primitives — DOM tags don't appear here; mix DOM and canvas trees
 * by giving the relevant component file a different `jsxImportSource`.
 */
export namespace JSX {
    /** The type returned by every JSX expression. */
    export type Element = ViewNode;

    export interface ElementChildrenAttribute {
        children: unknown;
    }

    export interface IntrinsicElements {
        rect: RectProps;
        circle: CircleProps;
        ellipse: EllipseProps;
        line: LineProps;
        path: PathProps;
        group: GroupProps;
        text: TextProps;
    }
}
