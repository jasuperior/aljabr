import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
    Derived,
    AsyncDerived,
    type DerivedState,
    type AsyncDerivedState,
} from "../../src/prelude/derived";
import { Signal } from "../../src/prelude/signal";
import { Schedule, ScheduleError } from "../../src/prelude/schedule";
import { Fault } from "../../src/prelude/fault";
import { instanceOf, getTag, __ } from "../../src/union";
import { match } from "../../src/match";

// ===========================================================================
// Derived<T>
// ===========================================================================

describe("Derived — read-only form", () => {
    it("starts in Uncomputed state", () => {
        const d = Derived.create(() => 42);
        expect(getTag(d.state)).toBe("Uncomputed");
    });

    it("evaluates lazily on first get()", () => {
        const fn = vi.fn(() => 7);
        const d = Derived.create(fn);
        expect(fn).not.toHaveBeenCalled();
        expect(d.get()).toBe(7);
        expect(fn).toHaveBeenCalledOnce();
    });

    it("transitions to Computed after first get()", () => {
        const d = Derived.create(() => "hello");
        d.get();
        expect(getTag(d.state)).toBe("Computed");
    });

    it("does not re-evaluate when dependencies haven't changed", () => {
        const fn = vi.fn(() => 99);
        const d = Derived.create(fn);
        d.get();
        d.get();
        expect(fn).toHaveBeenCalledOnce();
    });

    it("re-evaluates when a dependency signal changes (Computed → Stale → Computed)", () => {
        const sig = Signal.create(1);
        const fn = vi.fn(() => sig.get()! * 2);
        const d = Derived.create(fn);

        expect(d.get()).toBe(2);
        expect(fn).toHaveBeenCalledOnce();

        sig.set(5);
        expect(getTag(d.state)).toBe("Stale");

        expect(d.get()).toBe(10);
        expect(fn).toHaveBeenCalledTimes(2);
        expect(getTag(d.state)).toBe("Computed");
    });
});

describe("Derived — peek()", () => {
    it("returns null before first evaluation", () => {
        const d = Derived.create(() => 42);
        expect(d.peek()).toBeNull();
    });

    it("returns last known value after evaluation", () => {
        const d = Derived.create(() => "world");
        d.get();
        expect(d.peek()).toBe("world");
    });

    it("does not trigger evaluation", () => {
        const fn = vi.fn(() => 1);
        const d = Derived.create(fn);
        d.peek();
        expect(fn).not.toHaveBeenCalled();
    });

    it("returns stale value while in Stale state", () => {
        const sig = Signal.create(10);
        const d = Derived.create(() => sig.get()!);
        d.get(); // Computed(10)
        sig.set(20); // → Stale
        expect(d.peek()).toBe(10); // stale value preserved
    });
});

describe("Derived — DerivedState lifecycle", () => {
    it("Uncomputed → Computed → Stale via match()", () => {
        const sig = Signal.create(1);
        const d = Derived.create(() => sig.get()!);

        const s0 = match(d.state, {
            Uncomputed: () => "uncomputed",
            Computed: () => "computed",
            Stale: () => "stale",
            Disposed: () => "disposed",
        });
        expect(s0).toBe("uncomputed");

        d.get();
        const s1 = match(d.state, {
            Uncomputed: () => "uncomputed",
            Computed: ({ value }) => `computed(${value})`,
            Stale: () => "stale",
            Disposed: () => "disposed",
        });
        expect(s1).toBe("computed(1)");

        sig.set(2);
        const s2 = match(d.state, {
            Uncomputed: () => "uncomputed",
            Computed: () => "computed",
            Stale: ({ value }) => `stale(${value})`,
            Disposed: () => "disposed",
        });
        expect(s2).toBe("stale(1)");
    });

    it("transitions to Disposed after dispose()", () => {
        const d = Derived.create(() => 1);
        d.get();
        d.dispose();
        expect(getTag(d.state)).toBe("Disposed");
    });

    it("dispose() causes get() to return null", () => {
        const d = Derived.create(() => 42);
        d.get();
        d.dispose();
        expect(d.get()).toBeNull();
    });
});

describe("Derived — writable form", () => {
    it("set() delegates to the provided handler", () => {
        const sig = Signal.create(0);
        const handler = vi.fn((v: number) => sig.set(v));
        const d = Derived.create({ get: () => sig.get()!, set: handler });

        d.set(99);
        expect(handler).toHaveBeenCalledWith(99);
        expect(sig.peek()).toBe(99);
    });

    it("get() still reflects the upstream signal value", () => {
        const sig = Signal.create("ada");
        const d = Derived.create({
            get: () => sig.get()!.toUpperCase(),
            set: (v) => sig.set(v.toLowerCase()),
        });

        expect(d.get()).toBe("ADA");
        d.set("GRACE");
        expect(sig.peek()).toBe("grace");
        expect(d.get()).toBe("GRACE");
    });

    it("set() on a read-only derived throws an informative error", () => {
        const d = Derived.create(() => 1);
        expect(() => d.set(2)).toThrow(/read-only/);
    });
});

