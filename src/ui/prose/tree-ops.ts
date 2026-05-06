/**
 * Internal tree-walking primitives for the prose document model.
 *
 * These operate on `ProseNode` trees immutably — every mutation returns a
 * new tree with the changed branch rebuilt. IDs are preserved on
 * untouched nodes; replacements that should keep an identity must be
 * constructed with the original node's ID via `getNodeId`.
 *
 * Not exported from `aljabr/ui/prose` — these are an implementation detail
 * of `defaultApply`. Authors building their own command protocols are
 * welcome to write their own helpers; we don't commit to this shape.
 *
 * @module
 */

import { match } from "../../match.ts";
import { getTag, tag } from "../../union.ts";
import {
    ProseNode,
    getNodeId,
    type Block,
    type Code,
    type Document,
    type HardBreak,
    type Heading,
    type Hr,
    type Image,
    type MarkSet,
    type Quote,
    type Text,
} from "./document-model.ts";
import type { RangePoint } from "./editor-range.ts";

// ============================================================================
// Tag predicates
// ============================================================================

const BLOCK_TAGS = new Set(["Block", "Heading", "Quote", "Code"]);
const VOID_BLOCK_TAGS = new Set(["Image", "Hr"]);
const INLINE_TAGS = new Set(["Text", "HardBreak"]);

export const isBlock = (n: ProseNode): n is Block | Heading | Quote | Code =>
    BLOCK_TAGS.has(getTag(n));

export const isVoidBlock = (n: ProseNode): n is Image | Hr =>
    VOID_BLOCK_TAGS.has(getTag(n));

export const isInline = (n: ProseNode): n is Text | HardBreak =>
    INLINE_TAGS.has(getTag(n));

export const isText = (n: ProseNode): n is Text => getTag(n) === "Text";

// ============================================================================
// Children access
// ============================================================================

const hasChildren = (
    n: ProseNode,
): n is Document | Block | Heading | Quote | Code =>
    "children" in (n as object);

export const childrenOf = (n: ProseNode): ProseNode[] =>
    hasChildren(n) ? (n as { children: ProseNode[] }).children : [];

/**
 * Construct a clone of `n` with the children replaced. Preserves ID and
 * variant-specific payload (Heading.level, Code.language).
 */
export const withChildren = (n: ProseNode, children: ProseNode[]): ProseNode =>
    match(n, {
        Document: () => ProseNode.Document(children, getNodeId(n)) as ProseNode,
        Block:    () => ProseNode.Block(children, getNodeId(n)) as ProseNode,
        Heading:  ({ level }: Heading) => ProseNode.Heading(level, children, getNodeId(n)) as ProseNode,
        Quote:    () => ProseNode.Quote(children, getNodeId(n)) as ProseNode,
        Code:     ({ language }: Code) => ProseNode.Code(language, children, getNodeId(n)) as ProseNode,
        Text:     () => n,
        Image:    () => n,
        HardBreak:() => n,
        Hr:       () => n,
    });

// ============================================================================
// Locate
// ============================================================================

export type Located = {
    node: ProseNode;
    parent: ProseNode | null;
    indexInParent: number;
    /** Ancestors from root (inclusive) down to (but not including) the node. */
    ancestors: ProseNode[];
};

export const locate = (root: ProseNode, id: string): Located | null => {
    if (getNodeId(root) === id) {
        return { node: root, parent: null, indexInParent: -1, ancestors: [] };
    }
    const stack: { node: ProseNode; ancestors: ProseNode[] }[] = [
        { node: root, ancestors: [] },
    ];
    while (stack.length > 0) {
        const { node, ancestors } = stack.pop()!;
        const kids = childrenOf(node);
        for (let i = 0; i < kids.length; i++) {
            const child = kids[i]!;
            if (getNodeId(child) === id) {
                return {
                    node: child,
                    parent: node,
                    indexInParent: i,
                    ancestors: [...ancestors, node],
                };
            }
            if (hasChildren(child)) {
                stack.push({ node: child, ancestors: [...ancestors, node] });
            }
        }
    }
    return null;
};

/**
 * The nearest block ancestor of the node with `id` (or the node itself, if it
 * is a block).
 */
export const locateBlock = (
    root: ProseNode,
    id: string,
): Located | null => {
    const found = locate(root, id);
    if (!found) return null;
    if (isBlock(found.node) || isVoidBlock(found.node)) return found;
    // Walk up ancestors looking for a block.
    for (let i = found.ancestors.length - 1; i >= 0; i--) {
        const a = found.ancestors[i]!;
        if (isBlock(a)) {
            // Recompute Located for `a`.
            return locate(root, getNodeId(a));
        }
    }
    return null;
};

// ============================================================================
// Replace
// ============================================================================

/**
 * Return a new tree with the node identified by `id` replaced by
 * `replacement`. If `id` is not found, returns the tree unchanged.
 */
