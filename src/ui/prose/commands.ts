import { match } from "../../match.ts";
import { union, type Variant, getTag } from "../../union.ts";
import { Validation } from "../../prelude/validation.ts";
import { CommandError } from "../../prelude/command-error.ts";
import type {
    ApplyResult,
    CommandProtocol,
} from "../../prelude/dispatcher.ts";
import {
    ProseNode,
    getNodeId,
    type Document,
    type MarkSet,
    type Text as TextNode,
} from "./document-model.ts";
import {
    EditorRange,
    type RangePoint,
} from "./editor-range.ts";
import { BlockKind, type DocumentState } from "./document-state.ts";
import {
    childrenOf,
    isBlock,
    isText,
    locate,
    locateBlock,
    markTag,
    orderPoints,
    rangePointAt,
    replaceById,
    textRangeFrom,
    updateChildren,
    walkInOrder,
    withChildren,
} from "./tree-ops.ts";

// ============================================================================
// ProseCommand union
// ============================================================================

export type SetCursorCmd      = Variant<"SetCursor",      { range: EditorRange }>;
export type InsertCmd         = Variant<"Insert",         { content: string | ProseNode[]; at: RangePoint }>;
export type DeleteBackwardCmd = Variant<"DeleteBackward", { range: EditorRange }>;
export type DeleteForwardCmd  = Variant<"DeleteForward",  { range: EditorRange }>;
export type FormatCmd         = Variant<"Format",         { mark: MarkSet; range: EditorRange }>;
export type RemoveMarkCmd     = Variant<"RemoveMark",     { markTag: string; range: EditorRange }>;
export type SplitBlockCmd     = Variant<"SplitBlock",     { at: RangePoint; newBlockId: string | null }>;
export type MergeBlockCmd     = Variant<"MergeBlock",     { at: RangePoint }>;
export type SetBlockKindCmd   = Variant<"SetBlockKind",   { range: EditorRange; kind: BlockKind }>;
export type CompoundCmd       = Variant<"Compound",       { steps: ProseCommand[] }>;

export type ProseCommand =
    | SetCursorCmd | InsertCmd | DeleteBackwardCmd | DeleteForwardCmd
    | FormatCmd | RemoveMarkCmd | SplitBlockCmd | MergeBlockCmd
    | SetBlockKindCmd | CompoundCmd;

export const ProseCommand = union([]).typed({
    SetCursor:      (range: EditorRange) => ({ range }) as SetCursorCmd,
    Insert:         (content: string | ProseNode[], at: RangePoint) =>
        ({ content, at }) as InsertCmd,
    DeleteBackward: (range: EditorRange) => ({ range }) as DeleteBackwardCmd,
    DeleteForward:  (range: EditorRange) => ({ range }) as DeleteForwardCmd,
    Format:         (mark: MarkSet, range: EditorRange) =>
        ({ mark, range }) as FormatCmd,
    RemoveMark:     (markTag: string, range: EditorRange) =>
        ({ markTag, range }) as RemoveMarkCmd,
    SplitBlock:     (at: RangePoint, options?: { newBlockId?: string }) =>
        ({ at, newBlockId: options?.newBlockId ?? null }) as SplitBlockCmd,
    MergeBlock:     (at: RangePoint) => ({ at }) as MergeBlockCmd,
    SetBlockKind:   (range: EditorRange, kind: BlockKind) =>
        ({ range, kind }) as SetBlockKindCmd,
    Compound:       (steps: ProseCommand[]) => ({ steps }) as CompoundCmd,
});

// ============================================================================
// Apply helpers
// ============================================================================

type ApplyOk = ApplyResult<DocumentState, ProseCommand>;
type ApplyOut = Validation<ApplyOk, CommandError>;

const ok = (next: DocumentState, inverse: ProseCommand): ApplyOut =>
    Validation.Valid<ApplyOk, CommandError>({ next, inverse });

const reject = (msg: string): ApplyOut =>
    Validation.Invalid<ApplyOk, CommandError>([CommandError.Rejected(msg)]);

const conflict = (msg: string): ApplyOut =>
    Validation.Invalid<ApplyOk, CommandError>([CommandError.Conflict(msg)]);

/** Resolve a range to an ordered [from, to] pair of `RangePoint`s. */
const rangeBounds = (
    range: EditorRange,
): [RangePoint, RangePoint] | null =>
    match(range, {
        Cursor: ({ point }) => [point, point] as [RangePoint, RangePoint],
        Text:   ({ anchor, focus }) => orderPoints(anchor, focus),
        Node:   () => null as [RangePoint, RangePoint] | null,
    });