// ===========================================================================
// AsyncDerived<T, E>
// ===========================================================================

describe("AsyncDerived — initial state", () => {
    it("starts in Uncomputed state", () => {
        const d = AsyncDerived.create(async () => 42);
        expect(getTag(d.state)).toBe("Uncomputed");
    });

    it("peek() returns null before first evaluation", () => {
        const d = AsyncDerived.create(async () => 42);
        expect(d.peek()).toBeNull();
    });
});

describe("AsyncDerived — successful evaluation", () => {
    it("get() resolves to the computed value", async () => {
        const d = AsyncDerived.create(async () => 42);
        expect(await d.get()).toBe(42);
    });

    it("transitions to Ready after get()", async () => {
        const d = AsyncDerived.create(async () => "hello");
        await d.get();
        expect(getTag(d.state)).toBe("Ready");
    });

    it("peek() returns the value in Ready state", async () => {
        const d = AsyncDerived.create(async () => 7);
        await d.get();
        expect(d.peek()).toBe(7);
    });

    it("does not re-run when dependencies haven't changed", async () => {
        const fn = vi.fn(async () => 1);
        const d = AsyncDerived.create(fn);
        await d.get();
        await d.get();
        expect(fn).toHaveBeenCalledOnce();
    });
});

describe("AsyncDerived — Reloading (stale value preserved)", () => {
    it("transitions to Reloading when a dependency changes in Ready state", async () => {
        const sig = Signal.create(1);
        const d = AsyncDerived.create(async () => sig.get()!);

        await d.get(); // Ready(1)
        sig.set(2); // dirty() fires synchronously → Reloading(1)

        expect(getTag(d.state)).toBe("Reloading");
        expect(d.peek()).toBe(1); // stale value preserved
    });

    it("peek() returns the stale value while reloading, then updates", async () => {
        const sig = Signal.create(10);
        const d = AsyncDerived.create(async () => sig.get()!);

        await d.get(); // Ready(10)
        sig.set(20); // dirty() → Reloading(10) synchronously

        // State is already Reloading — peek returns stale without triggering re-eval
        expect(getTag(d.state)).toBe("Reloading");
        expect(d.peek()).toBe(10);

        // Now trigger re-evaluation and await completion
        await d.get();
        expect(d.peek()).toBe(20);
    });
});

describe("AsyncDerived — failure (Fault.Defect)", () => {
    it("transitions to Failed when the thunk rejects", async () => {
        const err = new Error("network error");
        const d = AsyncDerived.create(async () => {
            throw err;
        });

        await expect(d.get()).rejects.toMatchObject({ thrown: err });
        expect(getTag(d.state)).toBe("Failed");
    });

    it("Failed state carries a Fault.Defect", async () => {
        const d = AsyncDerived.create(async () => {
            throw new Error("boom");
        });
        await d.get().catch(() => {});
        const fault = d.state.getFault();
        expect(fault).not.toBeNull();
        expect(getTag(fault!)).toBe("Defect");
    });
});

describe("AsyncDerived — failure (Fault.Fail)", () => {
    it("preserves Fault.Fail thrown by the thunk", async () => {
        const domainError = { code: 404 };
        const d = AsyncDerived.create(async () => {
            throw Fault.Fail(domainError);
        });

        await d.get().catch(() => {});
        const fault = d.state.getFault();
        expect(fault).not.toBeNull();
        expect(getTag(fault!)).toBe("Fail");
        expect((fault as ReturnType<typeof Fault.Fail>).error).toBe(
            domainError,
        );
    });
});

describe("AsyncDerived — dispose", () => {
    it("transitions to Disposed", async () => {
        const d = AsyncDerived.create(async () => 1);
        await d.get();
        d.dispose();
        expect(getTag(d.state)).toBe("Disposed");
    });

    it("get() rejects on a disposed derived", async () => {
        const d = AsyncDerived.create(async () => 1);
        d.dispose();
        await expect(d.get()).rejects.toThrow(/disposed/);
    });

    it("peek() returns null after disposal", async () => {
        const d = AsyncDerived.create(async () => "x");
        await d.get();
        d.dispose();
        expect(d.peek()).toBeNull();
    });

    it("cancels in-flight request by aborting the AbortSignal", async () => {
        let capturedSignal!: AbortSignal;
        const d = AsyncDerived.create(async (signal) => {
            capturedSignal = signal;
            await new Promise<void>((_, reject) => {
                signal.addEventListener("abort", () =>
                    reject(new Error("aborted")),
                );
            });
            return 1;
        });

        void d.get().catch(() => {});
        await new Promise((r) => setTimeout(r, 0)); // let evaluate() start

        d.dispose();
        expect(capturedSignal?.aborted).toBe(true);
    });
});

