import { describe, expect, it, expectTypeOf } from "vitest";
import {
    Validation,
    type Valid,
    type Invalid,
    type Validation as ValidationType,
} from "../../src/prelude/validation";
import { getTag } from "../../src/union";

const valid = <T, E>(v: T): ValidationType<T, E> => Validation.Valid(v);
const invalid = <T, E>(...errors: E[]): ValidationType<T, E> =>
    Validation.Invalid(errors);

describe("Validation factory", () => {
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
});

describe("Validation.combine (error accumulation)", () => {
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
});
