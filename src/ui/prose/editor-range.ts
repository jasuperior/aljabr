import { union, type Variant } from "../../union.ts";
import { Schema, type Schema as SchemaT } from "../../schema/index.ts";

// ============================================================================
// RangePoint
// ============================================================================

/**
 * A position in the document.
 *
 * - `nodeId` — stable ID of the containing node (typically a `Text` node).
 * - `offset` — character offset within that node's text content.
 * - `line` / `col` — *logical* coordinates (newline-delimited, NOT visual
 *   after wrap). Authors who need visual coordinates read
 *   `getBoundingClientRect()` on the active selection.
 * - `absolute` — absolute character offset in the document (sum of preceding
 *   nodes' content lengths plus this node's local `offset`).
 */
export type RangePoint = {
    nodeId: string;
    offset: number;
    line: number;
    col: number;
    absolute: number;
};

export const rangePointSchema: SchemaT<RangePoint> = Schema.object({
    nodeId:   Schema.string(),
    offset:   Schema.number(),
    line:     Schema.number(),
    col:      Schema.number(),
    absolute: Schema.number(),
});

// ============================================================================
// EditorRange union
// ============================================================================

export type Cursor    = Variant<"Cursor", { point: RangePoint }>;
export type TextRange = Variant<"Text",   { anchor: RangePoint; focus: RangePoint }>;
export type NodeRange = Variant<"Node",   { nodeId: string }>;
export type EditorRange = Cursor | TextRange | NodeRange;

export const EditorRange = union([]).typed({
    Cursor: (point: RangePoint) => ({ point }) as Cursor,
    Text:   (anchor: RangePoint, focus: RangePoint) => ({ anchor, focus }) as TextRange,
    Node:   (nodeId: string) => ({ nodeId }) as NodeRange,
});

// ============================================================================
// Schema
// ============================================================================

/**
 * Wire schema for `EditorRange`. Default discriminant key is `"type"`.
 *
 * Wire shape:
 * ```
 * EditorRange.Cursor(p)        → { type: "Cursor", point: {...} }
 * EditorRange.Text(a, f)       → { type: "Text", anchor: {...}, focus: {...} }
 * EditorRange.Node(nodeId)     → { type: "Node", nodeId: "..." }
 * ```
 *
 * Used by collaborative-editing transports (v0.5.0) and the internal
 * clipboard format (v0.4.1). Authors can rebuild with
 * `Schema.variant(EditorRange, {...}, { discriminant: "kind" })` to change
 * the discriminant key.
 */
// Adapter: maps decoded payloads to the public EditorRange factories.
// `Schema.variant` invokes `factory[name](decodedPayload)` with one
// positional argument — this thin object bridges that single-arg shape to
// EditorRange's per-field constructors without polluting the public API.
const editorRangeFactoryAdapter = {
    Cursor: ({ point }: { point: RangePoint }) => EditorRange.Cursor(point),
    Text:   ({ anchor, focus }: { anchor: RangePoint; focus: RangePoint }) =>
        EditorRange.Text(anchor, focus),
    Node:   ({ nodeId }: { nodeId: string }) => EditorRange.Node(nodeId),
};

export const editorRangeSchema: SchemaT<EditorRange> = Schema.variant(
    editorRangeFactoryAdapter,
    {
        Cursor: Schema.object({ point: rangePointSchema }),
        Text:   Schema.object({ anchor: rangePointSchema, focus: rangePointSchema }),
        Node:   Schema.object({ nodeId: Schema.string() }),
    },
) as unknown as SchemaT<EditorRange>;
