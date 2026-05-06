import { describe, it, expect } from "vitest";
import { match } from "../../../src/match.ts";
import { roundtrip } from "../../../src/schema/index.ts";
import {
    EditorRange,
    editorRangeSchema,
    rangePointSchema,
    type RangePoint,
} from "../../../src/ui/prose/editor-range.ts";

const point = (
    nodeId: string,
    offset: number,
    line: number,
    col: number,
    absolute: number,
): RangePoint => ({ nodeId, offset, line, col, absolute });

describe("EditorRange — variant construction", () => {
    it("constructs each of the three modes", () => {
        const p = point("n1", 0, 0, 0, 0);
        const cursor = EditorRange.Cursor(p);
        const text = EditorRange.Text(p, point("n1", 5, 0, 5, 5));
        const node = EditorRange.Node("n1");

        expect(cursor.point).toBe(p);
        expect(text.anchor).toBe(p);
        expect(text.focus.offset).toBe(5);
        expect(node.nodeId).toBe("n1");
    });

    it("dispatches via match() exhaustively", () => {
        const cases: EditorRange[] = [
            EditorRange.Cursor(point("a", 0, 0, 0, 0)),
            EditorRange.Text(point("a", 0, 0, 0, 0), point("b", 3, 1, 3, 8)),
            EditorRange.Node("img-1"),
        ];

        const labels = cases.map((r) =>
            match(r, {
                Cursor: ({ point: p }) => `cursor@${p.absolute}`,
                Text:   ({ anchor, focus }) => `text:${anchor.absolute}-${focus.absolute}`,
                Node:   ({ nodeId }) => `node:${nodeId}`,
            }),
        );

        expect(labels).toEqual(["cursor@0", "text:0-8", "node:img-1"]);
    });

    it("supports reverse-direction text selections (focus before anchor)", () => {
        // User drag-selected right-to-left
        const r = EditorRange.Text(
            point("n1", 10, 0, 10, 10),
            point("n1", 2, 0, 2, 2),
        );
        expect(r.focus.absolute).toBeLessThan(r.anchor.absolute);
    });
});

describe("RangePoint — invariants", () => {
    it("documents `absolute` as the sum of preceding nodes' content lengths plus local offset", () => {
        // Construct a point that *describes* a position in a hypothetical
        // tree: two preceding text nodes "Hello" (5 chars) + ", world" (7
        // chars), then offset 3 into a third node.
        // → absolute = 5 + 7 + 3 = 15.
        const p = point("third", 3, 0, 15, 15);
        expect(p.absolute).toBe(15);
        expect(p.col).toBe(15);
    });

    it("permits line/col to diverge from absolute when newlines intervene", () => {
        // Two preceding lines of 5 chars each; cursor is at offset 2 of the
        // third line. absolute = 5 + 1 + 5 + 1 + 2 = 14, line = 2, col = 2.
        const p = point("n", 2, 2, 2, 14);
        expect(p.line).toBe(2);
        expect(p.col).toBe(2);
        expect(p.absolute).toBe(14);
    });
});

describe("Schema round-trips", () => {
    it("rangePointSchema round-trips a plain point", () => {
        const wire = {
            nodeId: "n1",
            offset: 4,
            line: 1,
            col: 4,
            absolute: 9,
        };
        expect(roundtrip(rangePointSchema, wire)).toBe(true);
    });

    it("editorRangeSchema round-trips a Cursor", () => {
        const wire = {
            type: "Cursor",
            point: { nodeId: "n1", offset: 0, line: 0, col: 0, absolute: 0 },
        };
        expect(roundtrip(editorRangeSchema, wire)).toBe(true);
    });

    it("editorRangeSchema round-trips a Text range", () => {
        const wire = {
            type: "Text",
            anchor: { nodeId: "a", offset: 0, line: 0, col: 0, absolute: 0 },
            focus:  { nodeId: "b", offset: 3, line: 1, col: 3, absolute: 8 },
        };
        expect(roundtrip(editorRangeSchema, wire)).toBe(true);
    });

    it("editorRangeSchema round-trips a Node range", () => {
        const wire = { type: "Node", nodeId: "img-42" };
        expect(roundtrip(editorRangeSchema, wire)).toBe(true);
    });
});
