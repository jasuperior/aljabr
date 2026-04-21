import { union, Trait, type Variant } from "../union.ts";
import { match } from "../match.ts";

export abstract class Thenable<T> extends Trait<{ value: unknown }> {
    then<TResult1 = T, TResult2 = never>(
        onAccepted?:
            | ((value: T) => TResult1 | PromiseLike<TResult1>)
            | null
            | undefined,
        onRejected?:
            | ((reason: any) => TResult2 | PromiseLike<TResult2>)
            | null
            | undefined,
    ): Result<TResult1, TResult2> {
        return match(this as unknown as Result, {
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
                        ? Result.Expect(accepted as any)
                        : Result.Accept(accepted);
                } catch (e) {
                    const rejected: any = onRejected ? onRejected(e) : e;
                    const isExpected =
                        rejected != null &&
                        typeof rejected === "object" &&
                        "then" in rejected;
                    return isExpected
                        ? Result.Expect(rejected)
                        : onRejected
                          ? Result.Accept(rejected)
                          : Result.Reject(rejected);
                }
            },
            Expect: ({ pending }) => {
                return Result.Expect(
                    pending.then(onAccepted as any, onRejected as any),
                );
            },
            Reject: ({ error }) => {
                return onRejected
                    ? Result.Accept(onRejected(error))
                    : Result.Reject(error);
            },
        }) as any as Result<TResult1, TResult2>;
    }
}

export type Accepted<T> = Variant<"Accept", { value: T; error?: never }, Thenable<T>>;
export type Expected<T> = Variant<
    "Expect",
    { pending: PromiseLike<T>; value: null; error?: never },
    Thenable<T>
>;
export type Rejected<E> = Variant<
    "Reject",
    { error: E; value: null },
    Thenable<never>
>;

export type Result<T = unknown, E = never> =
    | Accepted<T>
    | Expected<T>
    | Rejected<E>;

export const Result = union([Thenable]).typed({
    Accept: <T>(value: T) => ({ value }) as Accepted<T>,
    Expect: <T>(pending: PromiseLike<T>) =>
        ({ pending, value: null }) as Expected<T>,
    Reject: <E>(error: E) => ({ error, value: null }) as Rejected<E>,
});
