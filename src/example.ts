import {
    __,
    union,
    getTag,
    when,
    pred,
    type Union,
    Trait,
    type Variant,
} from "./union.ts";
import { match } from "./match.ts";

// --- Define your behaviors ---

class BaseEvent {
    name!: string;
    timestamp?: number = Date.now();

    log() {
        console.log(`[${this.timestamp}] ${getTag(this as any)} fired.`);
    }
}

class Monad {
    // A simple mapping method as an example
    map<T>(fn: (val: this) => T): T {
        return fn(this);
    }
}

// --- Define the Union ---

export const WebEvent = union({
    PageLoad: { name: "jhkjh" },
    KeyPress: (key: string) => ({ key, name: "hkjh" }),
    Click: (x: number, y: number) => ({ x, y, name: "" }),

    impl: [Monad, BaseEvent], // Pass as many as you want!
});
WebEvent.KeyPress("Enter");

export type WebEvent<T extends keyof typeof WebEvent | never = never> = Union<
    typeof WebEvent,
    T
>;

let x = WebEvent.PageLoad() as WebEvent;
let y = match(x, {
    KeyPress: [
        when(
            { key: pred((k): k is "Enter" => k === "Enter") },
            ({ key }) => key,
        ),
        when(
            (v) => v.key.length > 0,
            ({ key }) => key,
        ),
        when(__, () => ""),
    ],
    [__]: () => "nil",
});
console.log(y);

// --- Example 2 ---
abstract class Thenable<T> extends Trait<{ value: unknown }>() {
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
        // Cast to any: implementation detail, external signature is authoritative.
        return match(this as unknown as Result, {
            Accept: ({ value }) => {
                try {
                    const accepted = onAccepted
                        ? onAccepted(value as T)
                        : value;
                    const isDelayed = "then" in (accepted as any);
                    return isDelayed
                        ? Result.Delay(accepted as any)
                        : Result.Accept(accepted);
                } catch (e) {
                    const rejected: any = onRejected ? onRejected(e) : e;
                    const isDelayed = "then" in rejected;
                    return isDelayed
                        ? Result.Delay(rejected)
                        : onRejected
                          ? Result.Accept(rejected)
                          : Result.Reject(rejected);
                }
            },
            Delay: ({ pending }) => {
                return Result.Delay(
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

export type Accepted<T> = Variant<"Accept", { value: T }, Thenable<T>>;
export type Delayed<T> = Variant<
    "Delay",
    { pending: PromiseLike<T>; value: null },
    Thenable<T>
>;
export type Rejected<E> = Variant<
    "Reject",
    { error: E; value: null },
    Thenable<never>
>;

export type Result<T = unknown, E = never> =
    | Accepted<T>
    | Delayed<T>
    | Rejected<E>;

export const Result = union([Thenable]).typed({
    Accept: <T>(value: T) => ({ value }) as Accepted<T>,
    Delay: <T>(pending: PromiseLike<T>) =>
        ({ pending, value: null }) as Delayed<T>,
    Reject: <E>(error: E) => ({ error, value: null }) as Rejected<E>,
});

const ok = Result.Delay(Result.Accept(9));
const ok2 = ok.then(
    (value) => value,
    (v) => {
        return "hanmel";
    },
);
ok2.then(
    (value) => {
        console.log(value); // value is type number. should be type number | string
    },
    (value) => {
        console.log(value); // value has type any. Should be type E if it exists
    },
);
// console.log(ok.value);
