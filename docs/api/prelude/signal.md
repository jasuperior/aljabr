# API Reference: Signal

```ts
import { Signal, SignalState, type Active, type Unset, type Disposed } from "aljabr/prelude"
```

---

## Overview

`Signal<T>` is a reactive mutable value container. Reading a signal inside a reactive context (a [`Derived`](./derived.md) computation or a [`watchEffect`](./effect.md#watcheffect) callback) automatically registers it as a dependency — writing via `set()` notifies all current dependents.

The lifecycle of a signal's value is represented as `SignalState<T>`, a pattern-matchable union with three variants: `Unset`, `Active`, and `Disposed`.

---

## `Signal<T>`

### `Signal.create()`

```ts
Signal.create<T>(): Signal<T>            // starts Unset
Signal.create<T>(initial: T): Signal<T>  // starts Active
```

Creates a new signal. If created inside a reactive owner (e.g. inside a `Derived` computation), the signal is automatically disposed when the owner is disposed.

```ts
const count    = Signal.create(0)     // Active
const deferred = Signal.create<number>() // Unset
```

### `.get()`

```ts
signal.get(): T | null
```

Read the current value. If called inside a reactive context, registers this signal as a dependency of that computation. Returns `null` if the signal is `Unset` or `Disposed`.

```ts
const doubled = Derived.create(() => (count.get() ?? 0) * 2)
```

### `.peek()`

```ts
signal.peek(): T | null
```

Read the current value without registering a dependency. Use when you need the value for a one-off read and don't want the calling computation to re-run when the signal changes.

```ts
// Safe to call anywhere — won't create a reactive subscription
const snapshot = count.peek()
```

### `.set(value)`

```ts
signal.set(value: T): void
```

Write a new value and synchronously notify all current dependents. No-op if the signal has been disposed.

```ts
count.set(1)    // dependents of count are notified
count.set(count.peek()! + 1)  // increment (peek avoids re-subscription)
```

### `.dispose()`

```ts
signal.dispose(): void
```

Transition to `Disposed` and clear all subscriber registrations. After disposal, `set()` is a no-op and `get()` returns `null`.

```ts
count.dispose()
count.peek() // null
count.set(99) // no-op
```

### `.state`

```ts
signal.state: SignalState<T>
```

The current lifecycle state as a pattern-matchable value. Useful when you need to distinguish between "no value yet", "has a value", and "cleaned up".

```ts
match(signal.state, {
    Unset:    () => "waiting for a value",
    Active:   ({ value }) => `current value: ${value}`,
    Disposed: () => "signal has been cleaned up",
})
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

---

## See also

- [`Derived`](./derived.md) — lazy computed values derived from signals
- [`watchEffect`](./effect.md#watcheffect) — run async effects reactively
- [`batch`](./context.md#batch) — coalesce multiple writes into a single notification pass
- [`persistedSignal`](./persist.md#persistedsignal) — automatically persist a signal to storage
