import { describe, expect, it, expectTypeOf } from "vitest";
import { Signal, type Active, type Signal as SignalType } from "../../src/prelude/signal";
import { getTag } from "../../src/union";

describe("Signal factory", () => {
    it("Unset has null value", () => {
        const s = Signal.Unset();
        expect(getTag(s)).toBe("Unset");
        expect(s.value).toBeNull();
    });
    it("Active carries the value", () => {
        const s = Signal.Active(42);
        expect(getTag(s)).toBe("Active");
        expect(s.value).toBe(42);
    });
    it("Disposed has null value", () => {
        const s = Signal.Disposed();
        expect(getTag(s)).toBe("Disposed");
        expect(s.value).toBeNull();
    });
    it("Active preserves value type", () => {
        const s = Signal.Active("hello");
        expectTypeOf(s).toExtend<Active<string>>();
        expectTypeOf(s.value).toEqualTypeOf<string>();
    });
});

describe("Signal.isActive", () => {
    it("returns true for Active", () => {
        expect(Signal.Active(1).isActive()).toBe(true);
    });
    it("returns false for Unset", () => {
        expect(Signal.Unset().isActive()).toBe(false);
    });
    it("returns false for Disposed", () => {
        expect(Signal.Disposed().isActive()).toBe(false);
    });
});

describe("Signal.get", () => {
    it("returns the value for Active", () => {
        expect(Signal.Active(99).get()).toBe(99);
    });
    it("returns null for Unset", () => {
        expect(Signal.Unset().get()).toBeNull();
    });
    it("returns null for Disposed", () => {
        expect(Signal.Disposed().get()).toBeNull();
    });
    it("get return type reflects generic parameter", () => {
        const s = Signal.Active("x");
        expectTypeOf(s.get()).toEqualTypeOf<string | null>();
    });
    it("lifecycle works through Signal<T> union", () => {
        const s: SignalType<number> = Signal.Active(7);
        expect(s.isActive()).toBe(true);
        expect(s.get()).toBe(7);
    });
});
