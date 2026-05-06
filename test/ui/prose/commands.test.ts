import { describe, it, expect } from "vitest";
import { match } from "../../../src/match.ts";
import { getTag } from "../../../src/union.ts";
import {
    MarkSet,
    ProseNode,
    getNodeId,
    type Document,
} from "../../../src/ui/prose/document-model.ts";
import {
    EditorRange,
    type RangePoint,
} from "../../../src/ui/prose/editor-range.ts";
import {
    BlockKind,
    type DocumentState,
} from "../../../src/ui/prose/document-state.ts";
import {
    ProseCommand,
    defaultApply,
} from "../../../src/ui/prose/commands.ts";
import { rangePointAt, normalizeText } from "../../../src/ui/prose/tree-ops.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Serialize a ProseNode tree to a plain JSON shape (ignores node IDs). */
const serialize = (n: ProseNode): unknown => {
    const tag = getTag(n);
    const out: Record<string, unknown> = { tag };
    if ("level" in (n as object)) out.level = (n as { level: number }).level;
    if ("language" in (n as object))
        out.language = (n as { language: string | null }).language;
    if ("content" in (n as object))
        out.content = (n as { content: string }).content;
    if ("marks" in (n as object))
        out.marks = (n as { marks: { [k: symbol]: string }[] }).marks.map(
            (m) => ({ tag: getTag(m as never), ...m }),
        );
    if ("src" in (n as object)) out.src = (n as { src: string }).src;
    if ("alt" in (n as object)) out.alt = (n as { alt: string | null }).alt;
    if ("caption" in (n as object))
        out.caption = (n as { caption: string | null }).caption;
    if ("children" in (n as object))
        out.children = (n as { children: ProseNode[] }).children.map(serialize);
    return out;
};

const dispatch = (state: DocumentState, cmd: ProseCommand): { next: DocumentState; inverse: ProseCommand } => {
    const r = defaultApply(state, cmd);
    return match(r, {
        Valid: ({ value }) => value,
        Invalid: ({ errors }) => {
            throw new Error(`apply failed: ${JSON.stringify(errors)}`);
        },
        Unvalidated: () => {
            throw new Error("unreachable");
        },
    });
};

const expectRoundTrip = (state: DocumentState, cmd: ProseCommand): void => {
    const { next, inverse } = dispatch(state, cmd);
    const { next: restored } = dispatch(next, inverse);
    // Compare normalized forms — model carries fragmentation (adjacent
    // same-marks Texts) deliberately; consumers normalize on read.
    expect(serialize(normalizeText(restored.doc))).toEqual(
        serialize(normalizeText(state.doc)),
    );
};

const point = (
    doc: Document,
    nodeId: string,
    offset: number,
): RangePoint => {
    const p = rangePointAt(doc, nodeId, offset);
    if (!p) throw new Error(`no point for ${nodeId}@${offset}`);
    return p;
};

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Single-block document: <document><block id="b1"><text id="t1">Hello, world.</text></block></document> */
const makeSimpleDoc = (): DocumentState => {
    const t1 = ProseNode.Text("Hello, world.", [], "t1");
    const b1 = ProseNode.Block([t1], "b1");
    const doc = ProseNode.Document([b1], "d1") as Document;
    return { doc, cursor: EditorRange.Cursor(point(doc, "t1", 0)) };
};

/** Two-block doc: blocks b1="Hello" and b2="World". */
const makeTwoBlockDoc = (): DocumentState => {
    const t1 = ProseNode.Text("Hello", [], "t1");
    const t2 = ProseNode.Text("World", [], "t2");
    const b1 = ProseNode.Block([t1], "b1");
    const b2 = ProseNode.Block([t2], "b2");
    const doc = ProseNode.Document([b1, b2], "d1") as Document;
    return { doc, cursor: EditorRange.Cursor(point(doc, "t1", 0)) };
};

// ---------------------------------------------------------------------------
// SetCursor
// ---------------------------------------------------------------------------

describe("SetCursor", () => {
    it("updates the cursor and preserves the doc", () => {
        const s = makeSimpleDoc();
        const newPoint = point(s.doc, "t1", 5);
        const { next } = dispatch(s, ProseCommand.SetCursor(EditorRange.Cursor(newPoint)));
        expect(next.doc).toBe(s.doc);
        expect((next.cursor as { point: RangePoint }).point.offset).toBe(5);
    });

    it("round-trips via its inverse", () => {
        const s = makeSimpleDoc();
        const target = EditorRange.Cursor(point(s.doc, "t1", 5));
        const { next, inverse } = dispatch(s, ProseCommand.SetCursor(target));
        const { next: restored } = dispatch(next, inverse);
        expect(restored.cursor).toEqual(s.cursor);
    });
});

// ---------------------------------------------------------------------------
// Insert (text)
// ---------------------------------------------------------------------------

