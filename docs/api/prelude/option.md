# API Reference: Option

```ts
import { Option, Some, None } from "aljabr/prelude"
```

---

## Overview

`Option<T>` is a two-variant union that models the presence or absence of a value. It eliminates `null`/`undefined` checks by making the "maybe nothing" case explicit and chainable. All variants share `map`, `flatMap`, `getOrElse`, and `toResult` via the `Mappable<T>` impl mixin.

---

## Variants

### `Option.Some<T>`

A present value.

```ts
Option.Some<T>(value: T): Some<T>
```

| Property | Type | Description |
|---|---|---|
| `value` | `T` | The present value |

```ts
const name = Option.Some("alice")
name.value // "alice"
```

### `Option.None<T>`

An absent value.

```ts
Option.None<T>(): None<T>
```

| Property | Type | Description |
|---|---|---|
| `value` | `null` | Always null |

```ts
const missing = Option.None<string>()
missing.value // null
```

---

## Type definitions

```ts
type Some<T>   = Variant<"Some", { value: T },    Mappable<T>>
type None<T>   = Variant<"None", { value: null },  Mappable<T>>
type Option<T> = Some<T> | None<T>
```

---

## `Mappable<T>` — shared behavior

### `.map<U>(fn)`

Apply a function to the value if present, otherwise propagate `None`.

```ts
.map<U>(fn: (value: T) => U): Option<U>
```

```ts
Option.Some("alice").map(s => s.toUpperCase()) // Some { value: "ALICE" }
Option.None<string>().map(s => s.toUpperCase()) // None { value: null }
```

### `.flatMap<U>(fn)`

Apply a function that itself returns an `Option`, flattening the result. Useful for chaining optional operations.

```ts
.flatMap<U>(fn: (value: T) => Option<U>): Option<U>
```

```ts
const parseAge = (s: string): Option<number> => {
    const n = parseInt(s)
    return isNaN(n) ? Option.None() : Option.Some(n)
}

Option.Some("42").flatMap(parseAge)   // Some { value: 42 }
Option.Some("abc").flatMap(parseAge)  // None
Option.None<string>().flatMap(parseAge) // None
```

### `.getOrElse(defaultValue)`

Extract the value, or return a default if absent.

```ts
.getOrElse(defaultValue: T): T
```

```ts
Option.Some("grace").getOrElse("anonymous")  // "grace"
Option.None<string>().getOrElse("anonymous") // "anonymous"
```

### `.toResult<E>(error)`

Convert to a [`Result`](./result.md): `Some` → `Accept`, `None` → `Reject`.

```ts
.toResult<E>(error: E): Result<T, E>
```

```ts
Option.Some(42).toResult("missing")         // Accepted<number>
Option.None<number>().toResult("missing")   // Rejected<string>
```

---

## Pattern matching

```ts
import { match } from "aljabr"

match(option, {
    Some: ({ value }) => `got: ${value}`,
    None: ()          => "nothing here",
})
```

---

## Examples

### Safe property access

```ts
function getCity(user: User | null): Option<string> {
    if (!user) return Option.None()
    if (!user.address) return Option.None()
    return Option.Some(user.address.city)
}

const city = getCity(currentUser)
    .map(c => c.toUpperCase())
    .getOrElse("UNKNOWN")
```

### Chaining optional lookups

```ts
const config: Map<string, string> = loadConfig()

const timeout = Option.Some(config)
    .flatMap(c => {
        const val = c.get("timeout")
        return val ? Option.Some(val) : Option.None()
    })
    .flatMap(s => {
        const n = parseInt(s)
        return isNaN(n) ? Option.None() : Option.Some(n)
    })
    .getOrElse(30_000)
```

### Converting to Result for error propagation

```ts
import { Result } from "aljabr/prelude"

function requireEnv(key: string): Result<string, string> {
    return Option.Some(process.env[key] ?? null)
        .flatMap(v => v ? Option.Some(v) : Option.None())
        .toResult(`Missing required env var: ${key}`)
}
```

---

## See also

- [`Result`](./result.md) — synchronous/async success or failure
- [`Validation`](./validation.md) — accumulate multiple errors instead of short-circuiting
