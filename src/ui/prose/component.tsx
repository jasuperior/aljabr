/** @jsxImportSource ../dom */

/**
 * `<Prose>` — the prose author surface.
 *
 * Authors hand it a `Dispatcher<DocumentState, Document, Cmd>` (canonical
 * variable name: `editor`) plus an optional embed registry and `readonly`
 * flag, and the Component encapsulates everything else: its own
 * `ProseRenderer`, the contenteditable DOM, the `beforeinput` translator,
 * and a custom diff cycle from `editor.state().doc` to the DOM.
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
import { translateBeforeInput } from "./before-input.ts";
import {
    ProseRenderer,
    DEFAULT_EMBEDS,
    type EmbedRegistry,
} from "./prose-renderer.ts";
import { projectDoc } from "./projection.ts";

export type ProseProps<Cmd extends ProseCommand = ProseCommand> = {
    state: Dispatcher<Document, DocumentState, Cmd>;
    embeds?: EmbedRegistry;
    readonly?: boolean;
};

export const Prose = <Cmd extends ProseCommand>(
    props: ProseProps<Cmd>,
): ViewNode => {
    const { state, embeds, readonly } = props;
    const mergedEmbeds: EmbedRegistry = { ...DEFAULT_EMBEDS, ...embeds };

    return (
        <div
            contentEditable={!readonly}
            data-aljabr-prose=""
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
                    if (cmd !== null) state.dispatch(cmd as Cmd);
                };
                if (!readonly) {
                    el.addEventListener("beforeinput", handler);
                }

                defer(() => {
                    if (!readonly) {
                        el.removeEventListener("beforeinput", handler);
                    }
                    unmount();
                });
            }}
        />
    );
};
