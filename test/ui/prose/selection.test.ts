// @vitest-environment happy-dom

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { match } from "../../../src/match.ts";
import { __ } from "../../../src/union.ts";
import { Dispatcher } from "../../../src/prelude/dispatcher.ts";
import { Renderer } from "../../../src/ui/renderer.ts";
import { DomHost } from "../../../src/ui/dom/host.ts";
import {
    ProseNode,
    type Document,
} from "../../../src/ui/prose/document-model.ts";
import {
    EditorRange,
    type RangePoint,
} from "../../../src/ui/prose/editor-range.ts";
import type { DocumentState } from "../../../src/ui/prose/document-state.ts";
import {
    ProseCommand,
    proseProtocol,
} from "../../../src/ui/prose/commands.ts";
import { rangePointAt } from "../../../src/ui/prose/tree-ops.ts";
import { projectDoc } from "../../../src/ui/prose/projection.ts";
import { DEFAULT_EMBEDS } from "../../../src/ui/prose/embed-registry.ts";
import {
    bindSelection,
    rangePointToDom,
    domToRangePoint,
    editorRangeToSelection,
    selectionToEditorRange,
} from "../../../src/ui/prose/selection-binding.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const makeDoc = (): Document => {
    const t1 = ProseNode.Text("Hello, world.", [], "t1");
    const t2 = ProseNode.Text("second", [], "t2");
    const b1 = ProseNode.Block([t1], "b1");
    const b2 = ProseNode.Block([t2], "b2");
    return ProseNode.Document([b1, b2], "d1") as Document;
};

const point = (doc: Document, id: string, offset: number): RangePoint => {
    const p = rangePointAt(doc, id, offset);
    if (!p) throw new Error(`no point for ${id}@${offset}`);
    return p;
};

const initialState = (): DocumentState => {
    const doc = makeDoc();
    return { doc, cursor: EditorRange.Cursor(point(doc, "t1", 0)) };
};

const mountInto = (host: HTMLElement, doc: Document, embeds = DEFAULT_EMBEDS) => {
    const r = Renderer.create(DomHost);
    const unmount = r.mount(() => projectDoc(doc, embeds), host);
    return unmount;
};

// ---------------------------------------------------------------------------
// rangePointToDom / domToRangePoint
// ---------------------------------------------------------------------------

describe("rangePointToDom", () => {
    let host: HTMLElement;
    let unmount: () => void;
    const doc = makeDoc();

    beforeEach(() => {
        host = document.createElement("div");
        document.body.appendChild(host);
        unmount = mountInto(host, doc);
    });
    afterEach(() => {
        unmount();
        host.remove();
    });

    it("resolves a Text RangePoint to the matching DOM text node + offset", () => {
        const p = point(doc, "t1", 5); // "Hello,| world."
        const dom = rangePointToDom(p, host);
        expect(dom).not.toBeNull();
        expect(dom!.node.nodeType).toBe(3);
        expect(dom!.offset).toBe(5);
        expect(dom!.node.textContent).toBe("Hello, world.");
    });

    it("clamps to end-of-text when offset exceeds the node's content", () => {
        const p = { ...point(doc, "t1", 0), offset: 9999 };
        const dom = rangePointToDom(p, host);
        expect(dom).not.toBeNull();
        expect(dom!.offset).toBe("Hello, world.".length);
    });

    it("returns null for an unknown nodeId", () => {
        const p = { ...point(doc, "t1", 0), nodeId: "missing" };
        expect(rangePointToDom(p, host)).toBeNull();
    });
});

describe("domToRangePoint", () => {
    let host: HTMLElement;
    let unmount: () => void;
    const doc = makeDoc();

    beforeEach(() => {
        host = document.createElement("div");
        document.body.appendChild(host);
        unmount = mountInto(host, doc);
    });
    afterEach(() => {
        unmount();
        host.remove();
    });

    it("walks up to the nearest data-aljabr-id ancestor and computes char offset", () => {
        const t1El = host.querySelector('[data-aljabr-id="t1"]')!;
        const textNode = collectFirstText(t1El);
        const rp = domToRangePoint(textNode, 7, host, doc);
        expect(rp).not.toBeNull();
        expect(rp!.nodeId).toBe("t1");
        expect(rp!.offset).toBe(7);
    });

    it("returns null when the position is outside the prose root", () => {
        const stray = document.createElement("p");
        stray.textContent = "outside";
        document.body.appendChild(stray);
        const rp = domToRangePoint(stray.firstChild!, 0, host, doc);
        expect(rp).toBeNull();
        stray.remove();
    });
});

// ---------------------------------------------------------------------------
// editorRangeToSelection / selectionToEditorRange
// ---------------------------------------------------------------------------

describe("editorRangeToSelection", () => {
    let host: HTMLElement;
    let unmount: () => void;
    const doc = makeDoc();

    beforeEach(() => {
        host = document.createElement("div");
        document.body.appendChild(host);
        unmount = mountInto(host, doc);
    });
    afterEach(() => {
        unmount();
        host.remove();
    });

    it("collapses Selection at a Cursor RangePoint", () => {
        const sel = window.getSelection()!;
        editorRangeToSelection(EditorRange.Cursor(point(doc, "t1", 5)), host, sel);
        expect(sel.isCollapsed).toBe(true);
        expect(sel.anchorOffset).toBe(5);
    });

    it("extends Selection across a Text range", () => {
        const sel = window.getSelection()!;
        editorRangeToSelection(
            EditorRange.Text(point(doc, "t1", 0), point(doc, "t1", 5)),
            host,
            sel,
        );
        expect(sel.isCollapsed).toBe(false);
        expect(sel.toString()).toBe("Hello");
    });
});

