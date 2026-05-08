import { describe, it, expect } from "vitest";
import { match } from "../../../src/match.ts";
import { __, getTag } from "../../../src/union.ts";
import { Validation } from "../../../src/prelude/validation.ts";
import { Schema } from "../../../src/schema/index.ts";
import { view } from "../../../src/ui/view-node.ts";
import { parse } from "../../../src/ui/prose/parse.ts";
import {
    DEFAULT_EMBEDS,
    type EmbedRegistry,
} from "../../../src/ui/prose/embed-registry.ts";
import {
    getNodeId,
    type ProseNode,
} from "../../../src/ui/prose/document-model.ts";

const expectValid = <V, E>(v: Validation<V, E>): V =>
    match(v, {
        Valid: ({ value }) => value,
        Invalid: ({ errors }) => {
            throw new Error(`unexpected Invalid: ${JSON.stringify(errors)}`);
        },
        Unvalidated: () => {
            throw new Error("unexpected Unvalidated");
        },
    });

const expectInvalid = <V, E>(v: Validation<V, E>): E[] =>
    match(v, {
        Invalid: ({ errors }) => errors,
        Valid: () => {
            throw new Error("expected Invalid, got Valid");
        },
        Unvalidated: () => {
            throw new Error("unexpected Unvalidated");
        },
    });

const asBlock = (n: ProseNode): ProseNode[] =>
    match(n, {
        Block:    ({ children }) => children,
        Heading:  ({ children }) => children,
        Quote:    ({ children }) => children,
        Code:     ({ children }) => children,
        ListItem: ({ children }) => children,
        [__]: () => {
            throw new Error(`expected block-like, got ${getTag(n)}`);
        },
    });

const textContent = (n: ProseNode): string =>
    match(n, {
        Text: ({ content }) => content,
        [__]: () => {
            throw new Error(`expected Text, got ${getTag(n)}`);
        },
    });

describe("parse.jsx — closed structural set", () => {
    it("parses a minimal <document><block><text>", () => {
        const tree = view(
            "document",
            null,
            view("block", null, view("text", null, "Hello, world.")),
        );
        const state = expectValid(parse.jsx(tree));
        expect(getTag(state.doc)).toBe("Document");
        const block = state.doc.children[0]!;
        expect(getTag(block)).toBe("Block");
        const text = asBlock(block)[0]!;
        expect(getTag(text)).toBe("Text");
        expect(textContent(text)).toBe("Hello, world.");
    });

    it("supports each structural variant", () => {
        const tree = view(
            "document",
            null,
            view("heading", { level: 2 }, view("text", null, "h2")),
            view("quote", null, view("block", null, view("text", null, "q"))),
            view("code", { language: "ts" }, view("text", null, "const x = 1")),
            view(
                "list",
                { ordered: true },
                view(
                    "listItem",
                    null,
                    view("block", null, view("text", null, "a")),
                ),
            ),
            view("hr", null),
            view(
                "block",
                null,
                view("text", null, "x"),
                view("break", null),
                view("text", null, "y"),
            ),
        );
        const state = expectValid(parse.jsx(tree));
        const tags = state.doc.children.map(getTag);
        expect(tags).toEqual([
            "Heading",
            "Quote",
            "Code",
            "List",
            "Hr",
            "Block",
        ]);
    });

    it("parses text marks (boolean + payload + custom)", () => {
        const tree = view(
            "document",
            null,
            view(
                "block",
                null,
                view("text", { bold: true, italic: true }, "be"),
                view("text", { link: { href: "https://x" } }, "link"),
                view("text", { color: "#f00", fontSize: 14 }, "styled"),
            ),
        );
        const state = expectValid(parse.jsx(tree));
        const block = state.doc.children[0]!;
        const texts = asBlock(block);

        const tagsOfMarks = (n: ProseNode): string[] =>
            match(n, {
                Text: ({ marks }) => marks.map(getTag),
                [__]: () => {
                    throw new Error(`expected Text, got ${getTag(n)}`);
                },
            });

        expect(tagsOfMarks(texts[0]!)).toEqual(["Bold", "Italic"]);
        expect(tagsOfMarks(texts[1]!)).toEqual(["Link"]);
        match(texts[1]!, {
            Text: ({ marks }) =>
                match(marks[0]!, {
                    Link: ({ href }) => { expect(href).toBe("https://x"); },
                    [__]: () => { throw new Error("expected Link mark"); },
                }),
            [__]: () => { throw new Error("expected Text"); },
        });
        expect(tagsOfMarks(texts[2]!)).toEqual(["Color", "FontSize"]);
    });

    it("preserves caller-supplied node IDs via the `id` prop", () => {
        const tree = view(
            "document",
            { id: "d1" },
            view("block", { id: "b1" }, view("text", { id: "t1" }, "hi")),
        );
        const state = expectValid(parse.jsx(tree));
        expect(getNodeId(state.doc)).toBe("d1");
        const block = state.doc.children[0]!;
        expect(getNodeId(block)).toBe("b1");
        const text = asBlock(block)[0]!;
        expect(getNodeId(text)).toBe("t1");
    });
});