export const replaceById = (
    root: ProseNode,
    id: string,
    replacement: ProseNode,
): ProseNode => {
    if (getNodeId(root) === id) return replacement;
    if (!hasChildren(root)) return root;
    const kids = childrenOf(root);
    let changed = false;
    const next = kids.map((c) => {
        const r = replaceById(c, id, replacement);
        if (r !== c) changed = true;
        return r;
    });
    return changed ? withChildren(root, next) : root;
};

/**
 * Return a new tree with the children of `parentId` mutated by `fn`. If
 * `parentId` is not found or not a container, returns the tree unchanged.
 */
export const updateChildren = (
    root: ProseNode,
    parentId: string,
    fn: (children: ProseNode[]) => ProseNode[],
): ProseNode => {
    if (getNodeId(root) === parentId) {
        if (!hasChildren(root)) return root;
        return withChildren(root, fn(childrenOf(root)));
    }
    if (!hasChildren(root)) return root;
    const kids = childrenOf(root);
    let changed = false;
    const next = kids.map((c) => {
        const r = updateChildren(c, parentId, fn);
        if (r !== c) changed = true;
        return r;
    });
    return changed ? withChildren(root, next) : root;
};

// ============================================================================
// Document-order walk
// ============================================================================

export type Walk = {
    node: ProseNode;
    /** Absolute character offset at the *start* of this node's content. */
    absolute: number;
    /** Block-level ancestor chain from root downward. */
    ancestors: ProseNode[];
};

/**
 * Iterate `root` in document order, yielding each node with the absolute
 * character offset at which its content *starts*.
 *
 * Convention: `Text` nodes contribute `content.length` characters;
 * `HardBreak` contributes 1; `Image` and `Hr` contribute 0; structural
 * containers contribute 0 themselves but their children do.
 *
 * The `absolute` returned is monotonic and totals to the document's logical
 * character length when iteration completes.
 */
export function* walkInOrder(root: ProseNode): Generator<Walk> {
    yield* _walk(root, 0, []);
}

function* _walk(
    node: ProseNode,
    absolute: number,
    ancestors: ProseNode[],
): Generator<Walk, number> {
    yield { node, absolute, ancestors };
    if (isText(node)) return absolute + node.content.length;
    if (getTag(node) === "HardBreak") return absolute + 1;
    if (!hasChildren(node)) return absolute;

    let cursor = absolute;
    const nextAncestors = [...ancestors, node];
    for (const child of childrenOf(node)) {
        cursor = yield* _walk(child, cursor, nextAncestors);
    }
    return cursor;
}

// ============================================================================
// RangePoint helpers
// ============================================================================

/**
 * Compute a fully-populated `RangePoint` for a position at `offset` within
 * the node identified by `nodeId`. Returns `null` if the node isn't found.
 *
 * For `Text` nodes, `offset` is a character offset into `content`.
 * For void/leaf nodes, `offset` is ignored (treated as 0).
 *
 * Logical line/col counts newlines in `Text` content and block boundaries
 * (each block transition is a logical newline; same for `HardBreak`).
 */
export const rangePointAt = (
    root: ProseNode,
    nodeId: string,
    offset: number,
): RangePoint | null => {
    let line = 0;
    let col = 0;
    let lastBlockId: string | null = null;

    for (const visit of walkInOrder(root)) {
        const v = visit.node;
        // Block boundary: increment line, reset col.
        if (isBlock(v) || isVoidBlock(v)) {
            const id = getNodeId(v);
            if (lastBlockId !== null && id !== lastBlockId) {
                line += 1;
                col = 0;
            }
            lastBlockId = id;
        }
        if (getNodeId(v) !== nodeId) continue;

        if (isText(v)) {
            // Count newlines in content up to offset.
            const text = v.content.slice(0, offset);
            const newlines = (text.match(/\n/g) ?? []).length;
            const lastNewlineIdx = text.lastIndexOf("\n");
            const colWithin =
                lastNewlineIdx === -1
                    ? col + text.length
                    : text.length - lastNewlineIdx - 1;
            return {
                nodeId,
                offset,
                line: line + newlines,
                col: colWithin,
                absolute: visit.absolute + offset,
            };
        }
        // Non-text target: position at the node's start.
        return {
            nodeId,
            offset: 0,
            line,
            col,
            absolute: visit.absolute,
        };
    }
    return null;
};

/**
 * Construct a TextRange `[at, at+length)` confined to the same node as `at`.
 * Used by inverses of `Insert(text)` to specify what to delete.
 */
export const textRangeFrom = (
    at: RangePoint,
    length: number,
): { anchor: RangePoint; focus: RangePoint } => ({
    anchor: at,
    focus: {
        ...at,
        offset: at.offset + length,
        col: at.col + length,
        absolute: at.absolute + length,
    },
});

// ============================================================================
// Mark utilities
// ============================================================================