describe("Insert (text)", () => {
    it("splices text into a Text node", () => {
        const s = makeSimpleDoc();
        const { next } = dispatch(s, ProseCommand.Insert("XYZ", point(s.doc, "t1", 5)));
        const t1 = (next.doc.children[0] as { children: { content: string }[] })
            .children[0]!;
        expect(t1.content).toBe("HelloXYZ, world.");
    });

    it("round-trips via its inverse (DeleteForward)", () => {
        const s = makeSimpleDoc();
        expectRoundTrip(s, ProseCommand.Insert("XYZ", point(s.doc, "t1", 5)));
    });

    it("rejects targeting a non-Text node", () => {
        const s = makeSimpleDoc();
        const r = defaultApply(
            s,
            ProseCommand.Insert("X", point(s.doc, "b1", 0)),
        );
        expect(getTag(r)).toBe("Invalid");
    });

    it("rejects out-of-range offsets", () => {
        const s = makeSimpleDoc();
        const oob: RangePoint = { ...point(s.doc, "t1", 0), offset: 999 };
        const r = defaultApply(s, ProseCommand.Insert("X", oob));
        expect(getTag(r)).toBe("Invalid");
    });
});

// ---------------------------------------------------------------------------
// DeleteBackward / DeleteForward (single-block text)
// ---------------------------------------------------------------------------

describe("DeleteBackward / DeleteForward (single-Text)", () => {
    it("removes a slice within a single Text node", () => {
        const s = makeSimpleDoc();
        const range = EditorRange.Text(
            point(s.doc, "t1", 5),
            point(s.doc, "t1", 7),
        );
        const { next } = dispatch(s, ProseCommand.DeleteBackward(range));
        const t1 = (next.doc.children[0] as { children: { content: string }[] })
            .children[0]!;
        expect(t1.content).toBe("Helloworld.");
    });

    it("round-trips via inverse Insert (single-node text)", () => {
        const s = makeSimpleDoc();
        const range = EditorRange.Text(
            point(s.doc, "t1", 5),
            point(s.doc, "t1", 7),
        );
        expectRoundTrip(s, ProseCommand.DeleteBackward(range));
    });

    it("DeleteForward behaves equivalently for in-node ranges", () => {
        const s = makeSimpleDoc();
        const range = EditorRange.Text(
            point(s.doc, "t1", 5),
            point(s.doc, "t1", 7),
        );
        expectRoundTrip(s, ProseCommand.DeleteForward(range));
    });

    it("collapsed ranges are no-ops", () => {
        const s = makeSimpleDoc();
        const p = point(s.doc, "t1", 3);
        const { next } = dispatch(
            s,
            ProseCommand.DeleteBackward(EditorRange.Text(p, p)),
        );
        expect(serialize(next.doc)).toEqual(serialize(s.doc));
    });
});

// ---------------------------------------------------------------------------
// DeleteBackward (spanning)
// ---------------------------------------------------------------------------

describe("DeleteBackward (spanning blocks)", () => {
    it("merges two blocks and round-trips", () => {
        const s = makeTwoBlockDoc();
        // Delete from "Hell[o" through "Wor]ld" — keeps "Hellld"
        const range = EditorRange.Text(
            point(s.doc, "t1", 4),
            point(s.doc, "t2", 3),
        );
        const { next } = dispatch(s, ProseCommand.DeleteBackward(range));
        // After delete, only one block remains with merged content.
        expect(next.doc.children.length).toBe(1);
        expectRoundTrip(s, ProseCommand.DeleteBackward(range));
    });
});

// ---------------------------------------------------------------------------
// Format / RemoveMark
// ---------------------------------------------------------------------------

describe("Format / RemoveMark", () => {
    it("adds a Bold mark to a TextRange and splits the Text node", () => {
        const s = makeSimpleDoc();
        const range = EditorRange.Text(
            point(s.doc, "t1", 0),
            point(s.doc, "t1", 5),
        );
        const { next } = dispatch(
            s,
            ProseCommand.Format(MarkSet.Bold(), range),
        );
        const block = next.doc.children[0] as { children: { content: string; marks: unknown[] }[] };
        expect(block.children.length).toBeGreaterThan(1);
        const bolded = block.children.find((c) =>
            (c as { marks: { [k: symbol]: string }[] }).marks.some(
                (m) => getTag(m as never) === "Bold",
            ),
        );
        expect(bolded).toBeTruthy();
        expect((bolded as { content: string }).content).toBe("Hello");
    });

    it("Format round-trips via its inverse (RemoveMark)", () => {
        const s = makeSimpleDoc();
        const range = EditorRange.Text(
            point(s.doc, "t1", 0),
            point(s.doc, "t1", 5),
        );
        expectRoundTrip(s, ProseCommand.Format(MarkSet.Bold(), range));
    });

    it("RemoveMark removes a previously-applied mark", () => {
        const s0 = makeSimpleDoc();
        const range = EditorRange.Text(
            point(s0.doc, "t1", 0),
            point(s0.doc, "t1", 5),
        );
        const { next: s1 } = dispatch(s0, ProseCommand.Format(MarkSet.Bold(), range));
        // Find the now-bold range and remove the mark.
        const block = s1.doc.children[0] as { children: ProseNode[] };
        const boldNode = block.children.find((c) =>
            (c as { marks?: unknown[] }).marks?.some(
                (m) => getTag(m as never) === "Bold",
            ),
        )!;
        const boldStart = point(s1.doc, getNodeId(boldNode), 0);
        const boldEnd = point(s1.doc, getNodeId(boldNode), (boldNode as { content: string }).content.length);
        const { next: s2 } = dispatch(
            s1,
            ProseCommand.RemoveMark("Bold", EditorRange.Text(boldStart, boldEnd)),
        );
        // After removing, no Text node should carry a Bold mark.
        const newBlock = s2.doc.children[0] as { children: ProseNode[] };
        for (const c of newBlock.children) {
            const marks = (c as { marks?: unknown[] }).marks ?? [];
            expect(marks.some((m) => getTag(m as never) === "Bold")).toBe(false);
        }
    });
});

