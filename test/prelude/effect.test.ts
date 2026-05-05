import { describe, expect, it, vi, expectTypeOf, beforeEach, afterEach } from "vitest";
import {
    Effect,
    watch,
    type Idle,
    type Done,
    type Stale,
    type Failed,
} from "../../src/prelude/effect";
import { Fault, type Defect } from "../../src/prelude/fault";
import { Schedule, ScheduleError } from "../../src/prelude/schedule";
import { Signal } from "../../src/prelude/signal";
import { getTag } from "../../src/union";
import { instanceOf } from "../../src/union";

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

// ===========================================================================
// watch
// ===========================================================================

// Settle the initial IIFE before asserting onChange calls.
const settle = () => new Promise<void>(r => setTimeout(r, 0));

// ---------------------------------------------------------------------------
// Lazy mode — dep-change notifications
// ---------------------------------------------------------------------------

describe("watch — lazy (eager=false) dep change", () => {
    it("delivers Stale synchronously when a dependency changes after initial run", async () => {
        const sig = Signal.create("a");
        const changes: string[] = [];

        const handle = watch(
            async () => sig.get()!,
            (result) => changes.push(getTag(result)),
        );

        await settle(); // initial run stores Done in lastResult

        sig.set("b"); // dirty() fires synchronously → onChange(Stale)

        expect(changes).toEqual(["Stale"]);
        handle.dispose();
    });

    it("Stale carries the last known value", async () => {
        const sig = Signal.create(10);
        let staleValue: number | null = null;

        const handle = watch(
            async () => sig.get()!,
            (result) => {
                if (getTag(result) === "Stale") {
                    staleValue = (result as Stale<number>).value;
                }
            },
        );

        await settle();
        sig.set(20);

        expect(staleValue).toBe(10);
        handle.dispose();
    });

    it("does NOT call onChange before the initial run settles", () => {
        const sig = Signal.create("x");
        const onChange = vi.fn();

        const handle = watch(async () => sig.get()!, onChange);
        // Signal changed immediately — lastResult is still null, dirty() returns early
        sig.set("y");

        expect(onChange).not.toHaveBeenCalled();
        handle.dispose();
    });
});

// ---------------------------------------------------------------------------
// Eager mode — automatic re-run on dep change
// ---------------------------------------------------------------------------

describe("watch — eager (eager=true) dep change", () => {
    it("re-runs and delivers Done when a dependency changes", async () => {
        const sig = Signal.create(1);
        const results: string[] = [];

        const handle = watch(
            async () => sig.get()! * 2,
            (result) => results.push(getTag(result)),
            { eager: true },
        );

        await settle(); // initial run settles (no onChange from initial run)

        sig.set(2); // dirty() → void rerun() (async)
        await settle();

        expect(results).toContain("Done");
        const lastDone = results.findLast(t => t === "Done");
        expect(lastDone).toBe("Done");
        handle.dispose();
    });

    it("eager re-run delivers the updated computed value", async () => {
        const sig = Signal.create(3);
        let lastValue: number | undefined;

        const handle = watch(
            async () => sig.get()! * 10,
            (result) => {
                if (getTag(result) === "Done") lastValue = (result as Done<number>).value;
            },
            { eager: true },
        );

        await settle();
        sig.set(7);
        await settle();

        expect(lastValue).toBe(70);
        handle.dispose();
    });
});

// ---------------------------------------------------------------------------
// stop() — cancellation
// ---------------------------------------------------------------------------

