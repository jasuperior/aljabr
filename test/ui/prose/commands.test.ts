import { describe, it, expect } from "vitest";
import { match } from "../../../src/match.ts";
import { __ } from "../../../src/union.ts";
import { Dispatcher } from "../../../src/prelude/dispatcher.ts";
import { Validation } from "../../../src/prelude/validation.ts";
import { CommandError } from "../../../src/prelude/command-error.ts";
import type { ApplyResult } from "../../../src/prelude/dispatcher.ts";
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
    proseProtocol,
} from "../../../src/ui/prose/commands.ts";
import { rangePointAt, normalizeText } from "../../../src/ui/prose/tree-ops.ts";

// ---------------------------------------------------------------------------
// Test seam — exercises the production Dispatcher and Validation contracts
// rather than hand-rolling apply/match plumbing in the test file.
// ---------------------------------------------------------------------------

const newDispatcher = (state: DocumentState) =>
    Dispatcher.create(state, proseProtocol);

const expectValid = <V>(v: Validation<V, CommandError>): V =>
    match(v, {
        Valid: ({ value }) => value,
        Invalid: ({ errors }) => {
            throw new Error(`unexpected Invalid: ${JSON.stringify(errors)}`);
        },
        Unvalidated: () => {
            throw new Error("unexpected Unvalidated");
        },
    });

const expectInvalid = <V>(v: Validation<V, CommandError>): void =>
    match(v, {
        Invalid: () => {},
        Valid: () => {
            throw new Error("expected Invalid, got Valid");
        },
        Unvalidated: () => {
            throw new Error("expected Invalid, got Unvalidated");
        },
    });

/**
 * Round-trip a single command through a Dispatcher: dispatch, capture the
 * inverse from the returned ApplyResult, dispatch the inverse, and assert
 * the extracted Document is equivalent to the initial under `normalizeText`.
 */
const expectRoundTrip = (initial: DocumentState, cmd: ProseCommand): void => {
    const d = newDispatcher(initial);
    const { inverse }: ApplyResult<DocumentState, ProseCommand> = expectValid(
        d.dispatch(cmd),
    );
    expectValid(d.dispatch(inverse));
    expect(serialize(normalizeText(d.peek()!))).toEqual(
        serialize(normalizeText(initial.doc)),
    );
};

const serialize = (n: ProseNode): unknown =>
    match(n, {
        Document: ({ children }) => ({
            tag: "Document",
            children: children.map(serialize),
        }),
        Block: ({ children }) => ({
            tag: "Block",
            children: children.map(serialize),
        }),
        Heading: ({ level, children }) => ({
            tag: "Heading",
            level,
            children: children.map(serialize),
        }),
        Quote: ({ children }) => ({
            tag: "Quote",
            children: children.map(serialize),
        }),
        Code: ({ language, children }) => ({
            tag: "Code",
            language,
            children: children.map(serialize),
        }),
        Text: ({ content, marks }) => ({
            tag: "Text",
            content,
            marks: marks.map(serializeMark),
        }),
        Image: ({ src, alt, caption }) => ({
            tag: "Image",
            src,
            alt,
            caption,
        }),
        HardBreak: () => ({ tag: "HardBreak" }),
        Hr: () => ({ tag: "Hr" }),
    });

const serializeMark = (m: MarkSet): unknown =>
    match(m, {
        Bold: () => ({ tag: "Bold" }),
        Italic: () => ({ tag: "Italic" }),
        Underline: () => ({ tag: "Underline" }),
        Strike: () => ({ tag: "Strike" }),
        Code: () => ({ tag: "Code" }),
        Link: ({ href }) => ({ tag: "Link", href }),
        Color: ({ value }) => ({ tag: "Color", value }),
        BackgroundColor: ({ value }) => ({ tag: "BackgroundColor", value }),
        FontFamily: ({ value }) => ({ tag: "FontFamily", value }),
        FontSize: ({ value }) => ({ tag: "FontSize", value }),
    });

const point = (
    doc: Document,
    nodeId: string,
    offset: number,
): RangePoint => {
    const p = rangePointAt(doc, nodeId, offset);
    if (!p) throw new Error(`no point for ${nodeId}@${offset}`);
    return p;
};

const isBoldMark = (m: MarkSet): boolean =>
    match(m, {
        Bold: () => true,
        [__]: () => false,
    });

