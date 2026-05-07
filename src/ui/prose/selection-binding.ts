/**
 * Native selection binding — sync the editor's `cursor` to the browser
 * `Selection`, and translate `selectionchange` back into `SetCursor`
 * commands.
 *
 * The projection stamps every prose node's stable ID on its DOM element via
 * `data-aljabr-id`. Selection conversion uses this attribute as the bridge
 * between the model's `RangePoint` (carrying a stable `nodeId` and logical
 * character offset) and the browser's `(node, offset)` selection model.
 *
 * Sync directions:
 *
 * - **model → DOM**: `editorRangeToSelection` consumes an `EditorRange` and
 *   writes to the supplied `Selection`.
 * - **DOM → model**: `selectionToEditorRange` reads a `Selection` and
 *   produces an `EditorRange` (or `null` if the selection lies outside the
 *   prose root).
 *
 * `bindSelection` wires both directions to a `Dispatcher` and prevents the
 * obvious feedback loop: when the model→DOM update would set the same
 * selection that's already current, it skips; when DOM→model dispatches a
 * `SetCursor`, the resulting model→DOM update is suppressed by the same
 * comparison.
 *
 * @module
 */
import { match } from "../../match.ts";
import { getTag } from "../../union.ts";
import type { Dispatcher } from "../../prelude/dispatcher.ts";
import {
    EditorRange,
    type RangePoint,
} from "./editor-range.ts";
import type { Document, ProseNode } from "./document-model.ts";
import type { DocumentState } from "./document-state.ts";
import type { ProseCommand } from "./commands.ts";
import { ProseCommand as ProseCommandFactory } from "./commands.ts";
import { isVoidBlock, locate, rangePointAt } from "./tree-ops.ts";

const ID_ATTR = "data-aljabr-id";

const findElById = (root: Element, id: string): Element | null =>
    root.querySelector(`[${ID_ATTR}="${CSS.escape(id)}"]`);

type TextLeaf = { node: Text; length: number };

const collectTextLeaves = (el: Element): TextLeaf[] => {
    const out: TextLeaf[] = [];
    const walk = (n: Node): void => {
        if (n.nodeType === 3 /* TEXT_NODE */) {
            out.push({ node: n as Text, length: (n.textContent ?? "").length });
            return;
        }
        // Skip nested embed wrappers — their text is content of their own
        // embed component, not part of this node's text content.
        if (n !== el && (n as Element).hasAttribute?.(ID_ATTR)) return;
        for (const c of Array.from(n.childNodes)) walk(c);
    };
    walk(el);
    return out;
};

// ---------------------------------------------------------------------------
// model → DOM
// ---------------------------------------------------------------------------

/**
 * Resolve a `RangePoint` to a DOM `(node, offset)` pair within `root`.
 * Returns `null` if the node id is not present in the tree.
 */
export const rangePointToDom = (
    point: RangePoint,
    root: Element,
): { node: Node; offset: number } | null => {
    const el = findElById(root, point.nodeId);
    if (!el) return null;
    const leaves = collectTextLeaves(el);
    if (leaves.length === 0) {
        return { node: el, offset: 0 };
    }
    let remaining = point.offset;
    for (const leaf of leaves) {
        if (remaining <= leaf.length) {
            return { node: leaf.node, offset: remaining };
        }
        remaining -= leaf.length;
    }
    const last = leaves[leaves.length - 1]!;
    return { node: last.node, offset: last.length };
};

/**
 * Write `range` into the supplied `Selection`. Idempotent when the selection
 * already matches.
 */
export const editorRangeToSelection = (
    range: EditorRange,
    root: Element,
    sel: Selection,
): void => {
    match(range, {
        Cursor: ({ point }) => {
            const dom = rangePointToDom(point, root);
            if (!dom) return;
            sel.setBaseAndExtent(dom.node, dom.offset, dom.node, dom.offset);
        },
        Text: ({ anchor, focus }) => {
            const a = rangePointToDom(anchor, root);
            const f = rangePointToDom(focus, root);
            if (!a || !f) return;
            sel.setBaseAndExtent(a.node, a.offset, f.node, f.offset);
        },
        Node: ({ nodeId }) => {
            const el = findElById(root, nodeId);
            if (!el || !el.parentNode) return;
            const range = document.createRange();
            range.selectNode(el);
            sel.removeAllRanges();
            sel.addRange(range);
        },
    });
};

// ---------------------------------------------------------------------------
// DOM → model
// ---------------------------------------------------------------------------

const findIdAncestor = (
    node: Node | null,
    root: Element,
): Element | null => {
    let el: Element | null =
        node && node.nodeType === 3
            ? (node.parentElement as Element | null)
            : (node as Element | null);
    while (el && el !== root.parentElement) {
        if (el.hasAttribute && el.hasAttribute(ID_ATTR)) return el;
        el = el.parentElement;
    }
    return null;
};

const charOffsetWithin = (
    el: Element,
    node: Node,
    domOffset: number,
): number => {
    if (node.nodeType !== 3) {
        // Element-level position — sum text lengths of children before
        // childNodes[domOffset]. For v0.4.0 we approximate by 0 (start) when
        // the position is at the beginning, otherwise the total length.
        const leaves = collectTextLeaves(el);
        if (domOffset === 0) return 0;
        return leaves.reduce((acc, l) => acc + l.length, 0);
    }
    let offset = 0;
    for (const leaf of collectTextLeaves(el)) {
        if (leaf.node === node) return offset + domOffset;
        offset += leaf.length;
    }
    return offset;
};

