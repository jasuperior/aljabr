import { describe, it, expect } from "vitest";
import { match } from "../../../src/match.ts";
import { __, type Union } from "../../../src/union.ts";
import { Validation } from "../../../src/prelude/validation.ts";
import {
    Dispatcher,
    type ApplyResult,
    type CommandProtocol,
} from "../../../src/prelude/dispatcher.ts";
import { CommandError } from "../../../src/prelude/command-error.ts";
import {
    ProseNode,
    getNodeId,
    type Document,
    type Text as TextNode,
} from "../../../src/ui/prose/document-model.ts";
import {
    EditorRange,
    type RangePoint,
} from "../../../src/ui/prose/editor-range.ts";
import type { DocumentState } from "../../../src/ui/prose/document-state.ts";
import {
    ProseCommand,
    defaultApply,
} from "../../../src/ui/prose/commands.ts";
import {
    rangePointAt,
    locate,
    replaceById,
    normalizeText,
} from "../../../src/ui/prose/tree-ops.ts";

// ---------------------------------------------------------------------------
// Demonstrate the extension pattern: a domain-specific command extends
// `ProseCommand` via `.merge`, and `extendedApply` composes via `match()`
// with a `[__]` fallback that delegates to `defaultApply`. The test exercises
// the production `Dispatcher` so the protocol contract — extract, apply,
// inverse propagation, Validation seam — is verified end-to-end.
// ---------------------------------------------------------------------------

const point = (doc: Document, nodeId: string, offset: number): RangePoint =>
    rangePointAt(doc, nodeId, offset)!;

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

describe("Extending ProseCommand via merge() + [__] fallback", () => {
    const ExtendedCommand = ProseCommand.merge({
        InsertMention: (userId: string, at: RangePoint) => ({ userId, at }),
    });
    type ExtendedCommand = Union<typeof ExtendedCommand>;

    const extendedProtocol: CommandProtocol<
        DocumentState,
        Document,
        ExtendedCommand
    > = {
        extract: (state) => state.doc,
        apply: (state, cmd) =>
            match(cmd, {
                InsertMention: ({
                    userId,
                    at,
                }: {
                    userId: string;
                    at: RangePoint;
                }) => {
                    const found = locate(state.doc, at.nodeId);
                    if (!found) {
                        return Validation.Invalid<
                            ApplyResult<DocumentState, ExtendedCommand>,
                            CommandError
                        >([
                            CommandError.Conflict(
                                `InsertMention: target ${at.nodeId} not found`,
                            ),
                        ]);
                    }
                    return match(found.node, {
                        Text: (text: TextNode) => {
                            const insertion = `@${userId}`;
                            const newContent =
                                text.content.slice(0, at.offset) +
                                insertion +
                                text.content.slice(at.offset);
                            const newText = ProseNode.Text(
                                newContent,
                                text.marks,
                                getNodeId(text),
                            );
                            const newDoc = replaceById(
                                state.doc,
                                at.nodeId,
                                newText,
                            ) as Document;
                            const inverseRange = EditorRange.Text(at, {
                                ...at,
                                offset: at.offset + insertion.length,
                                col: at.col + insertion.length,
                                absolute: at.absolute + insertion.length,
                            });
                            return Validation.Valid<
                                ApplyResult<DocumentState, ExtendedCommand>,
                                CommandError
                            >({
                                next: { doc: newDoc, cursor: state.cursor },
                                inverse:
                                    ProseCommand.DeleteForward(inverseRange),
                            });
                        },
                        [__]: () =>
                            Validation.Invalid<
                                ApplyResult<DocumentState, ExtendedCommand>,
                                CommandError
                            >([
                                CommandError.Conflict(
                                    `InsertMention: target ${at.nodeId} is not a Text node`,
                                ),
                            ]),
                    });
                },
                // Fallback narrows to "everything except InsertMention" — i.e.
                // the base ProseCommand union — but TS can't infer that, so we
                // coerce when handing off to defaultApply.
                [__]: (c: ExtendedCommand) =>
                    defaultApply(state, c as ProseCommand),
            }),
    };

    const makeState = (): DocumentState => {
        const t1 = ProseNode.Text("Hello, world.", [], "t1");
        const b1 = ProseNode.Block([t1], "b1");
        const doc = ProseNode.Document([b1], "d1") as Document;
        return { doc, cursor: EditorRange.Cursor(point(doc, "t1", 0)) };
    };

    const firstText = (doc: Document): TextNode =>
        match(doc.children[0]!, {
            Block: ({ children }) =>
                match(children[0]!, {
                    Text: (t) => t,
                    [__]: () => {
                        throw new Error("expected Text");
                    },
                }),
            [__]: () => {
                throw new Error("expected Block");
            },
        });

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
            Text: ({ content }) => ({ tag: "Text", content }),
            Image: ({ src }) => ({ tag: "Image", src }),
            HardBreak: () => ({ tag: "HardBreak" }),
            Hr: () => ({ tag: "Hr" }),
        });

    it("dispatches the extended command through Dispatcher", () => {
        const initial = makeState();
        const d = Dispatcher.create(initial, extendedProtocol);
        const at = point(initial.doc, "t1", 5);
        expectValid(d.dispatch(ExtendedCommand.InsertMention("alice", at)));
        expect(firstText(d.peek()!).content).toBe("Hello@alice, world.");
    });

    it("falls through to defaultApply for built-in commands", () => {
        const initial = makeState();
        const d = Dispatcher.create(initial, extendedProtocol);
        const at = point(initial.doc, "t1", 5);
        expectValid(d.dispatch(ProseCommand.Insert("XYZ", at)));
        expect(firstText(d.peek()!).content).toBe("HelloXYZ, world.");
    });

    it("extended command's inverse round-trips through the Dispatcher", () => {
        const initial = makeState();
        const d = Dispatcher.create(initial, extendedProtocol);
        const at = point(initial.doc, "t1", 5);
        const { inverse } = expectValid(
            d.dispatch(ExtendedCommand.InsertMention("alice", at)),
        );
        expectValid(d.dispatch(inverse));
        expect(serialize(normalizeText(d.peek()!))).toEqual(
            serialize(normalizeText(initial.doc)),
        );
    });
});