describe("watch — stop()", () => {
    it("no more onChange callbacks after stop()", async () => {
        const sig = Signal.create("a");
        const onChange = vi.fn();

        const handle = watch(async () => sig.get()!, onChange);
        await settle();
        handle.dispose();

        sig.set("b");
        await settle();

        expect(onChange).not.toHaveBeenCalled();
    });

    it("aborts the AbortSignal of any in-flight thunk when stopped", async () => {
        let capturedSignal!: AbortSignal;

        const handle = watch(
            async (signal) => {
                capturedSignal = signal;
                await new Promise<never>((_, reject) =>
                    signal.addEventListener("abort", () => reject(new Error("aborted"))),
                );
                return 1;
            },
            () => {},
        );

        await new Promise(r => setTimeout(r, 0)); // let #evaluate start
        handle.dispose();
        expect(capturedSignal?.aborted).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// Retry — schedule-based
// ---------------------------------------------------------------------------

describe("watch — retry", () => {
    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(() => { vi.useRealTimers(); });

    it("retries after schedule delay and eventually calls onChange(Done)", async () => {
        const sig = Signal.create(0);
        let callCount = 0;
        const results: string[] = [];

        const handle = watch(
            async () => {
                sig.get(); // track the signal
                callCount++;
                if (callCount === 1) throw Fault.Fail("not yet");
                return "success";
            },
            (r) => results.push(getTag(r)),
            { schedule: Schedule.Fixed(100) },
        );

        // Initial run fails (no onChange from initial run), sets retry timer
        await Promise.resolve();
        await Promise.resolve();

        // Advance past retry delay → rerun() → success → onChange(Done)
        await vi.advanceTimersByTimeAsync(100);

        expect(results).toContain("Done");
        handle.dispose();
    });

    it("delivers Failed with MaxRetriesExceeded after maxRetries exhausted", async () => {
        const results: string[] = [];
        const faults: unknown[] = [];

        const handle = watch(
            async () => { throw Fault.Fail("always"); },
            (r) => {
                results.push(getTag(r));
                if (getTag(r) === "Failed") faults.push((r as Failed<never>).fault);
            },
            { schedule: Schedule.Fixed(50), maxRetries: 1 },
        );

        await Promise.resolve();
        await Promise.resolve();

        // Advance through retries — maxRetries=1 means 1 retry allowed
        for (let i = 0; i < 3; i++) {
            await vi.advanceTimersByTimeAsync(50);
        }

        const lastFault = faults[faults.length - 1] as any;
        expect(lastFault).not.toBeUndefined();
        const hitMaxRetries = lastFault != null &&
            getTag(lastFault) === "Fail" &&
            instanceOf(ScheduleError.MaxRetriesExceeded, lastFault.error);
        expect(hitMaxRetries).toBe(true);
        handle.dispose();
    });

    it("does not retry when shouldRetry returns false", async () => {
        let attempts = 0;
        const onChange = vi.fn();

        const handle = watch(
            async () => {
                attempts++;
                throw Fault.Fail("stop");
            },
            onChange,
            { schedule: Schedule.Fixed(100), maxRetries: 10, shouldRetry: () => false },
        );

        await Promise.resolve();
        await Promise.resolve();
        await vi.advanceTimersByTimeAsync(200);

        expect(attempts).toBe(1); // only initial run, no retries
        handle.dispose();
    });

    it("invokes afterRetry before each retry fires", async () => {
        const afterRetry = vi.fn();
        let attempts = 0;

        // Needs 3 attempts so that rerun() itself fails (triggering handleFailure+afterRetry).
        // Initial IIFE: fail → retry timer (no afterRetry from IIFE path).
        // rerun #1: fail → handleFailure → afterRetry called → retry timer.
        // rerun #2: succeed.
        const handle = watch(
            async () => {
                attempts++;
                if (attempts <= 2) throw Fault.Fail("not yet");
                return "ok";
            },
            () => {},
            { schedule: Schedule.Fixed(200), maxRetries: 5, afterRetry },
        );

        await Promise.resolve();
        await Promise.resolve();
        // Initial run (attempt 1) fails → timer 200ms, no afterRetry
        await vi.advanceTimersByTimeAsync(200);
        // rerun #1 (attempt 2) fails → handleFailure → afterRetry called

        expect(afterRetry).toHaveBeenCalledOnce();
        const [, , delayArg] = afterRetry.mock.calls[0]!;
        expect(delayArg).toBe(200);
        handle.dispose();
    });
});

// ---------------------------------------------------------------------------
// timeout
// ---------------------------------------------------------------------------

describe("watch — timeout", () => {
    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(() => { vi.useRealTimers(); });

    it("delivers Failed when the retried thunk exceeds the timeout", async () => {
        // Initial run fails fast (Fault.Fail) → retry timer fires → rerun() starts
        // with the timeout wrapper → times out → handleFailure → onChange(Failed).
        let attempt = 0;
        const results: string[] = [];

        const handle = watch(
            async () => {
                attempt++;
                if (attempt === 1) throw Fault.Fail("fail fast"); // initial fails immediately
                await new Promise<never>(() => {}); // retry hangs forever
                return 1;
            },
            (r) => results.push(getTag(r)),
            { schedule: Schedule.Fixed(50), timeout: 200 },
        );

        await Promise.resolve();
        await Promise.resolve();
        // Initial run failed → retry timer at 50ms

        await vi.advanceTimersByTimeAsync(50);
        // rerun #1 started (with timeout 200ms)

        await vi.advanceTimersByTimeAsync(200);
        // timeout fired → abort → Interrupted → handleFailure → onChange(Failed)

        expect(results).toContain("Failed");
        handle.dispose();
    });
});

describe("Effect.all (v0.3.10 Phase 5)", () => {
    it("aggregates Done values in parallel", async () => {
        const e = Effect.all([
            Effect.Idle<number>(async () => 1),
            Effect.Idle<string>(async () => "a"),
        ]);
        const result = await e.run();
        expect(getTag(result)).toBe("Done");
        expect((result as { value: unknown[] }).value).toEqual([1, "a"]);
    });

    it("fails fast on the first Failed effect", async () => {
        const e = Effect.all([
            Effect.Idle<number>(async () => 1),
            Effect.Idle<string>(async () => {
                throw Fault.Fail("boom");
            }),
        ]);
        const result = await e.run();
        expect(getTag(result)).toBe("Failed");
    });
});

describe("Effect.allSettled (v0.3.10 Phase 5)", () => {
    it("returns every settlement, never failing the aggregate", async () => {
        const e = Effect.allSettled([
            Effect.Idle<number>(async () => 1),
            Effect.Idle<string>(async () => {
                throw Fault.Fail("boom");
            }),
            Effect.Idle<boolean>(async () => true),
        ]);
        const result = await e.run();
        expect(getTag(result)).toBe("Done");
        const settled = (result as { value: unknown[] }).value;
        expect(settled.length).toBe(3);
        expect(getTag(settled[0] as never)).toBe("Done");
        expect(getTag(settled[1] as never)).toBe("Failed");
        expect(getTag(settled[2] as never)).toBe("Done");
    });
});

describe("Effect.runOr (v0.3.10 Phase 5)", () => {
    it("returns the resolved value on Done", async () => {
        const e = Effect.Idle<number>(async () => 42);
        expect(await e.runOr(0)).toBe(42);
    });

    it("returns the default on Failed", async () => {
        const e = Effect.Idle<number>(async () => {
            throw Fault.Fail("boom");
        });
        expect(await e.runOr(99)).toBe(99);
    });
});
