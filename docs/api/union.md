# API Reference: union, Trait, pred, is, select, when, getTag

These exports live in `src/union.ts` and are re-exported from the package root.

```ts
import { union, Trait, pred, is, select, when, getTag, __, tag, Union, FactoryPayload, Variant } from "aljabr"
```

---

## `union()`

Define a set of tagged variant factories.

### Direct form

```ts
function union<Def>(factories: Def): VariantFactories<Def>
```

Pass an object whose values are either factory functions or plain objects. You get back an object with the same keys, each converted to a callable constructor.

```ts
const Shape = union({
  Circle: (radius: number) => ({ radius }),  // factory function
  Rect:   (w: number, h: number) => ({ w, h }),
  Dot:    { x: 0, y: 0 },                   // constant variant
})

Shape.Circle(5)    // { radius: 5, [tag]: "Circle" }
Shape.Rect(10, 20) // { w: 10, h: 20, [tag]: "Rect" }
Shape.Dot()        // { x: 0, y: 0, [tag]: "Dot" } — fresh object every call
```

Constant variants (plain objects) are wrapped in a no-arg factory. Each call returns a fresh copy.

### With-impl form

```ts
function union<Impl extends AbstractConstructor[]>(
  impls: Impl
): (factories: ValidFactories<Impl>) => VariantFactories<...>
```

Pass an array of impl classes first. The returned curried function accepts the factories. Every variant instance receives the impl classes' instance properties and methods mixed in, and the type system validates that each factory's return type satisfies all `Trait<R>` requirements declared by the impl classes.

```ts
abstract class Timestamped extends Trait<{ id: string }> {
  createdAt = Date.now()
}

const Event = union([Timestamped])({
  Created: (id: string) => ({ id }),
  Deleted: (id: string) => ({ id }),
  // Missing: (n: number) => ({ n })  // ✗ compile error: missing `id`
})

const e = Event.Created("x")
e.id        // "x"
e.createdAt // number
```

### Variant instances

Every constructed variant:

- Has all payload properties spread as own properties
- Has impl class instance properties and prototype methods mixed in (impl properties are applied before payload, so payload values shadow impl defaults)
- Has a non-enumerable `[tag]` symbol on the prototype encoding the variant's name string

The tag is **not** an own property and **not** enumerable — it won't appear in `Object.keys()`, `JSON.stringify()`, or spread operations.

---

## `Trait<R>`

```ts
abstract class Trait<R extends object = {}>
```

Abstract base class that encodes required payload properties `R` at the type level. Impl classes extend it to declare what every variant's factory must return.

```ts
abstract class HasId extends Trait<{ id: string }> {
  // shared implementation
  label() { return `[${(this as any).id}]` }
}

abstract class HasSize extends Trait<{ size: number }> {
  isEmpty() { return (this as any).size === 0 }
}

const Box = union([HasId, HasSize])({
  Small: (id: string) => ({ id, size: 1 }),
  Large: (id: string) => ({ id, size: 100 }),
})
```

If a variant factory doesn't return an object satisfying all `Trait<R>` requirements from all impl classes, TypeScript surfaces an error on that specific factory — not on the whole union call.

Classes that don't extend `Trait<R>` are treated as `Trait<{}>` — they mix in properties and methods, but impose no payload requirements.

---

## `pred()`

```ts
function pred<T, S extends T>(fn: (val: T) => val is S): Pred<T, S>
function pred<T>(fn: (val: T) => boolean): Pred<T>
```