const hasBold = (n: ProseNode): boolean =>
    match(n, {
        Text: ({ marks }) => marks.some(isBoldMark),
        [__]: () => false,
    });

const blockChildren = (n: ProseNode): ProseNode[] =>
    match(n, {
        Block: ({ children }) => children,
        Heading: ({ children }) => children,
        Quote: ({ children }) => children,
        Code: ({ children }) => children,
        [__]: () => {
            throw new Error("expected block container");
        },
    });

const expectText = (n: ProseNode, expected: string): void =>
    match(n, {
        Text: ({ content }) => {
            expect(content).toBe(expected);
        },
        [__]: () => {
            throw new Error(`expected Text("${expected}")`);
        },
    });

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const makeSimpleDoc = (): DocumentState => {
    const t1 = ProseNode.Text("Hello, world.", [], "t1");
    const b1 = ProseNode.Block([t1], "b1");
    const doc = ProseNode.Document([b1], "d1") as Document;
    return { doc, cursor: EditorRange.Cursor(point(doc, "t1", 0)) };
};

const makeTwoBlockDoc = (): DocumentState => {
    const t1 = ProseNode.Text("Hello", [], "t1");
    const t2 = ProseNode.Text("World", [], "t2");
    const b1 = ProseNode.Block([t1], "b1");
    const b2 = ProseNode.Block([t2], "b2");
    const doc = ProseNode.Document([b1, b2], "d1") as Document;
    return { doc, cursor: EditorRange.Cursor(point(doc, "t1", 0)) };
};

const firstBlockChildren = (doc: Document): ProseNode[] =>
    blockChildren(doc.children[0]!);

// ---------------------------------------------------------------------------
// SetCursor
// ---------------------------------------------------------------------------

describe("SetCursor", () => {
    it("updates the cursor and preserves the doc", () => {
        const initial = makeSimpleDoc();
        const d = newDispatcher(initial);
        const newPoint = point(initial.doc, "t1", 5);
        expectValid(
            d.dispatch(ProseCommand.SetCursor(EditorRange.Cursor(newPoint))),
        );
        expect(d.peek()).toBe(initial.doc);
        match(d.peekState().cursor, {
            Cursor: ({ point: p }) => expect(p.offset).toBe(5),
            [__]: () => {
                throw new Error("expected Cursor range");
            },
        });
    });

    it("round-trips via its inverse", () => {
        const initial = makeSimpleDoc();
        const target = EditorRange.Cursor(point(initial.doc, "t1", 5));
        const d = newDispatcher(initial);
        const { inverse } = expectValid(
            d.dispatch(ProseCommand.SetCursor(target)),
        );
        expectValid(d.dispatch(inverse));
        expect(d.peekState().cursor).toEqual(initial.cursor);
    });
});

// ---------------------------------------------------------------------------
// Insert (text)
// ---------------------------------------------------------------------------

describe("Insert (text)", () => {
    it("splices text into a Text node", () => {
        const initial = makeSimpleDoc();
        const d = newDispatcher(initial);
        expectValid(
            d.dispatch(
                ProseCommand.Insert("XYZ", point(initial.doc, "t1", 5)),
            ),
        );
        expectText(firstBlockChildren(d.peek()!)[0]!, "HelloXYZ, world.");
    });

    it("round-trips via its inverse (DeleteForward)", () => {
        const initial = makeSimpleDoc();
        expectRoundTrip(
            initial,
            ProseCommand.Insert("XYZ", point(initial.doc, "t1", 5)),
        );
    });

    it("rejects targeting a non-Text node", () => {
        const initial = makeSimpleDoc();
        const d = newDispatcher(initial);
        expectInvalid(
            d.dispatch(ProseCommand.Insert("X", point(initial.doc, "b1", 0))),
        );
    });

    it("rejects out-of-range offsets", () => {
        const initial = makeSimpleDoc();
        const d = newDispatcher(initial);
        const oob: RangePoint = {
            ...point(initial.doc, "t1", 0),
            offset: 999,
        };
        expectInvalid(d.dispatch(ProseCommand.Insert("X", oob)));
    });
});

// ---------------------------------------------------------------------------
// DeleteBackward / DeleteForward (single-block text)
// ---------------------------------------------------------------------------

