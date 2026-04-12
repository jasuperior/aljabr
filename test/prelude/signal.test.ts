import { describe, expect, it, expectTypeOf } from "vitest";
import {
    Signal,
    SignalState,
    type Active,
    type SignalState as SignalStateType,
} from "../../src/prelude/signal";
import { getTag } from "../../src/union";

// ---------------------------------------------------------------------------
// SignalState — immutable lifecycle union
// ---------------------------------------------------------------------------

describe("SignalState factory", () => {
    it("Unset has null value", () => {
        const s = SignalState.Unset();
        expect(getTag(s)).toBe("Unset");
        expect(s.value).toBeNull();
    });
    it("Active carries the value", () => {
        const s = SignalState.Active(42);
        expect(getTag(s)).toBe("Active");
        expect(s.value).toBe(42);
    });
    it("Disposed has null value", () => {
        const s = SignalState.Disposed();
        expect(getTag(s)).toBe("Disposed");
        expect(s.value).toBeNull();
    });
    it("Active preserves value type", () => {
        const s = SignalState.Active("hello");
        expectTypeOf(s).toExtend<Active<string>>();
        expectTypeOf(s.value).toEqualTypeOf<string>();
    });
});

describe("SignalState.isActive", () => {
    it("returns true for Active", () => {
        expect(SignalState.Active(1).isActive()).toBe(true);
    });
    it("returns false for Unset", () => {
        expect(SignalState.Unset().isActive()).toBe(false);
    });
    it("returns false for Disposed", () => {
        expect(SignalState.Disposed().isActive()).toBe(false);
    });
});

describe("SignalState.get", () => {
    it("returns the value for Active", () => {
        expect(SignalState.Active(99).get()).toBe(99);
    });
    it("returns null for Unset", () => {
        expect(SignalState.Unset().get()).toBeNull();
    });
    it("returns null for Disposed", () => {
        expect(SignalState.Disposed().get()).toBeNull();
    });
    it("get return type reflects generic parameter", () => {
        const s = SignalState.Active("x");
        expectTypeOf(s.get()).toEqualTypeOf<string | null>();
    });
    it("lifecycle works through SignalState<T> union", () => {
        const s: SignalStateType<number> = SignalState.Active(7);
        expect(s.isActive()).toBe(true);
        expect(s.get()).toBe(7);
    });
});

// ---------------------------------------------------------------------------
// Signal<T> — reactive mutable container
// ---------------------------------------------------------------------------

describe("Signal.create", () => {
    it("starts Unset when created with no argument", () => {
        const s = Signal.create<number>();
        expect(getTag(s.state)).toBe("Unset");
    });
    it("starts Active when created with an initial value", () => {
        const s = Signal.create(42);
        expect(getTag(s.state)).toBe("Active");
        expect(s.peek()).toBe(42);
    });
});

describe("Signal.set / Signal.peek", () => {
    it("set transitions Unset to Active", () => {
        const s = Signal.create<number>();
        s.set(10);
        expect(getTag(s.state)).toBe("Active");
        expect(s.peek()).toBe(10);
    });
    it("set updates an already-Active signal", () => {
        const s = Signal.create(1);
        s.set(2);
        expect(s.peek()).toBe(2);
    });
    it("set is a no-op after disposal", () => {
        const s = Signal.create(1);
        s.dispose();
        s.set(99);
        expect(s.peek()).toBeNull();
        expect(getTag(s.state)).toBe("Disposed");
    });
});

describe("Signal.dispose", () => {
    it("transitions to Disposed", () => {
        const s = Signal.create(1);
        s.dispose();
        expect(getTag(s.state)).toBe("Disposed");
        expect(s.peek()).toBeNull();
    });
});

describe("Signal.state", () => {
    it("is pattern-matchable via match", async () => {
        const { match } = await import("../../src/match");
        const s = Signal.create(7);
        const result = match(s.state, {
            Unset: () => "unset",
            Active: ({ value }) => `active:${value}`,
            Disposed: () => "disposed",
        });
        expect(result).toBe("active:7");
    });
});

describe("Signal reactivity", () => {
    it("get() notifies a subscriber when set() is called", async () => {
        const { createOwner, trackIn } = await import(
            "../../src/prelude/context"
        );
        const s = Signal.create(1);
        let dirty = false;
        const comp = createOwner(null);
        comp.dirty = () => { dirty = true; };
        trackIn(comp, () => s.get());
        s.set(2);
        expect(dirty).toBe(true);
    });
    it("peek() does not register a dependency", async () => {
        const { createOwner, trackIn } = await import(
            "../../src/prelude/context"
        );
        const s = Signal.create(1);
        let dirty = false;
        const comp = createOwner(null);
        comp.dirty = () => { dirty = true; };
        trackIn(comp, () => s.peek());
        s.set(2);
        expect(dirty).toBe(false);
    });
});
