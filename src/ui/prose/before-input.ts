/**
 * `beforeinput` translator — DOM `InputEvent` → `ProseCommand | null`.
 *
 * The `<Prose>` Component intercepts every `beforeinput` event on its
 * contenteditable root, calls `event.preventDefault()` (so the browser
 * never mutates the DOM), and routes the result of this translator into
 * `editor.dispatch(...)`. Returning `null` means the input type is not
 * handled in v0.4.0; the Component swallows the event silently (and warns
 * in dev mode at the call site).
 *
 * Coverage in v0.4.0:
 *
 * - `insertText`               → `Insert(content, at)`
 * - `insertParagraph`          → `SplitBlock(at)` (or `SplitListItem` inside a list item)
 * - `insertLineBreak`          → `Insert([HardBreak], at)`
 * - `deleteContentBackward`    → `DeleteBackward(state.cursor)`
 * - `deleteContentForward`     → `DeleteForward(state.cursor)`
 * - `deleteWordBackward`       → `DeleteBackward(state.cursor)` (word-extension is v0.4.1)
 * - `deleteWordForward`        → `DeleteForward(state.cursor)`
 *
 * `historyUndo` / `historyRedo`, paste, and composition events are deferred
 * to v0.4.1.
 *
 * @module
 */
import { match } from "../../match.ts";
import { getTag } from "../../union.ts";
import { ProseCommand } from "./commands.ts";
import { ProseNode } from "./document-model.ts";
import type { RangePoint } from "./editor-range.ts";
import type { DocumentState } from "./document-state.ts";
import { locate } from "./tree-ops.ts";

const cursorPoint = (state: DocumentState): RangePoint | null =>
    match(state.cursor, {
        Cursor: ({ point }) => point,
        Text:   ({ focus }) => focus,
        Node:   () => null,
    });

const inListItem = (state: DocumentState, point: RangePoint): boolean => {
    const found = locate(state.doc, point.nodeId);
    if (!found) return false;
    return found.ancestors.some((a) => getTag(a) === "ListItem");
};

export const translateBeforeInput = (
    event: InputEvent,
    state: DocumentState,
): ProseCommand | null => {
    switch (event.inputType) {
        case "insertText": {
            const at = cursorPoint(state);
            if (!at) return null;
            const text = event.data ?? "";
            if (text.length === 0) return null;
            return ProseCommand.Insert(text, at);
        }
        case "insertParagraph": {
            const at = cursorPoint(state);
            if (!at) return null;
            return inListItem(state, at)
                ? ProseCommand.SplitListItem(at)
                : ProseCommand.SplitBlock(at);
        }
        case "insertLineBreak": {
            const at = cursorPoint(state);
            if (!at) return null;
            return ProseCommand.Insert([ProseNode.HardBreak()], at);
        }
        case "deleteContentBackward":
        case "deleteWordBackward":
            return ProseCommand.DeleteBackward(state.cursor);
        case "deleteContentForward":
        case "deleteWordForward":
            return ProseCommand.DeleteForward(state.cursor);
        default:
            return null;
    }
};