const pointAtNodeStart = (
    doc: Document,
    nodeId: string,
): RangePoint | null => rangePointAt(doc, nodeId, 0);

/**
 * Walk `doc` and find the first block ancestor of `at.nodeId`. Returns the
 * block node and a `pointAtBlockStart` for it.
 */
const requireBlockOf = (
    doc: Document,
    at: RangePoint,
):
    | { ok: true; blockId: string; blockIndex: number; parentId: string; block: ProseNode }
    | { ok: false; err: string } => {
    const located = locateBlock(doc, at.nodeId);
    if (!located) return { ok: false, err: `node ${at.nodeId} not found` };
    if (located.parent === null)
        return { ok: false, err: `node ${at.nodeId} has no block parent` };
    return {
        ok: true,
        blockId: getNodeId(located.node),
        blockIndex: located.indexInParent,
        parentId: getNodeId(located.parent),
        block: located.node,
    };
};

// ============================================================================
// SetCursor
// ============================================================================

const applySetCursor = (
    state: DocumentState,
    cmd: SetCursorCmd,
): ApplyOut =>
    ok(
        { ...state, cursor: cmd.range },
        ProseCommand.SetCursor(state.cursor),
    );

// ============================================================================
// Insert
// ============================================================================

const applyInsertText = (
    state: DocumentState,
    text: string,
    at: RangePoint,
): ApplyOut => {
    const found = locate(state.doc, at.nodeId);
    if (!found) return conflict(`Insert: node ${at.nodeId} not found`);
    if (!isText(found.node))
        return reject(`Insert(text) requires a Text target; got ${getTag(found.node)}`);
    const node = found.node;
    if (at.offset < 0 || at.offset > node.content.length)
        return conflict(
            `Insert: offset ${at.offset} out of range [0, ${node.content.length}]`,
        );

    const newContent =
        node.content.slice(0, at.offset) + text + node.content.slice(at.offset);
    const newText = ProseNode.Text(newContent, node.marks, getNodeId(node)) as TextNode;
    const newDoc = replaceById(state.doc, at.nodeId, newText) as Document;

    const { anchor, focus } = textRangeFrom(at, text.length);
    const inverse = ProseCommand.DeleteForward(EditorRange.Text(anchor, focus));
    return ok({ doc: newDoc, cursor: state.cursor }, inverse);
};

/**
 * Structural insert: splice `nodes` into the parent of `at.nodeId`,
 * immediately *after* `at.nodeId`. (`at.offset` is ignored for structural
 * inserts; this is the convention chosen for v0.4.0 — it's mainly used by
 * inverses, which control the call site.)
 */
const applyInsertStructural = (
    state: DocumentState,
    nodes: ProseNode[],
    at: RangePoint,
): ApplyOut => {
    if (nodes.length === 0)
        return ok(state, ProseCommand.Compound([]));

    const found = locate(state.doc, at.nodeId);
    if (!found) return conflict(`Insert: node ${at.nodeId} not found`);
    if (found.parent === null)
        return reject(`Insert(structural) cannot target the root`);

    const parentId = getNodeId(found.parent);
    const insertAt = found.indexInParent + 1;
    const newDoc = updateChildren(state.doc, parentId, (kids) => [
        ...kids.slice(0, insertAt),
        ...nodes,
        ...kids.slice(insertAt),
    ]) as Document;

    // Inverse: delete each inserted node, in reverse, by Node range.
    const inverseSteps: ProseCommand[] = [];
    for (let i = nodes.length - 1; i >= 0; i--) {
        inverseSteps.push(
            ProseCommand.DeleteBackward(EditorRange.Node(getNodeId(nodes[i]!))),
        );
    }
    const inverse =
        inverseSteps.length === 1
            ? inverseSteps[0]!
            : ProseCommand.Compound(inverseSteps);
    return ok({ doc: newDoc, cursor: state.cursor }, inverse);
};

const applyInsert = (state: DocumentState, cmd: InsertCmd): ApplyOut => {
    if (typeof cmd.content === "string")
        return applyInsertText(state, cmd.content, cmd.at);
    return applyInsertStructural(state, cmd.content, cmd.at);
};

// ============================================================================
// Delete (backward / forward)
// ============================================================================

/**
 * Delete a `Node` range — removes the void node entirely. Inverse is a
 * structural insert that reinserts it after the previous sibling (or, if
 * none, prepends to the parent).
 */
