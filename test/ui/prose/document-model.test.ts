import { describe, it, expect } from "vitest";
import { match } from "../../../src/match.ts";
import { Validation } from "../../../src/prelude/validation.ts";
import {
    MarkSet,
    ProseNode,
    getNodeId,
    validatePlacement,
} from "../../../src/ui/prose/document-model.ts";

describe("ProseNode — variant construction", () => {
    it("constructs each primitive with its expected payload", () => {
        const text = ProseNode.Text("hello", []);
        expect(text.content).toBe("hello");
        expect(text.marks).toEqual([]);

        const heading = ProseNode.Heading(2, [text]);
        expect(heading.level).toBe(2);
        expect(heading.children).toEqual([text]);

        const code = ProseNode.Code("ts", []);
        expect(code.language).toBe("ts");

        const image = ProseNode.Image("/cat.png", "a cat", null);
        expect(image.src).toBe("/cat.png");
        expect(image.alt).toBe("a cat");

        const hr = ProseNode.Hr();
        const br = ProseNode.HardBreak();
        expect(hr).toBeDefined();
        expect(br).toBeDefined();
    });

    it("dispatches via match() exhaustively", () => {
        const cases: ProseNode[] = [
            ProseNode.Document([]),
            ProseNode.Block([]),
            ProseNode.Heading(1, []),
            ProseNode.Quote([]),
            ProseNode.Code(null, []),
            ProseNode.Text("x", []),
            ProseNode.Image("/x", null, null),
            ProseNode.HardBreak(),
            ProseNode.Hr(),
        ];
        const labels = cases.map((n) =>
            match(n, {
                Document:  () => "doc",
                Block:     () => "block",
                Heading:   () => "heading",
                Quote:     () => "quote",
                Code:      () => "code",
                Text:      () => "text",
                Image:     () => "image",
                HardBreak: () => "br",
                Hr:        () => "hr",
            }),
        );
        expect(labels).toEqual([
            "doc", "block", "heading", "quote", "code",
            "text", "image", "br", "hr",
        ]);
    });
});

describe("ProseNode — node IDs", () => {
    it("auto-assigns a unique ID to every node", () => {
        const a = ProseNode.Text("a");
        const b = ProseNode.Text("b");
        expect(getNodeId(a)).toEqual(expect.any(String));
        expect(getNodeId(b)).toEqual(expect.any(String));
        expect(getNodeId(a)).not.toBe(getNodeId(b));
    });

    it("accepts a caller-supplied ID and round-trips it", () => {
        const node = ProseNode.Block([], "block-42");
        expect(getNodeId(node)).toBe("block-42");
    });

    it("keeps the ID stable across reads", () => {
        const node = ProseNode.Heading(3, []);
        const first = getNodeId(node);
        const second = getNodeId(node);
        expect(first).toBe(second);
    });

    it("keeps the ID off JSON.stringify output", () => {
        const node = ProseNode.Text("hi", [], "txt-1");
        const json = JSON.stringify(node);
        expect(json).not.toContain("txt-1");
    });
});

describe("MarkSet", () => {
    it("constructs each built-in style and payload variant", () => {
        const bold = MarkSet.Bold();
        const link = MarkSet.Link("https://example.com");
        const color = MarkSet.Color("#f00");
        const fs = MarkSet.FontSize(14);

        expect(bold).toBeDefined();
        expect(link.href).toBe("https://example.com");
        expect(color.value).toBe("#f00");
        expect(fs.value).toBe(14);
    });

    it("extends via .merge() without disturbing built-ins", () => {
        const Extended = MarkSet.merge({
            Mention: (userId: string) => ({ userId }),
            Comment: (threadId: string) => ({ threadId }),
        });

        const m = Extended.Mention("u-123");
        expect((m as { userId: string }).userId).toBe("u-123");

        // Built-ins still resolve on the extended union
        const b = Extended.Bold();
        const l = Extended.Link("https://x");
        expect(b).toBeDefined();
        expect((l as { href: string }).href).toBe("https://x");
    });

    it("can be attached to <Text> as the marks payload", () => {
        const text = ProseNode.Text("@jamel", [
            MarkSet.Bold(),
            MarkSet.Link("https://example.com"),
        ]);
        expect(text.marks.length).toBe(2);
    });
});

describe("validatePlacement", () => {
    const expectValid = (root: ProseNode) =>
        match(validatePlacement(root), {
            Valid:       () => true,
            Invalid:     ({ errors }) => { throw new Error(JSON.stringify(errors)); },
            Unvalidated: () => { throw new Error("unreachable"); },
        });

    const expectInvalid = (root: ProseNode) =>
        match(validatePlacement(root), {
            Valid:       () => { throw new Error("expected Invalid"); },
            Invalid:     ({ errors }) => errors,
            Unvalidated: () => { throw new Error("unreachable"); },
        });

    it("accepts a well-formed document", () => {
        const root = ProseNode.Document([
            ProseNode.Block([ProseNode.Text("hello")]),
            ProseNode.Heading(1, [ProseNode.Text("title")]),
            ProseNode.Quote([ProseNode.Block([ProseNode.Text("quoted")])]),
            ProseNode.Code("ts", [ProseNode.Text("const x = 1")]),
            ProseNode.Image("/a.png", null, null),
            ProseNode.Hr(),
        ]);
        expect(expectValid(root)).toBe(true);
    });

    it("rejects <text> directly under <document> without a containing block", () => {
        const root = ProseNode.Document([
            ProseNode.Text("loose text"),
        ]);
        const errors = expectInvalid(root);
        expect(errors[0]).toMatchObject({
            parentTag: "Document",
            childTag: "Text",
        });
    });

    it("rejects a block inside a block", () => {
        const root = ProseNode.Document([
            ProseNode.Block([ProseNode.Block([])]),
        ]);
        const errors = expectInvalid(root);
        expect(errors.some((e) => e.parentTag === "Block" && e.childTag === "Block")).toBe(true);
    });

    it("flags multiple errors in a single tree", () => {
        const root = ProseNode.Document([
            ProseNode.Text("loose 1"),
            ProseNode.Block([ProseNode.Heading(1, [])]),
            ProseNode.Text("loose 2"),
        ]);
        const errors = expectInvalid(root);
        expect(errors.length).toBeGreaterThanOrEqual(3);
    });

    it("returns Validation.Valid carrying the original root on success", () => {
        const root = ProseNode.Document([ProseNode.Block([])]);
        const result = validatePlacement(root);
        match(result, {
            Valid:       ({ value }) => { expect(value).toBe(root); },
            Invalid:     () => { throw new Error("unexpected"); },
            Unvalidated: () => { throw new Error("unreachable"); },
        });
    });
});
