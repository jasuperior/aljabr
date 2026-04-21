# API Reference: Signals

```ts
import { signal, memo, effect, scope, query, context } from "aljabr/signals"
import type { Getter, Setter, StateSetter, SignalProtocol } from "aljabr/signals"
```

---

## Overview

`aljabr/signals` is the ergonomic factory layer over the reactive primitives in `aljabr/prelude`. Each factory returns plain functions and tuples rather than class instances, matching the style of fine-grained reactive libraries.

All factories integrate with the reactive owner tree — signals and deriveds created inside a reactive context are automatically disposed when the context is torn down.

---

## Types

### `Getter<T, S>`

```ts
type Getter<T, S> = {
    (): T | null        // tracked call — registers a reactive dependency
    state(): S          // tracked state read — returns the full state union
}
```

A callable getter with an attached `.state()` accessor. Calling `getter()` inside a reactive context (an `effect`, `memo`, or `query` thunk) subscribes to value changes. Calling `getter.state()` subscribes to all state transitions, including those where the extracted value is `null`.

Use `getter.state()` when you need to `match` on the full union rather than just extract a value.

### `Setter<T>`

```ts
type Setter<T> = (value: T | ((prev: T | null) => T)) => void
```

Write a new value to a default `signal<T>`. Accepts either a raw value or a function that receives the previous extracted value (`T | null`).

```ts
const [count, setCount] = signal(0)
setCount(1)                        // raw value
setCount(prev => (prev ?? 0) + 1)  // functional — prev is T | null
```

### `StateSetter<S>`

```ts
type StateSetter<S> = (value: S | ((prev: S) => S)) => void
```

Write a new state variant to a `signal.protocol` signal. Accepts either a raw state variant or a function that receives the previous full state `S`. Unlike `Setter<T>`, the functional form receives `S` directly — not `T | null` — because the full state is always available.

```ts
const [ws, setWs] = signal.protocol(WsState.Connecting(), wsProtocol)
setWs(WsState.Open(socket))                                      // raw variant
setWs(prev => getTag(prev) === "Open" ? WsState.Closing() : prev) // functional
```

### `SignalProtocol<S, T>`

Re-exported from `aljabr/prelude` for convenience. Describes how to read `T` from a custom state union `S`.

```ts
type SignalProtocol<S, T> = {
    extract:     (state: S) => T | null
    isTerminal?: (state: S) => boolean
}
```

