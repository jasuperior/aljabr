import { union, type Variant } from "../union.ts";
import { match } from "../match.ts";
import { Result } from "./result.ts";
import { Bindable } from "./traits.ts";

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

export const Option = union([Mappable]).typed({
    Some: <T>(value: T) => ({ value }) as Some<T>,
    None: <T = never>() => ({ value: null }) as None<T>,
});
