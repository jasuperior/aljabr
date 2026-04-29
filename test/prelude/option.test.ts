import { describe, expect, it, expectTypeOf } from "vitest";
import { Option, type Some, type None } from "../../src/prelude/option";
import { getTag } from "../../src/union";

describe("Option factory", () => {
    it("Some carries the value", () => {
        const s = Option.Some(42);
        expect(getTag(s)).toBe("Some");
        expect(s.value).toBe(42);
    });
    it("None has null value", () => {
        const n = Option.None();
        expect(getTag(n)).toBe("None");
        expect(n.value).toBeNull();
    });
    it("Some preserves value type", () => {
        const s = Option.Some("hello");
        expectTypeOf(s).toExtend<Some<string>>();
        expectTypeOf(s.value).toEqualTypeOf<string>();
    });
    it("None is a valid Option<T>", () => {
        const n: Option<number> = Option.None();
        expectTypeOf(n).toExtend<None<number>>();
    });
});

describe("Option.map", () => {
    it("transforms Some value", () => {
        const r = Option.Some(5).map((n) => n * 2);
        expect(getTag(r)).toBe("Some");
        expect((r as Some<number>).value).toBe(10);
    });
    it("propagates None", () => {
        const n: Option<number> = Option.None();
        const r = n.map((n) => n * 2);
        expect(getTag(r)).toBe("None");
    });
});

describe("Option.flatMap", () => {
    it("chains Some values", () => {
        const r = Option.Some(3).flatMap((n) => Option.Some(n + 1));
        expect((r as Some<number>).value).toBe(4);
    });
    it("short-circuits on None input", () => {
        const n: Option<number> = Option.None();
        const r = n.flatMap((n) => Option.Some(n + 1));
        expect(getTag(r)).toBe("None");
    });
    it("returns None when callback returns None", () => {
        const r = Option.Some(5).flatMap(() => Option.None<number>());
        expect(getTag(r)).toBe("None");
    });
});

describe("Option.getOrElse", () => {
    it("returns value for Some", () => {
        expect(Option.Some("hello").getOrElse("default")).toBe("hello");
    });
    it("returns default for None", () => {
        const n: Option<string> = Option.None();
        expect(n.getOrElse("fallback")).toBe("fallback");
    });
});

describe("Option.toResult", () => {
    it("Some becomes Accept", () => {
        const r = Option.Some(7).toResult("missing");
        expect(getTag(r)).toBe("Accept");
    });
    it("None becomes Reject with the given error", () => {
        const n: Option<number> = Option.None();
        const r = n.toResult("missing");
        expect(getTag(r)).toBe("Reject");
        expect(r.error).toBe("missing");
    });
    it("Error can be lazily evaluated by supplying a callback", () => {
        const n: Option<number> = Option.None();
        const r = n.toResult(() => "missing");
        expect(r.error).toBe("missing");
    });
});
