/**
 * `PaintContext` — the inheritable paint and layout state threaded through
 * the canvas paint pass.
 *
 * Per the v0.3.8 roadmap (§5.1) the context is updated **only at `<group>`
 * boundaries**: a group whose props override any inheritable key produces a
 * new context for its descendants; non-group elements pass the parent's
 * context through unchanged. At paint time, each node resolves a prop as
 * `node.props[key] ?? context[key] ?? default`.
 *
 * @module
 */

/** Padding rectangle. The roadmap accepts a uniform `number` or this object. */
export interface PaddingRect {
    top: number;
    right: number;
    bottom: number;
    left: number;
}

/** Inheritable paint and text-layout state. */
export interface PaintContext {
    fontFamily: string;
    fontSize: number;
    fontWeight: string;
    fill: string;
    stroke: string;
    strokeWidth: number;
    textAlign: "left" | "center" | "right";
    verticalAlign: "top" | "middle" | "bottom";
    padding: PaddingRect;
}

/** The default context applied at the root of the scene graph. */
export function rootPaintContext(): PaintContext {
    return {
        fontFamily: "sans-serif",
        fontSize: 14,
        fontWeight: "normal",
        fill: "none",
        stroke: "none",
        strokeWidth: 1,
        textAlign: "left",
        verticalAlign: "top",
        padding: { top: 0, right: 0, bottom: 0, left: 0 },
    };
}

/**
 * Normalise a `padding` prop into a {@link PaddingRect}.
 * Accepts a uniform `number` or a partial object; missing fields default to 0.
 */
export function normalizePadding(value: unknown): PaddingRect {
    if (typeof value === "number" && Number.isFinite(value)) {
        return { top: value, right: value, bottom: value, left: value };
    }
    if (value !== null && typeof value === "object") {
        const v = value as Partial<PaddingRect>;
        return {
            top: typeof v.top === "number" ? v.top : 0,
            right: typeof v.right === "number" ? v.right : 0,
            bottom: typeof v.bottom === "number" ? v.bottom : 0,
            left: typeof v.left === "number" ? v.left : 0,
        };
    }
    return { top: 0, right: 0, bottom: 0, left: 0 };
}

const TEXT_ALIGN_VALUES: ReadonlySet<string> = new Set(["left", "center", "right"]);
const VERTICAL_ALIGN_VALUES: ReadonlySet<string> = new Set(["top", "middle", "bottom"]);

/**
 * Derive a child {@link PaintContext} from a parent's context plus a node's
 * own props. Only keys explicitly present on `props` (and recognised) override
 * the parent value; everything else is inherited.
 *
 * Returns the parent context unchanged when no inheritable key is overridden,
 * so descendants share a single object across un-affected boundaries.
 */
export function deriveContext(
    parent: PaintContext,
    props: Record<string, unknown>,
): PaintContext {
    let next: PaintContext | null = null;
    const ensure = (): PaintContext => (next ??= { ...parent });

    if (typeof props.fontFamily === "string") {
        ensure().fontFamily = props.fontFamily;
    }
    if (typeof props.fontSize === "number" && Number.isFinite(props.fontSize)) {
        ensure().fontSize = props.fontSize;
    }
    if (typeof props.fontWeight === "string") {
        ensure().fontWeight = props.fontWeight;
    }
    if (typeof props.fill === "string") {
        ensure().fill = props.fill;
    }
    if (typeof props.stroke === "string") {
        ensure().stroke = props.stroke;
    }
    if (typeof props.strokeWidth === "number" && Number.isFinite(props.strokeWidth)) {
        ensure().strokeWidth = props.strokeWidth;
    }
    if (typeof props.textAlign === "string" && TEXT_ALIGN_VALUES.has(props.textAlign)) {
        ensure().textAlign = props.textAlign as PaintContext["textAlign"];
    }
    if (typeof props.verticalAlign === "string" && VERTICAL_ALIGN_VALUES.has(props.verticalAlign)) {
        ensure().verticalAlign = props.verticalAlign as PaintContext["verticalAlign"];
    }
    if (props.padding !== undefined) {
        ensure().padding = normalizePadding(props.padding);
    }

    return next ?? parent;
}
