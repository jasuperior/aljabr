/**
 * Canvas paint pass.
 *
 * Walks a `CanvasElementNode` scene graph and emits the corresponding
 * `CanvasRenderingContext2D` calls. The flush driver (typically
 * `createCanvasRenderer`) is responsible for clearing the backing canvas
 * before invoking {@link paintNode} on the root; this module performs no
 * clearing of its own.
 *
 * Dispatch is consistently `match` + `when` on the `CanvasNode` union — first
 * by variant (`Element` vs `Text`), then by `tag` for the per-primitive paint
 * operations. The structural pattern matches keep the per-tag arms typed to
 * the matched payload and let new primitives slot in with one `when` arm
 * rather than a new switch case.
 *
 * Inheritable paint props (font, color, stroke) are threaded as a
 * `PaintContext` parameter — only `<group>` boundaries derive a new context;
 * other elements pass it through unchanged. Per-call prop resolution is
 * `el.props[key] ?? context[key] ?? hardcoded default`.
 *
 * @module
 */

import { match } from "../../match.ts";
import { __, when } from "../../union.ts";
import type { CanvasBounds, CanvasElementNode, CanvasNode, CanvasTag } from "./node.ts";
import {
    deriveContext,
    normalizePadding,
    rootPaintContext,
    type PaintContext,
} from "./paint-context.ts";

// ---------------------------------------------------------------------------
// Coercion helpers
// ---------------------------------------------------------------------------