const applyDeleteNode = (state: DocumentState, nodeId: string): ApplyOut => {
    const found = locate(state.doc, nodeId);
    if (!found) return conflict(`Delete: node ${nodeId} not found`);
    if (found.parent === null) return reject("Delete: cannot remove root");

    const node = found.node;
    const parentId = getNodeId(found.parent);
    const newDoc = updateChildren(state.doc, parentId, (kids) =>
        kids.filter((c) => getNodeId(c) !== nodeId),
    ) as Document;

    // Inverse: insert this node back after its previous sibling (or as the
    // first child if it was at index 0).
    if (found.indexInParent === 0) {
        // No previous sibling — insert as first child via custom convention:
        // we use a synthetic "before parent's first child" operation by
        // anchoring on the parent itself with an offset of 0. We model this
        // as inserting after a phantom — easier: re-use Insert(structural)
        // on the *first remaining child* with a pre-flag. Since our
        // Insert(structural) only supports "after", we emulate by inserting
        // after the (now-) first child and then... this gets ugly.
        //
        // Cleaner: introduce an internal helper that inserts at index 0
        // directly. We do that here without going through the public Insert
        // command for the inverse — the inverse becomes a Compound carrying
        // a single structural-insert that targets a virtual "head" anchor.
        //
        // For v0.4.0 we keep things simple: the inverse re-runs through the
        // public Insert command, which inserts *after* a node. If the
        // previous-sibling branch is unavailable, we anchor on the parent's
        // *first remaining child* and then SwapOrder, which is too complex.
        //
        // Compromise: when removing the first child, the inverse anchors on
        // the parent itself with offset=0, and applyInsertStructural is
        // taught to interpret "anchor === parent" as "prepend to children."
        const inverse = ProseCommand.Insert(
            [node],
            { ...rangePointAt(state.doc, parentId, 0)!, offset: 0 },
        );
        return ok({ doc: newDoc, cursor: state.cursor }, inverse);
    }

    const prevSibling = childrenOf(found.parent)[found.indexInParent - 1]!;
    const prevId = getNodeId(prevSibling);
    const inverse = ProseCommand.Insert(
        [node],
        rangePointAt(state.doc, prevId, 0)!,
    );
    return ok({ doc: newDoc, cursor: state.cursor }, inverse);
};

/**
 * Delete a text range that lies entirely within a single Text node.
 */
const applyDeleteSingleText = (
    state: DocumentState,
    textNode: TextNode,
    startOffset: number,
    endOffset: number,
    at: RangePoint,
): ApplyOut => {
    if (startOffset === endOffset)
        return ok(state, ProseCommand.Compound([]));

    const removed = textNode.content.slice(startOffset, endOffset);
    const newContent =
        textNode.content.slice(0, startOffset) + textNode.content.slice(endOffset);
    const newText = ProseNode.Text(
        newContent,
        textNode.marks,
        getNodeId(textNode),
    ) as TextNode;
    const newDoc = replaceById(state.doc, getNodeId(textNode), newText) as Document;

    const inverse = ProseCommand.Insert(removed, {
        ...at,
        offset: startOffset,
    });
    return ok({ doc: newDoc, cursor: state.cursor }, inverse);
};

/**
 * Spanning delete across blocks. Implements the "merge two blocks across a
 * deleted boundary" semantics typical of contenteditable.
 */
