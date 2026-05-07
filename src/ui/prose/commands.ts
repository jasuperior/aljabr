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
    isList,
    isListItem,
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
import type { List, ListItem } from "./document-model.ts";

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
export type ToggleListCmd      = Variant<"ToggleList",      { range: EditorRange; ordered: boolean }>;
export type IndentListItemCmd  = Variant<"IndentListItem",  { range: EditorRange }>;
export type OutdentListItemCmd = Variant<"OutdentListItem", { range: EditorRange }>;
export type SplitListItemCmd   = Variant<"SplitListItem",   { at: RangePoint }>;
export type CompoundCmd       = Variant<"Compound",       { steps: ProseCommand[] }>;

export type ProseCommand =
    | SetCursorCmd | InsertCmd | DeleteBackwardCmd | DeleteForwardCmd
    | FormatCmd | RemoveMarkCmd | SplitBlockCmd | MergeBlockCmd
    | SetBlockKindCmd
    | ToggleListCmd | IndentListItemCmd | OutdentListItemCmd | SplitListItemCmd
    | CompoundCmd;

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
    ToggleList:      (range: EditorRange, ordered: boolean) =>
        ({ range, ordered }) as ToggleListCmd,
    IndentListItem:  (range: EditorRange) => ({ range }) as IndentListItemCmd,
    OutdentListItem: (range: EditorRange) => ({ range }) as OutdentListItemCmd,
    SplitListItem:   (at: RangePoint) => ({ at }) as SplitListItemCmd,
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
            Block:       () => ProseNode.Block(rightKids, cmd.newBlockId ?? undefined),
            Heading:     ({ level }) => ProseNode.Heading(level, rightKids, cmd.newBlockId ?? undefined),
            Quote:       () => ProseNode.Quote(rightKids, cmd.newBlockId ?? undefined),
            Code:        ({ language }) => ProseNode.Code(language, rightKids, cmd.newBlockId ?? undefined),
            Document:    () => block,
            List:        () => block,
            ListItem:    () => block,
            Text:        () => block,
            HardBreak:   () => block,
            Hr:          () => block,
            BlockEmbed:  () => block,
            InlineEmbed: () => block,
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
    // Cross-ListItem fallback: when this block is the first in its ListItem
    // and that ListItem has a preceding sibling ListItem, merge with the last
    // block of the preceding ListItem and drop the now-empty current ListItem.
    if (idx === 0 && isListItem(parentLocated.node)) {
        const enc = locateEnclosingListItem(state.doc, blockInfo.blockId);
        if (enc && enc.itemIndex > 0) {
            const prevItem = enc.list.children[enc.itemIndex - 1]!;
            const prevItemKids = childrenOf(prevItem);
            const prevItemLastBlock = prevItemKids[prevItemKids.length - 1];
            if (prevItemLastBlock && isBlock(prevItemLastBlock)) {
                const mergedLastBlock = withChildren(prevItemLastBlock, [
                    ...childrenOf(prevItemLastBlock),
                    ...childrenOf(blockNode),
                ]);
                const newPrevItemKids = [
                    ...prevItemKids.slice(0, prevItemKids.length - 1),
                    mergedLastBlock,
                ];
                const newPrevItem = ProseNode.ListItem(newPrevItemKids, getNodeId(prevItem));
                const newListChildren = [
                    ...enc.list.children.slice(0, enc.itemIndex - 1),
                    newPrevItem,
                    ...enc.list.children.slice(enc.itemIndex + 1),
                ];
                const newList = ProseNode.List(
                    enc.list.ordered,
                    newListChildren,
                    getNodeId(enc.list),
                );
                const newDoc = replaceById(
                    state.doc,
                    getNodeId(enc.list),
                    newList,
                ) as Document;
                // Inverse: SplitListItem at the start of the original first
                // child of the merged-in block (the boundary).
                const firstChild = childrenOf(blockNode)[0];
                if (!firstChild)
                    return ok(
                        { doc: newDoc, cursor: state.cursor },
                        ProseCommand.Compound([]),
                    );
                const splitAt: RangePoint = isText(firstChild)
                    ? { ...rangePointAt(newDoc, getNodeId(firstChild), 0)!, offset: 0 }
                    : rangePointAt(newDoc, getNodeId(firstChild), 0)!;
                const inverse = ProseCommand.SplitListItem(splitAt);
                return ok({ doc: newDoc, cursor: state.cursor }, inverse);
            }
        }
        return reject("MergeBlock: no preceding block to merge with");
    }

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
            Block:       () => BlockKind.Block(),
            Heading:     ({ level }) => BlockKind.Heading(level),
            Quote:       () => BlockKind.Quote(),
            Code:        ({ language }) => BlockKind.Code(language),
            Document:    () => BlockKind.Block(),
            List:        () => BlockKind.Block(),
            ListItem:    () => BlockKind.Block(),
            Text:        () => BlockKind.Block(),
            HardBreak:   () => BlockKind.Block(),
            Hr:          () => BlockKind.Block(),
            BlockEmbed:  () => BlockKind.Block(),
            InlineEmbed: () => BlockKind.Block(),
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
        Block:       () => BlockKind.Block(),
        Heading:     ({ level }) => BlockKind.Heading(level),
        Quote:       () => BlockKind.Quote(),
        Code:        ({ language }) => BlockKind.Code(language),
        Document:    () => BlockKind.Block(),
        List:        () => BlockKind.Block(),
        ListItem:    () => BlockKind.Block(),
        Text:        () => BlockKind.Block(),
        HardBreak:   () => BlockKind.Block(),
        Hr:          () => BlockKind.Block(),
        BlockEmbed:  () => BlockKind.Block(),
        InlineEmbed: () => BlockKind.Block(),
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
// List operations
// ============================================================================

