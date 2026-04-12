# API Reference: Result

```ts
import { Result, Accepted, Expected, Rejected, Thenable } from "aljabr/prelude"
```

---

## Overview

`Result<T, E>` is a three-variant union that models synchronous success, asynchronous pending work, and failure. All three variants share a `then()` method via the `Thenable<T>` impl mixin, making `Result` directly usable in `await` expressions and `.then()` chains — without wrapping it in a `Promise`.

---

## Variants

### `Result.Accept<T>`

A synchronous successful value.

```ts
Result.Accept<T>(value: T): Accepted<T>
```

| Property | Type | Description |
|---|---|---|
| `value` | `T` | The accepted value |

```ts
const ok = Result.Accept(42)
ok.value // 42
```

### `Result.Expect<T>`

An async computation currently in flight.

```ts
Result.Expect<T>(pending: PromiseLike<T>): Expected<T>
```

| Property | Type | Description |
|---|---|---|
| `pending` | `PromiseLike<T>` | The in-flight promise |
| `value` | `null` | Always null while pending |

```ts
const loading = Result.Expect(fetch("/api/data").then(r => r.json()))
loading.pending // PromiseLike<Data>
```

### `Result.Reject<E>`

A failure with an associated error.

```ts
Result.Reject<E>(error: E): Rejected<E>
```

| Property | Type | Description |
|---|---|---|
| `error` | `E` | The error value |
| `value` | `null` | Always null on rejection |

```ts
const err = Result.Reject(new Error("not found"))
err.error // Error
```

---

## Type definitions

```ts
type Accepted<T> = Variant<"Accept", { value: T },                             Thenable<T>>
type Expected<T> = Variant<"Expect", { pending: PromiseLike<T>; value: null }, Thenable<T>>
type Rejected<E> = Variant<"Reject", { error: E; value: null },                Thenable<never>>

type Result<T = unknown, E = never> = Accepted<T> | Expected<T> | Rejected<E>
```

---

## `Thenable<T>` — shared behavior

Every `Result` variant implements `.then()`, mirroring the `Promise` contract. This means you can `await` a `Result` directly or chain `.then()` calls:

```ts
.then<TResult1 = T, TResult2 = never>(
    onAccepted?: ((value: T) => TResult1 | PromiseLike<TResult1>) | null,
    onRejected?:  ((reason: any) => TResult2 | PromiseLike<TResult2>) | null,
): Result<TResult1, TResult2>
```

### Chaining rules

| Current state | `onAccepted` provided | Result |
|---|---|---|
| `Accept` | Yes | Calls `onAccepted(value)`. If the return is thenable, wraps in `Expect`; otherwise wraps in `Accept`. |
| `Accept` | No  | Passes the value through as a new `Accept`. |
| `Expect` | — | Chains onto `pending.then(onAccepted, onRejected)`, returns new `Expect`. |
| `Reject` | Yes (onRejected) | Calls `onRejected(error)`, wraps result in `Accept`. |
| `Reject` | No  | Passes the error through as a new `Reject`. |

```ts
// Synchronous chain
const doubled = Result.Accept(3).then(n => n * 2)
// → Accepted<number> { value: 6 }

// Async chain — still a Result, not a raw Promise
const loaded = Result.Expect(fetchUser(1)).then(u => u.name)
// → Expected<string>

// Error recovery
const recovered = Result.Reject("oops").then(null, (e) => `handled: ${e}`)
// → Accepted<string> { value: "handled: oops" }
```

### Awaiting a Result

Because `Thenable` satisfies the `PromiseLike` contract, you can `await` any `Result`:

```ts
const name = await Result.Accept("grace")    // "grace"
const name = await Result.Expect(fetchName()) // awaits the pending promise
// Result.Reject throws on await — catch it with try/catch
```

---

## Pattern matching

```ts
import { match } from "aljabr"

match(result, {
    Accept: ({ value })   => `success: ${value}`,
    Expect: ({ pending }) => `loading...`,
    Reject: ({ error })   => `error: ${error}`,
})
```

With a fallback catch-all:

```ts
match(result, {
    Accept: ({ value }) => render(value),
    [__]: () => null,
})
```

---

## Examples

### Async data loading

```ts
import { Result, type Result as ResultType } from "aljabr/prelude"

async function fetchUser(id: number): Promise<ResultType<User, string>> {
    try {
        const user = await api.getUser(id)
        return Result.Accept(user)
    } catch (e) {
        return Result.Reject(`Failed to load user ${id}: ${e}`)
    }
}

const result = await fetchUser(1)

match(result, {
    Accept: ({ value }) => renderUser(value),
    Reject: ({ error }) => showError(error),
    Expect: () => showSpinner(),
})
```

### Wrapping a Promise

```ts
const result = Result.Expect(Promise.resolve(42))

result.then(
    (n)  => console.log("got:", n),   // "got: 42"
    (e)  => console.error("err:", e),
)
```

### Converting from Option

```ts
import { Option } from "aljabr/prelude"

const name = Option.Some("alice").toResult("name is required")
// → Accepted<string> { value: "alice" }

const missing = Option.None<string>().toResult("name is required")
// → Rejected<string> { error: "name is required" }
```

---

## See also

- [`Option`](./option.md) — nullable value container
- [`Validation`](./validation.md) — error-accumulating validation
- [Generic variant types](../../guides/advanced-patterns.md#generic-variant-types) — how `Result` is built with `.typed()`
