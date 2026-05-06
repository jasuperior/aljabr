import { describe, it, expect } from "vitest";
import { match } from "../../../src/match.ts";
import { __, getTag, type Union } from "../../../src/union.ts";
import { Validation } from "../../../src/prelude/validation.ts";
import type {
    ApplyResult,
    CommandProtocol,
} from "../../../src/prelude/dispatcher.ts";
import { CommandError } from "../../../src/prelude/command-error.ts";
import {
    ProseNode,
    getNodeId,
    type Document,
} from "../../../src/ui/prose/document-model.ts";
import {
    EditorRange,
    type RangePoint,
} from "../../../src/ui/prose/editor-range.ts";
import type { DocumentState } from "../../../src/ui/prose/document-state.ts";
import { ProseCommand, defaultApply } from "../../../src/ui/prose/commands.ts";
import {
    rangePointAt,
    locate,
    replaceById,
    normalizeText,
} from "../../../src/ui/prose/tree-ops.ts";

// ---------------------------------------------------------------------------
// Demonstrate the extension pattern: domain-specific commands extend
// `ProseCommand` via `.merge`, and the apply composes via `match()` with a
// `[__]` fallback that delegates to `defaultApply`.
// ---------------------------------------------------------------------------

const point = (doc: Document, nodeId: string, offset: number): RangePoint =>
    rangePointAt(doc, nodeId, offset)!;

describe("Extending ProseCommand via merge() + [__] fallback", () => {
    /**
     * Extended union with a domain-specific InsertMention command. The
     * payload carries the user ID; forward semantics is to insert "@user"
     * text at a Text RangePoint.
     */
    const ExtendedCommand = ProseCommand.merge({
        InsertMention: (userId: string, at: RangePoint) => ({ userId, at }),
    });
    type ExtendedCommand = Union<typeof ExtendedCommand>;

    const extendedApply: CommandProtocol<
        DocumentState,
        Document,
        ExtendedCommand
    >["apply"] = (state, cmd) =>
        match(cmd, {
            InsertMention: ({
                userId,
                at,
            }: {
                userId: string;
                at: RangePoint;
            }) => {
                const found = locate(state.doc, at.nodeId);
                if (!found || getTag(found.node) !== "Text") {
                    return Validation.Invalid<
                        ApplyResult<DocumentState, ProseCommand>,
                        CommandError
                    >([
                        CommandError.Conflict(
                            `InsertMention: target ${at.nodeId} is not a Text node`,
                        ),
                    ]);
                }
                const text = found.node as unknown as {
                    content: string;
                    marks: never[];
                };
                const insertion = `@${userId}`;
                const newContent =
                    text.content.slice(0, at.offset) +
                    insertion +
                    text.content.slice(at.offset);
                const newText = ProseNode.Text(
                    newContent,
                    text.marks,
                    getNodeId(found.node),
                );
                const newDoc = replaceById(
                    state.doc,
                    at.nodeId,
                    newText,
                ) as Document;
                // Inverse: a built-in DeleteForward over the inserted span.
                const inverseRange = EditorRange.Text(at, {
                    ...at,
                    offset: at.offset + insertion.length,
                    col: at.col + insertion.length,
                    absolute: at.absolute + insertion.length,
                });
                return Validation.Valid<
                    ApplyResult<DocumentState, ProseCommand>,
                    CommandError
                >({
                    next: { doc: newDoc, cursor: state.cursor },
                    inverse: ProseCommand.DeleteForward(inverseRange),
                });
            },
            // Fallback narrows to "everything except InsertMention", which is
            // exactly ProseCommand — but TS can't infer that, so we coerce.
            [__]: (c: ExtendedCommand) =>
                defaultApply(state, c as ProseCommand),
        });

    const makeState = (): DocumentState => {
        const t1 = ProseNode.Text("Hello, world.", [], "t1");
        const b1 = ProseNode.Block([t1], "b1");
        const doc = ProseNode.Document([b1], "d1") as Document;
        return { doc, cursor: EditorRange.Cursor(point(doc, "t1", 0)) };
    };

    const dispatch = (state: DocumentState, cmd: ExtendedCommand) =>
        match(extendedApply(state, cmd), {
            Valid: ({ value }) => value,
            Invalid: ({ errors }) => {
                throw new Error(`apply failed: ${JSON.stringify(errors)}`);
            },
            Unvalidated: () => {
                throw new Error("unreachable");
            },
        });

    it("dispatches the extended command", () => {
        const s = makeState();
        const at = point(s.doc, "t1", 5);
        const { next } = dispatch(
            s,
            ExtendedCommand.InsertMention("alice", at),
        );
        const t1 = (next.doc.children[0] as { children: { content: string }[] })
            .children[0]!;
        expect(t1.content).toBe("Hello@alice, world.");
    });

    it("falls through to defaultApply for built-in commands", () => {
        const s = makeState();
        const at = point(s.doc, "t1", 5);
        const { next } = dispatch(s, ProseCommand.Insert("XYZ", at));
        const t1 = (next.doc.children[0] as { children: { content: string }[] })
            .children[0]!;
        expect(t1.content).toBe("HelloXYZ, world.");
    });

    it("the extended command's inverse round-trips through extendedApply", () => {
        const s = makeState();
        const at = point(s.doc, "t1", 5);
        const { next, inverse } = dispatch(
            s,
            ExtendedCommand.InsertMention("alice", at),
        );
        const { next: restored } = dispatch(next, inverse);
        expect(serializeDoc(normalizeText(restored.doc))).toEqual(
            serializeDoc(normalizeText(s.doc)),
        );
    });
});

const serializeDoc = (n: ProseNode): unknown => {
    const tag = getTag(n);
    const o: Record<string, unknown> = { tag };
    if ("content" in (n as object))
        o.content = (n as { content: string }).content;
    if ("children" in (n as object))
        o.children = (n as { children: ProseNode[] }).children.map(
            serializeDoc,
        );
    return o;
};
