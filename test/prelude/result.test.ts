import { describe, expect, it, expectTypeOf } from "vitest";
import {
    Result,
    type Accepted,
    type Expected,
    type Rejected,
    type Result as ResultType,
} from "../../src/prelude/result";
import { getTag } from "../../src/union";

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

describe("Result.Accept", () => {
    it("carries the value", () => {
        const r = Result.Accept(42);
        expect(getTag(r)).toBe("Accept");
        expect((r as Accepted<number>).value).toBe(42);
    });
});

describe("Result.Expect", () => {
    it("carries the pending promise", () => {
        const p = Promise.resolve(1);
        const r = Result.Expect(p);
        expect(getTag(r)).toBe("Expect");
        expect((r as Expected<number>).pending).toBe(p);
    });

    it("defaults E to never when not specified", () => {
        const p = Promise.resolve(1);
        const r = Result.Expect(p);
        expectTypeOf(r).toEqualTypeOf<Expected<number, never>>();
    });

    it("accepts an explicit E type parameter", () => {
        const p = Promise.resolve(1);
        const r = Result.Expect<number, string>(p);
        expectTypeOf(r).toEqualTypeOf<Expected<number, string>>();
    });
});

describe("Result.Reject", () => {
    it("carries the error", () => {
        const r = Result.Reject("oops");
        expect(getTag(r)).toBe("Reject");
        expect((r as Rejected<string>).error).toBe("oops");
    });
});

// ---------------------------------------------------------------------------
// then() — Accept branch
// ---------------------------------------------------------------------------

describe("Result.then — Accept branch", () => {
    it("applies onAccepted and wraps the result in Accept", () => {
        const r = Result.Accept(5).then((x) => x * 2);
        expect(getTag(r)).toBe("Accept");
        expect((r as Accepted<number>).value).toBe(10);
    });

    it("passes through the value when onAccepted is not provided", () => {
        const r = Result.Accept(7).then();
        expect(getTag(r)).toBe("Accept");
        expect((r as Accepted<number>).value).toBe(7);
    });

    it("wraps in Expect when onAccepted returns a thenable", () => {
        const p = Promise.resolve(99);
        const r = Result.Accept(1).then(() => p);
        expect(getTag(r)).toBe("Expect");
        expect((r as Expected<number>).pending).toBe(p);
    });

    it("catches onAccepted throw and wraps in Reject when no onRejected", () => {
        const err = new Error("transform error");
        const r = Result.Accept(1).then(() => {
            throw err;
        });
        expect(getTag(r)).toBe("Reject");
        expect((r as Rejected<Error>).error).toBe(err);
    });

    it("catches onAccepted throw and calls onRejected, wrapping result in Accept", () => {
        // This exercises the branch: onAccepted throws, onRejected is provided,
        // onRejected returns a non-thenable → Result.Accept(rejected)
        const err = new Error("transform error");
        const r = Result.Accept(1).then(
            () => {
                throw err;
            },
            (e) => `recovered: ${(e as Error).message}`,
        );
        expect(getTag(r)).toBe("Accept");
        expect((r as Accepted<string>).value).toBe(
            "recovered: transform error",
        );
    });

    it("catches onAccepted throw; if onRejected returns a thenable → Expect", () => {
        const p = Promise.resolve("async recovery");
        const r = Result.Accept(1).then(
            () => {
                throw new Error("fail");
            },
            () => p,
        );
        expect(getTag(r)).toBe("Expect");
        expect((r as Expected<string, string>).pending).toBe(p);
    });
});

// ---------------------------------------------------------------------------
// then() — Expect branch
// ---------------------------------------------------------------------------

describe("Result.then — Expect branch", () => {
    it("wraps the chained handlers in a new Expect", async () => {
        const p = Promise.resolve(3);
        const r = Result.Expect(p).then((x) => x * 10);
        expect(getTag(r)).toBe("Expect");
        // The underlying promise applies the transform
        const settled = await (r as Expected<number>).pending;
        expect(settled).toBe(30);
    });

    it("passes through without handlers", async () => {
        const p = Promise.resolve("hello");
        const r = Result.Expect(p).then();
        expect(getTag(r)).toBe("Expect");
        const settled = await (r as Expected<string>).pending;
        expect(settled).toBe("hello");
    });
});

