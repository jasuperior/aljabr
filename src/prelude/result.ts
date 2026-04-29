import { union, Trait, type Variant } from "../union.ts";
import { match } from "../match.ts";

export abstract class Thenable<T, E = never> extends Trait<{ value: unknown }> {
    then<TResult1 = T, TResult2 = E>(
        onAccepted?:
            | ((value: T) => TResult1 | PromiseLike<TResult1>)
            | null
            | undefined,
        onRejected?:
            | ((reason: E) => TResult2 | PromiseLike<TResult2>)
            | null
            | undefined,
    ): Result<TResult1, TResult2> {
        return match(this as unknown as Result<T, E>, {
            Accept: ({ value }) => {
                try {
                    const accepted = onAccepted
                        ? onAccepted(value as T)
                        : value;
                    const isExpected =
                        accepted != null &&
                        typeof accepted === "object" &&
                        "then" in (accepted as any);
                    return isExpected
                        ? Result.Expect<TResult1, TResult2>(accepted as any)
                        : Result.Accept(accepted);
                } catch (e) {
                    const rejected: any = onRejected ? onRejected(e as E) : e;
                    const isExpected =
                        rejected != null &&
                        typeof rejected === "object" &&
                        "then" in rejected;
                    return isExpected
                        ? Result.Expect<TResult1, TResult2>(rejected)
                        : onRejected
                          ? Result.Accept(rejected)
                          : Result.Reject(rejected);
                }
            },
            Expect: ({ pending }) => {
                return Result.Expect<TResult1, TResult2>(
                    pending.then(onAccepted as any, onRejected as any),
                );
            },
            Reject: ({ error }) => {
                return onRejected
                    ? Result.Accept(onRejected(error as E))
                    : Result.Reject(error);
            },
        }) as any as Result<TResult1, TResult2>;
    }

    catch<TResult = never>(
        onRejected?:
            | ((reason: E) => TResult | PromiseLike<TResult>)
            | null
            | undefined,
    ): Result<T | TResult, never> {
        return this.then(undefined, onRejected) as Result<T | TResult, never>;
    }
}

export type Accepted<T> = Variant<"Accept", { value: T; error?: never }, Thenable<T>>;
export type Expected<T, E = never> = Variant<
    "Expect",
    { pending: PromiseLike<T>; value: null; error?: never },
    Thenable<T, E>
>;
export type Rejected<E> = Variant<
    "Reject",
    { error: E; value: null },
    Thenable<never, E>
>;

export type Result<T = unknown, E = never> =
    | Accepted<T>
    | Expected<T, E>
    | Rejected<E>;

export const Result = union([Thenable]).typed({
    Accept: <T>(value: T) => ({ value }) as Accepted<T>,
    Expect: <T, E = never>(pending: PromiseLike<T>) =>
        ({ pending, value: null }) as Expected<T, E>,
    Reject: <E>(error: E) => ({ error, value: null }) as Rejected<E>,
});