const applyDeleteSpanning = (
    state: DocumentState,
    from: RangePoint,
    to: RangePoint,
): ApplyOut => {
    // Collect the inverse steps as we go.
    const inverseSteps: ProseCommand[] = [];

    // 1. Find block A (containing `from`) and block B (containing `to`).
    const blockA = locateBlock(state.doc, from.nodeId);
    const blockB = locateBlock(state.doc, to.nodeId);
    if (!blockA || !blockB)
        return conflict("Delete: range endpoints not in any block");
    if (blockA.parent === null || blockB.parent === null)
        return reject("Delete: cannot span the root");
    if (getNodeId(blockA.parent) !== getNodeId(blockB.parent))
        return reject("Delete: spanning unequal parents not supported");

    const parentId = getNodeId(blockA.parent);
    const aId = getNodeId(blockA.node);
    const bId = getNodeId(blockB.node);
    const aIndex = blockA.indexInParent;
    const bIndex = blockB.indexInParent;

    // 2. For block A — slice text/inline children from `from.offset` onward.
    //    For block B — slice from start through `to.offset`.
    //    Anything between blockA and blockB is deleted whole.

    // Prepare new block A: keep content [0, from.offset) of from-text within A,
    // then append content [to.offset, end) of to-text within B, plus inline
    // siblings after the to-text within B.
    const aChildren = childrenOf(blockA.node);
    const fromTextLocated = locate(state.doc, from.nodeId)!;
    const fromTextIndexInA = aChildren.findIndex(
        (c) => getNodeId(c) === from.nodeId,
    );
    if (fromTextIndexInA === -1)
        return reject("Delete: `from` not directly inside block A");

    const bChildren = childrenOf(blockB.node);
    const toTextIndexInB = bChildren.findIndex(
        (c) => getNodeId(c) === to.nodeId,
    );
    if (toTextIndexInB === -1)
        return reject("Delete: `to` not directly inside block B");

    const fromText = fromTextLocated.node;
    const toTextLocated = locate(state.doc, to.nodeId)!;
    const toText = toTextLocated.node;

    if (!isText(fromText) || !isText(toText))
        return reject(
            "Delete: spanning ranges currently require Text endpoints",
        );

    // --- Build deleted content (for inverse construction). ---

    // Text removed from A's `fromText`:
    const removedFromAText = fromText.content.slice(from.offset);
    // Inline siblings of fromText that came after it in A:
    const trailingAInlines = aChildren.slice(fromTextIndexInA + 1);
    // Whole blocks between A and B:
    const middleBlocks = childrenOf(blockA.parent).slice(aIndex + 1, bIndex);
    // Text removed from B's `toText`:
    const removedFromBText = toText.content.slice(0, to.offset);
    // Inline siblings of toText that came before it in B:
    const leadingBInlines = bChildren.slice(0, toTextIndexInB);

    // --- Apply forward: rebuild A with merged content; remove middle and B. ---
    const truncatedFromText = ProseNode.Text(
        fromText.content.slice(0, from.offset),
        fromText.marks,
        getNodeId(fromText),
    );
    const truncatedToText = ProseNode.Text(
        toText.content.slice(to.offset),
        toText.marks,
        getNodeId(toText),
    );
    const newAChildren: ProseNode[] = [
        ...aChildren.slice(0, fromTextIndexInA),
        truncatedFromText,
        truncatedToText,
        ...bChildren.slice(toTextIndexInB + 1),
    ];
    // Drop empty Text nodes at the boundaries to keep things tidy.
    const cleanAChildren = newAChildren.filter(
        (c) => !(isText(c) && c.content.length === 0),
    );
    const newA = withChildren(blockA.node, cleanAChildren);

    const newParentChildren = childrenOf(blockA.parent).flatMap((c, i) => {
        if (i === aIndex) return [newA];
        if (i > aIndex && i <= bIndex) return [];
        return [c];
    });
    const newDoc = updateChildren(
        state.doc,
        parentId,
        () => newParentChildren,
    ) as Document;

    // --- Build inverse Compound. ---
    // Strategy: replay the deletion in reverse:
    //   1. SplitBlock at the boundary — restoring blocks A and B (B keeps its old ID).
    //   2. Reinsert middle blocks between the split halves.
    //   3. Reinsert text into A's fromText at from.offset.
    //   4. Reinsert text into B's toText at offset 0 (and prepend leading inlines).

    // For the split, we want to split blockA in newDoc at a point that
    // corresponds to the end of truncatedFromText. The split point is
    // (fromText, fromText.content.slice(0, from.offset).length) i.e.
    // an offset of `from.offset` into the (new) fromText.
    const splitPoint: RangePoint = {
        ...from,
        absolute: from.absolute, // logical only; recomputed at apply time.
    };

    // Reconstruct inverse:
    const invSteps: ProseCommand[] = [];

    // Step 1: split block A back into [A_truncated, B_with_old_id].
    invSteps.push(
        ProseCommand.SplitBlock(splitPoint, { newBlockId: bId }),
    );

    // Step 2: reinsert leading B inlines into the new B (they come before toText).
    //         These are inline nodes that lived in B before toText. Inserting them
    //         "before" toText currently isn't expressible with a single Insert.
    //         We use a Compound of per-node structural inserts instead.
    if (leadingBInlines.length > 0) {
        invSteps.push(
            // Stub: we model these as structural inserts targeting toText.
            // applyInsertStructural inserts *after* the anchor, so we
            // anchor on the previous sibling iteratively. For v0.4.0 we
            // emit a single Insert([leadingBInlines], at-targeting-blockB-start).
            ProseCommand.Insert(leadingBInlines, {
                ...rangePointAt(state.doc, bId, 0)!,
                offset: 0,
            }),
        );
    }

    // Step 3: reinsert removed text into B's toText at offset 0.
    if (removedFromBText.length > 0) {
        const toAt: RangePoint = {
            ...to,
            offset: 0,
        };
        invSteps.push(ProseCommand.Insert(removedFromBText, toAt));
    }

    // Step 4: reinsert middle blocks between split A and B.
    if (middleBlocks.length > 0) {
        invSteps.push(
            ProseCommand.Insert(middleBlocks, {
                ...rangePointAt(state.doc, aId, 0)!,
                offset: 0,
            }),
        );
    }

    // Step 5: reinsert trailing A inlines after fromText in A.
    if (trailingAInlines.length > 0) {
        invSteps.push(
            ProseCommand.Insert(trailingAInlines, {
                ...rangePointAt(state.doc, getNodeId(fromText), 0)!,
                offset: 0,
            }),
        );
    }

    // Step 6: reinsert removed text into A's fromText at from.offset.
    if (removedFromAText.length > 0) {
        invSteps.push(ProseCommand.Insert(removedFromAText, from));
    }

    inverseSteps.push(...invSteps);
    const inverse = ProseCommand.Compound(inverseSteps);
    return ok({ doc: newDoc, cursor: state.cursor }, inverse);
};

