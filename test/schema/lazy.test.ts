import { describe, it, expect } from "vitest";
import { Schema, decode, encode, roundtrip } from "../../src/schema/index.ts";
import { getTag } from "../../src/union.ts";

type TreeNode = {
    value: number;
    children: TreeNode[];
};

const treeSchema: Schema<TreeNode> = Schema.object({
    value: Schema.number(),
    children: Schema.array(Schema.lazy(() => treeSchema)),
});

describe("Schema.lazy", () => {
    it("decodes a recursive structure", () => {
        const input = {
            value: 1,
            children: [
                { value: 2, children: [] },
                { value: 3, children: [{ value: 4, children: [] }] },
            ],
        };
        const result = decode(treeSchema, input);
        expect(getTag(result)).toBe("Valid");
        expect(result.value).toEqual(input);
    });

    it("encodes a recursive structure", () => {
        const tree: TreeNode = {
            value: 1,
            children: [{ value: 2, children: [{ value: 3, children: [] }] }],
        };
        expect(encode(treeSchema, tree)).toEqual(tree);
    });

    it("round-trips a non-trivial recursive value", () => {
        const tree: TreeNode = {
            value: 0,
            children: [
                { value: 1, children: [{ value: 2, children: [] }] },
                { value: 3, children: [] },
            ],
        };
        expect(roundtrip(treeSchema, tree)).toBe(true);
    });

    it("propagates decode errors from inside the lazy boundary", () => {
        const result = decode(treeSchema, {
            value: 1,
            children: [{ value: "not a number", children: [] }],
        });
        expect(getTag(result)).toBe("Invalid");
    });

    it("supports mutual recursion via two thunks", () => {
        type A = { kind: "a"; b?: B };
        type B = { kind: "b"; a?: A };

        const aSchema: Schema<A> = Schema.object({
            kind: Schema.literal("a"),
            b: Schema.optional(Schema.lazy(() => bSchema)),
        });
        const bSchema: Schema<B> = Schema.object({
            kind: Schema.literal("b"),
            a: Schema.optional(Schema.lazy(() => aSchema)),
        });

        const input: A = { kind: "a", b: { kind: "b", a: { kind: "a" } } };
        const result = decode(aSchema, input);
        expect(getTag(result)).toBe("Valid");
        expect(result.value).toEqual(input);
    });
});
