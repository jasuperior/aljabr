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
import { Result, Option, Signal, Tree, Validation } from "./prelude/index.ts";

// --- Example 1: Simple union with shared behaviors ---

class BaseEvent {
    name!: string;
    timestamp?: number = Date.now();

    log() {
        console.log(`[${this.timestamp}] ${getTag(this as any)} fired.`);
    }
}

class Monad {
    map<T>(fn: (val: this) => T): T {
        return fn(this);
    }
}

export const WebEvent = union({
    PageLoad: { name: "page-load" },
    KeyPress: (key: string) => ({ key, name: "key-press" }),
    Click: (x: number, y: number) => ({ x, y, name: "click" }),

    impl: [Monad, BaseEvent],
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

// --- Example 2: Result — async-aware error handling ---

const ok = Result.Expect(Result.Accept(9));
const ok2 = ok.then(
    (value) => value,
    () => "error",
);
ok2.then(
    (value) => console.log("resolved:", value),
    (value) => console.log("rejected:", value),
);

// --- Example 3: Option — null-safe chaining ---

const name = Option.Some("alice");
const upper = name
    .map((s) => s.toUpperCase())
    .getOrElse("anonymous");
console.log(upper); // "ALICE"

const missing: Option<string> = Option.None();
const fallback = missing.getOrElse("default");
console.log(fallback); // "default"

const result = Option.Some(42).toResult("value was missing");
console.log(getTag(result)); // "Accept"

// --- Example 4: Signal — reactive lifecycle ---

const sig = Signal.Active(100);
console.log(sig.isActive()); // true
console.log(sig.get());      // 100

const disposed = Signal.Disposed();
console.log(disposed.isActive()); // false
console.log(disposed.get());      // null

match(sig as Signal<number>, {
    Unset: () => console.log("waiting for value"),
    Active: ({ value }) => console.log("current value:", value),
    Disposed: () => console.log("signal ended"),
});

// --- Example 5: Tree — recursive data structures ---

const tree = Tree.Branch(
    1,
    Tree.Branch(2, Tree.Leaf(4), Tree.Leaf(5)),
    Tree.Leaf(3),
);

const sum = tree.fold((acc, v) => acc + v, 0);
console.log("sum:", sum); // 15

const doubled = tree.map((v) => v * 2);
console.log("depth:", doubled.depth()); // 2

// --- Example 6: Validation — error accumulation ---

const validateAge = (age: number) =>
    age >= 0
        ? Validation.Valid<number, string>(age)
        : Validation.Invalid<number, string>(["Age must be non-negative"]);

const validateName = (name: string) =>
    name.length > 0
        ? Validation.Valid<string, string>(name)
        : Validation.Invalid<string, string>(["Name is required"]);

const person = validateAge(25).combine(validateName("Bob"));
console.log(getTag(person)); // "Valid"

const bad = validateAge(-1).combine(validateName(""));
console.log(getTag(bad)); // "Invalid"
match(bad, {
    Valid: ({ value }) => console.log("person:", value),
    Invalid: ({ errors }) => console.log("errors:", errors),
});

// --- Example 7: Custom Trait for user-defined unions ---

abstract class Serializable extends Trait<{ id: string }>() {
    serialize(): string {
        return JSON.stringify({ tag: getTag(this as any), id: (this as any).id });
    }
}

type Created = Variant<"Created", { id: string; at: number }, Serializable>;
type Deleted = Variant<"Deleted", { id: string }, Serializable>;
type DomainEvent = Created | Deleted;

const DomainEvent = union([Serializable]).typed({
    Created: (id: string, at: number) => ({ id, at }) as Created,
    Deleted: (id: string) => ({ id }) as Deleted,
});

const ev = DomainEvent.Created("abc-123", Date.now());
console.log(ev.serialize());
