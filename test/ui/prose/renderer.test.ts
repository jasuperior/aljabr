import { describe, it, expect, vi } from "vitest";
import { match } from "../../../src/match.ts";
import { __, getTag, tag } from "../../../src/union.ts";
import {
    MarkSet,
    ProseNode,
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
import { Schema, type Schema as SchemaT } from "../../../src/schema/index.ts";
import { view, type ViewNode, type Child } from "../../../src/ui/view-node.ts";
import type { DocumentState } from "../../../src/ui/prose/document-state.ts";

// ---------------------------------------------------------------------------
// Walker — narrow Child → ViewNode via the [tag] symbol, then dispatch via match
// ---------------------------------------------------------------------------

const isViewNode = (c: Child): c is ViewNode =>
    c !== null
    && typeof c === "object"
    && (c as Record<symbol, unknown>)[tag] !== undefined;

const walkViewNode = (vn: ViewNode, visit: (vn: ViewNode) => void): void => {
    visit(vn);
    match(vn, {
        Element:  ({ children }) => {
            for (const c of children) if (isViewNode(c)) walkViewNode(c, visit);
        },
        Fragment: ({ children }) => {
            for (const c of children) if (isViewNode(c)) walkViewNode(c, visit);
        },
        Text:      () => {},
        Component: () => {},
    });
};

const tagsOf = (vn: ViewNode): string[] => {
    const out: string[] = [];
    walkViewNode(vn, (n) => {
        match(n, {
            Element:  ({ tag: t }) => { out.push(t); },
            Text:      () => {},
            Component: () => {},
            Fragment:  () => {},
        });
    });
    return out;
};

const findTag = (vn: ViewNode, tagName: string): ViewNode | null => {
    let found: ViewNode | null = null;
    walkViewNode(vn, (n) => {
        if (found) return;
        match(n, {
            Element:  ({ tag: t }) => { if (t === tagName) found = n; },
            Text:      () => {},
            Component: () => {},
            Fragment:  () => {},
        });
    });
    return found;
};

const findElementWhere = (
    vn: ViewNode,
    pred: (props: Record<string, unknown>, tag: string) => boolean,
): ViewNode | null => {
    let found: ViewNode | null = null;
    walkViewNode(vn, (n) => {
        if (found) return;
        match(n, {
            Element:  ({ tag: t, props }) => { if (pred(props, t)) found = n; },
            Text:      () => {},
            Component: () => {},
            Fragment:  () => {},
        });
    });
    return found;
};

const elProps = (vn: ViewNode): Record<string, unknown> =>
    match(vn, {
        Element:  ({ props }) => props,
        Text:      () => { throw new Error("not an Element (Text)"); },
        Component: () => { throw new Error("not an Element (Component)"); },
        Fragment:  () => { throw new Error("not an Element (Fragment)"); },
    });

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
        ]);
        const tags = tagsOf(projectDoc(doc, DEFAULT_EMBEDS));
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
        ]);
        const tags = tagsOf(projectDoc(doc, DEFAULT_EMBEDS));
        expect(tags).toContain("ol");
        expect(tags).toContain("ul");
        expect(tags).toContain("li");
    });

    it("Hr → <hr>, HardBreak → <br>", () => {
        const doc = ProseNode.Document([
            ProseNode.Hr(),
            ProseNode.Block([
                ProseNode.Text("a"),
                ProseNode.HardBreak(),
                ProseNode.Text("b"),
            ]),
        ]);
        const tags = tagsOf(projectDoc(doc, DEFAULT_EMBEDS));
        expect(tags).toContain("hr");
        expect(tags).toContain("br");
    });

    it("Code carries language as a class on the inner <code>", () => {
        const doc = ProseNode.Document([
            ProseNode.Code("ts", [ProseNode.Text("hi")]),
        ]);
        const codeEl = findTag(projectDoc(doc, DEFAULT_EMBEDS), "code");
        expect(codeEl).not.toBeNull();
        expect(elProps(codeEl!)["class"]).toBe("language-ts");
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
        ]);
        const tags = tagsOf(projectDoc(doc, DEFAULT_EMBEDS));
        expect(tags).toContain("strong");
        expect(tags).toContain("em");
        expect(tags).toContain("code");
    });

    it("Link → <a href>", () => {
        const doc = ProseNode.Document([
            ProseNode.Block([
                ProseNode.Text("link", [MarkSet.Link("https://example.com")]),
            ]),
        ]);
        const a = findTag(projectDoc(doc, DEFAULT_EMBEDS), "a");
        expect(a).not.toBeNull();
        expect(elProps(a!)["href"]).toBe("https://example.com");
    });

    it("Color/Font marks fold into a wrapping inline style", () => {
        const doc = ProseNode.Document([
            ProseNode.Block([
                ProseNode.Text("x", [
                    MarkSet.Color("#f00"),
                    MarkSet.FontSize(14),
                ]),
            ]),
        ]);
        const styled = findElementWhere(
            projectDoc(doc, DEFAULT_EMBEDS),
            (props, t) => t === "span" && typeof props["style"] === "object",
        );
        expect(styled).not.toBeNull();
        const style = elProps(styled!)["style"];
        expect(style && typeof style === "object").toBe(true);
        const styleObj = style as Record<string, unknown>;
        expect(styleObj["color"]).toBe("#f00");
        expect(styleObj["fontSize"]).toBe("14px");
    });
});

