import { describe, expect, it, vi } from "vitest";
import {
    Scope,
    Resource,
    ScopeState,
    runInScope,
    getCurrentScope,
    defer,
    acquire,
    type ScopeHandle,
} from "../../src/prelude/scope";
import { createOwner, trackIn } from "../../src/prelude/context";
import { getTag } from "../../src/union";
import { match } from "../../src/match";

// ---------------------------------------------------------------------------
// ScopeState union
// ---------------------------------------------------------------------------

describe("ScopeState", () => {
    it("Active has the correct tag", () => {
        const s = ScopeState.Active();
        expect(getTag(s)).toBe("Active");
    });

    it("Disposed has the correct tag", () => {
        const s = ScopeState.Disposed();
        expect(getTag(s)).toBe("Disposed");
    });

    it("exhaustive match over ScopeState", () => {
        const active = ScopeState.Active();
        const disposed = ScopeState.Disposed();
        expect(match(active,   { Active: () => "a", Disposed: () => "d" })).toBe("a");
        expect(match(disposed, { Active: () => "a", Disposed: () => "d" })).toBe("d");
    });
});

// ---------------------------------------------------------------------------
// Resource factory
// ---------------------------------------------------------------------------

describe("Resource", () => {
    it("returns an inert handle with acquire and release", () => {
        const acquire = vi.fn(async () => "connection");
        const release = vi.fn(async () => {});
        const r = Resource(acquire, release);
        expect(r.acquire).toBe(acquire);
        expect(r.release).toBe(release);
        expect(acquire).not.toHaveBeenCalled();
    });
});

// ---------------------------------------------------------------------------
// Scope — basic lifecycle
// ---------------------------------------------------------------------------

describe("Scope — initial state", () => {
    it("starts Active", () => {
        const scope = Scope();
        expect(getTag(scope.state)).toBe("Active");
    });
});

describe("Scope.dispose — state transition", () => {
    it("transitions to Disposed after dispose()", async () => {
        const scope = Scope();
        await scope.dispose();
        expect(getTag(scope.state)).toBe("Disposed");
    });

    it("is idempotent — second dispose returns []", async () => {
        const scope = Scope();
        const fn = vi.fn();
        scope.defer(fn);
        await scope.dispose();
        const second = await scope.dispose();
        expect(second).toEqual([]);
        expect(fn).toHaveBeenCalledOnce();
    });
});

// ---------------------------------------------------------------------------
// Scope.defer — finalizers
// ---------------------------------------------------------------------------

describe("Scope.defer", () => {
    it("runs the finalizer on dispose", async () => {
        const scope = Scope();
        const fn = vi.fn();
        scope.defer(fn);
        await scope.dispose();
        expect(fn).toHaveBeenCalledOnce();
    });

    it("runs multiple finalizers in LIFO order", async () => {
        const scope = Scope();
        const order: number[] = [];
        scope.defer(() => { order.push(1); });
        scope.defer(() => { order.push(2); });
        scope.defer(() => { order.push(3); });
        await scope.dispose();
        expect(order).toEqual([3, 2, 1]);
    });

    it("async finalizer is awaited before the next one runs", async () => {
        const scope = Scope();
        const order: number[] = [];

        scope.defer(async () => {
            await new Promise<void>(resolve => setTimeout(resolve, 10));
            order.push(1);
        });
        scope.defer(async () => {
            order.push(2);
        });

        await scope.dispose();
        expect(order).toEqual([2, 1]);
    });
});

// ---------------------------------------------------------------------------
// Scope.dispose — defect collection
// ---------------------------------------------------------------------------

describe("Scope.dispose — defect collection", () => {
    it("collects thrown errors as Defect without aborting remaining finalizers", async () => {
        const scope = Scope();
        const afterThrowing = vi.fn();

        scope.defer(afterThrowing);            // registered first → runs last
        scope.defer(() => { throw new Error("oops"); }); // registered second → runs first

        const defects = await scope.dispose();

        expect(defects).toHaveLength(1);
        expect(getTag(defects[0]!)).toBe("Defect");
        expect((defects[0] as { thrown: unknown }).thrown).toBeInstanceOf(Error);
        expect(afterThrowing).toHaveBeenCalledOnce();
    });

    it("collects multiple defects from multiple throwing finalizers", async () => {
        const scope = Scope();
        scope.defer(() => { throw new Error("a"); });
        scope.defer(() => { throw new Error("b"); });
        const defects = await scope.dispose();
        expect(defects).toHaveLength(2);
    });
});

// ---------------------------------------------------------------------------
// Scope.acquire — resource integration
// ---------------------------------------------------------------------------

describe("Scope.acquire", () => {
    it("calls resource.acquire() and returns the value", async () => {
        const scope = Scope();
        const acquireFn = vi.fn(async () => "db");
        const releaseFn = vi.fn(async () => {});
        const r = Resource(acquireFn, releaseFn);

        const result = await scope.acquire(r);
        expect(result).toBe("db");
        expect(acquireFn).toHaveBeenCalledOnce();
    });

    it("registers resource.release() as a defer finalizer", async () => {
        const scope = Scope();
        const releaseFn = vi.fn(async (_: string) => {});
        const r = Resource(async () => "connection", releaseFn);

        await scope.acquire(r);
        expect(releaseFn).not.toHaveBeenCalled();

        await scope.dispose();
        expect(releaseFn).toHaveBeenCalledWith("connection");
    });

    it("release runs after explicit defer finalizers registered after acquire (LIFO)", async () => {
        const scope = Scope();
        const order: string[] = [];

        const r = Resource(async () => "res", async () => { order.push("release"); });
        await scope.acquire(r);
        scope.defer(() => { order.push("after"); });

        await scope.dispose();
        expect(order).toEqual(["after", "release"]);
    });
});

