import { union, getTag, requirements, type Variant } from "../union.ts";
import { match } from "../match.ts";
import { Bindable } from "./traits.ts";

type AllValues<Rs extends readonly Result<unknown, unknown>[]> = {
    [K in keyof Rs]: Rs[K] extends Result<infer T, unknown> ? T : never;
};

type AnyError<Rs extends readonly Result<unknown, unknown>[]> =
    Rs[number] extends Result<unknown, infer E> ? E : never;

export abstract class Thenable<T, E = never> extends Bindable<T> {
    declare readonly [requirements]: { value: unknown };

    map<U>(fn: (value: T) => U): Result<U, E> {
        return match(this as unknown as Result<T, E>, {
            Accept: ({ value }) => Result.Accept(fn(value)),
            Expect: ({ pending }) =>
                Result.Expect<U, E>(
                    (pending as PromiseLike<T>).then(fn) as PromiseLike<U>,
                ),
            Reject: ({ error }) =>
                Result.Reject(error) as unknown as Result<U, E>,
        }) as Result<U, E>;
    }

    flatMap<U>(fn: (value: T) => Result<U, E>): Result<U, E> {
        return match(this as unknown as Result<T, E>, {
            Accept: ({ value }) => fn(value),
            Expect: ({ pending }) =>
                Result.Expect<U, E>(
                    (pending as PromiseLike<T>).then((v) => {
                        const next = fn(v);
                        return match(next, {
                            Accept: ({ value }) => Promise.resolve(value),
                            Expect: ({ pending: p }) => p,
                            Reject: ({ error }) =>
                                Promise.reject(error) as Promise<U>,
                        });
                    }) as PromiseLike<U>,
                ),
            Reject: ({ error }) =>
                Result.Reject(error) as unknown as Result<U, E>,
        }) as Result<U, E>;
    }

    getOr(defaultValue: T): T {
        return match(this as unknown as Result<T, E>, {
            Accept: ({ value }) => value as T,
            Expect: () => defaultValue,
            Reject: () => defaultValue,
        });
    }

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

export const Result = Object.assign(
    union([Thenable]).typed({
        Accept: <T>(value: T) => ({ value }) as Accepted<T>,
        Expect: <T, E = never>(pending: PromiseLike<T>) =>
            ({ pending, value: null }) as Expected<T, E>,
        Reject: <E>(error: E) => ({ error, value: null }) as Rejected<E>,
    }),
    {
        /**
         * Aggregate an array of Results. Returns `Accept([...])` only if every
         * element is `Accept`; short-circuits on the first `Reject`.
         *
         * `Expect` (pending) elements are surfaced as a single `Expect` whose
         * resolved value is the aggregated value tuple.
         */
        all<Rs extends readonly Result<unknown, unknown>[]>(
            results: readonly [...Rs],
        ): Result<AllValues<Rs>, AnyError<Rs>> {
            const values: unknown[] = [];
            const pendings: PromiseLike<unknown>[] = [];
            const pendingIndices: number[] = [];

            for (let i = 0; i < results.length; i++) {
                const r = results[i]!;
                const tag = getTag(r as Result<unknown, unknown>);
                if (tag === "Reject") {
                    return Result.Reject(
                        (r as { error: unknown }).error,
                    ) as unknown as Result<AllValues<Rs>, AnyError<Rs>>;
                }
                if (tag === "Expect") {
                    pendings.push((r as { pending: PromiseLike<unknown> }).pending);
                    pendingIndices.push(i);
                    values.push(undefined); // placeholder
                } else {
                    values.push((r as { value: unknown }).value);
                }
            }

            if (pendings.length === 0) {
                return Result.Accept(values) as Result<
                    AllValues<Rs>,
                    AnyError<Rs>
                >;
            }

            return Result.Expect(
                Promise.all(pendings).then((resolved) => {
                    for (let i = 0; i < resolved.length; i++) {
                        values[pendingIndices[i]!] = resolved[i];
                    }
                    return values as AllValues<Rs>;
                }),
            ) as Result<AllValues<Rs>, AnyError<Rs>>;
        },
    },
);