describe("parse.jsx — embed resolution", () => {
    it("default <image> embed resolves to BlockEmbed('image', { src, alt, caption })", () => {
        const tree = view(
            "document",
            null,
            view("image", { src: "/cat.png", alt: "cat", caption: null }),
        );
        const state = expectValid(parse.jsx(tree));
        const child = state.doc.children[0]!;
        match(child, {
            BlockEmbed: ({ name, payload }) => {
                expect(name).toBe("image");
                expect((payload as { src: string }).src).toBe("/cat.png");
            },
            [__]: () => { throw new Error("expected BlockEmbed"); },
        });
    });

    it("an author-registered inline embed parses via its tag name", () => {
        const registry: EmbedRegistry = {
            ...DEFAULT_EMBEDS,
            reaction: {
                schema: Schema.object({ emoji: Schema.string() }),
                placement: "inline",
                render: () => view("span", null, "x"),
            },
        };
        const tree = view(
            "document",
            null,
            view(
                "block",
                null,
                view("text", null, "look "),
                view("reaction", { emoji: "🔥" }),
            ),
        );
        const state = expectValid(parse.jsx(tree, registry));
        const block = state.doc.children[0]!;
        const last = asBlock(block).at(-1)!;
        match(last, {
            InlineEmbed: ({ name }) => { expect(name).toBe("reaction"); },
            [__]: () => { throw new Error("expected InlineEmbed"); },
        });
    });

    it("rejects payloads that don't match the registered schema", () => {
        const tree = view(
            "document",
            null,
            // src missing.
            view("image", { alt: "no src", caption: null }),
        );
        const errors = expectInvalid(parse.jsx(tree));
        expect(errors.length).toBeGreaterThan(0);
    });

    it("rejects an unknown tag with a structured DecodeError", () => {
        const tree = view(
            "document",
            null,
            view("paragraph", null, view("text", null, "x")),
        );
        const errors = expectInvalid(parse.jsx(tree));
        expect(errors.length).toBeGreaterThan(0);
        // The first error mentions the unknown tag.
        const msg = JSON.stringify(errors);
        expect(msg).toContain("paragraph");
    });

    it("rejects <list> children that aren't <listItem>", () => {
        const tree = view(
            "document",
            null,
            view(
                "list",
                { ordered: false },
                view("block", null, view("text", null, "not a list item")),
            ),
        );
        const errors = expectInvalid(parse.jsx(tree));
        expect(JSON.stringify(errors)).toContain("listItem");
    });
});

describe("parse.jsx — root + cursor", () => {
    it("requires the root to be <document>", () => {
        const errors = expectInvalid(
            parse.jsx(view("block", null, view("text", null, "x"))),
        );
        expect(JSON.stringify(errors)).toContain("document");
    });

    it("places the default cursor at the first text node's start", () => {
        const tree = view(
            "document",
            null,
            view("block", { id: "b1" }, view("text", { id: "t1" }, "Hello")),
        );
        const state = expectValid(parse.jsx(tree));
        match(state.cursor, {
            Cursor: ({ point }) => {
                expect(point.nodeId).toBe("t1");
                expect(point.offset).toBe(0);
            },
            [__]: () => {
                throw new Error("expected Cursor");
            },
        });
    });
});
