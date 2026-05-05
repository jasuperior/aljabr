import { union, Trait, type Variant } from "../union.ts";
import { match } from "../match.ts";
import { Result } from "./result.ts";
import type { Bindable, Reducible } from "./traits.ts";

type CombineValues<A, B> = A extends readonly unknown[] ? [...A, B] : [A, B]

type AllValues<Vs extends readonly Validation<unknown, unknown>[]> = {
    [K in keyof Vs]: Vs[K] extends Validation<infer T, unknown> ? T : never
}

type AllError<Vs extends readonly Validation<unknown, unknown>[]> =
    Vs[number] extends Validation<unknown, infer E> ? E : never

export abstract class Combinable<T, E>
    extends Trait<{ value: T }>
    implements Bindable<T>, Reducible<T>
{
    map<U>(fn: (value: T) => U): Validation<U, E> {
        return match(this as unknown as Validation<T, E>, {
            Unvalidated: () => Validation.Unvalidated(),
            Valid: ({ value }) => Validation.Valid(fn(value)),
            Invalid: ({ errors }) => Validation.Invalid(errors),
        }) as Validation<U, E>;
    }

    /**
     * Chain a Validation-producing computation. The inner `Validation<U, F>`
     * may widen the error channel — final type is `Validation<U, E | F>`.
     */
    flatMap<U, F>(
        fn: (value: T) => Validation<U, F>,
    ): Validation<U, E | F> {
        return match(this as unknown as Validation<T, E>, {
            Unvalidated: () => Validation.Unvalidated(),
            Valid: ({ value }) => fn(value),
            Invalid: ({ errors }) =>
                Validation.Invalid(errors as unknown as (E | F)[]),
        }) as Validation<U, E | F>;
    }

    /**
     * Return the value on `Valid`, else `defaultValue`. The default's type
     * is independent of `T` to allow widening on unions where one branch
     * may carry `T = never`.
     */
    getOr<U = T>(defaultValue: U): T | U {
        return match(this as unknown as Validation<T, E>, {
            Unvalidated: () => defaultValue as T | U,
            Valid: ({ value }) => value as T | U,
            Invalid: () => defaultValue as T | U,
        });
    }

    combine<U>(other: Validation<U, E>): Validation<CombineValues<T, U>, E> {
        return match(this as unknown as Validation<T, E>, {
            Unvalidated: () => Validation.Unvalidated(),
            Valid: ({ value: a }) =>
                match(other, {
                    Unvalidated: () => Validation.Unvalidated(),
                    Valid: ({ value: b }) =>
                        Validation.Valid(
                            (Array.isArray(a)
                                ? [...(a as unknown[]), b]
                                : [a, b]) as CombineValues<T, U>,
                        ),
                    Invalid: ({ errors }) => Validation.Invalid(errors),
                }),
            Invalid: ({ errors: ae }) =>
                match(other, {
                    Unvalidated: () => Validation.Unvalidated(),
                    Valid: () => Validation.Invalid(ae),
                    Invalid: ({ errors: be }) =>
                        Validation.Invalid([...ae, ...be] as E[]),
                }),
        }) as Validation<CombineValues<T, U>, E>;
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
    { value: null; errors?: never },
    Combinable<T, E>
>;
export type Valid<T, E> = Variant<"Valid", { value: T; errors?: never }, Combinable<T, E>>;
export type Invalid<T, E> = Variant<
    "Invalid",
    { errors: E[]; value: null },
    Combinable<T, E>
>;
export type Validation<T, E> = Unvalidated<T, E> | Valid<T, E> | Invalid<T, E>;

export const Validation = Object.assign(
    union([Combinable]).typed({
        Unvalidated: <T, E>() => ({ value: null }) as Unvalidated<T, E>,
        Valid: <T, E>(value: T) => ({ value }) as Valid<T, E>,
        Invalid: <T, E>(errors: E[]) =>
            ({ errors, value: null }) as Invalid<T, E>,
    }),
    {
        all<Vs extends readonly Validation<unknown, unknown>[]>(
            validations: readonly [...Vs],
        ): Validation<AllValues<Vs>, AllError<Vs>> {
            const errors: AllError<Vs>[] = [];
            const values: unknown[] = [];
            for (const v of validations) {
                const state = match(v as Validation<unknown, AllError<Vs>>, {
                    Unvalidated: () => "unvalidated" as const,
                    Valid: ({ value }) => {
                        values.push(value);
                        return "valid" as const;
                    },
                    Invalid: ({ errors: es }) => {
                        errors.push(...(es as AllError<Vs>[]));
                        return "invalid" as const;
                    },
                });
                if (state === "unvalidated") return Validation.Unvalidated();
            }
            if (errors.length > 0) return Validation.Invalid(errors);
            return Validation.Valid(values as AllValues<Vs>);
        },
    },
);
