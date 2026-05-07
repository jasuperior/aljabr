import { describe, it, expect, vi } from "vitest";
import { match } from "../../../src/match.ts";
import { getTag } from "../../../src/union.ts";
import {
    MarkSet,
    ProseNode,
    type Document,
} from "../../../src/ui/prose/document-model.ts";
import { EditorRange } from "../../../src/ui/prose/editor-range.ts";
import { rangePointAt } from "../../../src/ui/prose/tree-ops.ts";
import { projectDoc } from "../../../src/ui/prose/projection.ts";
import {
    DEFAULT_EMBEDS,
    type EmbedRegistry,
} from "../../../src/ui/prose/embed-registry.ts";
import { translateBeforeInput } from "../../../src/ui/prose/before-input.ts";
import { ProseCommand } from "../../../src/ui/prose/commands.ts";
import { Schema } from "../../../src/schema/index.ts";
import { view, type ViewNode } from "../../../src/ui/view-node.ts";
import type { DocumentState } from "../../../src/ui/prose/document-state.ts";

// ---------------------------------------------------------------------------
// Helpers — walk the ViewNode tree by dispatching through `match`
// ---------------------------------------------------------------------------

const tagsOf = (vn: ViewNode | string): string[] => {
    if (typeof vn === "string" || typeof vn === "number") return [];
    const out: string[] = [];
    const walk = (n: ViewNode | unknown): void => {
        if (n === null || n === undefined || typeof n === "boolean") return;
        if (typeof n === "string" || typeof n === "number") return;
        if (typeof n === "function") return;
        const tag = (n as { [k: symbol]: unknown });
        if (typeof tag !== "object") return;
        match(n as ViewNode, {
            Element: ({ tag, children }) => {
                out.push(tag);
                for (const c of children) walk(c);
            },
            Text:      () => {},
            Component: () => {},
            Fragment:  ({ children }) => { for (const c of children) walk(c); },
        });
    };
    walk(vn);
    return out;
};

const findTag = (vn: ViewNode, tag: string): ViewNode | null => {
    let found: ViewNode | null = null;
    const walk = (n: unknown): void => {
        if (found) return;
        if (n === null || n === undefined) return;
        if (typeof n !== "object") return;
        match(n as ViewNode, {
            Element: ({ tag: t, children }) => {
                if (t === tag) { found = n as ViewNode; return; }
                for (const c of children) walk(c);
            },
            Text:      () => {},
            Component: () => {},
            Fragment:  ({ children }) => { for (const c of children) walk(c); },
        });
    };
    walk(vn);
    return found;
};

const elProps = (vn: ViewNode): Record<string, unknown> =>
    match(vn, {
        Element: ({ props }) => props,
        [Symbol.for("__")]: () => { throw new Error("not an Element"); },
    } as never) as Record<string, unknown>;

// ---------------------------------------------------------------------------
// projectDoc — variant → native-tag mapping
// ---------------------------------------------------------------------------

describe("projectDoc — block variants map to native HTML tags", () => {
    it("Block → <p>, Heading → <h{level}>, Quote → <blockquote>, Code → <pre><code>", () => {
        const doc = ProseNode.Document([
            ProseNode.Block([ProseNode.Text("body")]),
            ProseNode.Heading(2, [ProseNode.Text("h2")]),
            ProseNode.Heading(4, [ProseNode.Text("h4")]),
            ProseNode.Quote([ProseNode.Block([ProseNode.Text("q")])]),
            ProseNode.Code("ts", [ProseNode.Text("const x = 1")]),
        ]) as Document;
        const vn = projectDoc(doc, DEFAULT_EMBEDS);
        const tags = tagsOf(vn);
        expect(tags).toContain("p");
        expect(tags).toContain("h2");
        expect(tags).toContain("h4");
        expect(tags).toContain("blockquote");
        expect(tags).toContain("pre");
        expect(tags).toContain("code");
    });

    it("List(ordered=true) → <ol>; List(ordered=false) → <ul>; ListItem → <li>", () => {
        const doc = ProseNode.Document([
            ProseNode.List(true, [
                ProseNode.ListItem([ProseNode.Block([ProseNode.Text("a")])]),
            ]),
            ProseNode.List(false, [
                ProseNode.ListItem([ProseNode.Block([ProseNode.Text("b")])]),
            ]),
        ]) as Document;
        const vn = projectDoc(doc, DEFAULT_EMBEDS);
        const tags = tagsOf(vn);
        expect(tags).toContain("ol");
        expect(tags).toContain("ul");
        expect(tags).toContain("li");
    });

    it("Hr → <hr>, HardBreak → <br>", () => {
        const doc = ProseNode.Document([
            ProseNode.Hr(),
            ProseNode.Block([ProseNode.Text("a"), ProseNode.HardBreak(), ProseNode.Text("b")]),
        ]) as Document;
        const vn = projectDoc(doc, DEFAULT_EMBEDS);
        const tags = tagsOf(vn);
        expect(tags).toContain("hr");
        expect(tags).toContain("br");
    });

    it("Code carries language as a class on the inner <code>", () => {
        const doc = ProseNode.Document([
            ProseNode.Code("ts", [ProseNode.Text("hi")]),
        ]) as Document;
        const vn = projectDoc(doc, DEFAULT_EMBEDS);
        const codeEl = findTag(vn, "code");
        expect(codeEl).not.toBeNull();
        expect((elProps(codeEl!) as { class?: string }).class).toBe("language-ts");
    });
});

