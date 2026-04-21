# Advanced Patterns

This guide covers the parts of aljabr you reach for once the basics aren't enough: impl classes, Trait constraints, constant variants, and techniques for composing `when()` arms in real-world scenarios.

---

## Impl classes and mixins

Impl classes let you attach shared behavior to every variant without inheritance. They're ordinary TypeScript classes — aljabr constructs an instance of each and merges the properties and methods onto every variant it produces.

```ts
import { union, Union, getTag } from "aljabr"

class Auditable {
  readonly createdAt = Date.now()
  audit() {
    return `[${getTag(this as any)} @ ${this.createdAt}]`
  }
}

const Command = union([Auditable])({
  Create: (name: string) => ({ name }),
  Delete: (id: string) => ({ id }),
  Rename: (id: string, name: string) => ({ id, name }),
})
type Command = Union<typeof Command>

const cmd = Command.Create("widget")
cmd.name      // "widget"
cmd.createdAt // number
cmd.audit()   // "[Create @ 1712345678901]"
```

Every variant produced by this factory carries `createdAt` and `audit`. The impl class is instantiated fresh per `union()` definition — not per variant call. Properties that come from the impl default values (like `createdAt = Date.now()`) are set at definition time; if you need per-call initialization, use the payload factory function.

### Multiple impl classes

Pass as many impl classes as you need. Their properties and methods are merged left to right, with payload values winning over any impl defaults of the same name.

```ts
class Versioned {
  version = 1
}

class Tagged {
  tags: string[] = []
}

const Doc = union([Versioned, Tagged])({
  Draft:     (title: string) => ({ title }),
  Published: (title: string, url: string) => ({ title, url }),
})

const d = Doc.Draft("Hello")
d.version // 1
d.tags    // []
```

---

## Trait constraints

Plain classes mix in behavior without imposing any requirements. `Trait<R>` adds a type-level contract: every variant factory must return an object that satisfies `R`.

```ts
import { union, Trait, Union } from "aljabr"

abstract class Identifiable extends Trait<{ id: string }> {
  describe() { return `[${(this as any).id}]` }
}

const Entity = union([Identifiable])({
  User:    (id: string, name: string) => ({ id, name }),
  Product: (id: string, price: number) => ({ id, price }),
  // Broken: (n: number) => ({ n }),  // ✗ compile error: missing `id`
})
```

The error surfaces on the specific variant that doesn't conform — not a cryptic error on the `union()` call site.

### Combining Trait requirements

When multiple impl classes each extend `Trait<R>`, the requirements are intersected. Every variant must satisfy all of them:

```ts
abstract class HasId    extends Trait<{ id: string }> {}
abstract class HasLabel extends Trait<{ label: string }> {}

const Node = union([HasId, HasLabel])({
  Leaf:   (id: string, label: string) => ({ id, label }),
  Branch: (id: string, label: string, children: string[]) => ({ id, label, children }),
})
```

### `FactoryPayload<T>`

When writing factory functions for impl-based unions, typing the return can get repetitive. `FactoryPayload<T>` derives the plain payload type from your trait:

```ts
import { FactoryPayload } from "aljabr"

abstract class HasId extends Trait<{ id: string; active: boolean }> {}
type Payload = FactoryPayload<InstanceType<typeof HasId>>
// { id: string; active: boolean }

// Use it to type a helper:
function makeId(id: string): Payload {
  return { id, active: true }
}
```

---

## Constant variants

Variants defined with a plain object (instead of a factory function) become no-arg constructors. Each call returns a fresh copy — no shared reference:

```ts
const Token = union({
  EOF:     { pos: -1 },
  Newline: { char: "\n" },
  Tab:     { char: "\t" },
})

const a = Token.EOF()
const b = Token.EOF()
a === b // false — fresh objects
a.pos   // -1
```

This matters: mutating one won't affect another, and you can safely attach additional properties to a specific instance.

---

## Payload shadows impl defaults

When a variant's payload contains a key that an impl class also defines, the payload wins:

```ts
abstract class Stateful extends Trait<{ active: boolean }> {
  active = true  // default
}

const Widget = union([Stateful])({
  Toggle: (active: boolean) => ({ active }),
})

Widget.Toggle(true).active  // true
Widget.Toggle(false).active // false — payload shadowed the impl default
```

This is intentional and expected. Impl defaults are starting values; the factory is the authoritative source.

---

## Composing `when()` arms

### Pattern + pred + guard

