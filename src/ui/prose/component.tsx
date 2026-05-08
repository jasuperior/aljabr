/** @jsxImportSource ../dom */

/**
 * `<Prose>` — the prose author surface.
 *
 * Authors hand it a `Dispatcher<DocumentState, Document, Cmd>` (canonical
 * variable name: `editor`) plus an optional embed registry, `readonly`
 * flag, and synthetic event handlers. The Component encapsulates everything
 * else: its own `ProseRenderer`, the contenteditable DOM, the `beforeinput`
 * translator, native selection binding, and a custom diff cycle from
 * `editor.state().doc` to the DOM.
 *
 * The Component returns a single `<div contenteditable>` view node from a
 * parent renderer's perspective; all prose-internal lifecycle is scoped to
 * the `mounted` callback.
 *
 * @module
 */
import { defer } from "../../prelude/scope.ts";
import type { Dispatcher } from "../../prelude/dispatcher.ts";
import type { ViewNode } from "../view-node.ts";
import type { Document } from "./document-model.ts";
import type { DocumentState } from "./document-state.ts";
import type { ProseCommand } from "./commands.ts";
import type { EditorRange } from "./editor-range.ts";
import { translateBeforeInput } from "./before-input.ts";
import {
    ProseRenderer,
    DEFAULT_EMBEDS,
    type EmbedRegistry,
} from "./prose-renderer.ts";
import { projectDoc } from "./projection.ts";
import { bindSelection, selectionToEditorRange } from "./selection-binding.ts";

export type ProseInputEvent<Cmd extends ProseCommand = ProseCommand> = {
    command: Cmd;
    range: EditorRange;
};

export type ProseSelectEvent = {
    range: EditorRange;
    prev: EditorRange;
};

export type ProseFocusEvent = {
    range: EditorRange | null;
};

export type ProseProps<Cmd extends ProseCommand = ProseCommand> = {
    state: Dispatcher<Document, DocumentState, Cmd>;
    embeds?: EmbedRegistry;
    readonly?: boolean;
    onInput?:  (event: ProseInputEvent<Cmd>) => void;
    onSelect?: (event: ProseSelectEvent) => void;
    onFocus?:  (event: ProseFocusEvent) => void;
    onBlur?:   (event: ProseFocusEvent) => void;
};

const sameRange = (a: EditorRange | null, b: EditorRange | null): boolean => {
    if (a === b) return true;
    if (!a || !b) return false;
    // Cheap structural compare via JSON of the payload (both come from the
    // same factory so prop ordering is stable). Avoids a separate import of
    // the deeper `sameRange` from selection-binding.
    return JSON.stringify(a) === JSON.stringify(b);
};

export const Prose = <Cmd extends ProseCommand>(
    props: ProseProps<Cmd>,
): ViewNode => {
    const {
        state, embeds, readonly,
        onInput, onSelect, onFocus, onBlur,
    } = props;
    const mergedEmbeds: EmbedRegistry = { ...DEFAULT_EMBEDS, ...embeds };

    return (
        <div
            contentEditable={!readonly}
            data-aljabr-prose=""
            data-aljabr-readonly={readonly ? "" : null}
            style={readonly ? { caretColor: "transparent" } : null}
            mounted={(el: Element) => {
                const r = ProseRenderer.create({ embeds: mergedEmbeds });
                const unmount = r.mount(
                    () => projectDoc(state.state().doc, mergedEmbeds),
                    el,
                );

                const handler = (e: Event) => {
                    const ev = e as InputEvent;
                    ev.preventDefault();
                    if (readonly) return;
                    const cmd = translateBeforeInput(ev, state.peekState());
                    if (cmd !== null) {
                        state.dispatch(cmd as Cmd);
                        if (onInput) {
                            onInput({
                                command: cmd as Cmd,
                                range: state.peekState().cursor,
                            });
                        }
                    }
                };
                if (!readonly) {
                    el.addEventListener("beforeinput", handler);
                }

                const unbindSelection = bindSelection(state, el);

                // onSelect: fires on every cursor transition that produces a
                // distinct range. Subscribed alongside bindSelection (cheap;
                // gated on prop presence below).
                let prevRange: EditorRange = state.peekState().cursor;
                let selectUnsub: (() => void) | null = null;
                if (onSelect) {
                    selectUnsub = state.subscribe(() => {
                        const next = state.peekState().cursor;
                        if (!sameRange(next, prevRange)) {
                            const prev = prevRange;
                            prevRange = next;
                            onSelect({ range: next, prev });
                        }
                    });
                }

                const focusHandler = (): void => {
                    if (!onFocus) return;
                    const sel = el.ownerDocument?.defaultView?.getSelection?.() ?? null;
                    const range = sel
                        ? selectionToEditorRange(sel, el, state.peekState().doc)
                        : null;
                    onFocus({ range });
                };
                const blurHandler = (): void => {
                    if (!onBlur) return;
                    const sel = el.ownerDocument?.defaultView?.getSelection?.() ?? null;
                    const range = sel
                        ? selectionToEditorRange(sel, el, state.peekState().doc)
                        : null;
                    onBlur({ range });
                };
                if (onFocus) el.addEventListener("focus", focusHandler);
                if (onBlur)  el.addEventListener("blur",  blurHandler);

                defer(() => {
                    if (!readonly) {
                        el.removeEventListener("beforeinput", handler);
                    }
                    if (onFocus) el.removeEventListener("focus", focusHandler);
                    if (onBlur)  el.removeEventListener("blur",  blurHandler);
                    selectUnsub?.();
                    unbindSelection();
                    unmount();
                });
            }}
        />
    );
};