// ---------------------------------------------------------------------------
// Symbol.asyncDispose
// ---------------------------------------------------------------------------

describe("Scope[Symbol.asyncDispose]", () => {
    it("disposes cleanly without warnings for a clean scope", async () => {
        const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
        const scope = Scope();
        scope.defer(() => {});
        await scope[Symbol.asyncDispose]();
        expect(warnSpy).not.toHaveBeenCalled();
        warnSpy.mockRestore();
    });

    it("warns for each defect from a throwing finalizer", async () => {
        const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
        const scope = Scope();
        scope.defer(() => { throw new Error("finalizer panic"); });
        await scope[Symbol.asyncDispose]();
        expect(warnSpy).toHaveBeenCalledOnce();
        warnSpy.mockRestore();
    });
});

// ---------------------------------------------------------------------------
// catchDefect option
// ---------------------------------------------------------------------------

describe("Scope — catchDefect option", () => {
    it("direct dispose() returns defects without calling catchDefect", async () => {
        const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
        const catchDefect = vi.fn();

        const scope = Scope({ catchDefect });
        scope.defer(() => { throw new Error("direct defect"); });

        const defects = await scope.dispose();
        expect(defects).toHaveLength(1);
        // Direct disposal returns defects to the caller — catchDefect is NOT invoked
        expect(catchDefect).not.toHaveBeenCalled();
        expect(warnSpy).not.toHaveBeenCalled();

        warnSpy.mockRestore();
    });

    it("cascade path routes defects to catchDefect instead of console.warn", async () => {
        const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
        const catchDefect = vi.fn();

        // Create a parent computation; Scope() auto-parents to getCurrentComputation().
        const parent = createOwner(null);
        trackIn(parent, () => {
            const scope = Scope({ catchDefect });
            scope.defer(() => { throw new Error("cascade defect"); });
        });

        // Disposing the parent fires all child computation cleanups, which triggers
        // the Scope's cascade disposal (fire-and-forget path → catchDefect).
        parent.dispose();

        // Cascade is async — let the promise chain settle.
        await new Promise(r => setTimeout(r, 0));

        expect(catchDefect).toHaveBeenCalledOnce();
        expect(warnSpy).not.toHaveBeenCalled();
        warnSpy.mockRestore();
    });

    it("cascade path uses console.warn when no catchDefect is provided", async () => {
        const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

        const parent = createOwner(null);
        trackIn(parent, () => {
            const scope = Scope(); // no catchDefect
            scope.defer(() => { throw new Error("warn defect"); });
        });

        parent.dispose();
        await new Promise(r => setTimeout(r, 0));

        expect(warnSpy).toHaveBeenCalledOnce();
        warnSpy.mockRestore();
    });
});

// ---------------------------------------------------------------------------
// runInScope / getCurrentScope
// ---------------------------------------------------------------------------

describe("runInScope / getCurrentScope", () => {
    it("getCurrentScope returns null outside any scope", () => {
        expect(getCurrentScope()).toBeNull();
    });

    it("getCurrentScope returns the active scope inside runInScope", () => {
        const scope = Scope();
        let captured: ScopeHandle | null = null;
        runInScope(scope, () => {
            captured = getCurrentScope();
        });
        expect(captured).toBe(scope);
    });

    it("getCurrentScope returns null again after runInScope exits", () => {
        const scope = Scope();
        runInScope(scope, () => {});
        expect(getCurrentScope()).toBeNull();
    });

    it("restores the outer scope when runInScope is nested", () => {
        const outer = Scope();
        const inner = Scope();
        let duringInner: ScopeHandle | null = null;
        let afterInner: ScopeHandle | null = null;

        runInScope(outer, () => {
            runInScope(inner, () => {
                duringInner = getCurrentScope();
            });
            afterInner = getCurrentScope();
        });

        expect(duringInner).toBe(inner);
        expect(afterInner).toBe(outer);
    });
});

// ---------------------------------------------------------------------------
// Implicit defer() and acquire()
// ---------------------------------------------------------------------------

describe("implicit defer()", () => {
    it("throws when called outside a scope context", () => {
        expect(() => defer(() => {})).toThrow(/defer\(\) called outside/);
    });

    it("delegates to the ambient scope inside runInScope", async () => {
        const scope = Scope();
        const fn = vi.fn();
        runInScope(scope, () => {
            defer(fn);
        });
        await scope.dispose();
        expect(fn).toHaveBeenCalledOnce();
    });
});

describe("implicit acquire()", () => {
    it("throws when called outside a scope context", () => {
        const r = Resource(async () => "x", async () => {});
        expect(() => acquire(r)).toThrow(/acquire\(\) called outside/);
    });

    it("delegates to the ambient scope inside runInScope", async () => {
        const scope = Scope();
        const releaseFn = vi.fn(async () => {});
        const r = Resource(async () => "val", releaseFn);

        let result: string | undefined;
        runInScope(scope, () => {
            void acquire(r).then(v => { result = v; });
        });

        // Give the async acquire a tick to settle
        await new Promise(resolve => setTimeout(resolve, 0));
        expect(result).toBe("val");

        await scope.dispose();
        expect(releaseFn).toHaveBeenCalledOnce();
    });
});
