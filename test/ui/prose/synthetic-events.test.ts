// @vitest-environment happy-dom

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { match } from "../../../src/match.ts";
import { __, getTag } from "../../../src/union.ts";
import { Dispatcher } from "../../../src/prelude/dispatcher.ts";
import { DomRenderer } from "../../../src/ui/dom/host.ts";
import {
    ProseNode,
    type Document,
} from "../../../src/ui/prose/document-model.ts";
import { EditorRange } from "../../../src/ui/prose/editor-range.ts";
import type { DocumentState } from "../../../src/ui/prose/document-state.ts";
import {
    ProseCommand,
    proseProtocol,
} from "../../../src/ui/prose/commands.ts";
import { rangePointAt } from "../../../src/ui/prose/tree-ops.ts";
import {
    Prose,
    type ProseProps,
    type ProseInputEvent,
    type ProseSelectEvent,
    type ProseFocusEvent,
} from "../../../src/ui/prose/component.tsx";
import { view } from "../../../src/ui/view-node.ts";

const makeState = (): { state: DocumentState; doc: Document } => {
    const t1 = ProseNode.Text("Hello, world.", [], "t1");
    const b1 = ProseNode.Block([t1], "b1");
    const doc = ProseNode.Document([b1], "d1");
    const state: DocumentState = {
        doc,
        cursor: EditorRange.Cursor(rangePointAt(doc, "t1", 0)!),
    };
    return { state, doc };
};

const mountProse = (
    container: HTMLElement,
    proseProps: ProseProps,
): (() => void) => {
    const r = DomRenderer.create();
    return r.mount(() => view(Prose, proseProps), container);
};

const editorEl = (host: HTMLElement): HTMLElement => {
    const el = host.querySelector("[data-aljabr-prose]");
    if (!(el instanceof HTMLElement)) throw new Error("editor not mounted");
    return el;
};

const beforeInputEvent = (
    inputType: string,
    data: string | null = null,
): Event => {
    const ev = new Event("beforeinput", { cancelable: true });
    Object.defineProperty(ev, "inputType", { value: inputType });
    Object.defineProperty(ev, "data", { value: data });
    return ev;
};

describe("<Prose> synthetic events", () => {
    let host: HTMLElement;
    let unmount: (() => void) | null = null;
    let dispatcher: Dispatcher<Document, DocumentState, ProseCommand>;
    let doc: Document;

    beforeEach(() => {
        const { state, doc: d } = makeState();
        doc = d;
        dispatcher = Dispatcher.create(state, proseProtocol);
        host = document.createElement("div");
        document.body.appendChild(host);
    });
    afterEach(() => {
        unmount?.();
        unmount = null;
        host.remove();
    });

    it("onInput fires after a successful beforeinput dispatch with the command + new range", () => {
        const onInput = vi.fn<(e: ProseInputEvent) => void>();
        unmount = mountProse(host, { state: dispatcher, onInput });
        editorEl(host).dispatchEvent(beforeInputEvent("insertText", "X"));
        expect(onInput).toHaveBeenCalledTimes(1);
        const { command, range } = onInput.mock.calls[0]![0];
        expect(getTag(command)).toBe("Insert");
        expect(getTag(range)).toBe("Cursor");
    });

    it("onInput is not invoked for unhandled inputTypes", () => {
        const onInput = vi.fn<(e: ProseInputEvent) => void>();
        unmount = mountProse(host, { state: dispatcher, onInput });
        editorEl(host).dispatchEvent(beforeInputEvent("historyUndo"));
        expect(onInput).not.toHaveBeenCalled();
    });

    it("onSelect fires with { range, prev } when the cursor changes", () => {
        const onSelect = vi.fn<(e: ProseSelectEvent) => void>();
        unmount = mountProse(host, { state: dispatcher, onSelect });
        const at = rangePointAt(doc, "t1", 5)!;
        dispatcher.dispatch(ProseCommand.SetCursor(EditorRange.Cursor(at)));
        expect(onSelect).toHaveBeenCalledTimes(1);
        const { range, prev } = onSelect.mock.calls[0]![0];
        match(range, {
            Cursor: ({ point }) => { expect(point.offset).toBe(5); },
            [__]: () => { throw new Error("expected Cursor"); },
        });
        match(prev, {
            Cursor: ({ point }) => { expect(point.offset).toBe(0); },
            [__]: () => { throw new Error("expected Cursor"); },
        });
    });

    it("onSelect does not fire when dispatch produces an identical cursor", () => {
        const onSelect = vi.fn<(e: ProseSelectEvent) => void>();
        unmount = mountProse(host, { state: dispatcher, onSelect });
        const at = rangePointAt(doc, "t1", 0)!;
        dispatcher.dispatch(ProseCommand.SetCursor(EditorRange.Cursor(at)));
        expect(onSelect).not.toHaveBeenCalled();
    });

    it("onFocus fires on focus and carries the current range (or null)", () => {
        const onFocus = vi.fn<(e: ProseFocusEvent) => void>();
        unmount = mountProse(host, { state: dispatcher, onFocus });
        editorEl(host).dispatchEvent(new Event("focus"));
        expect(onFocus).toHaveBeenCalledTimes(1);
    });

    it("onBlur fires on blur", () => {
        const onBlur = vi.fn<(e: ProseFocusEvent) => void>();
        unmount = mountProse(host, { state: dispatcher, onBlur });
        editorEl(host).dispatchEvent(new Event("blur"));
        expect(onBlur).toHaveBeenCalledTimes(1);
    });

    it("authors who don't supply handlers see no listener overhead (gated on prop presence)", () => {
        unmount = mountProse(host, { state: dispatcher });
        const el = editorEl(host);
        // Smoke test: dispatching focus/blur with no handlers must not throw.
        expect(() => {
            el.dispatchEvent(new Event("focus"));
            el.dispatchEvent(new Event("blur"));
        }).not.toThrow();
    });
});