describe("projectDoc — text marks", () => {
    it("Bold → <strong>, Italic → <em>, Code → <code>", () => {
        const doc = ProseNode.Document([
            ProseNode.Block([
                ProseNode.Text("a", [MarkSet.Bold()]),
                ProseNode.Text("b", [MarkSet.Italic()]),
                ProseNode.Text("c", [MarkSet.Code()]),
            ]),
        ]) as Document;
        const vn = projectDoc(doc, DEFAULT_EMBEDS);
        const tags = tagsOf(vn);
        expect(tags).toContain("strong");
        expect(tags).toContain("em");
        expect(tags).toContain("code");
    });

    it("Link → <a href>", () => {
        const doc = ProseNode.Document([
            ProseNode.Block([
                ProseNode.Text("link", [MarkSet.Link("https://example.com")]),
            ]),
        ]) as Document;
        const vn = projectDoc(doc, DEFAULT_EMBEDS);
        const a = findTag(vn, "a");
        expect(a).not.toBeNull();
        expect((elProps(a!) as { href?: string }).href).toBe("https://example.com");
    });

    it("Color/Font marks fold into a wrapping inline style", () => {
        const doc = ProseNode.Document([
            ProseNode.Block([
                ProseNode.Text("x", [
                    MarkSet.Color("#f00"),
                    MarkSet.FontSize(14),
                ]),
            ]),
        ]) as Document;
        const vn = projectDoc(doc, DEFAULT_EMBEDS);
        // Find the span carrying the style object.
        let styled: Record<string, unknown> | null = null;
        const walk = (n: unknown): void => {
            if (styled || n === null || typeof n !== "object") return;
            match(n as ViewNode, {
                Element: ({ tag, props, children }) => {
                    if (tag === "span" && typeof props["style"] === "object") {
                        styled = props["style"] as Record<string, unknown>;
                    }
                    for (const c of children) walk(c);
                },
                Text:      () => {},
                Component: () => {},
                Fragment:  ({ children }) => { for (const c of children) walk(c); },
            });
        };
        walk(vn);
        expect(styled).not.toBeNull();
        expect(styled!["color"]).toBe("#f00");
        expect(styled!["fontSize"]).toBe("14px");
    });
});

// ---------------------------------------------------------------------------
// projectDoc — embed projection
// ---------------------------------------------------------------------------

describe("projectDoc — embed projection", () => {
    it("default `image` embed projects to a contenteditable=false wrapper around <img>", () => {
        const doc = ProseNode.Document([
            ProseNode.BlockEmbed("image", { src: "/cat.png", alt: "cat", caption: null }),
        ]) as Document;
        const vn = projectDoc(doc, DEFAULT_EMBEDS);
        const tags = tagsOf(vn);
        expect(tags).toContain("img");
        // Find the wrapping div for the embed.
        let embedDiv: ViewNode | null = null;
        const walk = (n: unknown): void => {
            if (embedDiv || !n || typeof n !== "object") return;
            match(n as ViewNode, {
                Element: ({ tag, props, children }) => {
                    if (tag === "div" && (props as Record<string, unknown>)["data-aljabr-embed"] === "image") {
                        embedDiv = n as ViewNode;
                        return;
                    }
                    for (const c of children) walk(c);
                },
                Text:      () => {},
                Component: () => {},
                Fragment:  ({ children }) => { for (const c of children) walk(c); },
            });
        };
        walk(vn);
        expect(embedDiv).not.toBeNull();
        expect((elProps(embedDiv!) as { contentEditable?: string }).contentEditable).toBe("false");
    });

    it("rejects payloads that don't match the registered schema", () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        const doc = ProseNode.Document([
            // Missing `src` field.
            ProseNode.BlockEmbed("image", { alt: "no src", caption: null }),
        ]) as Document;
        const vn = projectDoc(doc, DEFAULT_EMBEDS);
        // No <img> rendered — projection emitted a placeholder instead.
        expect(tagsOf(vn)).not.toContain("img");
        expect(warn).toHaveBeenCalled();
        warn.mockRestore();
    });

    it("unknown embed names emit a placeholder, not the registered render", () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        const doc = ProseNode.Document([
            ProseNode.BlockEmbed("not-registered", { x: 1 }),
        ]) as Document;
        const vn = projectDoc(doc, DEFAULT_EMBEDS);
        expect(tagsOf(vn)).not.toContain("img");
        expect(warn).toHaveBeenCalled();
        warn.mockRestore();
    });

    it("an InlineEmbed registered as inline projects with a <span> wrapper", () => {
        const registry: EmbedRegistry = {
            ...DEFAULT_EMBEDS,
            reaction: {
                schema:    Schema.object({ emoji: Schema.string() }) as never,
                placement: "inline",
                render: ({ emoji }) =>
                    view("span", { class: "reaction" }, (emoji as string)),
            },
        };
        const doc = ProseNode.Document([
            ProseNode.Block([
                ProseNode.Text("hi "),
                ProseNode.InlineEmbed("reaction", { emoji: "🔥" }),
            ]),
        ]) as Document;
        const vn = projectDoc(doc, registry);
        // The inline embed wrapper is a span with data-aljabr-embed="reaction".
        let embedSpan: ViewNode | null = null;
        const walk = (n: unknown): void => {
            if (embedSpan || !n || typeof n !== "object") return;
            match(n as ViewNode, {
                Element: ({ tag, props, children }) => {
                    if (tag === "span" && (props as Record<string, unknown>)["data-aljabr-embed"] === "reaction") {
                        embedSpan = n as ViewNode;
                        return;
                    }
                    for (const c of children) walk(c);
                },
                Text:      () => {},
                Component: () => {},
                Fragment:  ({ children }) => { for (const c of children) walk(c); },
            });
        };
        walk(vn);
        expect(embedSpan).not.toBeNull();
    });

    it("a BlockEmbed registered as inline-only is rejected", () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        const registry: EmbedRegistry = {
            inlineOnly: {
                schema:    Schema.object({ x: Schema.string() }) as never,
                placement: "inline",
                render:    () => view("span", null, "x"),
            },
        };
        const doc = ProseNode.Document([
            ProseNode.BlockEmbed("inlineOnly", { x: "hi" }),
        ]) as Document;
        projectDoc(doc, registry);
        expect(warn).toHaveBeenCalled();
        warn.mockRestore();
    });
});

