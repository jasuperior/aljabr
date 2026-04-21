import { describe, it, expect } from "vitest";
import { signal, memo } from "../../src/signals/index.ts";
import { getTag } from "../../src/union.ts";
import { createOwner, trackIn } from "../../src/prelude/context.ts";

describe("memo() — basic computation", () => {
    it("computes derived value from signal", () => {
        const [count] = signal(3);
        const doubled = memo(() => (count() ?? 0) * 2);
        expect(doubled()).toBe(6);
    });
    it("recomputes when dependency changes", () => {
        const [count, setCount] = signal(3);
        const doubled = memo(() => (count() ?? 0) * 2);
        setCount(5);
        expect(doubled()).toBe(10);
    });
});

describe("memo().state()", () => {
    it("returns Computed state after evaluation", () => {
        const [count] = signal(1);
        const doubled = memo(() => (count() ?? 0) * 2);
        doubled(); // evaluate
        expect(getTag(doubled.state())).toBe("Computed");
    });
    it("registers a dependency when read inside a computation", () => {
        const [count, setCount] = signal(1);
        const doubled = memo(() => (count() ?? 0) * 2);
        let dirty = false;
        const comp = createOwner(null);
        comp.dirty = () => { dirty = true; };
        trackIn(comp, () => doubled.state());
        setCount(2);
        expect(dirty).toBe(true);
    });
});

describe("memo() — chained memos", () => {
    it("chains correctly through multiple derived values", () => {
        const [n, setN] = signal(2);
        const squared = memo(() => (n() ?? 0) ** 2);
        const plusOne = memo(() => (squared() ?? 0) + 1);
        expect(plusOne()).toBe(5);
        setN(3);
        expect(plusOne()).toBe(10);
    });
});
