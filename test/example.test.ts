import { describe, expect, it, expectTypeOf } from "vitest";
import {
    Result,
    type Accepted,
    type Expected,
    type Rejected,
} from "../src/example";
import { getTag } from "../src/union";

describe("Result", () => {
    it("should be like a promise", async () => {
        let r = Result.Accept(3);
        let value = await r;
        expect(value).toBe(3);
        expect(r.value).toBe(value);
        expect(getTag(r)).toBe("Accept");
    });
    it("should be like a promise 2", async () => {
        let r = Result.Accept(3);
        let value = r.then(async (v) => await Result.Accept(v));
        expect(await value).toBe(3);
        // expect(value.pending).toBe(value);
        expect(getTag(value)).toBe("Delay");
    });
});

describe("Result type preservation", () => {
    it("Accept preserves value type", () => {
        const r = Result.Accept(3);
        // r.value
        expectTypeOf(r).toExtend<Accepted<number>>();
        expectTypeOf(r.value).toEqualTypeOf<number>();
    });
    it("Reject preserves error type", () => {
        const r = Result.Reject(new Error("oops"));
        expectTypeOf(r).toExtend<Rejected<Error>>();
        expectTypeOf(r.error).toEqualTypeOf<Error>();
    });
    it("Delay preserves pending type", () => {
        const r = Result.Expect(Promise.resolve(42));
        expectTypeOf(r).toExtend<Expected<number>>();
        expectTypeOf(r.pending).toEqualTypeOf<PromiseLike<number>>();
    });
    it("then() chain returns Result", () => {
        // typed assignment compiles iff then() returns Result<number, never>
        const r: Result<number, never> = Result.Accept(3).then((n) => n + 1);
        expect(r).toBeDefined();
    });
});