All three can be combined in a single arm. They're evaluated in order: pattern first, then pred fields within the pattern, then the guard function. All must pass for the arm to fire:

```ts
const Form = union({
  Submit: (value: string, retries: number) => ({ value, retries }),
})
type Form = Union<typeof Form>

const handle = (f: Form): string =>
  match(f, {
    Submit: [
      when(
        { value: pred((v) => v.length > 0) }, // pred: non-empty
        (f) => f.retries === 0,                // guard: first attempt
        () => "fresh submit",
      ),
      when(
        { value: pred((v) => v.length > 0) }, // pred: non-empty
        (f) => f.retries > 0,                  // guard: retry
        () => "retry submit",
      ),
      when(__, () => "empty or invalid"),
    ],
  })
```

### Guard-only arms

When you don't have a structural pattern — just a runtime condition on the full value — use the guard-only form:

```ts
match(event, {
  Click: [
    when((v) => v.x < 0 || v.y < 0, () => "out of bounds"),
    when((v) => v.x === v.y,         () => "diagonal"),
    when(__,                          () => "normal click"),
  ],
})
```

### Type-narrowing with pred

If a field can hold a union of types and you need to narrow it, use a type predicate:

```ts
type Payload = { value: string | number }

const Field = union({
  Input: (value: string | number) => ({ value }),
})
type Field = Union<typeof Field>

const format = (f: Field): string =>
  match(f, {
    Input: [
      when(
        { value: pred((v): v is string => typeof v === "string") },
        ({ value }) => value.toUpperCase(),  // value is string here
      ),
      when(
        { value: pred((v): v is number => typeof v === "number") },
        ({ value }) => value.toFixed(2),     // value is number here
      ),
      when(__, () => "unknown"),
    ],
  })
```

---

## Deep structural matching, `is`, and `select`

### Deep structural patterns

`when()` patterns recurse into plain object sub-patterns. You can match nested fields directly without manual destructuring in the handler:

```ts
const Event = union({
  UserAction: (user: { name: string; role: string }, action: string) => ({ user, action }),
})
type Event = Union<typeof Event>

match(event, {
  UserAction: [
    when({ user: { role: "admin" } }, () => "admin action"),
    when(__, () => "user action"),
  ],
})
```

Recursion stops at Aljabr variant boundaries — if a payload field holds another variant instance, `when()` will not recurse into it. Use a guard function or a separate `match()` call to inspect nested variants.

### Type wildcards with `is`

The `is` namespace provides pattern primitives that match by runtime type, for use as field values inside `when()` patterns:

```ts
import { is } from "aljabr"

const Form = union({
  Field: (value: string | number | null, required: boolean) => ({ value, required }),
})
type Form = Union<typeof Form>

match(form, {
  Field: [
    when({ value: is.string,  required: true  }, ({ value }) => validate(value)),
    when({ value: is.number              }, ({ value }) => value.toFixed(2)),
    when({ value: is.nullish, required: true  }, () => "required field is empty"),
    when(__,                                    () => "optional empty"),
  ],
})
```