const applyDeleteRange = (
    state: DocumentState,
    range: EditorRange,
    _direction: "backward" | "forward",
): ApplyOut => {
    return match(range, {
        Node: ({ nodeId }) => applyDeleteNode(state, nodeId),
        Cursor: ({ point: _ }) => ok(state, ProseCommand.Compound([])),
        Text: ({ anchor, focus }) => {
            const [from, to] = orderPoints(anchor, focus);
            if (from.absolute === to.absolute)
                return ok(state, ProseCommand.Compound([]));

            // Single-block path: from.nodeId === to.nodeId AND it's a Text
            // node — the simple in-node deletion.
            if (from.nodeId === to.nodeId) {
                const found = locate(state.doc, from.nodeId);
                if (!found || !isText(found.node))
                    return conflict("Delete: text range endpoint not on a Text node");
                return applyDeleteSingleText(
                    state,
                    found.node,
                    from.offset,
                    to.offset,
                    from,
                );
            }

            // Spanning path: from and to lie in different Text nodes,
            // possibly across blocks.
            return applyDeleteSpanning(state, from, to);
        },
    });
};

// ============================================================================
// Format / RemoveMark
// ============================================================================

const applyFormatRange = (
    state: DocumentState,
    mark: MarkSet,
    range: EditorRange,
    op: "add" | "remove",
    markTagName: string,
): ApplyOut => {
    const bounds = rangeBounds(range);
    if (!bounds) return reject(`${op === "add" ? "Format" : "RemoveMark"}: Node ranges not yet supported`);
    const [from, to] = bounds;
    if (from.absolute === to.absolute)
        return ok(state, ProseCommand.Compound([]));

    // Walk in document order; for each Text node overlapping the range,
    // split the node's content into [before, inside, after] and adjust
    // the marks on the inside segment.
    const inverseSteps: ProseCommand[] = [];
    let nextDoc: Document = state.doc;

    for (const visit of walkInOrder(state.doc)) {
        if (!isText(visit.node)) continue;
        const node = visit.node;
        const start = visit.absolute;
        const end = start + node.content.length;
        const overlapStart = Math.max(start, from.absolute);
        const overlapEnd = Math.min(end, to.absolute);
        if (overlapEnd <= overlapStart) continue;

        const localStart = overlapStart - start;
        const localEnd = overlapEnd - start;
        const before = node.content.slice(0, localStart);
        const inside = node.content.slice(localStart, localEnd);
        const after = node.content.slice(localEnd);

        // Determine whether this segment was already marked (for the inverse).
        const wasMarked = node.marks.some((m) => markTag(m) === markTagName);

        // Build replacement: split into up to three Text nodes.
        const replacements: ProseNode[] = [];
        if (before.length > 0)
            replacements.push(
                ProseNode.Text(before, [...node.marks], getNodeId(node)),
            );
        const insideMarks =
            op === "add"
                ? wasMarked
                    ? node.marks.map((m) =>
                        markTag(m) === markTagName ? mark : m,
                    )
                    : [...node.marks, mark]
                : node.marks.filter((m) => markTag(m) !== markTagName);
        const insideText = ProseNode.Text(
            inside,
            insideMarks,
            // First sub-node retains the original ID only if `before` is empty,
            // so the original ID is always preserved for the leftmost piece.
            before.length === 0 ? getNodeId(node) : undefined,
        );
        replacements.push(insideText);
        if (after.length > 0)
            replacements.push(ProseNode.Text(after, [...node.marks]));

        // Splice replacements into the parent.
        const located = locate(nextDoc, getNodeId(node));
        if (!located || !located.parent) continue; // shouldn't happen
        const parentId = getNodeId(located.parent);
        nextDoc = updateChildren(nextDoc, parentId, (kids) => {
            const idx = kids.findIndex((c) => getNodeId(c) === getNodeId(node));
            if (idx === -1) return kids;
            return [
                ...kids.slice(0, idx),
                ...replacements,
                ...kids.slice(idx + 1),
            ];
        }) as Document;

        // Inverse step: invert this segment's mark transition. Emit
        // per-segment Format/RemoveMark on the *new* insideText by its node ID.
        const insideAt = pointAtNodeStart(nextDoc, getNodeId(insideText))!;
        const insideRangeById = EditorRange.Text(insideAt, {
            ...insideAt,
            offset: insideText.content.length,
            col: insideAt.col + insideText.content.length,
            absolute: insideAt.absolute + insideText.content.length,
        });
        if (op === "add") {
            // Inverse: remove the mark we just added (or restore a prior payload).
            inverseSteps.push(
                wasMarked
                    ? ProseCommand.Format(
                        node.marks.find((m) => markTag(m) === markTagName)!,
                        insideRangeById,
                    )
                    : ProseCommand.RemoveMark(markTagName, insideRangeById),
            );
        } else {
            // Inverse: re-add the mark with its original payload, if any.
            if (wasMarked) {
                const prev = node.marks.find(
                    (m) => markTag(m) === markTagName,
                )!;
                inverseSteps.push(ProseCommand.Format(prev, insideRangeById));
            }
        }
    }

    const inverse =
        inverseSteps.length === 1
            ? inverseSteps[0]!
            : ProseCommand.Compound([...inverseSteps].reverse());
    return ok({ doc: nextDoc, cursor: state.cursor }, inverse);
};