See [`SignalProtocol`](./prelude/signal.md#signalprotocols-t) in the prelude docs for full details.

---

## `signal<T>()`

```ts
signal<T>(): [Getter<T, SignalState<T>>, Setter<T>]
signal<T>(initial: T): [Getter<T, SignalState<T>>, Setter<T>]
```

Create a reactive mutable value. Returns a `[getter, setter]` tuple.

- With no argument, the signal starts `Unset` — `getter()` returns `null` until the first `setter()` call.
- With an initial value, the signal starts `Active`.

```ts
const [count, setCount] = signal(0)

count()         // 0
setCount(1)
count()         // 1

// Functional update
setCount(prev => (prev ?? 0) + 1)
count()         // 2

// State inspection
import { match } from "aljabr"
match(count.state(), {
    Unset:    () => "no value",
    Active:   ({ value }) => `value: ${value}`,
    Disposed: () => "cleaned up",
})
```

---

## `signal.protocol<T, S>()`

```ts
signal.protocol<T, S>(
    initial: S,
    protocol: SignalProtocol<S, T>,
): [Getter<T, S>, StateSetter<S>]
```

Create a reactive signal whose lifecycle state is a **custom union `S`** rather than the default `SignalState<T>`. Returns a `[getter, setter]` tuple where the setter accepts full `S` variants.

- `T` — the extracted value type (what `getter()` returns when a value is available)
- `S` — the custom state union (what `getter.state()` returns)

The `protocol` maps your union to readable values:
- `extract(state)` — return `T` for states that carry a value, `null` otherwise
- `isTerminal?(state)` — return `true` to permanently freeze the signal after that state is set

> **Type parameter order:** `<T, S>` puts the value type first. `T` is what you name explicitly when needed; `S` is almost always inferred from `initial`. The underlying `SignalProtocol<S, T>` type still places the state first — this asymmetry exists at the type alias level only.

### Example A — Domain lifecycle (WebSocket)

```ts
import { signal } from "aljabr/signals"
import { union, match, getTag, type Variant } from "aljabr"

type WsState =
    | Variant<"Connecting", { value: null }>
    | Variant<"Open",       { value: WebSocket }>
    | Variant<"Closing",    { value: null }>
    | Variant<"Closed",     { value: null }>

const WsState = union().typed({
    Connecting: () => ({ value: null }) as Variant<"Connecting", { value: null }>,
    Open:       (ws: WebSocket) => ({ value: ws }) as Variant<"Open", { value: WebSocket }>,
    Closing:    () => ({ value: null }) as Variant<"Closing", { value: null }>,
    Closed:     () => ({ value: null }) as Variant<"Closed", { value: null }>,
})

const [ws, setWs] = signal.protocol(WsState.Connecting(), {
    extract: (s) => match(s, {
        Open:       ({ value }) => value,
        Connecting: () => null,
        Closing:    () => null,
        Closed:     () => null,
    }),
    isTerminal: (s) => getTag(s) === "Closed",
})

ws()          // null — Connecting, no socket yet
ws.state()    // Variant<"Connecting", ...>  (tracked)

setWs(WsState.Open(socket))
ws()          // WebSocket

setWs(WsState.Closed())
ws()          // null — terminal state; further setWs() calls are no-ops
```

### Example B — Value-enriched form field (Validation)

```ts
import { signal } from "aljabr/signals"
import { Validation, type Validation as V } from "aljabr/prelude"
import { match } from "aljabr"

const [email, setEmail] = signal.protocol(
    Validation.Unvalidated("") as V<string, string>,
    {
        extract: (s) => match(s, {
            Unvalidated: ({ value }) => value,
            Valid:        ({ value }) => value,
            Invalid:      ({ value }) => value,
        }),
    },
)

email()         // ""           — Unvalidated, raw value accessible
email.state()   // Unvalidated  — full union, tracked

setEmail(Validation.Valid("ada@example.com"))
email()         // "ada@example.com"

setEmail(Validation.Invalid({ value: "bad@", errors: ["bad format"] }))
email()         // "bad@"       — value still accessible

// Inside a reactive context, match on the full state:
effect(() => {
    match(email.state(), {
        Unvalidated: () => clearErrors(),
        Valid:        ({ value }) => submit(value),
        Invalid:      ({ errors }) => showErrors(errors),
    })
})
```

### Functional state updates

The `StateSetter<S>` supports a functional form that receives the current full state:

```ts
// Guard-based transition — only close if currently open
setWs(prev => getTag(prev) === "Open" ? WsState.Closing() : prev)
```

---

## `memo<T>()`

```ts
memo<T>(fn: () => T): Getter<T, DerivedState<T>>
```

Create a lazy computed value that re-evaluates only when read after a dependency changes. Signal reads inside `fn` are tracked automatically.

```ts
const [count, setCount] = signal(0)
const doubled = memo(() => (count() ?? 0) * 2)

doubled()         // 0  — evaluated on first read
setCount(5)
doubled()         // 10 — re-evaluates because count changed

// State inspection
import { match } from "aljabr"
match(doubled.state(), {
    Uncomputed: () => "not yet run",
    Computed:   ({ value }) => `value: ${value}`,
    Stale:      ({ value }) => `stale: ${value}`,
    Disposed:   () => "cleaned up",
})
```

---

## `effect()`

```ts
effect(fn: () => void): () => void
```

Run a reactive side effect. `fn` is called immediately and re-runs whenever any signal read inside it changes. Returns a disposer function.

```ts
const [name, setName] = signal("Alice")

const stop = effect(() => {
    console.log("name is:", name())
})
// logs "name is: Alice" immediately

setName("Bob")
// logs "name is: Bob"

stop()
setName("Carol")
// no log — effect stopped
```

---

## `scope<T>()`

```ts
scope<T>(fn: (dispose: () => Promise<Defect[]>) => T): [T, () => Promise<Defect[]>]
```

Create a disposable reactive boundary. All signals and effects created inside `fn` are owned by the scope and disposed together. Returns `[value, dispose]`.

The `dispose` function is also injected as the first argument to `fn`, allowing the scope to terminate itself from within (e.g., from an effect that detects a terminal condition).

```ts
const [value, dispose] = scope(() => {
    const [count, setCount] = signal(0)
    effect(() => console.log("count:", count()))
    return { count, setCount }
})

value.setCount(1)   // logs "count: 1"

const defects = await dispose()
value.setCount(2)   // no-op — scope disposed
```

---

## `query<T, E>()`

```ts
query<T, E = unknown>(
    fn: (signal: AbortSignal, scope: ScopeHandle) => Promise<T>,
    options?: AsyncOptions<E>,
): [Getter<T, AsyncDerivedState<T, E>>, { refetch(): void }]
```

Create an async derived value with manual refetch control. `fn` is lazy — it runs only when the getter is first called, and re-runs on `refetch()` or when a reactive dependency inside `fn` changes.

State transitions: `Uncomputed → Loading → Ready<T>` on success, `→ Failed<E>` on error, `→ Reloading<T>` during a subsequent fetch (preserving the last known value).

```ts
const [userId, setUserId] = signal(1)

const [user, { refetch }] = query(async (abortSignal) => {
    const id = userId()
    const res = await fetch(`/api/users/${id}`, { signal: abortSignal })
    return res.json()
})

user()          // null — Uncomputed until first call triggers evaluation
await tick()
user()          // { id: 1, name: "Alice" } — Ready

refetch()       // re-runs fn; state goes Reloading while loading

// State inspection
import { match } from "aljabr"
effect(() => {
    match(user.state(), {
        Uncomputed:  () => null,
        Loading:     () => showSpinner(),
        Ready:       ({ value }) => renderUser(value),
        Reloading:   ({ value }) => renderUser(value),  // stale-while-revalidating
        Failed:      ({ fault }) => showError(fault),
        Disposed:    () => null,
    })
})
```

---

## `context<T>()`

```ts
context<T>(defaultValue: T): Context<T>

type Context<T> = {
    provide(value: T, fn: () => void): void
    use(): T
}
```

Thread a value through the reactive owner tree without prop drilling. `provide()` makes a value available to all `use()` calls within its `fn` subtree. Nested providers shadow outer ones for the same context token.

```ts
const Theme = context<"light" | "dark">("light")

// Provide a value to a subtree
Theme.provide("dark", () => {
    const theme = Theme.use()  // "dark"
    effect(() => applyTheme(theme))
})

// Outside the provider, falls back to default
Theme.use()  // "light"
```

---

## See also

- [`Signal<T, S>`](./prelude/signal.md) — the underlying reactive container with full lifecycle docs
- [`SignalProtocol<S, T>`](./prelude/signal.md#signalprotocols-t) — protocol type reference
- [`DerivedState<T>`](./prelude/derived.md) — state union returned by `memo().state()`
- [`AsyncDerivedState<T, E>`](./prelude/derived.md#asyncderivedstateT-E) — state union returned by `query().state()`
- [`Defect`](./prelude/fault.md) — the error type returned by `scope().dispose()`
- [`AsyncOptions<E>`](./prelude/schedule.md#asyncoptionse) — retry/timeout options for `query()`
