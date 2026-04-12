import { describe, expect, it, vi, expectTypeOf } from "vitest";
import {
    Effect,
    type Idle,
    type Running,
    type Done,
    type Effect as EffectType,
} from "../../src/prelude/effect";
import { SignalState } from "../../src/prelude/signal";
import { getTag } from "../../src/union";

describe("Effect factory", () => {
    it("Idle carries the thunk", () => {
        const thunk = async () => 42;
        const e = Effect.Idle(thunk);
        expect(getTag(e)).toBe("Idle");
        expect(e.thunk).toBe(thunk);
    });
    it("Running carries the pending promise", () => {
        const pending = Promise.resolve(Effect.Done(SignalState.Active(1), null));
        const e = Effect.Running(pending);
        expect(getTag(e)).toBe("Running");
    });
    it("Done carries the signal and error", () => {
        const sig = SignalState.Active(7);
        const e = Effect.Done(sig, null);
        expect(getTag(e)).toBe("Done");
        expect(e.signal).toBe(sig);
        expect(e.error).toBeNull();
    });
    it("Done carries error on failure", () => {
        const err = new Error("oops");
        const e = Effect.Done<number, Error>(SignalState.Disposed(), err);
        expect(e.error).toBe(err);
    });
    it("preserves type parameters", () => {
        const e = Effect.Idle(async () => "hello");
        expectTypeOf(e).toExtend<Idle<string>>();
    });
});

describe("Effect.run — success", () => {
    it("returns Done(SignalState.Active(value)) on success", async () => {
        const e = Effect.Idle(async () => 42);
        const done = await e.run();
        expect(getTag(done)).toBe("Done");
        expect(getTag(done.signal)).toBe("Active");
        expect(done.signal.get()).toBe(42);
        expect(done.error).toBeNull();
    });
    it("works with async computation", async () => {
        const e = Effect.Idle(async () => {
            await Promise.resolve();
            return "hello";
        });
        const done = await e.run();
        expect(done.signal.get()).toBe("hello");
    });
});

describe("Effect.run — failure", () => {
    it("returns Done(SignalState.Disposed(), error) when thunk throws", async () => {
        const err = new Error("boom");
        const e = Effect.Idle<number, Error>(async () => {
            throw err;
        });
        const done = await e.run();
        expect(getTag(done)).toBe("Done");
        expect(getTag(done.signal)).toBe("Disposed");
        expect(done.signal.isActive()).toBe(false);
        expect(done.error).toBe(err);
    });
    it("returns Done(SignalState.Disposed()) when thunk rejects", async () => {
        const e = Effect.Idle<number, string>(async () =>
            Promise.reject("network error"),
        );
        const done = await e.run();
        expect(getTag(done.signal)).toBe("Disposed");
        expect(done.error).toBe("network error");
    });
});

describe("Effect.run — already Running/Done", () => {
    it("Running.run() awaits the in-flight promise", async () => {
        const pending = (async () => Effect.Done(SignalState.Active(99), null))();
        const r = Effect.Running(pending);
        const done = await r.run();
        expect(done.signal.get()).toBe(99);
    });
    it("Done.run() returns itself", async () => {
        const original = Effect.Done(SignalState.Active(5), null);
        const done = await original.run();
        expect(done).toBe(original);
    });
});

describe("Effect.map", () => {
    it("transforms the success value lazily (returns new Idle)", () => {
        const e = Effect.Idle(async () => 3);
        const mapped = e.map((n) => n * 2);
        expect(getTag(mapped)).toBe("Idle");
    });
    it("applies the transform when run", async () => {
        const done = await Effect.Idle(async () => 3)
            .map((n) => n * 2)
            .run();
        expect(done.signal.get()).toBe(6);
    });
    it("propagates failure without calling fn", async () => {
        const fn = vi.fn();
        const e = Effect.Idle<number, Error>(async () => {
            throw new Error("fail");
        });
        const done = await e.map(fn).run();
        expect(fn).not.toHaveBeenCalled();
        expect(getTag(done.signal)).toBe("Disposed");
    });
    it("can chain multiple maps", async () => {
        const done = await Effect.Idle(async () => "hello")
            .map((s) => s.toUpperCase())
            .map((s) => s.length)
            .run();
        expect(done.signal.get()).toBe(5);
    });
});

describe("Effect.flatMap", () => {
    it("chains two successful effects", async () => {
        const done = await Effect.Idle(async () => 3)
            .flatMap((n) => Effect.Idle(async () => n * 10))
            .run();
        expect(done.signal.get()).toBe(30);
    });
    it("propagates failure from the first effect", async () => {
        const err = new Error("first failed");
        const second = vi.fn();
        const done = await Effect.Idle<number, Error>(async () => {
            throw err;
        })
            .flatMap(() => Effect.Idle(second))
            .run();
        expect(second).not.toHaveBeenCalled();
        expect(getTag(done.signal)).toBe("Disposed");
        expect(done.error).toBe(err);
    });
    it("propagates failure from the second effect", async () => {
        const err = new Error("second failed");
        const done = await Effect.Idle(async () => 1)
            .flatMap(() =>
                Effect.Idle<number, Error>(async () => {
                    throw err;
                }),
            )
            .run();
        expect(getTag(done.signal)).toBe("Disposed");
        expect(done.error).toBe(err);
    });
});

describe("Effect.recover", () => {
    it("recovery fn not called on success", async () => {
        const fn = vi.fn(() => Effect.Idle(async () => 0));
        const done = await Effect.Idle(async () => 42).recover(fn).run();
        expect(fn).not.toHaveBeenCalled();
        expect(done.signal.get()).toBe(42);
    });
    it("recovery fn called on failure, succeeds", async () => {
        const err = new Error("fail");
        const done = await Effect.Idle<number, Error>(async () => {
            throw err;
        })
            .recover((e) => Effect.Idle(async () => e.message.length))
            .run();
        expect(done.signal.get()).toBe(4); // "fail".length
    });
    it("recovery fn called on failure, recovery also fails", async () => {
        const recoveryErr = new Error("recovery also failed");
        const done = await Effect.Idle<number, Error>(async () => {
            throw new Error("original");
        })
            .recover(() =>
                Effect.Idle<number, Error>(async () => {
                    throw recoveryErr;
                }),
            )
            .run();
        expect(getTag(done.signal)).toBe("Disposed");
    });
    it("returns new Idle lazily", () => {
        const e = Effect.Idle<number, Error>(async () => 1);
        const recovered = e.recover(() => Effect.Idle(async () => 0));
        expect(getTag(recovered)).toBe("Idle");
    });
});