export const markTag = (m: MarkSet): string => getTag(m);

export const hasMarkOfTag = (text: Text, tagName: string): boolean =>
    text.marks.some((m) => markTag(m) === tagName);

export const addMark = (text: Text, mark: MarkSet): Text => {
    const t = markTag(mark);
    // Replace any existing mark of the same tag with the new one.
    const filtered = text.marks.filter((m) => markTag(m) !== t);
    return ProseNode.Text(text.content, [...filtered, mark], getNodeId(text)) as Text;
};

export const removeMarkByTag = (text: Text, tagName: string): Text =>
    ProseNode.Text(
        text.content,
        text.marks.filter((m) => markTag(m) !== tagName),
        getNodeId(text),
    ) as Text;

// ============================================================================
// Range slicing and removal (spanning)
// ============================================================================

/**
 * Order two range points in document order. Returns `[from, to]` such that
 * `from.absolute <= to.absolute`.
 */
export const orderPoints = (
    a: RangePoint,
    b: RangePoint,
): [RangePoint, RangePoint] =>
    a.absolute <= b.absolute ? [a, b] : [b, a];

/**
 * Walk the leaf nodes of `root` in document order and emit a sequence of
 * "segments" describing what content lies inside `[from, to)`. Used by
 * delete and format operations to enumerate what they touch.
 */
export type RangeSegment =
    | {
        kind: "TextSlice";
        nodeId: string;
        startOffset: number;
        endOffset: number;
    }
    | { kind: "WholeNode"; nodeId: string };

export const segmentsInRange = (
    root: ProseNode,
    from: RangePoint,
    to: RangePoint,
): RangeSegment[] => {
    const segments: RangeSegment[] = [];
    for (const visit of walkInOrder(root)) {
        const v = visit.node;
        const id = getNodeId(v);

        if (isText(v)) {
            const start = visit.absolute;
            const end = visit.absolute + v.content.length;
            // Compute overlap with [from.absolute, to.absolute].
            const overlapStart = Math.max(start, from.absolute);
            const overlapEnd = Math.min(end, to.absolute);
            if (overlapEnd > overlapStart) {
                segments.push({
                    kind: "TextSlice",
                    nodeId: id,
                    startOffset: overlapStart - start,
                    endOffset: overlapEnd - start,
                });
            }
            continue;
        }

        if (getTag(v) === "HardBreak" || isVoidBlock(v)) {
            const start = visit.absolute;
            const len = getTag(v) === "HardBreak" ? 1 : 0;
            const end = start + len;
            // Include the void/break if its position lies strictly inside.
            if (start >= from.absolute && end <= to.absolute && (end > from.absolute || len === 0 && start > from.absolute && start < to.absolute)) {
                segments.push({ kind: "WholeNode", nodeId: id });
            }
            continue;
        }
    }
    return segments;
};

// ============================================================================
// Normalization
// ============================================================================

const sameMarks = (a: Text, b: Text): boolean => {
    if (a.marks.length !== b.marks.length) return false;
    for (let i = 0; i < a.marks.length; i++) {
        const ma = a.marks[i]!;
        const mb = b.marks[i]!;
        if (markTag(ma) !== markTag(mb)) return false;
        // Compare payload fields (not [tag] symbol).
        const ka = Object.keys(ma).sort();
        const kb = Object.keys(mb).sort();
        if (ka.length !== kb.length) return false;
        for (let j = 0; j < ka.length; j++) {
            const k = ka[j]!;
            if (k !== kb[j]) return false;
            if ((ma as Record<string, unknown>)[k] !== (mb as Record<string, unknown>)[k])
                return false;
        }
    }
    return true;
};

/**
 * Coalesce adjacent Text siblings whose marks match, and drop empty Text
 * siblings. Recurses into containers. The first Text in a run keeps its ID;
 * later ones are absorbed.
 */
export const normalizeText = (node: ProseNode): ProseNode => {
    if (!hasChildren(node)) return node;
    const originalKids = childrenOf(node);
    const kids = originalKids.map(normalizeText);
    const out: ProseNode[] = [];
    for (const c of kids) {
        if (isText(c) && c.content.length === 0) continue;
        const last = out[out.length - 1];
        if (last && isText(last) && isText(c) && sameMarks(last, c)) {
            const merged = ProseNode.Text(
                last.content + c.content,
                last.marks,
                getNodeId(last),
            );
            out[out.length - 1] = merged;
            continue;
        }
        out.push(c);
    }
    // Compare against originals so deeply-nested mutations propagate up.
    let changed = out.length !== originalKids.length;
    if (!changed) {
        for (let i = 0; i < out.length; i++) {
            if (out[i] !== originalKids[i]) { changed = true; break; }
        }
    }
    return changed ? withChildren(node, out) : node;
};

// Avoid unused import warnings — `tag` is re-exported below for tests/internal.
export { tag };
