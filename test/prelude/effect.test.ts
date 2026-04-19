import { describe, expect, it, vi, expectTypeOf } from "vitest";
import {
    Effect,
    type Idle,
    type Done,
    type Failed,
} from "../../src/prelude/effect";
import { Fault, type Defect } from "../../src/prelude/fault";
import { getTag } from "../../src/union";

describe("Effect factory", () => {
    it("Idle carries the thunk", () => {
        const thunk = async () => 42;
        const e = Effect.Idle(thunk);
        expect(getTag(e)).toBe("Idle");
        expect(e.thunk).toBe(thunk);
    });
    it("Running carries the pending promise", () => {
        const pending = Promise.resolve(Effect.Done(1));
        const e = Effect.Running(pending);
        expect(getTag(e)).toBe("Running");
    });
    it("Done carries the value", () => {
        const e = Effect.Done(7);
        expect(getTag(e)).toBe("Done");
        expect(e.value).toBe(7);
    });
    it("Failed carries fault, attempts, and nextRetryAt", () => {
        const err = new Error("oops");
        const e = Effect.Failed<number, Error>(Fault.Defect(err), 1, null);
        expect(getTag(e)).toBe("Failed");
        expect((e.fault as Defect).thrown).toBe(err);
        expect(e.attempts).toBe(1);
        expect(e.nextRetryAt).toBeNull();
    });
    it("preserves type parameters", () => {
        const e = Effect.Idle(async () => "hello");
        expectTypeOf(e).toExtend<Idle<string>>();
    });
});

describe("Effect.run — success", () => {
    it("returns Done(value) on success", async () => {
        const e = Effect.Idle(async () => 42);
        const result = await e.run();
        expect(getTag(result)).toBe("Done");
        expect((result as Done<number>).value).toBe(42);
    });
    it("works with async computation", async () => {
        const e = Effect.Idle(async () => {
            await Promise.resolve();
            return "hello";
        });
        const result = await e.run();
        expect((result as Done<string>).value).toBe("hello");
    });
});

describe("Effect.run — failure", () => {
    it("returns Failed when thunk throws", async () => {
        const err = new Error("boom");
        const e = Effect.Idle<number, Error>(async () => { throw err; });
        const result = await e.run();
        expect(getTag(result)).toBe("Failed");
        expect(getTag((result as Failed<number, Error>).fault)).toBe("Defect");
        expect(((result as Failed<number, Error>).fault as Defect).thrown).toBe(err);
        expect((result as Failed<number, Error>).attempts).toBe(1);
        expect((result as Failed<number, Error>).nextRetryAt).toBeNull();
    });
    it("returns Failed when thunk rejects", async () => {
        const e = Effect.Idle<number, string>(async () => Promise.reject("network error"));
        const result = await e.run();
        expect(getTag(result)).toBe("Failed");
        expect(((result as Failed<number, string>).fault as Defect).thrown).toBe("network error");
    });
});

describe("Effect.run — already Running/Done/Failed", () => {
    it("Running.run() awaits the in-flight promise", async () => {
        const pending = (async () => Effect.Done(99))();
        const r = Effect.Running(pending);
        const result = await r.run();
        expect((result as Done<number>).value).toBe(99);
    });
    it("Done.run() returns itself", async () => {
        const original = Effect.Done(5);
        const result = await original.run();
        expect(result).toBe(original);
    });
    it("Failed.run() returns itself", async () => {
        const original = Effect.Failed(Fault.Defect("err"), 1, null);
        const result = await original.run();
        expect(result).toBe(original);
    });
});

describe("Effect.map", () => {
    it("transforms the success value lazily (returns new Idle)", () => {
        const e = Effect.Idle(async () => 3);
        const mapped = e.map((n) => n * 2);
        expect(getTag(mapped)).toBe("Idle");
    });
    it("applies the transform when run", async () => {
        const result = await Effect.Idle(async () => 3)
            .map((n) => n * 2)
            .run();
        expect((result as Done<number>).value).toBe(6);
    });
    it("propagates failure without calling fn", async () => {
        const fn = vi.fn();
        const e = Effect.Idle<number, Error>(async () => { throw new Error("fail"); });
        const result = await e.map(fn).run();
        expect(fn).not.toHaveBeenCalled();
        expect(getTag(result)).toBe("Failed");
    });
    it("can chain multiple maps", async () => {
        const result = await Effect.Idle(async () => "hello")
            .map((s) => s.toUpperCase())
            .map((s) => s.length)
            .run();
        expect((result as Done<number>).value).toBe(5);
    });
});

describe("Effect.flatMap", () => {
    it("chains two successful effects", async () => {
        const result = await Effect.Idle(async () => 3)
            .flatMap((n) => Effect.Idle(async () => n * 10))
            .run();
        expect((result as Done<number>).value).toBe(30);
    });
    it("propagates failure from the first effect", async () => {
        const err = new Error("first failed");
        const second = vi.fn();
        const result = await Effect.Idle<number, Error>(async () => { throw Fault.Fail(err); })
            .flatMap(() => Effect.Idle(second))
            .run();
        expect(second).not.toHaveBeenCalled();
        expect(getTag(result)).toBe("Failed");
        // Fault.Fail passes through classifyError unchanged
        expect(getTag((result as Failed<number, Error>).fault)).toBe("Fail");
        expect(((result as Failed<number, Error>).fault as ReturnType<typeof Fault.Fail<Error>>).error).toBe(err);
    });
    it("propagates failure from the second effect", async () => {
        const err = new Error("second failed");
        const result = await Effect.Idle<number, Error>(async () => 1)
            .flatMap(() => Effect.Idle<number, Error>(async () => { throw Fault.Fail(err); }))
            .run();
        expect(getTag(result)).toBe("Failed");
        expect(getTag((result as Failed<number, Error>).fault)).toBe("Fail");
        expect(((result as Failed<number, Error>).fault as ReturnType<typeof Fault.Fail<Error>>).error).toBe(err);
    });
});

describe("Effect.recover", () => {
    it("recovery fn not called on success", async () => {
        const fn = vi.fn(() => Effect.Idle(async () => 0));
        const result = await Effect.Idle(async () => 42).recover(fn).run();
        expect(fn).not.toHaveBeenCalled();
        expect((result as Done<number>).value).toBe(42);
    });
    it("recovery fn called on failure, succeeds", async () => {
        const result = await Effect.Idle<number, string>(async () => { throw Fault.Fail("fail"); })
            .recover((fault) => {
                const msg = getTag(fault) === "Fail"
                    ? String((fault as ReturnType<typeof Fault.Fail<string>>).error)
                    : "";
                return Effect.Idle(async () => msg.length);
            })
            .run();
        expect((result as Done<number>).value).toBe(4); // "fail".length
    });
    it("recovery fn called on failure, recovery also fails", async () => {
        const recoveryErr = new Error("recovery also failed");
        const result = await Effect.Idle<number, Error>(async () => { throw new Error("original"); })
            .recover(() => Effect.Idle<number, Error>(async () => { throw recoveryErr; }))
            .run();
        expect(getTag(result)).toBe("Failed");
    });
    it("returns new Idle lazily", () => {
        const e = Effect.Idle<number, Error>(async () => 1);
        const recovered = e.recover(() => Effect.Idle(async () => 0));
        expect(getTag(recovered)).toBe("Idle");
    });
});