describe("DeleteBackward / DeleteForward (single-Text)", () => {
    it("removes a slice within a single Text node", () => {
        const initial = makeSimpleDoc();
        const d = newDispatcher(initial);
        const range = EditorRange.Text(
            point(initial.doc, "t1", 5),
            point(initial.doc, "t1", 7),
        );
        expectValid(d.dispatch(ProseCommand.DeleteBackward(range)));
        expectText(firstBlockChildren(d.peek()!)[0]!, "Helloworld.");
    });

    it("round-trips via inverse Insert (single-node text)", () => {
        const initial = makeSimpleDoc();
        const range = EditorRange.Text(
            point(initial.doc, "t1", 5),
            point(initial.doc, "t1", 7),
        );
        expectRoundTrip(initial, ProseCommand.DeleteBackward(range));
    });

    it("DeleteForward behaves equivalently for in-node ranges", () => {
        const initial = makeSimpleDoc();
        const range = EditorRange.Text(
            point(initial.doc, "t1", 5),
            point(initial.doc, "t1", 7),
        );
        expectRoundTrip(initial, ProseCommand.DeleteForward(range));
    });

    it("collapsed ranges are no-ops", () => {
        const initial = makeSimpleDoc();
        const d = newDispatcher(initial);
        const p = point(initial.doc, "t1", 3);
        expectValid(
            d.dispatch(ProseCommand.DeleteBackward(EditorRange.Text(p, p))),
        );
        expect(serialize(d.peek()!)).toEqual(serialize(initial.doc));
    });
});

// ---------------------------------------------------------------------------
// DeleteBackward (spanning)
// ---------------------------------------------------------------------------

describe("DeleteBackward (spanning blocks)", () => {
    it("merges two blocks and round-trips", () => {
        const initial = makeTwoBlockDoc();
        const range = EditorRange.Text(
            point(initial.doc, "t1", 4),
            point(initial.doc, "t2", 3),
        );
        const d = newDispatcher(initial);
        expectValid(d.dispatch(ProseCommand.DeleteBackward(range)));
        expect(d.peek()!.children.length).toBe(1);
        expectRoundTrip(initial, ProseCommand.DeleteBackward(range));
    });
});

// ---------------------------------------------------------------------------
// Format / RemoveMark
// ---------------------------------------------------------------------------

describe("Format / RemoveMark", () => {
    it("adds a Bold mark to a TextRange and splits the Text node", () => {
        const initial = makeSimpleDoc();
        const d = newDispatcher(initial);
        const range = EditorRange.Text(
            point(initial.doc, "t1", 0),
            point(initial.doc, "t1", 5),
        );
        expectValid(d.dispatch(ProseCommand.Format(MarkSet.Bold(), range)));
        const kids = firstBlockChildren(d.peek()!);
        expect(kids.length).toBeGreaterThan(1);
        const bolded = kids.find(hasBold);
        if (!bolded) throw new Error("expected a bolded Text node");
        expectText(bolded, "Hello");
    });

    it("Format round-trips via its inverse (RemoveMark)", () => {
        const initial = makeSimpleDoc();
        const range = EditorRange.Text(
            point(initial.doc, "t1", 0),
            point(initial.doc, "t1", 5),
        );
        expectRoundTrip(initial, ProseCommand.Format(MarkSet.Bold(), range));
    });

    it("RemoveMark removes a previously-applied mark", () => {
        const initial = makeSimpleDoc();
        const d = newDispatcher(initial);
        const range = EditorRange.Text(
            point(initial.doc, "t1", 0),
            point(initial.doc, "t1", 5),
        );
        expectValid(d.dispatch(ProseCommand.Format(MarkSet.Bold(), range)));

        const boldNode = firstBlockChildren(d.peek()!).find(hasBold);
        if (!boldNode) throw new Error("expected a bolded node after Format");
        const length = match(boldNode, {
            Text: ({ content }) => content.length,
            [__]: () => {
                throw new Error("expected Text");
            },
        });
        const id = getNodeId(boldNode);
        const start = point(d.peek()!, id, 0);
        const end = point(d.peek()!, id, length);

        expectValid(
            d.dispatch(
                ProseCommand.RemoveMark("Bold", EditorRange.Text(start, end)),
            ),
        );
        for (const c of firstBlockChildren(d.peek()!)) {
            expect(hasBold(c)).toBe(false);
        }
    });
});