// ---------------------------------------------------------------------------
// projectDoc — embed projection
// ---------------------------------------------------------------------------

// `EmbedDefinition.schema` is `Schema<P>` for the registered P; the registry
// type widens P to `unknown`. We declare a small helper instead of writing
// `as never` casts at every author registration in tests.
const widenSchema = <P>(s: SchemaT<P>): SchemaT<unknown> =>
    s as unknown as SchemaT<unknown>;

describe("projectDoc — embed projection", () => {
    it("default `image` embed projects to a contenteditable=false wrapper around <img>", () => {
        const doc = ProseNode.Document([
            ProseNode.BlockEmbed("image", { src: "/cat.png", alt: "cat", caption: null }),
        ]);
        const vn = projectDoc(doc, DEFAULT_EMBEDS);
        expect(tagsOf(vn)).toContain("img");
        const embedDiv = findElementWhere(
            vn,
            (props, t) => t === "div" && props["data-aljabr-embed"] === "image",
        );
        expect(embedDiv).not.toBeNull();
        expect(elProps(embedDiv!)["contentEditable"]).toBe("false");
    });

    it("rejects payloads that don't match the registered schema", () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        const doc = ProseNode.Document([
            // src missing.
            ProseNode.BlockEmbed("image", { alt: "no src", caption: null }),
        ]);
        const vn = projectDoc(doc, DEFAULT_EMBEDS);
        expect(tagsOf(vn)).not.toContain("img");
        expect(warn).toHaveBeenCalled();
        warn.mockRestore();
    });

    it("unknown embed names emit a placeholder, not the registered render", () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        const doc = ProseNode.Document([
            ProseNode.BlockEmbed("not-registered", { x: 1 }),
        ]);
        const vn = projectDoc(doc, DEFAULT_EMBEDS);
        expect(tagsOf(vn)).not.toContain("img");
        expect(warn).toHaveBeenCalled();
        warn.mockRestore();
    });

    it("an InlineEmbed registered as inline projects with a <span> wrapper", () => {
        const registry: EmbedRegistry = {
            ...DEFAULT_EMBEDS,
            reaction: {
                schema:    widenSchema(Schema.object({ emoji: Schema.string() })),
                placement: "inline",
                // Renderer receives the schema-validated payload; the cast at
                // the call site is the registry's documented widening point.
                render: (payload) =>
                    view("span", { class: "reaction" },
                        (payload as { emoji: string }).emoji),
            },
        };
        const doc = ProseNode.Document([
            ProseNode.Block([
                ProseNode.Text("hi "),
                ProseNode.InlineEmbed("reaction", { emoji: "🔥" }),
            ]),
        ]);
        const embedSpan = findElementWhere(
            projectDoc(doc, registry),
            (props, t) => t === "span" && props["data-aljabr-embed"] === "reaction",
        );
        expect(embedSpan).not.toBeNull();
    });

    it("a BlockEmbed registered as inline-only is rejected", () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        const registry: EmbedRegistry = {
            inlineOnly: {
                schema:    widenSchema(Schema.object({ x: Schema.string() })),
                placement: "inline",
                render:    () => view("span", null, "x"),
            },
        };
        const doc = ProseNode.Document([
            ProseNode.BlockEmbed("inlineOnly", { x: "hi" }),
        ]);
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
    const doc = ProseNode.Document([b1], "d1");
    const at = rangePointAt(doc, "t1", 2)!;
    return { doc, cursor: EditorRange.Cursor(at) };
};

const fakeEvent = (
    inputType: string,
    data: string | null = null,
): InputEvent => {
    const ev = new Event("beforeinput", { cancelable: true });
    Object.defineProperty(ev, "inputType", { value: inputType });
    Object.defineProperty(ev, "data", { value: data });
    return ev as InputEvent;
};

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
        const doc = ProseNode.Document([list], "d1");
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