Wraps a predicate function for use as a field matcher inside a [`when()`](#when) pattern object. Distinguishes dynamic checks from literal value comparisons.

```ts
// Boolean predicate
const isPositive = pred((n: number) => n > 0)

// Narrowing type predicate
const isEnter = pred((k: string): k is "Enter" => k === "Enter")
```

Use in a `when()` pattern:

```ts
when({ score: pred((n) => n > 100) }, () => "high score")
when({ key: pred((k): k is "Enter" => k === "Enter") }, () => "submit")
```

When the match engine encounters a `Pred` value in a pattern, it calls `pred.fn(fieldValue)` instead of doing strict equality. A type-narrowing predicate (`val is S`) carries its narrowed type through to the handler.

### Types

```ts
type Pred<T, S extends T = T> = {
  readonly fn: (val: T) => boolean
  readonly _narrow?: S  // phantom type for narrowing
}
```

---

## `is`

A namespace of pattern primitives for use as field values inside [`when()`](#when) patterns. Two categories: type wildcards that check a value's runtime type, and logical combinators that compose patterns.

```ts
import { is } from "aljabr"
```

### Type wildcards

Each wildcard is a [`Pred`](#pred) that matches values of the corresponding type:

| Wildcard | Equivalent runtime check |
|---|---|
| `is.string` | `typeof v === "string"` |
| `is.number` | `typeof v === "number"` |
| `is.boolean` | `typeof v === "boolean"` |
| `is.nullish` | `v == null` (null or undefined) |
| `is.defined` | `v !== undefined` |
| `is.array` | `Array.isArray(v)` |
| `is.object` | `typeof v === "object" && v !== null && !Array.isArray(v)` |

```ts
when({ age: is.number },   ({ age }) => age * 2)
when({ name: is.string },  ({ name }) => name.toUpperCase())
when({ data: is.nullish }, () => "no data")
when({ list: is.array },   ({ list }) => list.length)
```

Note: `is.object` does not match arrays — use `is.array` for those.

### `is.not(pattern)`

```ts
is.not(pattern: unknown): Combinator
```

Matches any value that does **not** match the given pattern. The inner pattern may be a literal, a `Pred`, another combinator, or a structural object.

```ts
when({ status: is.not("error") },   handler)    // any status except "error"
when({ code:   is.not(is.string) }, handler)    // code is not a string
when({ text:   is.not(is.nullish) }, handler)   // text is defined and non-null
```

### `is.union(...patterns)`

```ts
is.union(...patterns: unknown[]): Combinator
```

Matches if the value satisfies **any** of the given patterns (logical OR).

```ts
when({ key:    is.union("Tab", "Enter") },       handler)   // Tab or Enter
when({ code:   is.union(is.string, is.number) }, handler)   // string or number
when({ status: is.union("pending", "active") },  handler)   // either status
```

### Types

```ts
type Combinator =
  | { readonly kind: "not";   readonly pattern: unknown }
  | { readonly kind: "union"; readonly patterns: readonly unknown[] }
```

> **Phase 1.5 note:** In the current release, combinators carry `unknown` as the narrowed type in TypeScript. Type-level narrowing (`Exclude<T, U>` for `is.not`, `A | B` for `is.union`) is planned for Phase 1.5.

---

## `select()`

```ts
function select(name: string, pattern?: unknown): SelectMarker
```

Marks a field in a [`when()`](#when) pattern for extraction. When the arm matches, the field's value is collected into a `selections` map and injected as the second argument to the handler.

An optional second argument constrains the field: the arm only matches if the field also satisfies that pattern.

```ts
// Extract without constraint — arm always fires for this variant
when({ key: select("k") }, (val, { k }) => `pressed: ${k}`)

// Extract with type assertion — arm only fires when text is non-null
when({ text: select("t", is.not(is.nullish)) }, (val, { t }) => t.toUpperCase())

// Extract from a nested path
when({ user: { name: select("name") } }, (val, { name }) => `Hello, ${name}`)

// Multiple selections
when(
  { key: select("k"), shift: select("s") },
  (val, { k, s }) => s ? `Shift+${k}` : k,
)
```

### Handler signature with `select`

When one or more `select()` markers appear in the pattern, the handler receives a second argument containing all extracted values:

```ts
(val: V, selections?: Record<string, unknown>) => R
```

Handlers without any `select()` markers still type-check: the second argument is optional and TypeScript will not complain if it's omitted.

> **Phase 1.5 note:** In the current release, `selections` is typed as `Record<string, unknown>`. Per-name type inference (e.g., knowing `{ name: string }` from the variant's field type) is planned for Phase 1.5.

### `SelectMarker` type

```ts
type SelectMarker = {
  readonly name: string
  readonly pattern?: unknown
}
```

---

## `when()`

```ts
// Catch-all: always matches
function when<V, R>(pattern: typeof __, handler: (val: V) => R): WhenArm<V, R>

// Guard-only: matches when guard(val) returns true
function when<V, R>(guard: (val: V) => boolean, handler: (val: V) => R): WhenArm<V, R>

// Structural: matches when all pattern fields satisfy the pattern
function when<V, R>(
  pattern: object,
  handler: (val: V, selections?: Record<string, unknown>) => R
): WhenArm<V, R>

// Structural + guard: both must pass
function when<V, R>(
  pattern: object,
  guard: (val: V) => boolean,
  handler: (val: V, selections?: Record<string, unknown>) => R
): WhenArm<V, R>
```

Constructs a pattern match arm for use as a variant matcher inside [`match()`](match.md). Arms are used either as a single value or in an array (first-match-wins).

### Pattern matching rules

Each field in the pattern is evaluated against the corresponding field on the variant value:

- **[`Pred`](#pred)** — `pred.fn(fieldValue)` is called
- **[`Combinator`](#is)** (`is.not`, `is.union`) — evaluated recursively
- **[`SelectMarker`](#select)** — field is extracted into `selections`; the optional inner pattern is evaluated if present
- **Plain object (not an Aljabr variant)** — matched recursively as a sub-pattern
- **Anything else** — strict equality (`===`)

Recursion into sub-patterns stops at Aljabr variant boundaries (values that carry a `[tag]` on their prototype).

An empty pattern `{}` matches any value (all-keys-pass vacuously).

### Examples

```ts
// Catch-all
when(__, () => "fallback")

// Guard-only
when((v) => v.x > 0, () => "positive x")

// Structural pattern — literal equality
when({ key: "Enter" }, () => "submit")

// Pattern with is.* wildcard
when({ age: is.number }, ({ age }) => age * 2)

// Pattern with combinator
when({ status: is.not("error") }, handler)

// Deep structural match
when({ user: { name: "Alice" } }, () => "found Alice")

// Extract a field with select
when({ key: select("k") }, (val, { k }) => `pressed: ${k}`)

// Extract with type constraint
when({ age: select("age", is.number) }, (val, { age }) => age)

// Pattern + guard
when({ active: true }, (v) => v.count > 10, () => "active and busy")

// Array of arms in match
match(event, {
  KeyPress: [
    when({ key: "Enter" },                         () => "submit"),
    when({ key: is.union("Tab", "Escape") },       () => "navigation"),
    when({ key: select("k", is.not(is.nullish)) }, (_, { k }) => `char: ${k}`),
    when(__,                                        () => "other"),
  ],
})
```

### `WhenArm<V, R>` type

```ts
type WhenArm<V, R> = {
  readonly pattern:
    | { [K in keyof V]?: V[K] | Pred<V[K]> | SelectMarker | Combinator }
    | typeof __
  readonly guard?: (val: V) => boolean
  readonly handler: (val: V, selections?: Record<string, unknown>) => R
}
```

---

## `getTag()`

```ts
function getTag<E extends { [tag]: string }>(variant: E): E[typeof tag]
```

Extracts the variant name string from a tagged instance. Useful when you need the name outside of a `match()` — for logging, serialization keys, or debugging.

```ts
const Shape = union({ Circle: (r: number) => ({ r }), Dot: { x: 0 } })

getTag(Shape.Circle(5)) // "Circle"
getTag(Shape.Dot())     // "Dot"
```

---

## `__`

```ts
const __: unique symbol
```

The catch-all symbol. Two uses:

1. As a pattern in `when(__, handler)` — the arm always matches
2. As a key in `match()` matchers — handles any variant not explicitly listed

```ts
match(event, {
  Click: (v) => `clicked at ${v.x},${v.y}`,
  [__]: () => "something else happened",
})
```

---

## `tag`

```ts
const tag: unique symbol
```

The discriminant symbol. Every variant instance carries this on its prototype. You rarely need to access it directly — use [`getTag()`](#gettag) or just let `match()` handle dispatch. It's exposed for advanced use cases (e.g. custom serializers).

```ts
import { tag } from "aljabr"

const v = Shape.Circle(5)
v[tag] // "Circle"
Object.keys(v).includes(tag.toString()) // false — non-enumerable
```

---

## Types

### `Union<T, VariantName?>`

```ts
type Union<
  T extends Record<string, (...args: any[]) => any>,
  VariantName extends keyof T | never = never
>
```

Extracts the union type from a factory object. Pass a `VariantName` to extract a single variant.

```ts
const Shape = union({ Circle: (r: number) => ({ r }), Dot: { x: 0 } })

type Shape  = Union<typeof Shape>           // Circle instance | Dot instance
type Circle = Union<typeof Shape, "Circle"> // Circle instance only
```

### `Variant<Tag, Payload, Impl?>`

```ts
type Variant<
  Tag extends string,
  Payload extends object,
  Impl = unknown,
>
```

Assembles a complete tagged variant type from its three parts: the tag string literal, the payload shape, and an optional impl mixin instance type. Use as the `as`-cast target in `.typed()` factory bodies to encode generic type parameters.

```ts
import { Variant, tag } from "aljabr";

// Without impl
type Some<T> = Variant<"Some", { value: T }>;
// { value: T } & { [tag]: "Some" }

// With impl mixin
type Accepted<T> = Variant<"Accept", { value: T }, Thenable<T>>;
// { value: T } & { [tag]: "Accept" } & Thenable<T>
```

When `Impl` is omitted (or `unknown`), no mixin type is added. When provided, it is intersected with the payload and tag.

See [Generic variant types](../guides/advanced-patterns.md#generic-variant-types) for a full walkthrough.

### `union([Impl]).typed`

```ts
readonly typed: <Factories extends Record<string, (...args: any[]) => any>>(
  factories: Factories,
) => Factories
```

A property on the builder returned by `union([Impl])`. Calling `.typed({ ... })` accepts the same factory object as the standard curried call, but passes each factory's type through unchanged instead of mapping through `Parameters<>` / `ReturnType<>`. This preserves generic type variables on factory functions.

```ts
const Option = union([]).typed({
    Some: <T>(value: T) => ({ value } as Variant<"Some", { value: T }>),
    None: ()            => ({ value: null } as Variant<"None", { value: null }>),
});

Option.Some(42).value   // number ✓
Option.Some("hi").value // string ✓
```

**When to use `.typed()` vs the plain call form:**

| | Plain call | `.typed()` |
|---|---|---|
| Generic type params | Instantiated to `unknown` | Preserved |
| Impl mixin in type | Automatic | Must include in `Variant<>` cast |
| Suitable for | Non-generic unions | Generic unions like `Result<T,E>`, `Option<T>` |

The impl class passed to `union([Impl])` still applies at runtime — instances are merged onto each variant — but the impl's type must be explicitly included in each `Variant<>` cast for TypeScript to see it.

### `FactoryPayload<Trait, Ignore?>`

```ts
type FactoryPayload<Trait, Ignore extends keyof any = never>
```

Derives the plain payload shape from a trait or impl class instance, stripping methods, the `[tag]` symbol, and any keys listed in `Ignore`. Useful for typing factory functions without repeating annotations.

```ts
abstract class Node extends Trait<{ id: string; value: number }> {}

type NodePayload = FactoryPayload<InstanceType<typeof Node>>
// { id: string; value: number }

type WithoutId = FactoryPayload<InstanceType<typeof Node>, "id">
// { value: number }
```