/**
 * Resolve a DOM `(node, offset)` pair to a `RangePoint`. Returns `null` if
 * the position lies outside the prose `root`.
 */
export const domToRangePoint = (
    node: Node,
    domOffset: number,
    root: Element,
    doc: Document,
): RangePoint | null => {
    const el = findIdAncestor(node, root);
    if (!el) return null;
    const id = el.getAttribute(ID_ATTR);
    if (!id) return null;
    const charOffset = charOffsetWithin(el, node, domOffset);
    return rangePointAt(doc, id, charOffset);
};

/**
 * Read a browser `Selection` as an `EditorRange`. Returns `null` if the
 * selection has no anchor / lies outside `root`.
 */
export const selectionToEditorRange = (
    sel: Selection | null,
    root: Element,
    doc: Document,
): EditorRange | null => {
    if (!sel || !sel.anchorNode) return null;
    if (!root.contains(sel.anchorNode)) return null;
    const anchor = domToRangePoint(sel.anchorNode, sel.anchorOffset, root, doc);
    if (!anchor) return null;

    // Click-on-void detection: if the anchor lands on a void node (Hr or
    // BlockEmbed/InlineEmbed), surface that as `EditorRange.Node(id)`.
    const located = locate(doc, anchor.nodeId);
    const isVoid = (n: ProseNode): boolean => {
        const t = getTag(n);
        return isVoidBlock(n) || t === "InlineEmbed";
    };
    if (sel.isCollapsed && located && isVoid(located.node)) {
        return EditorRange.Node(anchor.nodeId);
    }

    if (sel.isCollapsed) return EditorRange.Cursor(anchor);

    const focus =
        sel.focusNode === sel.anchorNode && sel.focusOffset === sel.anchorOffset
            ? anchor
            : domToRangePoint(sel.focusNode!, sel.focusOffset, root, doc);
    if (!focus) return EditorRange.Cursor(anchor);
    return EditorRange.Text(anchor, focus);
};

// ---------------------------------------------------------------------------
// Bind: full sync loop with feedback-loop guard
// ---------------------------------------------------------------------------

const sameRange = (a: EditorRange, b: EditorRange): boolean => {
    if (getTag(a) !== getTag(b)) return false;
    return match(a, {
        Cursor: ({ point: pa }) =>
            match(b, {
                Cursor: ({ point: pb }) =>
                    pa.nodeId === pb.nodeId && pa.offset === pb.offset,
                Text: () => false,
                Node: () => false,
            }),
        Text: ({ anchor: aa, focus: af }) =>
            match(b, {
                Text: ({ anchor: ba, focus: bf }) =>
                    aa.nodeId === ba.nodeId &&
                    aa.offset === ba.offset &&
                    af.nodeId === bf.nodeId &&
                    af.offset === bf.offset,
                Cursor: () => false,
                Node: () => false,
            }),
        Node: ({ nodeId: na }) =>
            match(b, {
                Node: ({ nodeId: nb }) => na === nb,
                Cursor: () => false,
                Text: () => false,
            }),
    });
};

/**
 * Wire two-way selection sync between `dispatcher` and the DOM `root`.
 * Returns a teardown function that detaches listeners and stops syncing.
 *
 * Owns:
 * - a `selectionchange` listener on `document` (the only event that fires
 *   for native caret/drag-selection changes; not bubbled from the editor)
 * - a dispatcher subscription that mirrors `cursor` to the browser selection
 *
 * Suppresses feedback by comparing the *current* browser selection to the
 * `EditorRange` it would write — if they already agree, skip.
 */
export const bindSelection = <Cmd extends ProseCommand>(
    dispatcher: Dispatcher<Document, DocumentState, Cmd>,
    root: Element,
): (() => void) => {
    const win = root.ownerDocument?.defaultView ?? globalThis.window;
    const docNode = root.ownerDocument ?? globalThis.document;
    if (!win || !docNode) return () => {};

    let suppressNext = false;

    const writeModelToDom = (range: EditorRange): void => {
        const sel = win.getSelection();
        if (!sel) return;
        const current = selectionToEditorRange(
            sel,
            root,
            dispatcher.peekState().doc,
        );
        if (current && sameRange(current, range)) return;
        suppressNext = true;
        editorRangeToSelection(range, root, sel);
    };

    // Initial sync: align the browser selection with the model's cursor.
    writeModelToDom(dispatcher.peekState().cursor);

    const unsubscribe = dispatcher.subscribe(() => {
        const next = dispatcher.peekState();
        writeModelToDom(next.cursor);
    });

    const onSelectionChange = (): void => {
        if (suppressNext) {
            suppressNext = false;
            return;
        }
        const sel = win.getSelection();
        if (!sel || !sel.anchorNode || !root.contains(sel.anchorNode)) return;
        const range = selectionToEditorRange(
            sel,
            root,
            dispatcher.peekState().doc,
        );
        if (!range) return;
        if (sameRange(range, dispatcher.peekState().cursor)) return;
        dispatcher.dispatch(ProseCommandFactory.SetCursor(range) as Cmd);
    };
    docNode.addEventListener("selectionchange", onSelectionChange);

    return () => {
        unsubscribe();
        docNode.removeEventListener("selectionchange", onSelectionChange);
    };
};