describe("selectionToEditorRange", () => {
    let host: HTMLElement;
    let unmount: () => void;
    const doc = makeDoc();

    beforeEach(() => {
        host = document.createElement("div");
        document.body.appendChild(host);
        unmount = mountInto(host, doc);
    });
    afterEach(() => {
        unmount();
        host.remove();
    });

    it("reads a collapsed Selection as Cursor", () => {
        const t1El = host.querySelector('[data-aljabr-id="t1"]')!;
        const textNode = collectFirstText(t1El);
        const sel = window.getSelection()!;
        sel.setBaseAndExtent(textNode, 3, textNode, 3);
        const range = selectionToEditorRange(sel, host, doc);
        expect(range).not.toBeNull();
        match(range!, {
            Cursor: ({ point: p }) => {
                expect(p.nodeId).toBe("t1");
                expect(p.offset).toBe(3);
            },
            [__]: () => { throw new Error("expected Cursor"); },
        });
    });

    it("reads an extended Selection as Text", () => {
        const t1El = host.querySelector('[data-aljabr-id="t1"]')!;
        const textNode = collectFirstText(t1El);
        const sel = window.getSelection()!;
        sel.setBaseAndExtent(textNode, 0, textNode, 5);
        const range = selectionToEditorRange(sel, host, doc);
        match(range!, {
            Text: ({ anchor, focus }) => {
                expect(anchor.offset).toBe(0);
                expect(focus.offset).toBe(5);
            },
            [__]: () => { throw new Error("expected Text"); },
        });
    });

    it("returns Node range when selection collapses on a void node (Hr)", () => {
        const docHr = ProseNode.Document([
            ProseNode.Block([ProseNode.Text("a", [], "ta")], "ba"),
            ProseNode.Hr("hr1"),
        ], "d2") as Document;
        host.innerHTML = "";
        unmount();
        unmount = mountInto(host, docHr);
        const hrEl = host.querySelector('[data-aljabr-id="hr1"]')!;
        const sel = window.getSelection()!;
        sel.setBaseAndExtent(hrEl, 0, hrEl, 0);
        const range = selectionToEditorRange(sel, host, docHr);
        match(range!, {
            Node: ({ nodeId }) => { expect(nodeId).toBe("hr1"); },
            [__]: () => { throw new Error("expected Node range"); },
        });
    });
});

// ---------------------------------------------------------------------------
// bindSelection — full sync loop
// ---------------------------------------------------------------------------

describe("bindSelection", () => {
    let host: HTMLElement;
    let unmount: () => void;
    let unbind: () => void;
    let dispatcher: Dispatcher<Document, DocumentState, ProseCommand>;
    let doc: Document;

    beforeEach(() => {
        const state = initialState();
        doc = state.doc;
        host = document.createElement("div");
        document.body.appendChild(host);
        unmount = mountInto(host, doc);
        dispatcher = Dispatcher.create(state, proseProtocol);
        unbind = bindSelection(dispatcher, host);
    });
    afterEach(() => {
        unbind();
        unmount();
        host.remove();
    });

    it("dispatching SetCursor updates the browser Selection", () => {
        dispatcher.dispatch(
            ProseCommand.SetCursor(EditorRange.Cursor(point(doc, "t1", 7))),
        );
        const sel = window.getSelection()!;
        expect(sel.isCollapsed).toBe(true);
        expect(sel.anchorOffset).toBe(7);
    });

    it("a selectionchange in the DOM dispatches SetCursor with the corresponding range", () => {
        const t1El = host.querySelector('[data-aljabr-id="t1"]')!;
        const textNode = collectFirstText(t1El);
        const sel = window.getSelection()!;
        sel.setBaseAndExtent(textNode, 4, textNode, 4);
        document.dispatchEvent(new Event("selectionchange"));
        match(dispatcher.peekState().cursor, {
            Cursor: ({ point: p }) => {
                expect(p.nodeId).toBe("t1");
                expect(p.offset).toBe(4);
            },
            [__]: () => { throw new Error("expected Cursor"); },
        });
    });

    it("does not re-dispatch when the model→DOM update fires selectionchange", () => {
        let dispatchCount = 0;
        const orig = dispatcher.dispatch.bind(dispatcher);
        dispatcher.dispatch = ((cmd: ProseCommand) => {
            dispatchCount += 1;
            return orig(cmd);
        }) as typeof dispatcher.dispatch;

        dispatcher.dispatch(
            ProseCommand.SetCursor(EditorRange.Cursor(point(doc, "t1", 2))),
        );
        // Even if the DOM fires selectionchange echoing the model write, the
        // suppression flag should swallow it without re-dispatch.
        document.dispatchEvent(new Event("selectionchange"));
        // Exactly one dispatch — the model→DOM write should suppress the
        // resulting DOM→model echo.
        expect(dispatchCount).toBe(1);
    });
});

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function collectFirstText(root: Element): Text {
    const walker = (n: Node): Text | null => {
        if (n.nodeType === 3) return n as Text;
        for (const c of Array.from(n.childNodes)) {
            const r = walker(c);
            if (r) return r;
        }
        return null;
    };
    const t = walker(root);
    if (!t) throw new Error("no text node found");
    return t;
}
