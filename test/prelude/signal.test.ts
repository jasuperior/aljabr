import { describe, expect, it, expectTypeOf } from "vitest";
import {
    Signal,
    SignalState,
    type Active,
    type SignalState as SignalStateType,
    type SignalProtocol,
} from "../../src/prelude/signal";
import {
    Validation,
    type Validation as ValidationType,
} from "../../src/prelude/validation";
import { match } from "../../src/match";
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
    it("read() notifies a subscriber when set() is called", async () => {
        const { createOwner, trackIn } = await import(
            "../../src/prelude/context"
        );
        const s = Signal.create(1);
        let dirty = false;
        const comp = createOwner(null);
        comp.dirty = () => { dirty = true; };
        trackIn(comp, () => s.read());
        s.set(2);
        expect(dirty).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// Signal<T, S> — custom state union
// ---------------------------------------------------------------------------

const validationProtocol: SignalProtocol<ValidationType<string, string>, string> = {
    extract: (state) => match(state, {
        Unvalidated: () => null,
        Valid:       ({ value }) => value,
        Invalid:     () => null,
    }),
};

// Convenience factory — widens initial state to the full union type so
// TypeScript infers S = Validation<string, string> rather than Unvalidated.
const makeField = () =>
    Signal.create(
        Validation.Unvalidated() as ValidationType<string, string>,
        validationProtocol,
    );

describe("Signal.create with custom protocol", () => {
    it("starts with the provided initial state", () => {
        const s = makeField();
        expect(getTag(s.state)).toBe("Unvalidated");
    });
    it("get() extracts via protocol — returns null for Unvalidated", () => {
        const s = makeField();
        expect(s.get()).toBeNull();
    });
    it("set() accepts full variants", () => {
        const s = makeField();
        s.set(Validation.Valid("hello@example.com"));
        expect(getTag(s.state)).toBe("Valid");
        expect(s.get()).toBe("hello@example.com");
    });
    it("get() returns null for Invalid even after set()", () => {
        const s = makeField();
        s.set(Validation.Invalid(["bad format"]));
        expect(s.get()).toBeNull();
    });
    it("peek() returns extracted value without tracking", () => {
        const s = makeField();
        s.set(Validation.Valid("test"));
        expect(s.peek()).toBe("test");
    });
    it("dispose() makes set() a no-op", () => {
        const s = makeField();
        s.dispose();
        s.set(Validation.Valid("after-dispose"));
        expect(getTag(s.state)).toBe("Unvalidated");
    });
    it("isTerminal stops notifications when the terminal state is set", async () => {
        const { createOwner, trackIn } = await import("../../src/prelude/context");
        const terminalProtocol: SignalProtocol<ValidationType<string, string>, string> = {
            extract: (state) => match(state, {
                Unvalidated: () => null,
                Valid:       ({ value }) => value,
                Invalid:     () => null,
            }),
            isTerminal: (state) => getTag(state) === "Invalid",
        };
        const s = Signal.create(
            Validation.Unvalidated() as ValidationType<string, string>,
            terminalProtocol,
        );
        let notifyCount = 0;
        const comp = createOwner(null);
        comp.dirty = () => { notifyCount++; };
        trackIn(comp, () => s.get());
        s.set(Validation.Invalid(["error"]));
        expect(notifyCount).toBe(0); // terminal — subscribers cleared, no notification
        s.set(Validation.Valid("too late"));
        expect(getTag(s.state)).toBe("Invalid"); // state frozen after terminal
    });
});

describe("Signal<T, S> read()", () => {
    it("returns the full state union (tracked)", async () => {
        const { createOwner, trackIn } = await import("../../src/prelude/context");
        const s = makeField();
        let dirty = false;
        const comp = createOwner(null);
        comp.dirty = () => { dirty = true; };
        trackIn(comp, () => s.read());
        s.set(Validation.Invalid(["required"]));
        expect(dirty).toBe(true);
        const errors = match(s.state, {
            Unvalidated: () => [] as string[],
            Valid:       () => [] as string[],
            Invalid:     ({ errors }) => errors,
        });
        expect(errors).toEqual(["required"]);
    });
});

describe("Signal<T>.read() — default signal", () => {
    it("returns SignalState<T> and registers a dependency", async () => {
        const { createOwner, trackIn } = await import("../../src/prelude/context");
        const s = Signal.create(42);
        let dirty = false;
        const comp = createOwner(null);
        comp.dirty = () => { dirty = true; };
        trackIn(comp, () => s.read());
        s.set(99);
        expect(dirty).toBe(true);
        expect(getTag(s.read())).toBe("Active");
        expectTypeOf(s.read()).toExtend<SignalStateType<number>>();
    });
});
