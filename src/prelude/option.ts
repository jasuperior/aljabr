import { union, getTag, type Variant } from "../union.ts";
import { match } from "../match.ts";
import { Result } from "./result.ts";
import { Bindable } from "./traits.ts";

type AllValues<Os extends readonly Option<unknown>[]> = {
    [K in keyof Os]: Os[K] extends Option<infer T> ? T : never;
};

export abstract class Mappable<T> extends Bindable<T> {
    map<U>(fn: (value: T) => U): Option<U> {
        return match(this as unknown as Option<T>, {
            Some: ({ value }) => Option.Some(fn(value)),
            None: () => Option.None(),
        }) as Option<U>;
    }

    flatMap<U>(fn: (value: T) => Option<U>): Option<U> {
        return match(this as unknown as Option<T>, {
            Some: ({ value }) => fn(value),
            None: () => Option.None(),
        }) as Option<U>;
    }

    getOr(defaultValue: T): T {
        return match(this as unknown as Option<T>, {
            Some: ({ value }) => value,
            None: () => defaultValue,
        });
    }

    /** @deprecated Use {@link getOr} instead. Removed in a future release. */
    getOrElse(defaultValue: T): T {
        return this.getOr(defaultValue);
    }

    toResult<E>(error: () => Promise<E>): Result<T, E>;
    toResult<E>(error: () => E): Result<T, E>;
    toResult<E>(error: E): Result<T, E>;
    toResult<E>(error: E | (() => E) | (() => Promise<E>)): Result<T, E> {
        return match(this as unknown as Option<T>, {
            Some: ({ value }) => Result.Accept(value),
            None: () => {
                const e =
                    typeof error === "function"
                        ? (error as () => E | Promise<E>)()
                        : (error as E);
                return e != null &&
                    typeof e === "object" &&
                    "then" in (e as object)
                    ? Result.Expect<T, E>(
                          (e as PromiseLike<E>).then<T>((v) => {
                              throw v;
                          }),
                      )
                    : Result.Reject(e as E);
            },
        });
    }
}

export type Some<T> = Variant<"Some", { value: T }, Mappable<T>>;
export type None<T = never> = Variant<"None", { value: null }, Mappable<T>>;
export type Option<T> = Some<T> | None<T>;

export const Option = Object.assign(
    union([Mappable]).typed({
        Some: <T>(value: T) => ({ value }) as Some<T>,
        None: <T = never>() => ({ value: null }) as None<T>,
    }),
    {
        /**
         * Aggregate an array of Options. Returns `Some([...])` only if every
         * element is `Some`; otherwise `None`.
         *
         * Fail-fast: stops scanning at the first `None`.
         */
        all<Os extends readonly Option<unknown>[]>(
            options: readonly [...Os],
        ): Option<AllValues<Os>> {
            const values: unknown[] = [];
            for (const opt of options) {
                if (getTag(opt) === "None") {
                    return Option.None() as Option<AllValues<Os>>;
                }
                values.push((opt as { value: unknown }).value);
            }
            return Option.Some(values) as Option<AllValues<Os>>;
        },
    },
);