Available wildcards: `is.string`, `is.number`, `is.boolean`, `is.nullish`, `is.defined`, `is.array`, `is.object`. See the [API reference](../api/union.md#is) for the full list.

### Combinators: `is.not` and `is.union`

`is.not(pattern)` negates any pattern. `is.union(...patterns)` is logical OR across patterns. Both compose with wildcards, literals, and each other:

```ts
const Message = union({
  Alert: (code: string, level: string) => ({ code, level }),
})
type Message = Union<typeof Message>

match(msg, {
  Alert: [
    when({ level: is.union("error", "fatal") }, () => showCritical()),
    when({ level: is.not("debug") },             () => showNormal()),
    when(__,                                      () => logDebug()),
  ],
})
```

```ts
// is.not composes with is.*
when({ value: is.not(is.nullish) }, ({ value }) => process(value))

// is.union composes with is.*
when({ id: is.union(is.string, is.number) }, ({ id }) => String(id))
```

`is.not` is also a namespace — each wildcard has a BDD-style pre-computed counterpart:

```ts
// These are equivalent pairs:
when({ code: is.not(is.string) },  handler)
when({ code: is.not.string },      handler)   // shorthand

when({ flag: is.not(is.boolean) }, handler)
when({ flag: is.not.boolean },     handler)   // shorthand
```

The pre-computed values (`is.not.string`, `is.not.number`, `is.not.array`, etc.) are plain values — not callable — consistent with how `is.string` works.

### Extracting values with `select`

`select(name)` binds a field to a named slot in the handler's second argument. This lets you extract nested or guarded values without repeating the field path inside the handler body. The extracted value is **typed precisely** — no casts needed:

```ts
import { select } from "aljabr"

const Nav = union({
  Route: (path: string, params: Record<string, string>) => ({ path, params }),
})
type Nav = Union<typeof Nav>

match(nav, {
  Route: [
    when(
      { path: "/user", params: { id: select("id") } },
      (val, { id }) => loadUser(id),  // id: string — typed from params field
    ),
    when(__, () => notFound()),
  ],
})
```

`select` also accepts an optional second argument — a pattern that the field must satisfy for the arm to match. The inner pattern also **narrows the extracted type**:

```ts
// Only fires when `name` is non-nullish; sel.name is string (null excluded)
when(
  { user: { name: select("name", is.not(is.nullish)) } },
  (val, { name }) => `Hello, ${name}`,
  //                          ^ name: string, not string | null
)
```

Multiple selections work naturally — each `select()` in the pattern contributes a typed key to the `selections` map:

```ts
when(
  { key: select("k"), shift: select("s") },
  (val, { k, s }) => s ? `Shift+${k}` : k,
  //         ^ k: string, s: boolean — each typed from their variant field
)
```

### Typed selections: how the inference works

The `selections` type is computed from the pattern at the `match()` call site. For each `select("name")` in the pattern, the type of the corresponding field in the variant is used:

```ts
const Key = union({
  Press: (key: string, shift: boolean) => ({ key, shift }),
})

match(e, {
  Press: when(
    { key: select("k"), shift: select("s") },
    // TypeScript infers: selections: { k: string; s: boolean }
    (val, sel) => {
      sel.k  // string ✓
      sel.s  // boolean ✓
    },
  ),
})
```

When no `select()` markers appear in the pattern, `selections` is `{}` — safe to omit or ignore:

```ts
when({ key: "Enter" }, () => "submit")  // no second arg needed
```

Inner pattern constraints narrow the extracted type:

| Inner pattern | Extracted type (when field is `T`) |
|---|---|
| _(none)_ | `T` |
| `is.string` | `string` |
| `is.number` | `number` |
| `is.not(is.nullish)` | `Exclude<T, null \| undefined>` |
| `is.union("a", "b")` | `"a" \| "b"` |

---

## Cross-union matching with `is.variant` and `variantOf`

Aljabr's tag-first dispatch is fast, but the tag alone can't distinguish two unions that share a variant name. If both `Result` and `Option` define an `"Ok"` variant, `getTag` alone is insufficient — you need union identity, not just the tag string.

Every factory created by `union()` carries a unique symbol internally. Every variant prototype it produces is stamped with the same symbol. This lets you ask "is this value from **that** specific union?" regardless of what its tag string is.

### `is.variant(factory)` in `when()` patterns

Use `is.variant(factory)` as a field value in a `when()` pattern to test whether a field holds any variant from a specific union:

```ts
import { union, match, when, is, __, Union } from "aljabr"

const Result = union({ Ok: (v: number) => ({ v }), Err: (e: string) => ({ e }) })
const Option = union({ Some: (v: number) => ({ v }), None: { v: null } })

const Container = union({
  Wrap: (payload: unknown) => ({ payload }),
})

const describe = (c: ReturnType<typeof Container.Wrap>): string =>
  match(c, {
    Wrap: [
      when({ payload: is.variant(Result) }, () => "contains a Result"),
      when({ payload: is.variant(Option) }, () => "contains an Option"),
      when({ payload: is.string },           () => "contains a string"),
      when(__,                               () => "contains something else"),
    ],
  })

describe(Container.Wrap(Result.Ok(42)))   // "contains a Result"
describe(Container.Wrap(Option.None()))   // "contains an Option"
describe(Container.Wrap("hello"))         // "contains a string"
```

Without `is.variant`, matching against `Result.Ok` would dispatch on the tag `"Ok"` — which might also match an `Option.Ok` if that variant existed.

### `is.union(Factory1, Factory2)` for OR membership

Pass union factories directly to `is.union` to match a field that can be any variant of any of those unions:

```ts
const Wrapper = union({ Wrap: (val: unknown) => ({ val }) })

match(wrapper, {
  Wrap: [
    when({ val: is.union(Result, Option) }, () => "Result or Option variant"),
    when(__, () => "something else"),
  ],
})
```

Factories and other patterns mix freely in the same `is.union(...)` call:

```ts
when({ val: is.union(Result, is.string) }, handler) // Result variant or a plain string
```

### `is.not(Factory)` and `is.not.variant(factory)` for negation

Both forms work symmetrically:

```ts
when({ data: is.not(Result) },         handler)  // data is NOT a Result variant
when({ data: is.not.variant(Result) }, handler)  // identical — namespace form
```

### `variantOf` for runtime checks outside patterns

When you need a membership check outside of a `when()` pattern — in a guard function, a filter, or any imperative code — use the standalone `variantOf`:

```ts
import { variantOf } from "aljabr"

// Direct form
variantOf(Result, someValue) // boolean

// Curried form — useful for array filtering
const results = values.filter(variantOf(Result))

// Compose with pred() for use in when() arms
when({ data: pred(variantOf(Result)) }, handler)
// (equivalent to is.variant — use whichever reads more clearly)
```

---

## Modeling state machines

aljabr pairs naturally with state machine patterns. Each state is a variant; transitions are functions that return new variants:

```ts
import { union, match, Union } from "aljabr"

const State = union({
  Idle:    { count: 0 },
  Loading: (requestId: string) => ({ requestId }),
  Success: (data: string[]) => ({ data }),
  Error:   (message: string, retries: number) => ({ message, retries }),
})
type State = Union<typeof State>

function transition(state: State, event: string): State {
  return match(state, {
    Idle:    () => State.Loading(crypto.randomUUID()),
    Loading: ({ requestId }) =>
      event === "ok"
        ? State.Success(["item1", "item2"])
        : State.Error("fetch failed", 0),
    Error:   ({ message, retries }) =>
      retries < 3
        ? State.Loading(crypto.randomUUID())
        : State.Error(message, retries),
    Success: (s) => s,
  })
}
```

Each call to a `State.*` constructor produces a new, immutable-by-convention value. `match()` guarantees every state is handled — add a new state and every unhandled transition becomes a compile error.

---

---

## Generic variant types

By default, `union()` infers factory return types through `ReturnType<F>`, which instantiates any generic type variable to `unknown`. This means `Result.Accept(3).value` is typed as `unknown` even though the value is clearly a `number`.

To preserve type parameters through factory definitions, aljabr provides two tools: the `Variant<Tag, Payload, Impl>` helper type and the `.typed()` builder property.

### The problem

```ts
const Box = union({
    Wrap: (value: any) => ({ value }),
});

Box.Wrap(42).value // any — type information lost
```

TypeScript cannot automatically thread `T` through `Parameters<F>` / `ReturnType<F>`. The solution is to write the generic signature explicitly once, as a type cast on each factory body.

### `Variant<Tag, Payload, Impl>`

`Variant<>` is a convenience type that assembles a complete tagged variant type from its three constituents:

```ts
import { Variant, tag } from "aljabr";

type Wrapped<T> = Variant<"Wrap", { value: T }>;
// equivalent to: { value: T } & { [tag]: "Wrap" }
```

The optional third parameter attaches an impl class instance type — mixins, trait methods, etc.:

```ts
type Wrapped<T> = Variant<"Wrap", { value: T }, SomeMixin<T>>;
```

### `.typed()` — identity passthrough builder

When you use `union([Impl])`, the returned builder has a `.typed` property. Calling `.typed({ ... })` accepts the same factory object but passes each factory's type through unchanged rather than mapping through `Parameters<>` / `ReturnType<>`. This lets the factories carry explicit generic signatures:

```ts
const Box = union([]).typed({
    Wrap: <T>(value: T) => ({ value } as Variant<"Wrap", { value: T }>),
});

Box.Wrap(42).value   // number ✓
Box.Wrap("hi").value // string ✓
```

### Building a generic `Option<T>`

A simple nullable wrapper — one value variant, one empty variant:

```ts
import { union, match, Variant, Union } from "aljabr";

type Some<T> = Variant<"Some", { value: T }>;
type None    = Variant<"None", { value: null }>;

export type Option<T> = Some<T> | None;

export const Option = union([]).typed({
    Some: <T>(value: T)  => ({ value }       as Some<T>),
    None: ()             => ({ value: null } as None),
});

// Usage
Option.Some(42).value  // number
Option.None().value    // null

// Match
function unwrapOr<T>(opt: Option<T>, fallback: T): T {
    return match(opt, {
        Some: ({ value }) => value,
        None: ()          => fallback,
    });
}

unwrapOr(Option.Some(3), 0)  // 3
unwrapOr(Option.None(),  0)  // 0
```

### Building a generic `RemoteData<T, E>`

`RemoteData<T, E>` is a well-known pattern for modeling the four states of an async data fetch. Unlike the built-in `AsyncDerived`, it's a pure value type — no reactivity, no evaluation machinery — making it ideal for explicit state containers in complex UIs.

This example shows `Variant<>`, `.typed()`, and an impl mixin all working together on a type that genuinely isn't in the library:

```ts
import { union, match, Trait, Variant, Union } from "aljabr";

// Impl class — shared behavior for mapping over success values.
abstract class Mappable<T, E> extends Trait {
    map<U>(fn: (value: T) => U): RemoteData<U, E> {
        return match(this as unknown as RemoteData<T, E>, {
            NotAsked: () => RemoteData.NotAsked(),
            Loading:  () => RemoteData.Loading(),
            Success:  ({ data }) => RemoteData.Success(fn(data)),
            Failure:  ({ error }) => RemoteData.Failure(error),
        }) as RemoteData<U, E>;
    }

    getOrElse(fallback: T): T {
        return match(this as unknown as RemoteData<T, E>, {
            NotAsked: () => fallback,
            Loading:  () => fallback,
            Success:  ({ data }) => data,
            Failure:  () => fallback,
        });
    }
}

// Named variant aliases — typed parameters preserved via cast targets.
export type NotAsked<T, E> = Variant<"NotAsked", Record<never, never>,   Mappable<T, E>>;
export type Loading<T, E>  = Variant<"Loading",  Record<never, never>,   Mappable<T, E>>;
export type Success<T, E>  = Variant<"Success",  { data: T },            Mappable<T, E>>;
export type Failure<T, E>  = Variant<"Failure",  { error: E },           Mappable<T, E>>;

export type RemoteData<T, E> = NotAsked<T, E> | Loading<T, E> | Success<T, E> | Failure<T, E>;

export const RemoteData = union([Mappable]).typed({
    NotAsked: <T, E>()           => ({} as NotAsked<T, E>),
    Loading:  <T, E>()           => ({} as Loading<T, E>),
    Success:  <T, E>(data: T)    => ({ data }  as Success<T, E>),
    Failure:  <T, E>(error: E)   => ({ error } as Failure<T, E>),
});
```

**What you get:**

```ts
const rd = RemoteData.Success<User, string>({ name: "Alice", id: 1 })
rd.data  // User ✓

RemoteData.Failure<User, string>("Not found").error  // string ✓

// map() preserves type safety
RemoteData.Success<number, string>(42)
    .map(n => n * 2)
    // → RemoteData.Success<number, string> { data: 84 } ✓

// getOrElse() provides a safe fallback
RemoteData.Failure<string, Error>(new Error()).getOrElse("default")
// → "default" ✓

// Exhaustive match with full narrowing
match(rd, {
    NotAsked: () => renderEmpty(),
    Loading:  () => renderSpinner(),
    Success:  ({ data }) => renderUser(data),   // data: User
    Failure:  ({ error }) => renderError(error), // error: string
})
```

### How it compares to the plain `union()` form

| | `union(factories)` | `union([Impl]).typed(factories)` |
|---|---|---|
| Factory signatures | Inferred via `ReturnType<F>` | Passed through unchanged |
| Generic type params | Instantiated to `unknown` | Preserved as written |
| Impl mixin in type  | Automatic | Must include in `Variant<>` cast |
| Best for | Non-generic unions | Unions with type-parameterized variants |

The direct `union(factories)` form remains the right choice for non-generic unions like `WebEvent` or `State`. Reach for `.typed()` when you need type parameters to survive the factory boundary.

### Pattern: variant aliases as exported types

Because `Accepted<T>`, `Delayed<T>`, etc. are plain type aliases, consumers can import and use them directly:

```ts
import type { Accepted, Rejected, Result } from "./result";

function onlyAccepted<T>(r: Result<T>): r is Accepted<T> {
    return r[tag] === "Accept";
}
```

This is especially useful for writing helper functions that operate on a single variant without needing the full union.

---

## See also

- [Getting Started](./getting-started.md)
- [Working with External Data](./schema.md) — `aljabr/schema`: decode, encode, transform, adapters
- [API Reference: union](../api/union.md)
- [API Reference: match](../api/match.md)
- [API Reference: aljabr/schema](../api/schema.md)
