/**
 * Canvas paint pass.
 *
 * Walks a `CanvasElementNode` scene graph and emits the corresponding
 * `CanvasRenderingContext2D` calls. The flush driver (Phase 4) is responsible
 * for clearing the backing canvas before invoking {@link paintNode} on the
 * root; this module performs no clearing of its own.
 *
 * Dispatch is consistently `match` + `when` on the `CanvasNode` union — first
 * by variant (`Element` vs `Text`), then by `tag` for the per-primitive paint
 * operations. The structural pattern matches keep the per-tag arms typed to
 * the matched payload and let new primitives slot in with one `when` arm
 * rather than a new switch case.
 *
 * @module
 */

import { match } from "../../match.ts";
import { __, when } from "../../union.ts";
import type { CanvasElementNode, CanvasNode } from "./node.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function num(v: unknown, fallback = 0): number {
    return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

function str(v: unknown, fallback = ""): string {
    return typeof v === "string" ? v : fallback;
}

function shouldFill(props: Record<string, unknown>): boolean {
    const fill = props.fill;
    return typeof fill === "string" && fill !== "none";
}

function shouldStroke(props: Record<string, unknown>): boolean {
    const stroke = props.stroke;
    return typeof stroke === "string" && stroke !== "none";
}

function applyPaintStyle(ctx: CanvasRenderingContext2D, props: Record<string, unknown>): void {
    if (shouldFill(props)) ctx.fillStyle = str(props.fill);
    if (shouldStroke(props)) {
        ctx.strokeStyle = str(props.stroke);
        ctx.lineWidth = num(props.strokeWidth, 1);
        const lineCap = props.lineCap;
        if (lineCap === "butt" || lineCap === "round" || lineCap === "square") {
            ctx.lineCap = lineCap;
        }
    }
}

/**
 * Stable in-place sort by `zIndex` ascending. `Text` variants (which have no
 * `zIndex`) sort as 0. JavaScript's `Array.prototype.sort` is stable per
 * ECMAScript 2019, so insertion order serves as the tiebreaker for equal
 * `zIndex` values without an auxiliary index.
 */
function sortChildrenByZIndex(children: CanvasNode[]): void {
    children.sort((a, b) => zIndexOf(a) - zIndexOf(b));
}

function zIndexOf(node: CanvasNode): number {
    return match(node, {
        Element: ({ zIndex }) => zIndex,
        Text: () => 0,
    });
}

// ---------------------------------------------------------------------------
// applyTransform — group-only transform composition
//
// Per the v0.3.8 roadmap, structured transform props (`x`, `y`, `scale`,
// `rotate`) only take effect on `<group>` elements; primitive shapes encode
// position in their own geometry props (e.g. rect's `x`/`y`). Other tags fall
// through `when(__)` and emit no transform.
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
// paintShape — emit the geometry-specific ctx calls for a single Element
// ---------------------------------------------------------------------------

function paintShape(ctx: CanvasRenderingContext2D, el: CanvasElementNode): void {
    match(el, {
        Element: [
            when({ tag: "rect" }, ({ props }) => {
                const x = num(props.x);
                const y = num(props.y);
                const w = num(props.width);
                const h = num(props.height);
                const rx = num(props.rx);

                if (rx > 0 && typeof ctx.roundRect === "function") {
                    applyPaintStyle(ctx, props);
                    ctx.beginPath();
                    ctx.roundRect(x, y, w, h, rx);
                    if (shouldFill(props)) ctx.fill();
                    if (shouldStroke(props)) ctx.stroke();
                    return;
                }

                applyPaintStyle(ctx, props);
                if (shouldFill(props)) ctx.fillRect(x, y, w, h);
                if (shouldStroke(props)) ctx.strokeRect(x, y, w, h);
            }),

            when({ tag: "circle" }, ({ props }) => {
                applyPaintStyle(ctx, props);
                ctx.beginPath();
                ctx.arc(num(props.cx), num(props.cy), num(props.r), 0, Math.PI * 2);
                if (shouldFill(props)) ctx.fill();
                if (shouldStroke(props)) ctx.stroke();
            }),

            when({ tag: "ellipse" }, ({ props }) => {
                applyPaintStyle(ctx, props);
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
                if (shouldFill(props)) ctx.fill();
                if (shouldStroke(props)) ctx.stroke();
            }),

            when({ tag: "line" }, ({ props }) => {
                applyPaintStyle(ctx, props);
                ctx.beginPath();
                ctx.moveTo(num(props.x1), num(props.y1));
                ctx.lineTo(num(props.x2), num(props.y2));
                if (shouldStroke(props)) ctx.stroke();
            }),

            when({ tag: "path" }, ({ props }) => {
                applyPaintStyle(ctx, props);
                const d = str(props.d);
                const path = new Path2D(d);
                if (shouldFill(props)) ctx.fill(path);
                if (shouldStroke(props)) ctx.stroke(path);
            }),

            when({ tag: "text" }, ({ props }) => {
                applyPaintStyle(ctx, props);
                const family = str(props.fontFamily, "sans-serif");
                const size = num(props.fontSize, 14);
                const weight = str(props.fontWeight, "normal");
                ctx.font = `${weight} ${size}px ${family}`;
                const align = props.textAlign;
                if (
                    align === "start" || align === "end" ||
                    align === "left" || align === "right" || align === "center"
                ) {
                    ctx.textAlign = align;
                }
                const baseline = props.textBaseline;
                if (
                    baseline === "alphabetic" || baseline === "top" ||
                    baseline === "middle" || baseline === "bottom" ||
                    baseline === "hanging" || baseline === "ideographic"
                ) {
                    ctx.textBaseline = baseline;
                }
                if (shouldFill(props)) {
                    ctx.fillText(str(props.content), num(props.x), num(props.y));
                }
                if (shouldStroke(props)) {
                    ctx.strokeText(str(props.content), num(props.x), num(props.y));
                }
            }),

            // group: transform-only — handled by `applyTransform`, no shape paint.
            // Anything unrecognised falls through to a paint no-op as well.
            when(__, () => undefined),
        ],
    });
}

// ---------------------------------------------------------------------------
// paintNode — recursive entry; flush driver (Phase 4) calls this on the root
// ---------------------------------------------------------------------------

/**
 * Walk a `CanvasNode` and emit the canvas operations required to paint it
 * and its descendants. The driver is responsible for clearing the canvas and
 * resetting any global state before calling `paintNode` on the root.
 *
 * Each `Element` is wrapped in a `save`/`restore` pair so that group
 * transforms compose with the parent's accumulated transform without leaking.
 * `Text` variants are not painted directly — Phase 5's implicit wrapping
 * promotes them into synthetic `<text>` elements at insert time.
 */
export function paintNode(ctx: CanvasRenderingContext2D, node: CanvasNode): void {
    match(node, {
        Element: (el) => {
            ctx.save();
            applyTransform(ctx, el);
            sortChildrenByZIndex(el.children);
            paintShape(ctx, el);
            for (const child of el.children) {
                paintNode(ctx, child);
            }
            ctx.restore();
        },
        Text: () => undefined,
    });
}