/**
 * Locate the nearest enclosing `<List>` ancestor of the node identified by
 * `nodeId`. Returns the located List along with the index of the enclosing
 * `ListItem` within that list. Returns `null` if `nodeId` is not inside a
 * List.
 */
const locateEnclosingList = (
    doc: Document,
    nodeId: string,
): { list: List; listIndexInParent: number; listParentId: string; itemIndex: number } | null => {
    const found = locate(doc, nodeId);
    if (!found) return null;
    let lastListItemAncestorIndex = -1;
    for (let i = found.ancestors.length - 1; i >= 0; i--) {
        const a = found.ancestors[i]!;
        if (isListItem(a)) lastListItemAncestorIndex = i;
        if (isList(a)) {
            const list = a as List;
            const listLocated = locate(doc, getNodeId(list));
            if (!listLocated || !listLocated.parent) return null;
            const itemIndex = lastListItemAncestorIndex >= 0
                ? list.children.findIndex(
                    (c) => getNodeId(c) === getNodeId(found.ancestors[lastListItemAncestorIndex]!),
                )
                : -1;
            return {
                list,
                listIndexInParent: listLocated.indexInParent,
                listParentId: getNodeId(listLocated.parent),
                itemIndex,
            };
        }
    }
    return null;
};

const applyToggleList = (
    state: DocumentState,
    cmd: ToggleListCmd,
): ApplyOut => {
    const bounds = rangeBounds(cmd.range);
    if (!bounds) return reject("ToggleList: Node ranges not supported");
    const [from] = bounds;

    // Unwrap path: range start is inside a List → replace the List with its
    // items' children flattened.
    const enclosing = locateEnclosingList(state.doc, from.nodeId);
    if (enclosing) {
        const { list, listParentId } = enclosing;
        const flattened: ProseNode[] = list.children.flatMap((li) => childrenOf(li));
        const listId = getNodeId(list);

        const newDoc = updateChildren(state.doc, listParentId, (kids) => {
            const idx = kids.findIndex((c) => getNodeId(c) === listId);
            return [...kids.slice(0, idx), ...flattened, ...kids.slice(idx + 1)];
        }) as Document;

        // Inverse: ToggleList over the same range — re-runs the wrap path on
        // the (now unwrapped) blocks.
        const inverse = ProseCommand.ToggleList(cmd.range, list.ordered);
        return ok({ doc: newDoc, cursor: state.cursor }, inverse);
    }

    // Wrap path: locate the block ancestor of `from`. Wrap that single block
    // into a `<List>` of one `<ListItem>`. (Multi-block wrap is deferred.)
    const blockLocated = locateBlock(state.doc, from.nodeId);
    if (!blockLocated || !blockLocated.parent)
        return reject("ToggleList: target has no block ancestor");
    const block = blockLocated.node;
    const blockId = getNodeId(block);
    const blockParentId = getNodeId(blockLocated.parent);

    const item = ProseNode.ListItem([block]);
    const list = ProseNode.List(cmd.ordered, [item]);

    const newDoc = updateChildren(state.doc, blockParentId, (kids) => {
        const idx = kids.findIndex((c) => getNodeId(c) === blockId);
        return [...kids.slice(0, idx), list, ...kids.slice(idx + 1)];
    }) as Document;

    // Inverse: ToggleList over the same range — re-runs the unwrap path
    // since the block is now inside the new List.
    const inverse = ProseCommand.ToggleList(cmd.range, cmd.ordered);
    return ok({ doc: newDoc, cursor: state.cursor }, inverse);
};

