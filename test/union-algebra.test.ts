import { describe, it, expect, expectTypeOf } from "vitest";
import { union, getTag, Trait, type Variant, Union } from "../src/union.ts";

describe("union.merge — direct form", () => {
    const Base = union({
        Foo: (n: number) => ({ n }),
        Bar: (s: string) => ({ s }),
    });

    it("returns a new union with all base variants plus the new ones", () => {
        const Extended = Base.merge({
            Baz: (b: boolean) => ({ b }),
        });

        expect(typeof Extended.Foo).toBe("function");
        expect(typeof Extended.Bar).toBe("function");
        expect(typeof Extended.Baz).toBe("function");
        expect(getTag(Extended.Foo(1))).toBe("Foo");
        expect(getTag(Extended.Baz(true))).toBe("Baz");
    });

    it("does not mutate the original union", () => {
        Base.merge({ Quux: () => ({}) });
        expect("Quux" in Base).toBe(false);
    });

    it("rejects overlapping keys at the type level", () => {
        // @ts-expect-error — `Foo` already exists in Base
        Base.merge({ Foo: (n: number) => ({ n }) });
        //!NOTE: this is incomplete and doesnt test anything.
    });

    it("preserves variant identity for the merged union (separate from Base)", () => {
        const Extended = Base.merge({ Baz: () => ({}) });
        // Extended's Foo factory is a new factory bound to a new union id —
        // a value from Extended.Foo is not interchangeable with Base.Foo at
        // the membership level (each call to buildUnion creates a fresh id).
        const baseFoo = Base.Foo(1);
        const extFoo = Extended.Foo(1);
        expect(getTag(baseFoo)).toBe("Foo");
        expect(getTag(extFoo)).toBe("Foo");
    });
});

describe("union.merge — curried impl form", () => {
    abstract class Trackable extends Trait<{ id: string }> {
        tracked = true;
    }

    const Base = union({
        Foo: (id: string) => ({ id, n: 1 }),
    });

    it("accepts an impl array and returns a builder for the new factories", () => {
        const Extended = Base.merge([Trackable])({
            Bar: (id: string) => ({ id, s: "x" }),
        });

        const bar = Extended.Bar("b1");
        expect(getTag(bar)).toBe("Bar");
        expect(bar.tracked).toBe(true);
        expect(bar.id).toBe("b1");
    });

    it("preserves base variants in the curried form", () => {
        const Extended = Base.merge([Trackable])({
            Bar: (id: string) => ({ id }),
        });
        expect(typeof Extended.Foo).toBe("function");
        const foo = Extended.Foo("f1");
        // Base variants get the new impl mixin too — buildUnion rebuilds all factories.
        expect(foo.tracked).toBe(true);
    });

    it("carries over impls from the base union when merging", () => {
        abstract class Counted extends Trait<{ count: number }> {
            tracked = true;
        }
        abstract class Loggable extends Trait<{ count: number }> {
            logged = true;
        }
        const BaseWithImpl = union([Counted])({
            Foo: (count: number) => ({ count }),
        });

        // Direct merge — base impls preserved.
        const Direct = BaseWithImpl.merge({
            Bar: (count: number) => ({ count }),
        });
        const directBar = Direct.Bar(1);
        expect(directBar.tracked).toBe(true);

        // Curried merge — base impls AND new impls combine.
        const Curried = BaseWithImpl.merge([Loggable])({
            Bar: (count: number) => ({ count }),
        });
        const curriedBar = Curried.Bar(2);
        expect(curriedBar.tracked).toBe(true);
        expect(curriedBar.logged).toBe(true);
        const curriedFoo = Curried.Foo(3);
        expect(curriedFoo.tracked).toBe(true);
        expect(curriedFoo.logged).toBe(true);
    });
});

describe("union.pick", () => {
    const Full = union({
        Foo: (n: number) => ({ n }),
        Bar: (s: string) => ({ s }),
        Baz: (b: boolean) => ({ b }),
    });

    it("returns a union containing only the named variants", () => {
        const Sub = Full.pick("Foo", "Bar");
        expect(typeof Sub.Foo).toBe("function");
        expect(typeof Sub.Bar).toBe("function");
        expect("Baz" in Sub).toBe(false);
    });

    it("the picked variants still produce values with correct tags", () => {
        const Sub = Full.pick("Foo");
        const v = Sub.Foo(42);
        expect(getTag(v)).toBe("Foo");
        expect(v.n).toBe(42);
    });

    it("does not mutate the original union", () => {
        Full.pick("Foo");
        expect("Bar" in Full).toBe(true);
        expect("Baz" in Full).toBe(true);
    });
});