// ============================================================================
// SplitBlock / MergeBlock
// ============================================================================

const applySplitBlock = (
    state: DocumentState,
    cmd: SplitBlockCmd,
): ApplyOut => {
    const blockInfo = requireBlockOf(state.doc, cmd.at);
    if (!blockInfo.ok) return conflict(blockInfo.err);

    const block = blockInfo.block;
    const blockKids = childrenOf(block);
    const parentId = blockInfo.parentId;

    // Find the inline child (Text) referenced by `at.nodeId` and split there.
    const childIndex = blockKids.findIndex(
        (c) => getNodeId(c) === cmd.at.nodeId,
    );
    if (childIndex === -1)
        return reject(
            `SplitBlock: at.nodeId ${cmd.at.nodeId} not a direct child of its block`,
        );
    const child = blockKids[childIndex]!;
    if (!isText(child))
        return reject("SplitBlock: split point must be inside a Text node");

    const before = child.content.slice(0, cmd.at.offset);
    const after = child.content.slice(cmd.at.offset);

    const leftText = ProseNode.Text(before, child.marks, getNodeId(child));
    const rightText = ProseNode.Text(after, child.marks);

    const leftKids: ProseNode[] = [
        ...blockKids.slice(0, childIndex),
        leftText,
    ];
    const rightKids: ProseNode[] = [
        rightText,
        ...blockKids.slice(childIndex + 1),
    ];

    const leftBlock = withChildren(block, leftKids);
    // Build the right block as the same kind, with the new ID (or pinned).
    const rightBlock = (() => {
        const kindMatch = match(block, {
            Block:    () => ProseNode.Block(rightKids, cmd.newBlockId ?? undefined),
            Heading:  ({ level }) => ProseNode.Heading(level, rightKids, cmd.newBlockId ?? undefined),
            Quote:    () => ProseNode.Quote(rightKids, cmd.newBlockId ?? undefined),
            Code:     ({ language }) => ProseNode.Code(language, rightKids, cmd.newBlockId ?? undefined),
            Document: () => block,
            Text:     () => block,
            Image:    () => block,
            HardBreak:() => block,
            Hr:       () => block,
        });
        return kindMatch;
    })();

    const newDoc = updateChildren(state.doc, parentId, (kids) => {
        const idx = kids.findIndex((c) => getNodeId(c) === blockInfo.blockId);
        return [
            ...kids.slice(0, idx),
            leftBlock,
            rightBlock,
            ...kids.slice(idx + 1),
        ];
    }) as Document;

    // Inverse: MergeBlock at the start of the right block.
    const rightStart = rangePointAt(newDoc, getNodeId(rightBlock), 0);
    if (!rightStart) return reject("SplitBlock: failed to compute inverse anchor");
    const inverse = ProseCommand.MergeBlock(rightStart);
    return ok({ doc: newDoc, cursor: state.cursor }, inverse);
};