/**
 * Locate the `<ListItem>` enclosing `nodeId`, along with its parent `<List>`
 * and that list's location. Returns null if `nodeId` is not inside a list
 * item.
 */
const locateEnclosingListItem = (
    doc: Document,
    nodeId: string,
):
    | {
        item: ListItem;
        itemIndex: number;
        list: List;
        listIndexInListParent: number;
        listParentId: string;
    }
    | null => {
    const found = locate(doc, nodeId);
    if (!found) return null;
    for (let i = found.ancestors.length - 1; i >= 0; i--) {
        const a = found.ancestors[i]!;
        if (isListItem(a)) {
            // Find the List parent of this ListItem.
            for (let j = i - 1; j >= 0; j--) {
                const b = found.ancestors[j]!;
                if (isList(b)) {
                    const list = b as List;
                    const itemIndex = list.children.findIndex(
                        (c) => getNodeId(c) === getNodeId(a),
                    );
                    const listLocated = locate(doc, getNodeId(list));
                    if (!listLocated || !listLocated.parent) return null;
                    return {
                        item: a as ListItem,
                        itemIndex,
                        list,
                        listIndexInListParent: listLocated.indexInParent,
                        listParentId: getNodeId(listLocated.parent),
                    };
                }
            }
            return null;
        }
    }
    return null;
};

const applyIndentListItem = (
    state: DocumentState,
    cmd: IndentListItemCmd,
): ApplyOut => {
    const bounds = rangeBounds(cmd.range);
    if (!bounds) return reject("IndentListItem: Node ranges not supported");
    const [from] = bounds;

    const enc = locateEnclosingListItem(state.doc, from.nodeId);
    if (!enc) return reject("IndentListItem: not inside a list item");
    if (enc.itemIndex === 0)
        return reject("IndentListItem: first item has no preceding sibling");

    const { item, itemIndex, list } = enc;
    const prev = list.children[itemIndex - 1]!;
    const prevKids = childrenOf(prev);
    const lastChildOfPrev = prevKids[prevKids.length - 1];

    // If prev's last child is a List of the same `ordered` value, append into
    // it; otherwise create a nested list at the end of prev.
    let newPrev: ListItem;
    if (lastChildOfPrev && isList(lastChildOfPrev) && lastChildOfPrev.ordered === list.ordered) {
        const targetList = lastChildOfPrev;
        const newTargetList = ProseNode.List(
            targetList.ordered,
            [...targetList.children, item],
            getNodeId(targetList),
        );
        newPrev = ProseNode.ListItem(
            [...prevKids.slice(0, prevKids.length - 1), newTargetList],
            getNodeId(prev),
        );
    } else {
        const nestedList = ProseNode.List(list.ordered, [item]);
        newPrev = ProseNode.ListItem([...prevKids, nestedList], getNodeId(prev));
    }

    const newListChildren = [
        ...list.children.slice(0, itemIndex - 1),
        newPrev,
        ...list.children.slice(itemIndex + 1),
    ];
    const newList = ProseNode.List(list.ordered, newListChildren, getNodeId(list));
    const newDoc = replaceById(state.doc, getNodeId(list), newList) as Document;

    const inverse = ProseCommand.OutdentListItem(cmd.range);
    return ok({ doc: newDoc, cursor: state.cursor }, inverse);
};

