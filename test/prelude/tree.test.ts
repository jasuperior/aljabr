import { describe, expect, it, expectTypeOf } from "vitest";
import { Tree, type Leaf, type Branch } from "../../src/prelude/tree";
import { getTag } from "../../src/union";

const leaf = Tree.Leaf(1);
const small = Tree.Branch(10, Tree.Leaf(5), Tree.Leaf(15));
const full = Tree.Branch(
    1,
    Tree.Branch(2, Tree.Leaf(4), Tree.Leaf(5)),
    Tree.Leaf(3),
);

describe("Tree factory", () => {
    it("Leaf carries the value", () => {
        expect(getTag(leaf)).toBe("Leaf");
        expect(leaf.value).toBe(1);
    });
    it("Branch carries value and children", () => {
        expect(getTag(small)).toBe("Branch");
        expect(small.value).toBe(10);
        expect(getTag(small.left)).toBe("Leaf");
        expect(getTag(small.right)).toBe("Leaf");
    });
    it("preserves value type", () => {
        expectTypeOf(leaf).toExtend<Leaf<number>>();
        expectTypeOf(small).toExtend<Branch<number>>();
    });
});

describe("Tree.map", () => {
    it("transforms all node values", () => {
        const doubled = small.map((v) => v * 2);
        expect(doubled.value).toBe(20);
        expect((doubled as Branch<number>).left.value).toBe(10);
        expect((doubled as Branch<number>).right.value).toBe(30);
    });
    it("maps a Leaf", () => {
        const r = leaf.map((v) => String(v));
        expect(getTag(r)).toBe("Leaf");
        expectTypeOf(r).toExtend<Leaf<string>>();
    });
    it("preserves structure depth", () => {
        expect(full.map((v) => v + 1).depth()).toBe(full.depth());
    });
});

describe("Tree.fold (pre-order)", () => {
    it("sums all values in a Branch tree", () => {
        expect(small.fold((acc, v) => acc + v, 0)).toBe(30);
    });
    it("folds a single Leaf", () => {
        expect(leaf.fold((acc, v) => acc + v, 0)).toBe(1);
    });
    it("collects values in pre-order (root, left, right)", () => {
        const order = small.fold<number[]>((acc, v) => [...acc, v], []);
        expect(order).toEqual([10, 5, 15]);
    });
    it("pre-order traversal on full tree", () => {
        const order = full.fold<number[]>((acc, v) => [...acc, v], []);
        expect(order).toEqual([1, 2, 4, 5, 3]);
    });
});

describe("Tree.depth", () => {
    it("Leaf has depth 0", () => {
        expect(leaf.depth()).toBe(0);
    });
    it("single-level Branch has depth 1", () => {
        expect(small.depth()).toBe(1);
    });
    it("multi-level Branch returns max depth", () => {
        expect(full.depth()).toBe(2);
    });
});
