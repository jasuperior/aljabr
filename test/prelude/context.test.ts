import { describe, expect, it, vi } from "vitest";
import {
    getCurrentComputation,
    trackIn,
    createOwner,
    runInContext,
    untrack,
    scheduleNotification,
    batch,
    type Computation,
} from "../../src/prelude/context";

// ---------------------------------------------------------------------------
// getCurrentComputation
// ---------------------------------------------------------------------------

describe("getCurrentComputation", () => {
    it("returns null outside any tracking context", () => {
        expect(getCurrentComputation()).toBeNull();
    });

    it("returns the active computation inside trackIn", () => {
        const owner = createOwner(null);
        let captured: Computation | null = null;
        trackIn(owner, () => {
            captured = getCurrentComputation();
        });
        expect(captured).toBe(owner);
    });

    it("returns null again after trackIn exits", () => {
        const owner = createOwner(null);
        trackIn(owner, () => {});
        expect(getCurrentComputation()).toBeNull();
    });
});

// ---------------------------------------------------------------------------
// trackIn
// ---------------------------------------------------------------------------

describe("trackIn", () => {
    it("returns the value produced by fn", () => {
        const owner = createOwner(null);
        const result = trackIn(owner, () => 42);
        expect(result).toBe(42);
    });

    it("restores the previous computation after fn returns", () => {
        const outer = createOwner(null);
        const inner = createOwner(null);
        let insideInner: Computation | null = null;
        let afterInner: Computation | null = null;

        trackIn(outer, () => {
            trackIn(inner, () => {
                insideInner = getCurrentComputation();
            });
            afterInner = getCurrentComputation();
        });

        expect(insideInner).toBe(inner);
        expect(afterInner).toBe(outer);
    });

    it("restores the stack even if fn throws", () => {
        const owner = createOwner(null);
        expect(() => trackIn(owner, () => { throw new Error("boom"); })).toThrow("boom");
        expect(getCurrentComputation()).toBeNull();
    });
});

// ---------------------------------------------------------------------------
// createOwner
// ---------------------------------------------------------------------------

