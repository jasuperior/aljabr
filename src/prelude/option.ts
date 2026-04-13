import { union, Trait, type Variant } from "../union.ts";
import { match } from "../match.ts";
import { Result } from "./result.ts";

export abstract class Mappable<T> extends Trait<{ value: unknown }> {
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

    getOrElse(defaultValue: T): T {
        return match(this as unknown as Option<T>, {
            Some: ({ value }) => value,
            None: () => defaultValue,
        });
    }

    toResult<E>(error: E): Result<T, E> {
        return match(this as unknown as Option<T>, {
            Some: ({ value }) => Result.Accept(value),
            None: () => Result.Reject(error),
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