function num(v: unknown, fallback = 0): number {
    return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

function str(v: unknown, fallback = ""): string {
    return typeof v === "string" ? v : fallback;
}

// ---------------------------------------------------------------------------
// Resolution — `props[key] ?? context[key]`
// ---------------------------------------------------------------------------

function resolveFill(props: Record<string, unknown>, ctx: PaintContext): string {
    return typeof props.fill === "string" ? props.fill : ctx.fill;
}

function resolveStroke(props: Record<string, unknown>, ctx: PaintContext): string {
    return typeof props.stroke === "string" ? props.stroke : ctx.stroke;
}

function resolveStrokeWidth(props: Record<string, unknown>, ctx: PaintContext): number {
    return num(props.strokeWidth, ctx.strokeWidth);
}

function resolveFontFamily(props: Record<string, unknown>, ctx: PaintContext): string {
    return typeof props.fontFamily === "string" ? props.fontFamily : ctx.fontFamily;
}

function resolveFontSize(props: Record<string, unknown>, ctx: PaintContext): number {
    return num(props.fontSize, ctx.fontSize);
}

function resolveFontWeight(props: Record<string, unknown>, ctx: PaintContext): string {
    return typeof props.fontWeight === "string" ? props.fontWeight : ctx.fontWeight;
}

/**
 * Layout props on `<text>` resolve through one extra fallback step — the
 * shape parent's own props — before reaching the paint context. This is what
 * makes `<rect textAlign="center">label</rect>` Just Work without needing
 * the rect to be wrapped in a group: the wrapped synthetic `<text>` reaches
 * up through `el.parent.props` to find the layout intent.
 */
function resolveLayoutProp<T extends "textAlign" | "verticalAlign">(
    props: Record<string, unknown>,
    parent: CanvasElementNode | null,
    ctx: PaintContext,
    key: T,
    accept: ReadonlySet<string>,
): PaintContext[T] {
    const own = props[key];
    if (typeof own === "string" && accept.has(own)) return own as PaintContext[T];
    if (parent !== null && isShapeTag(parent.tag)) {
        const inherited = parent.props[key];
        if (typeof inherited === "string" && accept.has(inherited)) {
            return inherited as PaintContext[T];
        }
    }
    return ctx[key] as PaintContext[T];
}

function resolvePadding(
    props: Record<string, unknown>,
    parent: CanvasElementNode | null,
    ctx: PaintContext,
): PaintContext["padding"] {
    if (props.padding !== undefined) return normalizePadding(props.padding);
    if (parent !== null && isShapeTag(parent.tag) && parent.props.padding !== undefined) {
        return normalizePadding(parent.props.padding);
    }
    return ctx.padding;
}

const SHAPE_TAGS: ReadonlySet<CanvasTag> = new Set([
    "rect", "circle", "ellipse", "line", "path",
]);

function isShapeTag(tag: CanvasTag): boolean {
    return SHAPE_TAGS.has(tag);
}

const TEXT_ALIGN_VALUES: ReadonlySet<string> = new Set(["left", "center", "right"]);
const VERTICAL_ALIGN_VALUES: ReadonlySet<string> = new Set(["top", "middle", "bottom"]);

// ---------------------------------------------------------------------------
// Style application
// ---------------------------------------------------------------------------

function shouldFill(value: string): boolean {
    return value !== "none";
}
function shouldStroke(value: string): boolean {
    return value !== "none";
}

function applyPaintStyle(
    canvasCtx: CanvasRenderingContext2D,
    props: Record<string, unknown>,
    paintCtx: PaintContext,
): { fill: string; stroke: string } {
    const fill = resolveFill(props, paintCtx);
    const stroke = resolveStroke(props, paintCtx);
    if (shouldFill(fill)) canvasCtx.fillStyle = fill;
    if (shouldStroke(stroke)) {
        canvasCtx.strokeStyle = stroke;
        canvasCtx.lineWidth = resolveStrokeWidth(props, paintCtx);
        const lineCap = props.lineCap;
        if (lineCap === "butt" || lineCap === "round" || lineCap === "square") {
            canvasCtx.lineCap = lineCap;
        }
    }
    return { fill, stroke };
}

// ---------------------------------------------------------------------------
// zIndex sort + culling helpers
// ---------------------------------------------------------------------------

function sortChildrenByZIndex(children: CanvasNode[]): void {
    children.sort((a, b) => zIndexOf(a) - zIndexOf(b));
}

function zIndexOf(node: CanvasNode): number {
    return match(node, {
        Element: ({ zIndex }) => zIndex,
        Text: () => 0,
    });
}

function intersects(a: CanvasBounds, b: CanvasBounds): boolean {
    return (
        a.x <= b.x + b.width &&
        a.x + a.width >= b.x &&
        a.y <= b.y + b.height &&
        a.y + a.height >= b.y
    );
}

function hasCullableBounds(b: CanvasBounds): boolean {
    return b.width > 0 && b.height > 0;
}

// ---------------------------------------------------------------------------
// applyTransform — group-only transform composition
// ---------------------------------------------------------------------------

function applyTransform(ctx: CanvasRenderingContext2D, el: CanvasElementNode): void {
    match(el, {
        Element: [
            when({ tag: "group" }, ({ props }) => {
                ctx.translate(num(props.x), num(props.y));
                ctx.rotate((num(props.rotate) * Math.PI) / 180);
                const s = num(props.scale, 1);
                ctx.scale(s, s);
            }),
            when(__, () => undefined),
        ],
    });
}

// ---------------------------------------------------------------------------
// Text layout — when a <text> element's parent is a shape, x/y are computed
// from the parent's bounds + (textAlign, verticalAlign, padding) instead of
// taken from the text's own props.
// ---------------------------------------------------------------------------

function textLayoutPosition(
    el: CanvasElementNode,
    paintCtx: PaintContext,
    fontSize: number,
): { x: number; y: number; baseline: CanvasTextBaseline; align: CanvasTextAlign } {
    const parent = el.parent;
    const usingLayout = parent !== null && isShapeTag(parent.tag);

    const align = resolveLayoutProp(el.props, parent, paintCtx, "textAlign", TEXT_ALIGN_VALUES);
    const vAlign = resolveLayoutProp(el.props, parent, paintCtx, "verticalAlign", VERTICAL_ALIGN_VALUES);
    const padding = resolvePadding(el.props, parent, paintCtx);

    const baseline: CanvasTextBaseline = vAlign === "middle" ? "middle" : "alphabetic";
    const canvasAlign: CanvasTextAlign = align;

    if (!usingLayout) {
        return {
            x: num(el.props.x),
            y: num(el.props.y),
            baseline,
            align: canvasAlign,
        };
    }

    const b = parent.bounds;
    let x: number;
    switch (align) {
        case "left":   x = b.x + padding.left; break;
        case "center": x = b.x + b.width / 2; break;
        case "right":  x = b.x + b.width - padding.right; break;
    }

    let y: number;
    switch (vAlign) {
        case "top":    y = b.y + padding.top + fontSize; break;
        case "middle": y = b.y + b.height / 2; break;
        case "bottom": y = b.y + b.height - padding.bottom; break;
    }

    return { x, y, baseline, align: canvasAlign };
}

// ---------------------------------------------------------------------------
// paintShape — per-primitive ctx calls
// ---------------------------------------------------------------------------

function paintShape(
    ctx: CanvasRenderingContext2D,
    el: CanvasElementNode,
    paintCtx: PaintContext,
): void {
    match(el, {
        Element: [
            when({ tag: "rect" }, ({ props }) => {
                const { fill, stroke } = applyPaintStyle(ctx, props, paintCtx);
                const x = num(props.x);
                const y = num(props.y);
                const w = num(props.width);
                const h = num(props.height);
                const rx = num(props.rx);

                if (rx > 0 && typeof ctx.roundRect === "function") {
                    ctx.beginPath();
                    ctx.roundRect(x, y, w, h, rx);
                    if (shouldFill(fill)) ctx.fill();
                    if (shouldStroke(stroke)) ctx.stroke();
                    return;
                }
                if (shouldFill(fill)) ctx.fillRect(x, y, w, h);
                if (shouldStroke(stroke)) ctx.strokeRect(x, y, w, h);
            }),

            when({ tag: "circle" }, ({ props }) => {
                const { fill, stroke } = applyPaintStyle(ctx, props, paintCtx);
                ctx.beginPath();
                ctx.arc(num(props.cx), num(props.cy), num(props.r), 0, Math.PI * 2);
                if (shouldFill(fill)) ctx.fill();
                if (shouldStroke(stroke)) ctx.stroke();
            }),

            when({ tag: "ellipse" }, ({ props }) => {
                const { fill, stroke } = applyPaintStyle(ctx, props, paintCtx);
                ctx.beginPath();
                ctx.ellipse(
                    num(props.cx),
                    num(props.cy),
                    num(props.rx),
                    num(props.ry),
                    0,
                    0,
                    Math.PI * 2,
                );
                if (shouldFill(fill)) ctx.fill();
                if (shouldStroke(stroke)) ctx.stroke();
            }),

            when({ tag: "line" }, ({ props }) => {
                const { stroke } = applyPaintStyle(ctx, props, paintCtx);
                ctx.beginPath();
                ctx.moveTo(num(props.x1), num(props.y1));
                ctx.lineTo(num(props.x2), num(props.y2));
                if (shouldStroke(stroke)) ctx.stroke();
            }),

            when({ tag: "path" }, ({ props }) => {
                const { fill, stroke } = applyPaintStyle(ctx, props, paintCtx);
                const path = new Path2D(str(props.d));
                if (shouldFill(fill)) ctx.fill(path);
                if (shouldStroke(stroke)) ctx.stroke(path);
            }),

            when({ tag: "text" }, (textEl) => {
                const { props } = textEl;
                const { fill, stroke } = applyPaintStyle(ctx, props, paintCtx);
                const family = resolveFontFamily(props, paintCtx);
                const size = resolveFontSize(props, paintCtx);
                const weight = resolveFontWeight(props, paintCtx);
                ctx.font = `${weight} ${size}px ${family}`;
                const layout = textLayoutPosition(textEl, paintCtx, size);
                ctx.textAlign = layout.align;
                ctx.textBaseline = layout.baseline;
                const content = str(props.content);
                if (shouldFill(fill)) ctx.fillText(content, layout.x, layout.y);
                if (shouldStroke(stroke)) ctx.strokeText(content, layout.x, layout.y);
            }),

            // group: transform-only, no shape paint. Catch-all for anything
            // unrecognised collapses here too.
            when(__, () => undefined),
        ],
    });
}

// ---------------------------------------------------------------------------
// paintNode — recursive entry; the flush driver calls this on the root
// ---------------------------------------------------------------------------

/**
 * Walk a `CanvasNode` and emit the canvas operations required to paint it
 * and its descendants. The driver is responsible for clearing the canvas and
 * resetting any global state before calling `paintNode` on the root.
 *
 * Each `Element` is wrapped in a `save`/`restore` pair so that group
 * transforms compose with the parent's accumulated transform without leaking.
 * `Text` variants are not painted directly — the canvas host's implicit
 * wrapping promotes them into synthetic `<text>` elements at insert time.
 *
 * When `viewportBounds` is provided, every Element with non-empty bounds is
 * intersection-tested against it in world space; misses skip the entire
 * subtree. Tags whose bounds are not yet computed (`group`, `path`, `text`)
 * fall through and always paint — see {@link hasCullableBounds} for why.
 *
 * `parentContext` defaults to the root paint context. Only `<group>`
 * boundaries derive a new context; non-group elements forward the parent's
 * context unchanged.
 */
export function paintNode(
    ctx: CanvasRenderingContext2D,
    node: CanvasNode,
    viewportBounds?: CanvasBounds,
    parentContext: PaintContext = rootPaintContext(),
): void {
    match(node, {
        Element: (el) => {
            if (
                viewportBounds !== undefined &&
                hasCullableBounds(el.bounds) &&
                !intersects(el.bounds, viewportBounds)
            ) {
                return;
            }
            ctx.save();
            applyTransform(ctx, el);

            // Inherited paint props update only at <group> boundaries —
            // non-group elements forward the parent's context unchanged.
            const childContext = el.tag === "group"
                ? deriveContext(parentContext, el.props)
                : parentContext;

            sortChildrenByZIndex(el.children);
            paintShape(ctx, el, parentContext);
            for (const child of el.children) {
                paintNode(ctx, child, viewportBounds, childContext);
            }
            ctx.restore();
        },
        Text: () => undefined,
    });
}