// ---------------------------------------------------------------------------
// then() — Reject branch
// ---------------------------------------------------------------------------

describe("Result.then — Reject branch", () => {
    it("passes through Reject when no onRejected is provided", () => {
        const r = Result.Reject("err").then((x) => x);
        expect(getTag(r)).toBe("Reject");
        expect((r as Rejected<string>).error).toBe("err");
    });

    it("calls onRejected and wraps the result in Accept", () => {
        // This is the primary uncovered branch: Reject + onRejected provided
        const r = Result.Reject("domain error").then(
            undefined,
            (e) => `handled: ${e}`,
        );
        expect(getTag(r)).toBe("Accept");
        expect((r as Accepted<string>).value).toBe("handled: domain error");
    });

    it("passes through without any handlers", () => {
        const r = Result.Reject(404).then();
        expect(getTag(r)).toBe("Reject");
        expect((r as Rejected<number>).error).toBe(404);
    });
});

// ---------------------------------------------------------------------------
// then() — E type propagation
// ---------------------------------------------------------------------------

describe("Result.then — E propagation", () => {
    it("preserves E when only onAccepted is provided", () => {
        const r: ResultType<number, string> = Result.Reject("err");
        // Compile-time check: TResult2 defaults to E (= string).
        const next: ResultType<number, string> = r.then((n) => n * 2);
        expect(getTag(next)).toBe("Reject");
    });

    it("replaces E with TResult2 when onRejected is provided", () => {
        const r: ResultType<number, string> = Result.Reject("err");
        // Compile-time check: TResult2 inferred from onRejected return.
        const next: ResultType<number, number> = r.then(
            undefined,
            (e) => e.length,
        );
        expect(getTag(next)).toBe("Accept");
        expect((next as Accepted<number>).value).toBe(3);
    });

    it("narrows onRejected reason to E", () => {
        const r: ResultType<number, string> = Result.Reject("err");
        r.then(undefined, (e) => {
            expectTypeOf(e).toEqualTypeOf<string>();
            return "";
        });
    });

    it("preserves E through the Expect branch", async () => {
        const p = Promise.resolve(3);
        const r = Result.Expect<number, string>(p);
        // Compile-time check: Expected<number, string>.then preserves E.
        const next: ResultType<number, string> = r.then((n) => n * 10);
        expect(getTag(next)).toBe("Expect");
        const settled = await (next as Expected<number, string>).pending;
        expect(settled).toBe(30);
    });
});

// ---------------------------------------------------------------------------
// catch()
// ---------------------------------------------------------------------------

describe("Result.catch", () => {
    it("Accept passes through unchanged", () => {
        const r = Result.Accept(5).catch(() => 0);
        expect(getTag(r)).toBe("Accept");
        expect((r as Accepted<number>).value).toBe(5);
    });

    it("Reject calls handler and lands in Accept", () => {
        const r = Result.Reject("boom").catch((e) => `handled: ${e}`);
        expect(getTag(r)).toBe("Accept");
        expect((r as Accepted<string>).value).toBe("handled: boom");
    });

    it("Reject without handler stays Reject", () => {
        const r = Result.Reject("boom").catch();
        expect(getTag(r)).toBe("Reject");
        expect((r as Rejected<string>).error).toBe("boom");
    });

    it("Expect chains the handler onto the pending promise", async () => {
        const p = Promise.reject<number>("async-fail");
        const r = Result.Expect<number, string>(p).catch(
            (e) => `recovered: ${e}`,
        );
        expect(getTag(r)).toBe("Expect");
        const settled = await (r as Expected<string, never>).pending;
        expect(settled).toBe("recovered: async-fail");
    });

    it("rejection slot is `never` after catch", () => {
        const r: ResultType<number, string> = Result.Reject("err");
        // Compile-time check: catch produces Result<T | TResult, never>.
        const recovered: ResultType<number, never> = r.catch((e) => e.length);
        expect(getTag(recovered)).toBe("Accept");
    });

    it("narrows the catch reason to E", () => {
        const r: ResultType<number, string> = Result.Reject("err");
        r.catch((e) => {
            expectTypeOf(e).toEqualTypeOf<string>();
            return 0;
        });
    });
});