describe("AsyncDerived — retry with Schedule.Fixed", () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it("retries after the schedule delay and eventually succeeds", async () => {
        let attempt = 0;
        const d = AsyncDerived.create(
            async () => {
                attempt++;
                if (attempt < 3) throw Fault.Fail("not yet");
                return "done";
            },
            { schedule: Schedule.Fixed(100), maxRetries: 5 },
        );

        // Initial get() rejects on first failure; discard that rejection
        void d.get().catch(() => {});

        // Let the first attempt fail
        await Promise.resolve();
        await Promise.resolve();
        expect(getTag(d.state)).toBe("Failed");

        // Advance past the retry delay — triggers retry 2 (fails again)
        await vi.advanceTimersByTimeAsync(100);
        expect(getTag(d.state)).toBe("Failed");

        // Advance again — triggers retry 3 (succeeds)
        await vi.advanceTimersByTimeAsync(100);

        // Now fetch the settled value
        const result = await d.get();
        expect(result).toBe("done");
        expect(getTag(d.state)).toBe("Ready");
        d.dispose();
    });
});

describe("AsyncDerived — maxRetries exceeded", () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it("stops retrying after maxRetries and enters Failed with MaxRetriesExceeded", async () => {
        const d = AsyncDerived.create(
            async () => {
                throw Fault.Fail("always fails");
            },
            { schedule: Schedule.Fixed(50), maxRetries: 2 },
        );

        const promise = d.get().catch((e) => e);

        // Flush microtasks for initial attempt, then advance through all retries
        await Promise.resolve();
        await Promise.resolve();
        for (let i = 0; i < 3; i++) {
            await vi.advanceTimersByTimeAsync(50);
        }

        const caught = await promise;
        expect(getTag(d.state)).toBe("Failed");

        const fault = d.state.getFault();
        expect(fault).not.toBeNull();
        if (fault !== null) {
            const isMaxRetries = match(fault, {
                Fail: ({ error }) =>
                    instanceOf(ScheduleError.MaxRetriesExceeded, error),
                Defect: () => false,
                Interrupted: () => false,
            });
            expect(isMaxRetries).toBe(true);
        }
        void caught;
        d.dispose();
    });
});

describe("AsyncDerived — shouldRetry", () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it("does not retry when shouldRetry returns false", async () => {
        let attempt = 0;
        const d = AsyncDerived.create(
            async () => {
                attempt++;
                throw Fault.Fail("stop");
            },
            {
                schedule: Schedule.Fixed(100),
                maxRetries: 10,
                shouldRetry: () => false,
            },
        );

        const promise = d.get().catch((e) => e);
        await Promise.resolve();
        await Promise.resolve();

        const result = await promise;
        expect(attempt).toBe(1);
        expect(getTag(d.state)).toBe("Failed");
        void result;
        d.dispose();
    });
});

describe("AsyncDerived — afterRetry callback", () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it("invokes afterRetry with attempt number and delay before each retry", async () => {
        const afterRetry = vi.fn();
        let attempt = 0;

        const d = AsyncDerived.create(
            async () => {
                attempt++;
                if (attempt < 2) throw Fault.Fail("fail");
                return "ok";
            },
            { schedule: Schedule.Fixed(200), maxRetries: 3, afterRetry },
        );

        // Discard the initial rejection; retry runs internally
        void d.get().catch(() => {});
        await Promise.resolve();
        await Promise.resolve();
        await vi.advanceTimersByTimeAsync(200);

        // Retry has now succeeded — fresh get() returns the value
        await d.get();

        expect(afterRetry).toHaveBeenCalledOnce();
        const [attemptArg, , delayArg] = afterRetry.mock.calls[0]!;
        expect(attemptArg).toBe(1);
        expect(delayArg).toBe(200);
        d.dispose();
    });
});

describe("AsyncDerived — timeout", () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it("enters Failed when the thunk exceeds the timeout", async () => {
        const d = AsyncDerived.create(
            async () => new Promise<number>(() => {}), // never resolves
            { timeout: 500 },
        );

        const promise = d.get().catch((e) => e);
        await vi.advanceTimersByTimeAsync(500);

        await promise;
        expect(getTag(d.state)).toBe("Failed");
        const state = d.state;

        if (getTag(state) === "Failed") {
            // ScheduleError.TimedOut is thrown by the timeout wrapper and lands as a Defect
            expect(["Defect", "Interrupted", "Fail"]).toContain(
                getTag(state.getFault()!),
            );
        }
        d.dispose();
    });
});
