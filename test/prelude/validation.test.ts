import { describe, expect, it, expectTypeOf } from "vitest";
import {
    Validation,
    type Valid,
    type Invalid,
    type Unvalidated,
    type Validation as ValidationType,
} from "../../src/prelude/validation";
import { getTag } from "../../src/union";

const valid = <T, E>(v: T): ValidationType<T, E> => Validation.Valid(v);
const invalid = <T, E>(...errors: E[]): ValidationType<T, E> =>
    Validation.Invalid(errors);

describe("Validation factory", () => {
    it("Unvalidated has null value", () => {
        const r = Validation.Unvalidated();
        expect(getTag(r)).toBe("Unvalidated");
        expect(r.value).toBeNull();
    });
    it("Unvalidated preserves phantom type params", () => {
        const r: ValidationType<number, string> = Validation.Unvalidated();
        expectTypeOf(r).toExtend<Unvalidated<number, string>>();
    });
    it("Valid carries the value", () => {
        const r = Validation.Valid(42);
        expect(getTag(r)).toBe("Valid");
    });
    it("Invalid carries the errors", () => {
        const r = Validation.Invalid(["bad"]);
        expect(getTag(r)).toBe("Invalid");
        expect(r.errors).toEqual(["bad"]);
    });
    it("Valid preserves value type", () => {
        const r: ValidationType<number, string> = Validation.Valid(1);
        expectTypeOf(r).toExtend<Valid<number, string>>();
    });
    it("Invalid preserves error type", () => {
        const r: ValidationType<number, string> = Validation.Invalid(["e"]);
        expectTypeOf(r).toExtend<Invalid<number, string>>();
    });
});

describe("Validation.map", () => {
    it("transforms a Valid value", () => {
        const r = valid<number, string>(5).map((n) => n * 2);
        expect(getTag(r)).toBe("Valid");
        expect((r as Valid<number, string>).value).toBe(10);
    });
    it("propagates Invalid unchanged", () => {
        const r = invalid<number, string>("required").map((n) => n + 1);
        expect(getTag(r)).toBe("Invalid");
        expect((r as Invalid<number, string>).errors).toEqual(["required"]);
    });
    it("propagates Unvalidated unchanged", () => {
        const r = Validation.Unvalidated<number, string>().map((n) => n + 1);
        expect(getTag(r)).toBe("Unvalidated");
    });
});

describe("Validation.combine (error accumulation)", () => {
    it("Unvalidated + anything yields Unvalidated", () => {
        const r1 = Validation.Unvalidated<number, string>().combine(valid<string, string>("x"));
        expect(getTag(r1)).toBe("Unvalidated");
        const r2 = Validation.Unvalidated<number, string>().combine(invalid<string, string>("e"));
        expect(getTag(r2)).toBe("Unvalidated");
    });
    it("Valid + Unvalidated yields Unvalidated", () => {
        const r = valid<number, string>(1).combine(Validation.Unvalidated<string, string>());
        expect(getTag(r)).toBe("Unvalidated");
    });
    it("Invalid + Unvalidated yields Unvalidated", () => {
        const r = invalid<number, string>("e1").combine(Validation.Unvalidated<string, string>());
        expect(getTag(r)).toBe("Unvalidated");
    });
    it("combines two Valid values into a tuple", () => {
        const r = valid<number, string>(1).combine(valid<string, string>("x"));
        expect(getTag(r)).toBe("Valid");
        expect(r.value).toEqual([1, "x"]);
    });
    it("Invalid + Valid yields Invalid", () => {
        const r = invalid<number, string>("e1").combine(
            valid<string, string>("x"),
        );
        expect(getTag(r)).toBe("Invalid");
        expect((r as Invalid<[number, string], string>).errors).toEqual(["e1"]);
    });
    it("Valid + Invalid yields Invalid", () => {
        const r = valid<number, string>(1).combine(
            invalid<string, string>("e2"),
        );
        expect(getTag(r)).toBe("Invalid");
        expect((r as Invalid<[number, string], string>).errors).toEqual(["e2"]);
    });
    it("Invalid + Invalid accumulates all errors", () => {
        const r = invalid<number, string>("e1").combine(
            invalid<string, string>("e2"),
        );
        expect(getTag(r)).toBe("Invalid");
        expect((r as Invalid<[number, string], string>).errors).toEqual([
            "e1",
            "e2",
        ]);
    });
});

describe("Validation.toResult", () => {
    it("Valid becomes Accept", () => {
        const r = valid<number, string>(7).toResult();
        expect(getTag(r)).toBe("Accept");
        expect(r.value).toBe(7);
    });
    it("Invalid becomes Reject with error array", () => {
        const r = invalid<number, string>("a", "b").toResult();
        expect(getTag(r)).toBe("Reject");
        expect(r.error).toEqual(["a", "b"]);
    });
    it("Unvalidated becomes Reject with empty error array", () => {
        const r = Validation.Unvalidated<number, string>().toResult();
        expect(getTag(r)).toBe("Reject");
        expect(r.error).toEqual([]);
    });
});
