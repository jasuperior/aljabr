import { describe, it, expect, vi } from "vitest";
import { Dispatcher } from "../../src/prelude/dispatcher.ts";
import { CommandError } from "../../src/prelude/command-error.ts";
import { Validation } from "../../src/prelude/validation.ts";
import { watchEffect } from "../../src/prelude/effect.ts";
import { union, getTag, type Union } from "../../src/union.ts";
import { match } from "../../src/match.ts";

const settle = () => new Promise<void>((r) => setTimeout(r, 0));

const Counter = union({
    Increment: () => ({}),
    Decrement: () => ({}),
    Set: (n: number) => ({ n }),
    Reject: () => ({}),
});
type CounterCmd = Union<typeof Counter>;

const counterProtocol = {
    extract: (n: number) => n,
    apply: (current: number, cmd: CounterCmd) =>
        match(cmd, {
            Increment: () =>
                Validation.Valid<
                    { next: number; inverse: CounterCmd },
                    CommandError
                >({
                    next: current + 1,
                    inverse: Counter.Decrement(),
                }),
            Decrement: () =>
                Validation.Valid<
                    { next: number; inverse: CounterCmd },
                    CommandError
                >({
                    next: current - 1,
                    inverse: Counter.Increment(),
                }),
            Set: ({ n }) =>
                Validation.Valid<
                    { next: number; inverse: CounterCmd },
                    CommandError
                >({
                    next: n,
                    inverse: Counter.Set(current),
                }),
            Reject: () =>
                Validation.Invalid<
                    { next: number; inverse: CounterCmd },
                    CommandError
                >([CommandError.Rejected("nope")]),
        }),
};

describe("Dispatcher.create", () => {
    it("creates a dispatcher with the initial state", () => {
        const d = Dispatcher.create(0, counterProtocol);
        expect(d.peekState()).toBe(0);
        expect(d.get()).toBe(0);
    });
});

describe("dispatch — Valid", () => {
    it("updates state to result.next", () => {
        const d = Dispatcher.create(0, counterProtocol);
        d.dispatch(Counter.Increment());
        expect(d.peekState()).toBe(1);
        d.dispatch(Counter.Set(42));
        expect(d.peekState()).toBe(42);
    });

    it("returns the Validation result with the inverse", () => {
        const d = Dispatcher.create(0, counterProtocol);
        const result = d.dispatch(Counter.Increment());
        match(result, {
            Valid: ({ value: { next, inverse } }) => {
                expect(next).toBe(1);
                expect(getTag(inverse)).toBe("Decrement");
            },
            Invalid: () => expect.fail("expected Valid"),
            Unvalidated: () => expect.fail("expected Valid"),
        });
    });

    it("notifies dependents", async () => {
        const d = Dispatcher.create(0, counterProtocol);
        const seen: string[] = [];
        const handle = watchEffect(
            async () => d.get() ?? 0,
            (result) => {
                seen.push(getTag(result));
            },
        );
        await settle();
        d.dispatch(Counter.Increment());
        expect(seen).toContain("Stale");
        handle.stop();
    });
});

describe("dispatch — Invalid", () => {
    it("does not change state on rejection", () => {
        const d = Dispatcher.create(5, counterProtocol);
        d.dispatch(Counter.Reject());
        expect(d.peekState()).toBe(5);
    });

    it("does not notify dependents on rejection", async () => {
        const d = Dispatcher.create(0, counterProtocol);
        const cb = vi.fn();
        const handle = watchEffect(async () => d.get() ?? 0, cb);
        await settle();
        cb.mockClear();
        d.dispatch(Counter.Reject());
        expect(cb).not.toHaveBeenCalled();
        handle.stop();
    });

    it("returns the Invalid validation with errors", () => {
        const d = Dispatcher.create(0, counterProtocol);
        const result = d.dispatch(Counter.Reject());
        match(result, {
            Invalid: ({ errors }) => {
                expect(errors.length).toBe(1);
                expect(getTag(errors[0])).toBe("Rejected");
            },
            Valid: () => expect.fail("expected Invalid"),
            Unvalidated: () => expect.fail("expected Invalid"),
        });
    });
});

describe("inverse round-trip", () => {
    it("dispatch then dispatch(inverse) returns to original state", () => {
        const d = Dispatcher.create(10, counterProtocol);
        const result = d.dispatch(Counter.Set(99));
        expect(d.peekState()).toBe(99);
        match(result, {
            Valid: ({ value: { inverse } }) => {
                d.dispatch(inverse);
                expect(d.peekState()).toBe(10);
            },
            Invalid: () => expect.fail("expected Valid"),
            Unvalidated: () => expect.fail("expected Valid"),
        });
    });
});

