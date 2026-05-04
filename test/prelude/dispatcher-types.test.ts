import { describe, it, expectTypeOf } from "vitest";
import { Dispatcher, type ApplyResult } from "../../src/prelude/dispatcher.ts";
import { CommandError } from "../../src/prelude/command-error.ts";
import { Validation } from "../../src/prelude/validation.ts";
import { union, type Union } from "../../src/union.ts";
import { match } from "../../src/match.ts";

const Counter = union({
    Increment: () => ({}),
    Decrement: () => ({}),
});
type CounterCmd = Union<typeof Counter>;

const counterProtocol = {
    extract: (n: number) => n,
    apply: (current: number, cmd: CounterCmd) =>
        match(cmd, {
            Increment: () =>
                Validation.Valid<{ next: number; inverse: CounterCmd }, CommandError>({
                    next: current + 1,
                    inverse: Counter.Decrement(),
                }),
            Decrement: () =>
                Validation.Valid<{ next: number; inverse: CounterCmd }, CommandError>({
                    next: current - 1,
                    inverse: Counter.Increment(),
                }),
        }),
};

describe("Dispatcher type inference", () => {
    it("infers Cmd from the protocol's apply signature", () => {
        const d = Dispatcher.create(0, counterProtocol);
        // dispatch's parameter must accept CounterCmd specifically
        expectTypeOf(d.dispatch).parameter(0).toEqualTypeOf<CounterCmd>();
    });

    it("dispatch returns Validation<ApplyResult<S, Cmd>, CommandError> with concrete generics", () => {
        const d = Dispatcher.create(0, counterProtocol);
        const r = d.dispatch(Counter.Increment());
        expectTypeOf(r).toEqualTypeOf<
            Validation<ApplyResult<number, CounterCmd>, CommandError>
        >();
    });

    it("state() returns S as inferred from the initial value", () => {
        const d = Dispatcher.create(0, counterProtocol);
        expectTypeOf(d.state()).toEqualTypeOf<number>();
    });

    it("get() returns T | null where T is the protocol's extract return", () => {
        const d = Dispatcher.create(0, counterProtocol);
        expectTypeOf(d.get()).toEqualTypeOf<number | null>();
    });
});
