import { describe, expect, it, vi } from "vitest";
import { Signal } from "../../src/prelude/signal";
import { Derived } from "../../src/prelude/derived";
import { batch, createOwner, trackIn, untrack } from "../../src/prelude/context";

describe("batch — signal notifications", () => {
    it("notifies once when one signal changes inside a batch", () => {
        const s = Signal.create(0);
        const comp = createOwner(null);
        const dirty = vi.fn();
        comp.dirty = dirty;
        trackIn(comp, () => s.get());

        batch(() => s.set(1));
        expect(dirty).toHaveBeenCalledTimes(1);
    });

    it("notifies once even when the same signal is set multiple times", () => {
        const s = Signal.create(0);
        const comp = createOwner(null);
        const dirty = vi.fn();
        comp.dirty = dirty;
        trackIn(comp, () => s.get());

        batch(() => {
            s.set(1);
            s.set(2);
            s.set(3);
        });
        expect(dirty).toHaveBeenCalledTimes(1);
        expect(s.peek()).toBe(3);
    });

    it("deduplicates notifications when a computation depends on two changing signals", () => {
        const a = Signal.create(0);
        const b = Signal.create(0);
        const comp = createOwner(null);
        const dirty = vi.fn();
        comp.dirty = dirty;
        trackIn(comp, () => { a.get(); b.get(); });

        batch(() => {
            a.set(1);
            b.set(1);
        });
        expect(dirty).toHaveBeenCalledTimes(1);
    });

    it("fires immediately (once) outside a batch", () => {
        const s = Signal.create(0);
        const comp = createOwner(null);
        const dirty = vi.fn();
        comp.dirty = dirty;
        trackIn(comp, () => s.get());

        s.set(1);
        s.set(2);
        expect(dirty).toHaveBeenCalledTimes(2);
    });

    it("supports nested batches — flush only on outermost exit", () => {
        const s = Signal.create(0);
        const comp = createOwner(null);
        const dirty = vi.fn();
        comp.dirty = dirty;
        trackIn(comp, () => s.get());

        batch(() => {
            batch(() => s.set(1));
            expect(dirty).not.toHaveBeenCalled(); // still inside outer batch
            s.set(2);
        });
        expect(dirty).toHaveBeenCalledTimes(1);
    });
});

describe("batch — Derived propagation", () => {
    it("marks a Derived stale exactly once when two deps change in a batch", () => {
        const a = Signal.create(1);
        const b = Signal.create(2);
        const sum = Derived.create(() => a.get()! + b.get()!);

        sum.get(); // prime it to Computed

        const comp = createOwner(null);
        const dirty = vi.fn();
        comp.dirty = dirty;
        trackIn(comp, () => sum.get());

        batch(() => {
            a.set(10);
            b.set(20);
        });

        expect(dirty).toHaveBeenCalledTimes(1);
        expect(sum.get()).toBe(30); // re-evaluates lazily on read
    });

    it("a Derived already in Stale does not re-propagate on second dirty call", () => {
        const s = Signal.create(0);
        const d = Derived.create(() => s.get()! * 2);
        d.get(); // prime

        const comp = createOwner(null);
        const dirty = vi.fn();
        comp.dirty = dirty;
        trackIn(comp, () => d.get());

        // Two rapid sets outside a batch — d goes Stale after the first,
        // second dirty call should not re-propagate downstream.
        s.set(1); // d: Computed → Stale, comp notified once
        s.set(2); // d already Stale, comp should NOT be notified again
        expect(dirty).toHaveBeenCalledTimes(1);
    });
});

// ---------------------------------------------------------------------------
// untrack
// ---------------------------------------------------------------------------

describe("untrack", () => {
    it("signal reads inside untrack do not register a dependency", () => {
        const s = Signal.create(0);
        const comp = createOwner(null);
        const dirty = vi.fn();
        comp.dirty = dirty;

        trackIn(comp, () => untrack(() => s.get()));

        s.set(1);
        expect(dirty).not.toHaveBeenCalled();
    });

    it("returns the value from the callback", () => {
        const s = Signal.create(42);
        const result = untrack(() => s.get());
        expect(result).toBe(42);
    });

    it("Signal.create inside untrack is not owned by the current computation", () => {
        const owner = createOwner(null);
        let inner: Signal<number> | null = null;

        trackIn(owner, () => {
            inner = untrack(() => Signal.create(99));
        });

        // If owned, owner.cleanups would have a dispose entry for `inner`.
        // We verify by disposing the owner and checking the inner signal still works.
        owner.dispose();
        expect(() => inner!.peek()).not.toThrow();
        expect(inner!.peek()).toBe(99); // signal is not disposed
    });

    it("the outer tracking context is restored after untrack exits", () => {
        const a = Signal.create(1);
        const b = Signal.create(2);
        const comp = createOwner(null);
        const dirty = vi.fn();
        comp.dirty = dirty;

        trackIn(comp, () => {
            untrack(() => a.get()); // a should NOT be tracked
            b.get();                // b should be tracked
        });

        a.set(10); // should NOT notify
        expect(dirty).not.toHaveBeenCalled();

        b.set(20); // should notify
        expect(dirty).toHaveBeenCalledTimes(1);
    });
});