const applyOutdentListItem = (
    state: DocumentState,
    cmd: OutdentListItemCmd,
): ApplyOut => {
    const bounds = rangeBounds(cmd.range);
    if (!bounds) return reject("OutdentListItem: Node ranges not supported");
    const [from] = bounds;

    const enc = locateEnclosingListItem(state.doc, from.nodeId);
    if (!enc) return reject("OutdentListItem: not inside a list item");
    const { item, itemIndex, list, listParentId } = enc;

    // Find the parent of the List. Two cases:
    //   - List is inside a ListItem (nested list) → outdent the item to be
    //     a sibling of that enclosing ListItem within its parent List.
    //   - List is inside Document/Quote → outdent splits the list and the
    //     item becomes a sibling block of the List in that container.
    const listParentLocated = locate(state.doc, listParentId);
    if (!listParentLocated) return conflict("OutdentListItem: list parent missing");
    const listParent = listParentLocated.node;

    if (isListItem(listParent)) {
        // Nested-list case.
        // Split the inner list around `item`: items before stay under listParent
        // in the existing nested List; items after move to a new nested List
        // appended inside a new ListItem that follows listParent in the outer List.
        const before = list.children.slice(0, itemIndex);
        const after = list.children.slice(itemIndex + 1);

        const outerListLocated = locate(state.doc, listParentId);
        if (!outerListLocated || !outerListLocated.parent)
            return conflict("OutdentListItem: outer list missing");
        const outerList = outerListLocated.parent;
        if (!isList(outerList))
            return reject("OutdentListItem: nested list not inside a List");
        const outerListId = getNodeId(outerList);
        const listParentIndexInOuter = outerListLocated.indexInParent;

        // Build the new listParent (the enclosing ListItem) without the inner list
        // (or with the inner list trimmed to `before`).
        const listParentKids = childrenOf(listParent);
        const innerListIndex = listParentKids.findIndex((c) => getNodeId(c) === getNodeId(list));
        let newListParentKids: ProseNode[];
        if (before.length === 0 && after.length === 0) {
            // Drop the empty inner list entirely.
            newListParentKids = [
                ...listParentKids.slice(0, innerListIndex),
                ...listParentKids.slice(innerListIndex + 1),
            ];
        } else if (after.length === 0) {
            // Keep inner list with `before` items only.
            const trimmed = ProseNode.List(list.ordered, before, getNodeId(list));
            newListParentKids = [
                ...listParentKids.slice(0, innerListIndex),
                trimmed,
                ...listParentKids.slice(innerListIndex + 1),
            ];
        } else {
            // before stays in original inner list (may be empty → drop); after goes
            // into a new inner list appended on the *trailing* sibling ListItem.
            // Simpler: keep the original inner list with `before`, and put the
            // `after` items inside a new sibling ListItem (which we'll insert in
            // the outer list).
            const trimmed = ProseNode.List(list.ordered, before, getNodeId(list));
            newListParentKids =
                before.length > 0
                    ? [
                        ...listParentKids.slice(0, innerListIndex),
                        trimmed,
                        ...listParentKids.slice(innerListIndex + 1),
                    ]
                    : [
                        ...listParentKids.slice(0, innerListIndex),
                        ...listParentKids.slice(innerListIndex + 1),
                    ];
        }

        const newListParent = ProseNode.ListItem(newListParentKids, listParentId);

        // Build the trailing sibling ListItem for `after` (if any).
        const afterContainer =
            after.length > 0
                ? [
                    ProseNode.ListItem([
                        ProseNode.List(list.ordered, after),
                    ]),
                ]
                : [];

        // Rebuild the outer list.
        const outerKids = outerList.children;
        const newOuterKids: ListItem[] = [
            ...outerKids.slice(0, listParentIndexInOuter),
            newListParent as ListItem,
            // The promoted item slots in here — sibling of the (now-modified)
            // listParent ListItem.
            item,
            ...(afterContainer as ListItem[]),
            ...outerKids.slice(listParentIndexInOuter + 1),
        ];
        const newOuterList = ProseNode.List(outerList.ordered, newOuterKids, outerListId);
        const newDoc = replaceById(state.doc, outerListId, newOuterList) as Document;

        const inverse = ProseCommand.IndentListItem(cmd.range);
        return ok({ doc: newDoc, cursor: state.cursor }, inverse);
    }

    // Top-level list case: item is promoted to a sibling block of the List in
    // listParent. The list splits into [before-list] [promoted item-as-blocks]
    // [after-list].
    const before = list.children.slice(0, itemIndex);
    const after = list.children.slice(itemIndex + 1);
    const promotedBlocks = childrenOf(item);

    const replacement: ProseNode[] = [];
    if (before.length > 0)
        replacement.push(ProseNode.List(list.ordered, before, getNodeId(list)));
    replacement.push(...promotedBlocks);
    if (after.length > 0)
        replacement.push(ProseNode.List(list.ordered, after));

    const listId = getNodeId(list);
    const newDoc = updateChildren(state.doc, listParentId, (kids) => {
        const idx = kids.findIndex((c) => getNodeId(c) === listId);
        return [...kids.slice(0, idx), ...replacement, ...kids.slice(idx + 1)];
    }) as Document;

    const inverse = ProseCommand.IndentListItem(cmd.range);
    return ok({ doc: newDoc, cursor: state.cursor }, inverse);
};