// ---------------------------------------------------------------------------
// SplitBlock / MergeBlock
// ---------------------------------------------------------------------------

describe("SplitBlock / MergeBlock", () => {
    it("SplitBlock divides a block at a Text offset", () => {
        const s = makeSimpleDoc();
        const at = point(s.doc, "t1", 5);
        const { next } = dispatch(s, ProseCommand.SplitBlock(at));
        expect(next.doc.children.length).toBe(2);
        const left = next.doc.children[0] as { children: { content: string }[] };
        const right = next.doc.children[1] as { children: { content: string }[] };
        expect(left.children[0]!.content).toBe("Hello");
        expect(right.children[0]!.content).toBe(", world.");
    });

    it("SplitBlock round-trips via MergeBlock", () => {
        const s = makeSimpleDoc();
        const at = point(s.doc, "t1", 5);
        expectRoundTrip(s, ProseCommand.SplitBlock(at));
    });

    it("MergeBlock combines a block with its predecessor", () => {
        const s = makeTwoBlockDoc();
        const at = point(s.doc, "t2", 0);
        const { next } = dispatch(s, ProseCommand.MergeBlock(at));
        expect(next.doc.children.length).toBe(1);
    });

    it("MergeBlock round-trips via SplitBlock with pinned ID", () => {
        const s = makeTwoBlockDoc();
        const at = point(s.doc, "t2", 0);
        expectRoundTrip(s, ProseCommand.MergeBlock(at));
    });
});

// ---------------------------------------------------------------------------
// SetBlockKind
// ---------------------------------------------------------------------------

describe("SetBlockKind", () => {
    it("converts a Block to a Heading on a Node range", () => {
        const s = makeSimpleDoc();
        const { next } = dispatch(
            s,
            ProseCommand.SetBlockKind(EditorRange.Node("b1"), BlockKind.Heading(2)),
        );
        const h = next.doc.children[0]!;
        expect(getTag(h)).toBe("Heading");
        expect((h as { level: number }).level).toBe(2);
    });

    it("round-trips on a single block", () => {
        const s = makeSimpleDoc();
        expectRoundTrip(
            s,
            ProseCommand.SetBlockKind(EditorRange.Node("b1"), BlockKind.Heading(1)),
        );
    });

    it("converts multiple blocks across a Text range and round-trips", () => {
        const s = makeTwoBlockDoc();
        const range = EditorRange.Text(
            point(s.doc, "t1", 0),
            point(s.doc, "t2", 5),
        );
        const { next } = dispatch(
            s,
            ProseCommand.SetBlockKind(range, BlockKind.Quote()),
        );
        for (const c of next.doc.children) expect(getTag(c)).toBe("Quote");
        expectRoundTrip(
            s,
            ProseCommand.SetBlockKind(range, BlockKind.Quote()),
        );
    });
});

// ---------------------------------------------------------------------------
// Compound
// ---------------------------------------------------------------------------

describe("Compound", () => {
    it("applies steps sequentially", () => {
        const s = makeSimpleDoc();
        const c1 = ProseCommand.Insert("ABC", point(s.doc, "t1", 0));
        const c2 = ProseCommand.Insert("XYZ", point(s.doc, "t1", 0));
        const { next } = dispatch(s, ProseCommand.Compound([c1, c2]));
        // Both inserts at offset 0 in the *same* original RangePoint —
        // each Insert resolves against the *current* state, so c2 sees the
        // post-c1 state. Result: "XYZABCHello, world." (c2 inserts before c1's chars).
        const t1 = (next.doc.children[0] as { children: { content: string }[] })
            .children[0]!;
        expect(t1.content).toBe("XYZABCHello, world.");
    });

    it("round-trips via reversed inverse steps", () => {
        const s = makeSimpleDoc();
        const c1 = ProseCommand.Insert("ABC", point(s.doc, "t1", 0));
        expectRoundTrip(s, ProseCommand.Compound([c1]));
    });

    it("an empty Compound is a no-op", () => {
        const s = makeSimpleDoc();
        const { next } = dispatch(s, ProseCommand.Compound([]));
        expect(serialize(next.doc)).toEqual(serialize(s.doc));
    });
});
