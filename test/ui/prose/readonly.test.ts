// @vitest-environment happy-dom

import { describe, it, expect, beforeEach, afterEach } from "vitest";
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
import { Prose, type ProseProps } from "../../../src/ui/prose/component.tsx";
import { view } from "../../../src/ui/view-node.ts";

const makeState = (): DocumentState => {
    const t1 = ProseNode.Text("Hello", [], "t1");
    const b1 = ProseNode.Block([t1], "b1");
    const doc = ProseNode.Document([b1], "d1");
    return { doc, cursor: EditorRange.Cursor(rangePointAt(doc, "t1", 0)!) };
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

const firstBlockText = (doc: Document): string => {
    const block = doc.children[0]!;
    const inlines = match(block, {
        Block:    ({ children }) => children,
        [__]: () => { throw new Error(`expected Block, got ${getTag(block)}`); },
    });
    return match(inlines[0]!, {
        Text: ({ content }) => content,
        [__]: () => { throw new Error("expected Text"); },
    });
};

describe("<Prose readonly>", () => {
    let host: HTMLElement;
    let unmount: (() => void) | null = null;
    let dispatcher: Dispatcher<Document, DocumentState, ProseCommand>;
    let initial: DocumentState;

    beforeEach(() => {
        initial = makeState();
        dispatcher = Dispatcher.create(initial, proseProtocol);
        host = document.createElement("div");
        document.body.appendChild(host);
    });
    afterEach(() => {
        unmount?.();
        unmount = null;
        host.remove();
    });

    it("readonly mount sets contenteditable=false on the root", () => {
        unmount = mountProse(host, { state: dispatcher, readonly: true });
        const el = editorEl(host);
        expect(el.getAttribute("contenteditable")).toBe("false");
        expect(el.hasAttribute("data-aljabr-readonly")).toBe(true);
    });

    it("non-readonly mount sets contenteditable=true and omits the readonly marker", () => {
        unmount = mountProse(host, { state: dispatcher });
        const el = editorEl(host);
        expect(el.getAttribute("contenteditable")).toBe("true");
        expect(el.hasAttribute("data-aljabr-readonly")).toBe(false);
    });

    it("readonly hides the caret via inline style", () => {
        unmount = mountProse(host, { state: dispatcher, readonly: true });
        expect(editorEl(host).style.caretColor).toBe("transparent");
    });

    it("readonly suppresses beforeinput → dispatch", () => {
        unmount = mountProse(host, { state: dispatcher, readonly: true });
        const ev = new Event("beforeinput", { cancelable: true });
        Object.defineProperty(ev, "inputType", { value: "insertText" });
        Object.defineProperty(ev, "data", { value: "X" });
        editorEl(host).dispatchEvent(ev);
        expect(firstBlockText(dispatcher.peekState().doc)).toBe("Hello");
    });

    it("programmatic dispatch still applies in readonly", () => {
        unmount = mountProse(host, { state: dispatcher, readonly: true });
        const at = rangePointAt(initial.doc, "t1", 5)!;
        dispatcher.dispatch(ProseCommand.Insert("!", at));
        expect(firstBlockText(dispatcher.peekState().doc)).toBe("Hello!");
    });

    it("readonly still renders the document tree (selection-as-highlight UIs work)", () => {
        unmount = mountProse(host, { state: dispatcher, readonly: true });
        expect(editorEl(host).querySelectorAll("[data-aljabr-id]").length)
            .toBeGreaterThan(0);
    });
});