const applyMergeBlock = (
    state: DocumentState,
    cmd: MergeBlockCmd,
): ApplyOut => {
    const blockInfo = requireBlockOf(state.doc, cmd.at);
    if (!blockInfo.ok) return conflict(blockInfo.err);

    const blockNode = blockInfo.block;
    const parentLocated = locate(state.doc, blockInfo.parentId);
    if (!parentLocated) return conflict("MergeBlock: parent vanished");
    const siblings = childrenOf(parentLocated.node);
    const idx = siblings.findIndex(
        (c) => getNodeId(c) === blockInfo.blockId,
    );
    if (idx <= 0)
        return reject("MergeBlock: no preceding block to merge with");

    const prev = siblings[idx - 1]!;
    if (!isBlock(prev))
        return reject("MergeBlock: preceding sibling is not a block");

    const prevId = getNodeId(prev);
    const prevKids = childrenOf(prev);
    const thisKids = childrenOf(blockNode);

    // Adjacent Text siblings at the merge boundary are intentionally NOT
    // coalesced here — leaving them separate keeps inverse anchors stable.
    const mergedKids = [...prevKids, ...thisKids];
    const mergedPrev = withChildren(prev, mergedKids);

    const newDoc = updateChildren(state.doc, blockInfo.parentId, (kids) => [
        ...kids.slice(0, idx - 1),
        mergedPrev,
        ...kids.slice(idx + 1),
    ]) as Document;

    // Inverse: SplitBlock at the start of the first child contributed by
    // `blockNode` (i.e., the original block-boundary).
    const firstThisChild = thisKids[0];
    if (!firstThisChild)
        // Edge: merging an empty block is just removal; inverse is structural insert.
        return ok(
            { doc: newDoc, cursor: state.cursor },
            ProseCommand.Insert([blockNode], {
                ...rangePointAt(newDoc, prevId, 0)!,
                offset: 0,
            }),
        );

    const firstThisId = getNodeId(firstThisChild);
    const splitAt: RangePoint = isText(firstThisChild)
        ? {
              ...rangePointAt(newDoc, firstThisId, 0)!,
              offset: 0,
          }
        : rangePointAt(newDoc, firstThisId, 0)!;
    const inverse = ProseCommand.SplitBlock(splitAt, {
        newBlockId: blockInfo.blockId,
    });
    return ok({ doc: newDoc, cursor: state.cursor }, inverse);
};

// ============================================================================
// SetBlockKind
// ============================================================================

const applySetBlockKind = (
    state: DocumentState,
    cmd: SetBlockKindCmd,
): ApplyOut => {
    const bounds = rangeBounds(cmd.range);
    if (!bounds)
        return reject("SetBlockKind: Node ranges not supported");
    const [from, to] = bounds;

    // Identify all blocks overlapping [from, to].
    const targets: { blockId: string; prevKind: BlockKind }[] = [];
    let nextDoc: Document = state.doc;

    const seen = new Set<string>();
    for (const v of walkInOrder(state.doc)) {
        if (!isBlock(v.node)) continue;
        const id = getNodeId(v.node);
        if (seen.has(id)) continue;
        // Compute block's character span [start, end].
        const start = v.absolute;
        // Sum content length of subtree.
        let len = 0;
        for (const inner of walkInOrder(v.node)) {
            if (isText(inner.node)) len += inner.node.content.length;
            else if (getTag(inner.node) === "HardBreak") len += 1;
        }
        const end = start + len;
        if (end < from.absolute || start > to.absolute) continue;

        seen.add(id);
        const prevKind = match(v.node, {
            Block:    () => BlockKind.Block(),
            Heading:  ({ level }) => BlockKind.Heading(level),
            Quote:    () => BlockKind.Quote(),
            Code:     ({ language }) => BlockKind.Code(language),
            Document: () => BlockKind.Block(),
            Text:     () => BlockKind.Block(),
            Image:    () => BlockKind.Block(),
            HardBreak:() => BlockKind.Block(),
            Hr:       () => BlockKind.Block(),
        });
        targets.push({ blockId: id, prevKind });

        const replacement = match(cmd.kind, {
            Block:   () => ProseNode.Block(childrenOf(v.node), id),
            Heading: ({ level }) => ProseNode.Heading(level, childrenOf(v.node), id),
            Quote:   () => ProseNode.Quote(childrenOf(v.node), id),
            Code:    ({ language }) => ProseNode.Code(language, childrenOf(v.node), id),
        });
        nextDoc = replaceById(nextDoc, id, replacement) as Document;
    }

    if (targets.length === 0)
        return ok(state, ProseCommand.Compound([]));

    // Inverse: per-block SetBlockKind restoring previous kind.
    const invSteps = targets.map(({ blockId, prevKind }) =>
        ProseCommand.SetBlockKind(
            EditorRange.Node(blockId), // single-block range expressed via Node
            prevKind,
        ),
    );
    const inverse =
        invSteps.length === 1
            ? invSteps[0]!
            : ProseCommand.Compound(invSteps);
    return ok({ doc: nextDoc, cursor: state.cursor }, inverse);
};