describe("createOwner", () => {
    it("creates a root owner with no parent when passed null", () => {
        const root = createOwner(null);
        expect(root.owner).toBeNull();
    });

    it("auto-parents to the current computation when called inside trackIn", () => {
        const parent = createOwner(null);
        let child: Computation | null = null;

        trackIn(parent, () => {
            child = createOwner();
        });

        expect(child).not.toBeNull();
        expect(child!.owner).toBe(parent);
        expect(parent.children.has(child!)).toBe(true);
    });

    it("creates a root when called outside any context with no argument", () => {
        const root = createOwner();
        expect(root.owner).toBeNull();
    });

    it("accepts an explicit parent", () => {
        const parent = createOwner(null);
        const child = createOwner(parent);
        expect(child.owner).toBe(parent);
        expect(parent.children.has(child)).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// dispose — cascading cleanup
// ---------------------------------------------------------------------------

describe("Computation.dispose", () => {
    it("removes the owner from its parent's children", () => {
        const parent = createOwner(null);
        const child = createOwner(parent);
        expect(parent.children.has(child)).toBe(true);
        child.dispose();
        expect(parent.children.has(child)).toBe(false);
    });

    it("disposes all child computations recursively", () => {
        const root = createOwner(null);
        const child = createOwner(root);
        const grandchild = createOwner(child);

        const childCleanup = vi.fn();
        const grandchildCleanup = vi.fn();
        child.cleanups.add(childCleanup);
        grandchild.cleanups.add(grandchildCleanup);

        root.dispose();

        expect(childCleanup).toHaveBeenCalledOnce();
        expect(grandchildCleanup).toHaveBeenCalledOnce();
    });

    it("runs all cleanup callbacks on dispose", () => {
        const owner = createOwner(null);
        const fn1 = vi.fn();
        const fn2 = vi.fn();
        owner.cleanups.add(fn1);
        owner.cleanups.add(fn2);

        owner.dispose();

        expect(fn1).toHaveBeenCalledOnce();
        expect(fn2).toHaveBeenCalledOnce();
    });

    it("unsubscribes from all sources", () => {
        const owner = createOwner(null);
        const unsubscribe = vi.fn();
        const fakeSource = { unsubscribe };
        owner.sources.add(fakeSource);

        owner.dispose();

        expect(unsubscribe).toHaveBeenCalledWith(owner);
        expect(owner.sources.size).toBe(0);
    });

    it("clears children and cleanups after dispose", () => {
        const owner = createOwner(null);
        const child = createOwner(owner);
        owner.cleanups.add(() => {});
        void child;

        owner.dispose();

        expect(owner.children.size).toBe(0);
        expect(owner.cleanups.size).toBe(0);
    });
});

// ---------------------------------------------------------------------------
// untrack
// ---------------------------------------------------------------------------

describe("untrack", () => {
    it("returns the value from fn", () => {
        expect(untrack(() => 99)).toBe(99);
    });

    it("suppresses the current computation — getCurrentComputation returns null inside", () => {
        const owner = createOwner(null);
        let captured: Computation | null = undefined as unknown as Computation | null;

        trackIn(owner, () => {
            untrack(() => {
                captured = getCurrentComputation();
            });
        });

        expect(captured).toBeNull();
    });

    it("restores the computation after the untrack block", () => {
        const owner = createOwner(null);
        let after: Computation | null = null;

        trackIn(owner, () => {
            untrack(() => {});
            after = getCurrentComputation();
        });

        expect(after).toBe(owner);
    });

    it("restores the computation even if fn throws", () => {
        const owner = createOwner(null);
        trackIn(owner, () => {
            expect(() => untrack(() => { throw new Error("x"); })).toThrow("x");
            expect(getCurrentComputation()).toBe(owner);
        });
    });
});

// ---------------------------------------------------------------------------
// runInContext
// ---------------------------------------------------------------------------

describe("runInContext", () => {
    it("behaves like trackIn — sets getCurrentComputation inside fn", () => {
        const owner = createOwner(null);
        let captured: Computation | null = null;
        runInContext(owner, () => {
            captured = getCurrentComputation();
        });
        expect(captured).toBe(owner);
    });

    it("returns the value from fn", () => {
        const owner = createOwner(null);
        expect(runInContext(owner, () => "hello")).toBe("hello");
    });
});

// ---------------------------------------------------------------------------
// scheduleNotification
// ---------------------------------------------------------------------------

describe("scheduleNotification", () => {
    it("calls comp.dirty() immediately outside a batch", () => {
        const owner = createOwner(null);
        owner.dirty = vi.fn();
        scheduleNotification(owner);
        expect(owner.dirty).toHaveBeenCalledOnce();
    });

    it("defers comp.dirty() inside a batch, flushing on exit", () => {
        const owner = createOwner(null);
        owner.dirty = vi.fn();

        batch(() => {
            scheduleNotification(owner);
            expect(owner.dirty).not.toHaveBeenCalled();
        });

        expect(owner.dirty).toHaveBeenCalledOnce();
    });

    it("deduplicates: scheduling the same computation twice fires dirty once", () => {
        const owner = createOwner(null);
        owner.dirty = vi.fn();

        batch(() => {
            scheduleNotification(owner);
            scheduleNotification(owner);
        });

        expect(owner.dirty).toHaveBeenCalledOnce();
    });
});

// ---------------------------------------------------------------------------
// batch
// ---------------------------------------------------------------------------

describe("batch", () => {
    it("defers all notifications until the outermost batch exits", () => {
        const a = createOwner(null);
        const b = createOwner(null);
        a.dirty = vi.fn();
        b.dirty = vi.fn();

        batch(() => {
            scheduleNotification(a);
            scheduleNotification(b);
            expect(a.dirty).not.toHaveBeenCalled();
            expect(b.dirty).not.toHaveBeenCalled();
        });

        expect(a.dirty).toHaveBeenCalledOnce();
        expect(b.dirty).toHaveBeenCalledOnce();
    });

    it("nested batches flush only when the outermost exits", () => {
        const owner = createOwner(null);
        owner.dirty = vi.fn();

        batch(() => {
            batch(() => {
                scheduleNotification(owner);
                expect(owner.dirty).not.toHaveBeenCalled();
            });
            // still inside outer batch
            expect(owner.dirty).not.toHaveBeenCalled();
        });

        expect(owner.dirty).toHaveBeenCalledOnce();
    });
});
