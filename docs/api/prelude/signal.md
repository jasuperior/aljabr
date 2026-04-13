# API Reference: Signal

```ts
import { Signal, SignalState, type SignalProtocol, type Active, type Unset, type Disposed } from "aljabr/prelude"
```

---

## Overview

`Signal<T>` is a reactive mutable value container. Reading a signal inside a reactive context (a [`Derived`](./derived.md) computation or a [`watchEffect`](./effect.md#watcheffect) callback) automatically registers it as a dependency — writing via `set()` notifies all current dependents.

By default the lifecycle state is `SignalState<T>` — a `Unset | Active<T> | Disposed` union. You can replace this with **any domain union** by providing a `SignalProtocol<S, T>` to `Signal.create()`, giving you a `Signal<T, S>` whose state is entirely your own.

---

## `Signal<T, S>`

`S` defaults to `never`, which selects the standard `SignalState<T>` lifecycle. Provide `S` and a `SignalProtocol<S, T>` to use a custom state union instead.

### `Signal.create()`

```ts
Signal.create<T>(): Signal<T>                                      // starts Unset
Signal.create<T>(initial: T): Signal<T>                            // starts Active
Signal.create<S, T>(initial: S, protocol: SignalProtocol<S, T>): Signal<T, S>  // custom state
```

Creates a new signal. If created inside a reactive owner, the signal is automatically disposed when the owner is disposed.

```ts
const count    = Signal.create(0)          // Signal<number>   — Active
const deferred = Signal.create<number>()   // Signal<number>   — Unset

// Custom state union
const field = Signal.create(
    Validation.Unvalidated() as Validation<string, string>,
    {
        extract: (state) => match(state, {
            Unvalidated: () => null,
            Valid:       ({ value }) => value,
            Invalid:     () => null,
        }),
    },
) // Signal<string, Validation<string, string>>
```

> **Type inference note:** TypeScript infers `S` from the `initial` argument. When the initial value is a narrow variant (e.g. `Unvalidated<string, string>`), cast it to the full union type so `S` is inferred correctly: `Validation.Unvalidated() as Validation<string, string>`.

### `.get()`

```ts
signal.get(): T | null
```

Read the current value, registering a dependency in the active tracking context.

- **Default `Signal<T>`:** returns the `Active` value or `null` if `Unset`/`Disposed`.
- **Custom `Signal<T, S>`:** returns `protocol.extract(state)`, which may be `null` for states that carry no extractable `T` (e.g. `Unvalidated`, `Invalid`).

In both forms `get()` always triggers re-runs on state transitions — even when it returns `null`.

```ts
const doubled = Derived.create(() => (count.get() ?? 0) * 2)
```

### `.read()`

```ts
signal.read(): SignalState<T>          // default Signal<T>
signal.read(): S                       // custom Signal<T, S>
```

Read the **full state union** and register a dependency. Unlike `get()`, which extracts only `T | null`, `read()` gives you the complete state — use it inside reactive contexts when you need to pattern-match on all variants (e.g. to access `Invalid` errors).

```ts
watchEffect(
    async () => match(field.read(), {
        Unvalidated: () => null,
        Valid:       ({ value })  => submit(value),
        Invalid:     ({ errors }) => displayErrors(errors),
    }),
    onChange,
)
```

### `.peek()`

```ts
signal.peek(): T | null
```

Read the current extracted value without registering a dependency. Follows the same extraction logic as `get()` but never creates a subscription.

```ts
const snapshot = count.peek()
```

### `.set(value)`

```ts
// Default Signal<T>:
signal.set(value: T): void

// Custom Signal<T, S>:
signal.set(state: S): void
```

Write a new state and notify all current dependents.

- **Default:** wraps `value` in `Active`. No-op after disposal.
- **Custom:** accepts a full `S` variant. If `protocol.isTerminal(state)` returns `true` after the write, the signal is permanently frozen — all subscribers are cleared and future `set()` calls are no-ops.

```ts
count.set(1)
field.set(Validation.Valid("hello@example.com"))
field.set(Validation.Invalid(["bad format"]))
```

### `.dispose()`

```ts
signal.dispose(): void
```

Permanently deactivate the signal and clear all subscribers. Future `set()` calls are no-ops.

- **Default `Signal<T>`:** transitions state to `Disposed`.
- **Custom `Signal<T, S>`:** marks the signal as inert without mutating the state union — `.state` retains its last value.

```ts
count.dispose()
count.peek()  // null
count.set(99) // no-op
```

### `.state`

```ts
signal.state: SignalState<T>   // default Signal<T>
signal.state: S                // custom Signal<T, S>
```

The current state. **Untracked** — safe to read outside reactive contexts. For tracked reads inside computations, use `read()`.

```ts
match(signal.state, {
    Unset:    () => "waiting",
    Active:   ({ value }) => `value: ${value}`,
    Disposed: () => "cleaned up",
})
```

---

## `SignalProtocol<S, T>`

Describes how to read `T` from a custom state union `S`, and when to stop notifications.

```ts
type SignalProtocol<S, T> = {
    extract:     (state: S) => T | null
    isTerminal?: (state: S) => boolean
}
```

| Field | Required | Description |
|---|---|---|
| `extract` | Yes | Returns `T` for states that carry a readable value, `null` otherwise |
| `isTerminal` | No | Returns `true` to permanently freeze the signal after `set()`. Defaults to `() => false` |

```ts
const protocol: SignalProtocol<Validation<string, string>, string> = {
    extract: (state) => match(state, {
        Unvalidated: () => null,
        Valid:       ({ value }) => value,
        Invalid:     () => null,      // errors accessible via .read(), not .get()
    }),
    isTerminal: (state) => getTag(state) === "Disposed", // optional
}
```

---

## `SignalState<T>`

The lifecycle union for a signal's value. All variants implement `SignalLifecycle<T>`.

### Variants

| Variant | Payload | Meaning |
|---|---|---|
| `Unset` | `{ value: null }` | Signal created with no initial value; nothing has been `set()` yet |
| `Active<T>` | `{ value: T }` | Signal has a current value |
| `Disposed` | `{ value: null }` | Signal has been disposed; further writes are ignored |

### `SignalLifecycle<T>` — shared behavior

#### `.isActive()`

```ts
.isActive(): boolean
```

Returns `true` only for the `Active` variant. Equivalent to `match(state, { Active: () => true, [__]: () => false })`.

```ts
Signal.create(0).state.isActive()   // true
Signal.create<number>().state.isActive() // false (Unset)
```

#### `.get()`

```ts
.get(): T | null
```

Returns the value if `Active`, `null` otherwise. Exposed on `SignalState` to let `Done` results in the `Effect` system inspect their signal without an extra `match`.

```ts
const state = Signal.create(42).state
state.get() // 42
```

### Type definitions

```ts
type Unset          = Variant<"Unset",    { value: null }, SignalLifecycle<never>>
type Active<T>      = Variant<"Active",   { value: T },    SignalLifecycle<T>>
type Disposed       = Variant<"Disposed", { value: null }, SignalLifecycle<never>>
type SignalState<T> = Unset | Active<T> | Disposed
```

---

## Reactive dependency tracking

Signal reads are tracked implicitly via the computation stack. A read inside any of the following automatically subscribes:

- A `Derived` computation's getter function
- An `AsyncDerived` computation's async getter function
- A `watchEffect` thunk

Reads outside these contexts (at the top level, in event handlers, or after `await`) are not tracked. Use [`runInContext`](./context.md#runincontext) to restore a reactive owner across async boundaries.

---

## Examples

### Counter with derived display

```ts
import { Signal, Derived } from "aljabr/prelude"

const count = Signal.create(0)
const label = Derived.create(() => `Count: ${count.get()}`)

label.get() // "Count: 0"
count.set(5)
label.get() // "Count: 5"
```

### Batching writes

```ts
import { batch } from "aljabr/prelude"

const x = Signal.create(1)
const y = Signal.create(2)
const sum = Derived.create(() => (x.get() ?? 0) + (y.get() ?? 0))

// Without batch: sum is re-evaluated twice (once per set)
batch(() => {
    x.set(10)
    y.set(20)
})
// With batch: sum is re-evaluated once, after both writes
sum.get() // 30
```

### Lifecycle inspection

```ts
const sig = Signal.create<string>()

sig.state.isActive() // false — Unset
sig.set("hello")
sig.state.isActive() // true — Active
sig.dispose()
sig.state.isActive() // false — Disposed
```

### Custom state union — form field

Replace `SignalState<T>` with a `Validation` union so the signal's lifecycle IS the domain state:

```ts
import { Signal, type SignalProtocol } from "aljabr/prelude"
import { Validation, type Validation as V } from "aljabr/prelude"
import { match } from "aljabr"

const emailProtocol: SignalProtocol<V<string, string>, string> = {
    extract: (state) => match(state, {
        Unvalidated: () => null,
        Valid:       ({ value }) => value,
        Invalid:     () => null,
    }),
}

const email = Signal.create(
    Validation.Unvalidated() as V<string, string>,
    emailProtocol,
)

email.get()    // null          — Unvalidated, no extractable value
email.state    // Unvalidated   — full union, untracked

email.set(Validation.Valid("ada@example.com"))
email.get()    // "ada@example.com"

email.set(Validation.Invalid(["bad format"]))
email.get()    // null          — extract returns null for Invalid

// Use read() inside reactive contexts to access the full state:
watchEffect(
    async () => match(email.read(), {
        Unvalidated: () => null,
        Valid:       ({ value })  => submit(value),
        Invalid:     ({ errors }) => displayErrors(errors),
    }),
    onChange,
)
```

---

## See also

- [`Derived`](./derived.md) — lazy computed values derived from signals
- [`watchEffect`](./effect.md#watcheffect) — run async effects reactively
- [`batch`](./context.md#batch) — coalesce multiple writes into a single notification pass
- [`persistedSignal`](./persist.md#persistedsignal) — automatically persist a signal to storage
