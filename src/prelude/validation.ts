import { union, Trait, type Variant } from "../union.ts";
import { match } from "../match.ts";
import { Result } from "./result.ts";

export abstract class Combinable<T, E> extends Trait<{ value: unknown }>() {
    map<U>(fn: (value: T) => U): Validation<U, E> {
        return match(this as unknown as Validation<T, E>, {
            Unvalidated: () => Validation.Unvalidated(),
            Valid: ({ value }) => Validation.Valid(fn(value)),
            Invalid: ({ errors }) => Validation.Invalid(errors),
        }) as Validation<U, E>;
    }

    combine<U>(other: Validation<U, E>): Validation<[T, U], E> {
        return match(this as unknown as Validation<T, E>, {
            Unvalidated: () => Validation.Unvalidated(),
            Valid: ({ value: a }) =>
                match(other, {
                    Unvalidated: () => Validation.Unvalidated(),
                    Valid: ({ value: b }) =>
                        Validation.Valid([a, b] as [T, U]),
                    Invalid: ({ errors }) => Validation.Invalid(errors),
                }),
            Invalid: ({ errors: ae }) =>
                match(other, {
                    Unvalidated: () => Validation.Unvalidated(),
                    Valid: () => Validation.Invalid(ae),
                    Invalid: ({ errors: be }) =>
                        Validation.Invalid([...ae, ...be] as E[]),
                }),
        }) as Validation<[T, U], E>;
    }

    toResult(): Result<T, E[]> {
        return match(this as unknown as Validation<T, E>, {
            Unvalidated: () => Result.Reject([] as E[]),
            Valid: ({ value }) => Result.Accept(value),
            Invalid: ({ errors }) => Result.Reject(errors),
        });
    }
}

export type Unvalidated<T, E> = Variant<
    "Unvalidated",
    { value: null },
    Combinable<T, E>
>;
export type Valid<T, E> = Variant<"Valid", { value: T }, Combinable<T, E>>;
export type Invalid<T, E> = Variant<
    "Invalid",
    { errors: E[]; value: null },
    Combinable<T, E>
>;
export type Validation<T, E> = Unvalidated<T, E> | Valid<T, E> | Invalid<T, E>;

export const Validation = union([Combinable]).typed({
    Unvalidated: <T, E>() => ({ value: null }) as Unvalidated<T, E>,
    Valid: <T, E>(value: T) => ({ value }) as Valid<T, E>,
    Invalid: <T, E>(errors: E[]) => ({ errors, value: null }) as Invalid<T, E>,
});