// ---------------------------------------------------------------------------
// translateBeforeInput
// ---------------------------------------------------------------------------

const makeState = (): DocumentState => {
    const t1 = ProseNode.Text("hello", [], "t1");
    const b1 = ProseNode.Block([t1], "b1");
    const doc = ProseNode.Document([b1], "d1") as Document;
    const at = rangePointAt(doc, "t1", 2)!;
    return { doc, cursor: EditorRange.Cursor(at) };
};

const fakeEvent = (
    inputType: string,
    data: string | null = null,
): InputEvent =>
    ({
        inputType,
        data,
        preventDefault: () => {},
    }) as unknown as InputEvent;

describe("translateBeforeInput", () => {
    it("insertText → Insert(text, point)", () => {
        const cmd = translateBeforeInput(fakeEvent("insertText", "X"), makeState());
        expect(cmd).not.toBeNull();
        expect(getTag(cmd!)).toBe("Insert");
    });

    it("insertParagraph at a non-list-item point → SplitBlock", () => {
        const cmd = translateBeforeInput(fakeEvent("insertParagraph"), makeState());
        expect(cmd).not.toBeNull();
        expect(getTag(cmd!)).toBe("SplitBlock");
    });

    it("insertParagraph inside a list item → SplitListItem", () => {
        const t1 = ProseNode.Text("hello", [], "t1");
        const b1 = ProseNode.Block([t1], "b1");
        const li = ProseNode.ListItem([b1], "li1");
        const list = ProseNode.List(false, [li], "L1");
        const doc = ProseNode.Document([list], "d1") as Document;
        const state: DocumentState = {
            doc,
            cursor: EditorRange.Cursor(rangePointAt(doc, "t1", 2)!),
        };
        const cmd = translateBeforeInput(fakeEvent("insertParagraph"), state);
        expect(cmd).not.toBeNull();
        expect(getTag(cmd!)).toBe("SplitListItem");
    });

    it("insertLineBreak → Insert([HardBreak], at)", () => {
        const cmd = translateBeforeInput(fakeEvent("insertLineBreak"), makeState());
        expect(cmd).not.toBeNull();
        expect(getTag(cmd!)).toBe("Insert");
    });

    it("deleteContentBackward → DeleteBackward; deleteContentForward → DeleteForward", () => {
        const back = translateBeforeInput(fakeEvent("deleteContentBackward"), makeState());
        const fwd  = translateBeforeInput(fakeEvent("deleteContentForward"), makeState());
        expect(getTag(back!)).toBe("DeleteBackward");
        expect(getTag(fwd!)).toBe("DeleteForward");
    });

    it("deleteWordBackward → DeleteBackward (word-extension is v0.4.1)", () => {
        const cmd = translateBeforeInput(fakeEvent("deleteWordBackward"), makeState());
        expect(getTag(cmd!)).toBe("DeleteBackward");
    });

    it("returns null for unhandled inputTypes (e.g. historyUndo)", () => {
        const cmd = translateBeforeInput(fakeEvent("historyUndo"), makeState());
        expect(cmd).toBeNull();
    });

    it("returns null when insertText carries no data", () => {
        const cmd = translateBeforeInput(fakeEvent("insertText", null), makeState());
        expect(cmd).toBeNull();
    });

    // Avoid unused-symbol diagnostic
    it("ProseCommand factory still constructs valid commands", () => {
        const at = rangePointAt(makeState().doc, "t1", 0)!;
        const cmd = ProseCommand.Insert("x", at);
        expect(getTag(cmd)).toBe("Insert");
    });
});