describe("tracked vs untracked reads", () => {
    it("peekState does not register a dependency", async () => {
        const d = Dispatcher.create(0, counterProtocol);
        const cb = vi.fn();
        const handle = watchEffect(async () => {
            d.peekState();
            return 0;
        }, cb);
        await settle();
        cb.mockClear();
        d.dispatch(Counter.Increment());
        expect(cb).not.toHaveBeenCalled();
        handle.stop();
    });

    it("state() registers a dependency", async () => {
        const d = Dispatcher.create(0, counterProtocol);
        const seen: string[] = [];
        const handle = watchEffect(
            async () => {
                d.state();
                return 0;
            },
            (result) => seen.push(getTag(result)),
        );
        await settle();
        seen.length = 0;
        d.dispatch(Counter.Increment());
        expect(seen).toContain("Stale");
        handle.stop();
    });
});

describe("isTerminal", () => {
    it("disposes the dispatcher when isTerminal returns true", () => {
        const Term = union({
            Bump: () => ({}),
            Stop: () => ({}),
        });
        type TermCmd = Union<typeof Term>;
        type State = { value: number; done: boolean };

        const d = Dispatcher.create<number, State, TermCmd>(
            { value: 0, done: false },
            {
                extract: (s) => s.value,
                isTerminal: (s) => s.done,
                apply: (current, cmd) =>
                    match(cmd, {
                        Bump: () =>
                            Validation.Valid<
                                { next: State; inverse: TermCmd },
                                CommandError
                            >({
                                next: { value: current.value + 1, done: false },
                                inverse: Term.Bump(),
                            }),
                        Stop: () =>
                            Validation.Valid<
                                { next: State; inverse: TermCmd },
                                CommandError
                            >({
                                next: { value: current.value, done: true },
                                inverse: Term.Stop(),
                            }),
                    }),
            },
        );

        d.dispatch(Term.Bump());
        d.dispatch(Term.Stop());
        // After terminal state, the dispatcher is disposed.
        expect(() => d.dispatch(Term.Bump())).toThrow();
    });
});

describe("disposal", () => {
    it("dispatch on a disposed dispatcher throws", () => {
        const d = Dispatcher.create(0, counterProtocol);
        d.dispose();
        expect(() => d.dispatch(Counter.Increment())).toThrow();
    });
});

describe("Dispatcher.peek and getOr (v0.3.10 Phase 5)", () => {
    it("peek() returns the extracted value untracked", () => {
        const d = Dispatcher.create<number, number, number>(5, {
            extract: (s) => s,
            apply: (current, cmd) =>
                Validation.Valid({ next: cmd, inverse: current }),
        });
        expect(d.peek()).toBe(5);
    });

    it("getOr returns the value when extracted is non-null", () => {
        const d = Dispatcher.create<number, number, number>(5, {
            extract: (s) => s,
            apply: (current, cmd) =>
                Validation.Valid({ next: cmd, inverse: current }),
        });
        expect(d.getOr(0)).toBe(5);
    });

    it("getOr returns the default when extract yields null", () => {
        const d = Dispatcher.create<number, number | null, number>(null, {
            extract: (s) => s,
            apply: (current, cmd) =>
                Validation.Valid({ next: cmd, inverse: current ?? 0 }),
        });
        expect(d.getOr(99)).toBe(99);
    });
});

describe("Dispatcher.subscribe (v0.3.10 Phase 5)", () => {
    it("fires on successful dispatch with extracted value", () => {
        const d = Dispatcher.create<number, number, number>(0, {
            extract: (s) => s,
            apply: (current, cmd) =>
                Validation.Valid({ next: cmd, inverse: current }),
        });
        const seen: number[] = [];
        d.subscribe((v) => { if (v !== null) seen.push(v); });
        d.dispatch(5);
        d.dispatch(7);
        expect(seen).toEqual([5, 7]);
    });

    it("does not fire on rejected dispatch", () => {
        const d = Dispatcher.create<number, number, number>(0, {
            extract: (s) => s,
            apply: () =>
                Validation.Invalid([CommandError.Rejected("nope")]),
        });
        let count = 0;
        d.subscribe(() => { count++; });
        d.dispatch(5);
        expect(count).toBe(0);
    });

    it("fires with null on dispose", () => {
        const d = Dispatcher.create<number, number, number>(0, {
            extract: (s) => s,
            apply: (current, cmd) =>
                Validation.Valid({ next: cmd, inverse: current }),
        });
        let lastValue: number | null = -1;
        d.subscribe((v) => { lastValue = v; });
        d.dispose();
        expect(lastValue).toBeNull();
    });
});

describe("Dispatcher Symbol.dispose (v0.3.10 Phase 5)", () => {
    it("Symbol.dispose disposes the dispatcher", () => {
        const d = Dispatcher.create<number, number, number>(0, {
            extract: (s) => s,
            apply: (current, cmd) =>
                Validation.Valid({ next: cmd, inverse: current }),
        });
        d[Symbol.dispose]();
        expect(() => d.dispatch(1)).toThrow(/disposed/);
    });
});