describe("union.omit", () => {
    const Full = union({
        Foo: (n: number) => ({ n }),
        Bar: (s: string) => ({ s }),
        Baz: (b: boolean) => ({ b }),
    });

    it("returns a union with the named variants removed", () => {
        const Sub = Full.omit("Baz");
        expect(typeof Sub.Foo).toBe("function");
        expect(typeof Sub.Bar).toBe("function");
        expect("Baz" in Sub).toBe(false);
    });

    it("supports the explicit-replacement pattern", () => {
        const Replaced = Full.omit("Foo").merge({
            Foo: (n: number, m: number) => ({ n, m }),
        });
        const v = Replaced.Foo(1, 2);
        expect(v.n).toBe(1);
        expect(v.m).toBe(2);
    });
});

describe("union.extend — sugar for .omit().merge()", () => {
    const Base = union({
        Foo: (n: number) => ({ n }),
        Bar: (s: string) => ({ s }),
    });

    it("adds new variants like .merge", () => {
        const Extended = Base.extend({
            Baz: (b: boolean) => ({ b }),
        });
        expect(typeof Extended.Foo).toBe("function");
        expect(typeof Extended.Bar).toBe("function");
        expect(typeof Extended.Baz).toBe("function");
    });

    it("silently replaces overlapping keys (no compile-time error)", () => {
        const Extended = Base.extend({
            Foo: (n: number, m: number) => ({ n, m }),
        });
        const v = Extended.Foo(1, 2);
        expect(v.n).toBe(1);
        expect(v.m).toBe(2);
    });

    it("is equivalent to .omit().merge() for replacement", () => {
        const ViaExtend = Base.extend({
            Foo: (n: number, m: number) => ({ n, m }),
        });
        const ViaOmitMerge = Base.omit("Foo").merge({
            Foo: (n: number, m: number) => ({ n, m }),
        });
        const a = ViaExtend.Foo(3, 4);
        const b = ViaOmitMerge.Foo(3, 4);
        expect(a.n).toBe(b.n);
        expect(a.m).toBe(b.m);
        expect(getTag(a)).toBe(getTag(b));
    });

    it("supports the curried impl form", () => {
        abstract class Tagged extends Trait<{ id: string }> {
            tagged = true;
        }
        const Extended = Base.extend([Tagged])({
            Foo: (id: string, n: number) => ({ id, n }),
            Baz: (id: string) => ({ id }),
        });
        const foo = Extended.Foo("a", 1);
        expect(foo.tagged).toBe(true);
        expect(foo.n).toBe(1);
        const baz = Extended.Baz("b");
        expect(baz.tagged).toBe(true);
    });
});

describe("round-trip", () => {
    it("merge then pick produces the expected subset", () => {
        const Base = union({ A: () => ({}), B: () => ({}) });
        const Extended = Base.merge({ C: () => ({}), D: () => ({}) });
        const Picked = Extended.pick("A", "C");

        expect("A" in Picked).toBe(true);
        expect("C" in Picked).toBe(true);
        expect("B" in Picked).toBe(false);
        expect("D" in Picked).toBe(false);
    });
});
describe("common", () => {
    it("union.typed.{merge|extend|pick|omit} carry impl to new union", () => {
        type Id = { id: string };
        abstract class Tagged extends Trait<Id> {
            tagged = true;
            toTag<T extends Id>(this: T): string {
                return `Tagged:${this.id}`;
            }
        }
        type Base = Union<typeof Base>;
        const Base = union([Tagged]).typed({
            A: () => ({ id: "a" }) as Variant<"A", Id, Tagged>,
            B: () => ({ id: "b" }) as Variant<"B", Id, Tagged>,
        });
        const Merged = Base.merge({
            C: () => ({ id: "c" }) as Variant<"C", Id, Tagged>,
            D: () => ({ id: "d" }) as Variant<"D", Id, Tagged>,
        });
        const Extended = Base.extend({
            C: () => ({ id: "c" }) as Variant<"C", Id, Tagged>,
            A: () => ({ id: "A" }) as Variant<"A", Id, Tagged>,
        });
        const Picked = Extended.pick("A", "C");

        expect(Base.A().toTag()).toBe("Tagged:a");
        expect(Merged.A().toTag()).toBe("Tagged:a");
        expect(Extended.A().toTag()).toBe("Tagged:A");
        expect(Picked.A().toTag()).toBe("Tagged:A");
    });
});
describe("backwards compatibility", () => {
    it("union() return value still spreads its variant factories", () => {
        const U = union({ Foo: () => ({}) });
        const keys = Object.keys(U);
        expect(keys).toContain("Foo");
    });

    it("algebra methods are non-enumerable", () => {
        const U = union({ Foo: () => ({}) });
        expect(Object.keys(U)).not.toContain("merge");
        expect(Object.keys(U)).not.toContain("pick");
        expect(Object.keys(U)).not.toContain("omit");
    });
});