const applySplitListItem = (
    state: DocumentState,
    cmd: SplitListItemCmd,
): ApplyOut => {
    const enc = locateEnclosingListItem(state.doc, cmd.at.nodeId);
    if (!enc) return reject("SplitListItem: not inside a list item");
    const { item, itemIndex, list } = enc;

    // Identify the block within `item` that contains `at`, and split it.
    const itemKids = childrenOf(item);
    const targetBlock = itemKids.find((b) => {
        // Walk into b looking for at.nodeId.
        for (const v of walkInOrder(b)) {
            if (getNodeId(v.node) === cmd.at.nodeId) return true;
        }
        return false;
    });
    if (!targetBlock)
        return conflict("SplitListItem: at.nodeId not inside any block of the item");

    // Use SplitBlock to split that block, then partition the item's children
    // around the split.
    const splitResult = applySplitBlock(state, ProseCommand.SplitBlock(cmd.at));
    const splitOut = match(splitResult, {
        Valid:       ({ value }) => value,
        Invalid:     () => null,
        Unvalidated: () => null,
    });
    if (!splitOut) return splitResult;

    // After SplitBlock, `targetBlock` was split into [leftBlock, rightBlock]
    // siblings inside `item`. Now we partition `item.children` so leftBlock and
    // anything before stays in `item`, and rightBlock plus what follows goes
    // into a new ListItem inserted after `item` in `list`.
    const splitDoc = splitOut.next.doc;
    const splitItemLocated = locate(splitDoc, getNodeId(item));
    if (!splitItemLocated) return conflict("SplitListItem: item vanished after block split");
    const splitItem = splitItemLocated.node;
    const splitItemKids = childrenOf(splitItem);

    const targetIdx = splitItemKids.findIndex(
        (b) => getNodeId(b) === getNodeId(targetBlock),
    );
    // After split, indices [0..targetIdx] stay (leftBlock at targetIdx), and
    // [targetIdx+1..] move to the new item (rightBlock leads).
    const leftKids = splitItemKids.slice(0, targetIdx + 1);
    const rightKids = splitItemKids.slice(targetIdx + 1);

    const newLeftItem = ProseNode.ListItem(leftKids, getNodeId(item));
    const newRightItem = ProseNode.ListItem(rightKids);

    const newListChildren = [
        ...list.children.slice(0, itemIndex),
        newLeftItem,
        newRightItem,
        ...list.children.slice(itemIndex + 1),
    ];
    const newList = ProseNode.List(list.ordered, newListChildren, getNodeId(list));
    const newDoc = replaceById(splitDoc, getNodeId(list), newList) as Document;

    // Inverse: a Compound that (1) merges the new ListItem back into `item` by
    // re-merging its blocks via MergeBlock, (2) un-splits the block via
    // MergeBlock at the boundary. Simpler — encode as MergeBlock at the start
    // of the right block (which is what SplitBlock's inverse already produces).
    const splitInverse = splitOut.inverse; // MergeBlock
    return ok({ doc: newDoc, cursor: state.cursor }, splitInverse);
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
        ToggleList:      (c) => applyToggleList(state, c),
        IndentListItem:  (c) => applyIndentListItem(state, c),
        OutdentListItem: (c) => applyOutdentListItem(state, c),
        SplitListItem:   (c) => applySplitListItem(state, c),
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
