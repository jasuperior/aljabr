import { describe, expect, it } from "vitest";
import { Result, type Accepted, type Expected, type Rejected } from "../../src/prelude/result";
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
        const r = Result.Accept(5).then(x => x * 2);
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
        const r = Result.Accept(1).then(() => { throw err; });
        expect(getTag(r)).toBe("Reject");
        expect((r as Rejected<Error>).error).toBe(err);
    });

    it("catches onAccepted throw and calls onRejected, wrapping result in Accept", () => {
        // This exercises the branch: onAccepted throws, onRejected is provided,
        // onRejected returns a non-thenable → Result.Accept(rejected)
        const err = new Error("transform error");
        const r = Result.Accept(1).then(
            () => { throw err; },
            (e) => `recovered: ${(e as Error).message}`,
        );
        expect(getTag(r)).toBe("Accept");
        expect((r as Accepted<string>).value).toBe("recovered: transform error");
    });

    it("catches onAccepted throw; if onRejected returns a thenable → Expect", () => {
        const p = Promise.resolve("async recovery");
        const r = Result.Accept(1).then(
            () => { throw new Error("fail"); },
            () => p,
        );
        expect(getTag(r)).toBe("Expect");
        expect((r as Expected<string>).pending).toBe(p);
    });
});

// ---------------------------------------------------------------------------
// then() — Expect branch
// ---------------------------------------------------------------------------

describe("Result.then — Expect branch", () => {
    it("wraps the chained handlers in a new Expect", async () => {
        const p = Promise.resolve(3);
        const r = Result.Expect(p).then(x => x * 10);
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
        const r = Result.Reject("err").then(x => x);
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