// ---------------------------------------------------------------------------
// SplitBlock / MergeBlock
// ---------------------------------------------------------------------------

describe("SplitBlock / MergeBlock", () => {
    it("SplitBlock divides a block at a Text offset", () => {
        const initial = makeSimpleDoc();
        const d = newDispatcher(initial);
        expectValid(
            d.dispatch(ProseCommand.SplitBlock(point(initial.doc, "t1", 5))),
        );
        const doc = d.peek()!;
        expect(doc.children.length).toBe(2);
        expectText(blockChildren(doc.children[0]!)[0]!, "Hello");
        expectText(blockChildren(doc.children[1]!)[0]!, ", world.");
    });

    it("SplitBlock round-trips via MergeBlock", () => {
        const initial = makeSimpleDoc();
        expectRoundTrip(
            initial,
            ProseCommand.SplitBlock(point(initial.doc, "t1", 5)),
        );
    });

    it("MergeBlock combines a block with its predecessor", () => {
        const initial = makeTwoBlockDoc();
        const d = newDispatcher(initial);
        expectValid(
            d.dispatch(ProseCommand.MergeBlock(point(initial.doc, "t2", 0))),
        );
        expect(d.peek()!.children.length).toBe(1);
    });

    it("MergeBlock round-trips via SplitBlock with pinned ID", () => {
        const initial = makeTwoBlockDoc();
        expectRoundTrip(
            initial,
            ProseCommand.MergeBlock(point(initial.doc, "t2", 0)),
        );
    });
});

// ---------------------------------------------------------------------------
// SetBlockKind
// ---------------------------------------------------------------------------

describe("SetBlockKind", () => {
    it("converts a Block to a Heading on a Node range", () => {
        const initial = makeSimpleDoc();
        const d = newDispatcher(initial);
        expectValid(
            d.dispatch(
                ProseCommand.SetBlockKind(
                    EditorRange.Node("b1"),
                    BlockKind.Heading(2),
                ),
            ),
        );
        match(d.peek()!.children[0]!, {
            Heading: ({ level }) => expect(level).toBe(2),
            [__]: () => {
                throw new Error("expected Heading");
            },
        });
    });

    it("round-trips on a single block", () => {
        const initial = makeSimpleDoc();
        expectRoundTrip(
            initial,
            ProseCommand.SetBlockKind(
                EditorRange.Node("b1"),
                BlockKind.Heading(1),
            ),
        );
    });

    it("converts multiple blocks across a Text range and round-trips", () => {
        const initial = makeTwoBlockDoc();
        const range = EditorRange.Text(
            point(initial.doc, "t1", 0),
            point(initial.doc, "t2", 5),
        );
        const d = newDispatcher(initial);
        expectValid(
            d.dispatch(ProseCommand.SetBlockKind(range, BlockKind.Quote())),
        );
        for (const c of d.peek()!.children) {
            match(c, {
                Quote: () => {},
                [__]: () => {
                    throw new Error("expected Quote");
                },
            });
        }
        expectRoundTrip(
            initial,
            ProseCommand.SetBlockKind(range, BlockKind.Quote()),
        );
    });
});

// ---------------------------------------------------------------------------
// Compound
// ---------------------------------------------------------------------------

describe("Compound", () => {
    it("applies steps sequentially", () => {
        const initial = makeSimpleDoc();
        const c1 = ProseCommand.Insert("ABC", point(initial.doc, "t1", 0));
        const c2 = ProseCommand.Insert("XYZ", point(initial.doc, "t1", 0));
        const d = newDispatcher(initial);
        expectValid(d.dispatch(ProseCommand.Compound([c1, c2])));
        expectText(
            firstBlockChildren(d.peek()!)[0]!,
            "XYZABCHello, world.",
        );
    });

    it("round-trips via reversed inverse steps", () => {
        const initial = makeSimpleDoc();
        const c1 = ProseCommand.Insert("ABC", point(initial.doc, "t1", 0));
        expectRoundTrip(initial, ProseCommand.Compound([c1]));
    });

    it("an empty Compound is a no-op", () => {
        const initial = makeSimpleDoc();
        const d = newDispatcher(initial);
        expectValid(d.dispatch(ProseCommand.Compound([])));
        expect(serialize(d.peek()!)).toEqual(serialize(initial.doc));
    });
});