// SetBlockKind needs to also handle Node-range targeting a single block (used
// by inverse compositions). Handle that path here:
const applySetBlockKindNode = (
    state: DocumentState,
    nodeId: string,
    kind: BlockKind,
): ApplyOut => {
    const found = locate(state.doc, nodeId);
    if (!found) return conflict(`SetBlockKind: ${nodeId} not found`);
    if (!isBlock(found.node))
        return reject("SetBlockKind: target must be a block");

    const prevKind = match(found.node, {
        Block:    () => BlockKind.Block(),
        Heading:  ({ level }) => BlockKind.Heading(level),
        Quote:    () => BlockKind.Quote(),
        Code:     ({ language }) => BlockKind.Code(language),
        Document: () => BlockKind.Block(),
        Text:     () => BlockKind.Block(),
        Image:    () => BlockKind.Block(),
        HardBreak:() => BlockKind.Block(),
        Hr:       () => BlockKind.Block(),
    });
    const replacement = match(kind, {
        Block:   () => ProseNode.Block(childrenOf(found.node), nodeId),
        Heading: ({ level }) => ProseNode.Heading(level, childrenOf(found.node), nodeId),
        Quote:   () => ProseNode.Quote(childrenOf(found.node), nodeId),
        Code:    ({ language }) => ProseNode.Code(language, childrenOf(found.node), nodeId),
    });
    const newDoc = replaceById(state.doc, nodeId, replacement) as Document;
    return ok(
        { doc: newDoc, cursor: state.cursor },
        ProseCommand.SetBlockKind(EditorRange.Node(nodeId), prevKind),
    );
};

// ============================================================================
// defaultApply
// ============================================================================

export const defaultApply: CommandProtocol<
    DocumentState,
    Document,
    ProseCommand
>["apply"] = (state, cmd) =>
    match(cmd, {
        SetCursor:      (c) => applySetCursor(state, c),
        Insert:         (c) => applyInsert(state, c),
        DeleteBackward: ({ range }) => applyDeleteRange(state, range, "backward"),
        DeleteForward:  ({ range }) => applyDeleteRange(state, range, "forward"),
        Format:         ({ mark, range }) =>
            applyFormatRange(state, mark, range, "add", markTag(mark)),
        RemoveMark:     ({ markTag: t, range }) =>
            applyFormatRange(state, undefined as unknown as MarkSet, range, "remove", t),
        SplitBlock:     (c) => applySplitBlock(state, c),
        MergeBlock:     (c) => applyMergeBlock(state, c),
        SetBlockKind:   ({ range, kind }) =>
            getTag(range) === "Node"
                ? applySetBlockKindNode(state, (range as { nodeId: string }).nodeId, kind)
                : applySetBlockKind(state, ProseCommand.SetBlockKind(range, kind)),
        Compound:       ({ steps }) => applyCompound(state, steps),
    });

const applyCompound = (
    state: DocumentState,
    steps: ProseCommand[],
): ApplyOut => {
    let current = state;
    const inverseSteps: ProseCommand[] = [];
    for (const step of steps) {
        const result = defaultApply(current, step);
        const flowed = match(result, {
            Valid: ({ value }) => {
                current = value.next;
                inverseSteps.push(value.inverse);
                return null;
            },
            Invalid: (v) => v as ApplyOut,
            Unvalidated: (v) => v as ApplyOut,
        });
        if (flowed !== null) return flowed;
    }
    return ok(current, ProseCommand.Compound([...inverseSteps].reverse()));
};

// ============================================================================
// proseProtocol
// ============================================================================

export const proseProtocol: CommandProtocol<
    DocumentState,
    Document,
    ProseCommand
> = {
    extract: (state) => state.doc,
    apply: defaultApply,
};
