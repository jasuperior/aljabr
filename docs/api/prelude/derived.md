# API Reference: Derived / AsyncDerived

```ts
import {
    Derived,
    AsyncDerived,
    type DerivedState,
    type AsyncDerivedState,
    type Fault,
} from "aljabr/prelude"
```

---

## Overview

`Derived<T>` and `AsyncDerived<T, E>` are lazy computed reactive values. They re-evaluate their computation only when read after one of their dependencies (signals or other deriveds) has changed — a pull-based model similar to `createMemo` in Solid.js.

Both expose a `state` property that is a pattern-matchable lifecycle union, so you can render stale-while-revalidating: the last known value is preserved in `Stale`/`Reloading` states while a new computation is in flight.

---

## `Derived<T>`

### `Derived.create(fn)`

```ts
Derived.create<T>(fn: () => T): Derived<T>
```

Create a read-only derived value. `fn` is called lazily — on the first `.get()` and on any subsequent `.get()` after a dependency has changed.

```ts
const name  = Signal.create("ada")
const upper = Derived.create(() => name.get()!.toUpperCase())

upper.get() // "ADA"
name.set("grace")
upper.get() // "GRACE" — re-evaluated
```

### `Derived.writable({ get, set })`

```ts
Derived.writable<T>(options: { get: () => T; set: (value: T) => void }): WritableDerived<T>
```

Create a writable derived value. Returns `WritableDerived<T>`, which extends `Derived<T>` and adds `.set(value)`. A variable typed `Derived<T>` accepts either factory's return; only `WritableDerived<T>` exposes the setter — calling `.set()` on a read-only `Derived<T>` is a compile-time error.

The `set` handler must update the upstream `Signal`(s) that feed into this derivation; calling `derived.set()` does not bypass the getter. The derived re-evaluates on the next `.get()` after those upstream signals change.

```ts
const firstName = Signal.create("ada")
const lastName  = Signal.create("lovelace")

const fullName = Derived.writable({
    get: () => `${firstName.get()} ${lastName.get()}`,
    set: (v) => {
        const [f, l] = v.split(" ")
        firstName.set(f)
        lastName.set(l)
    },
})

fullName.get()          // "ada lovelace"
fullName.set("grace hopper")
firstName.peek()        // "grace"
lastName.peek()         // "hopper"
```

### `.get()`

```ts
derived.get(): T | null
```

Read the current value. Re-evaluates lazily if the state is `Uncomputed` or `Stale`. Registers this derived as a dependency of the current reactive context.

### `.getOr(default)`

```ts
derived.getOr(defaultValue: T): T
```

Read the current value with a fallback. Tracked. Returns `defaultValue` when the value is `null` (not yet computed or disposed).

### `.peek()`

```ts
derived.peek(): T | null
```

Read the last known value without triggering re-evaluation or registering a dependency. Returns `null` if never computed or disposed.

### `.subscribe(callback)`

```ts
derived.subscribe(callback: (value: T | null) => void): () => void
```

Register a synchronous callback that fires every time this derived computes a new value. Push subscribers force eager re-evaluation when a dependency changes — unlike `.get()`, which is lazy. Returns an unsubscribe function. Subscribers also receive `null` when this derived is disposed. Prefer `watch` for in-graph reactive coordination; reserve `subscribe` for bridging to non-reactive sinks.

### `.set(value)` (`WritableDerived` only)

```ts
writableDerived.set(value: T): void
```

Write a value via the `set` handler provided to `Derived.writable({ get, set })`. Calling `.set()` on a read-only `Derived<T>` is a **compile-time error**.

### `.dispose()` / `[Symbol.dispose]()`

```ts
derived.dispose(): void
```

Dispose this derived and clear all subscriptions. Downstream computations that depend on this derived will be notified as stale. `Symbol.dispose` is also implemented, so a `Derived` can be managed with a `using` block.

### `.state()` / `.peekState()`

```ts
derived.state(): DerivedState<T>
derived.peekState(): DerivedState<T>
```

Read the current lifecycle state. `.state()` registers a dependency in the active tracking context; `.peekState()` does not. Pattern-match to distinguish not-yet-computed, fresh, stale, and disposed.

---

## `DerivedState<T>`

| Variant | Meaning |
|---|---|
| `Uncomputed` | The getter has never been called |
| `Computed<T>` | The getter has run and the value is fresh |
| `Stale<T>` | A dependency changed; the old value is preserved until `.get()` is called |
| `Disposed` | The derived has been disposed |

Both `Computed` and `Stale` carry `{ value: T }`. The stale value is accessible via `.peek()` or by matching `state` directly — useful for rendering stale-while-revalidating.

```ts
match(derived.state(), {
    Uncomputed: () => "never computed",
    Computed:   ({ value }) => `fresh: ${value}`,
    Stale:      ({ value }) => `stale (was: ${value}), recomputing...`,
    Disposed:   () => "cleaned up",
})
```

### Type definitions

```ts
type DerivedState<T> =
    | Variant<"Uncomputed", { value: null }>
    | Variant<"Computed",   { value: T }>
    | Variant<"Stale",      { value: T }>
    | Variant<"Disposed",   { value: null }>
```

---

## `AsyncDerived<T, E>`

Like `Derived`, but the computation is `async`. State includes `Loading` (first run, no prior value) and `Reloading` (re-run after a dep change, stale value preserved).

### `AsyncDerived.create(fn, options?)`

```ts
AsyncDerived.create<T, E = unknown>(
    fn: (signal: AbortSignal, scope: ScopeHandle) => Promise<T>,
    options?: AsyncOptions<E>,
): AsyncDerived<T, E>
```

The thunk receives two arguments on every evaluation:

- **`signal: AbortSignal`** — aborted before each new attempt (dep change or retry) to cancel stale in-flight requests.
- **`scope: ScopeHandle`** — a fresh `Scope` for each evaluation. Register cleanup logic via `scope.defer()` or acquire resources via `scope.acquire()`. The previous evaluation's scope disposes before the next begins.

Pass `options` to enable automatic retry, timeouts, and observability hooks. See [`AsyncOptions`](./schedule.md#asyncoptionse) for the full option set.

```ts
import { Signal, AsyncDerived, Schedule } from "aljabr/prelude"

const userId  = Signal.create(1)
const profile = AsyncDerived.create(async (signal) => {
    const id = userId.get()!
    const res = await fetch(`/api/users/${id}`, { signal })
    return res.json() as Promise<UserProfile>
})
```

With resource cleanup:

```ts
const data = AsyncDerived.create(async (signal, scope) => {
    const db = await scope.acquire(DbResource)  // released when this evaluation ends
    return db.query(`SELECT * FROM users WHERE id = ${userId.get()!}`)
})
```

With retry:

```ts
const data = AsyncDerived.create(
    async (signal) => fetchData(signal),
    {
        schedule:    Schedule.Exponential({ initialDelay: 100, maxDelay: 30_000 }),
        maxRetries:  5,
        afterRetry:  (attempt, fault, delay) =>
            console.warn(`attempt ${attempt} failed, retrying in ${delay} ms`, fault),
    },
)
```

### `.get()`

```ts
asyncDerived.get(): T | null
```

Read the last-known extracted value **synchronously**. Tracked — registers this derived as a dependency in the active tracking context, but does **not** trigger evaluation. Returns `null` until the first successful evaluation completes via `.run()`. After `Ready`/`Reloading` transitions, the value is preserved here. Mirrors `Signal.get()` semantics.

> **Migration:** prior to v0.3.10, `get()` was async (`Promise<T>`). For the awaitable form, use `.run()` (or `.runOr(default)`).

### `.run()`

```ts
asyncDerived.run(): Promise<Done<T, E> | Failed<T, E>>
```

Trigger evaluation if needed and resolve to the settled state. Mirrors `Effect.run()` so callers pattern-match with the same vocabulary. Tracked.

```ts
const user = await profile.run() // triggers fetch on first call
match(user, {
    Done:   ({ value }) => render(value),
    Failed: ({ fault }) => showError(fault),
})
```

### `.runOr(default)`

```ts
asyncDerived.runOr(defaultValue: T): Promise<T>
```

Awaitable form with a fallback. Resolves to the produced value on `Done`, or `defaultValue` on `Failed`. Tracked.

### `.getOr(default)`

```ts
asyncDerived.getOr(defaultValue: T): T
```

Synchronous read with a fallback. Tracked. Returns `defaultValue` until a value is available.

### `.peek()`

```ts
asyncDerived.peek(): T | null
```

Read the last known value synchronously without registering a dependency.

### `.subscribe(callback)`

```ts
asyncDerived.subscribe(callback: (value: T | null) => void): () => void
```

Register a synchronous callback that fires when this derived's extracted value changes. Returns an unsubscribe function.

### `.dispose()` / `[Symbol.dispose]()`

```ts
asyncDerived.dispose(): void
```

Dispose the derived, abort any in-flight thunk, and clear all subscriptions.

### `.state()` / `.peekState()`

```ts
asyncDerived.state(): AsyncDerivedState<T, E>
asyncDerived.peekState(): AsyncDerivedState<T, E>
```

Read the lifecycle state. `.state()` is tracked; `.peekState()` is not.

---

## `AsyncDerivedState<T, E>`

| Variant | Meaning |
|---|---|
| `Uncomputed` | Never been evaluated |
| `Loading` | First evaluation in progress; no prior value |
| `Ready<T>` | Computation completed successfully; value is fresh |
| `Reloading<T>` | A dependency changed; stale value preserved; new computation in flight |
| `Failed<E>` | The computation failed; exposes fault and retry context |
| `Disposed` | The derived has been disposed |

`Reloading` is the key stale-while-revalidating state: the prior `value` is still accessible while the new fetch runs.

`Failed` carries `{ fault, attempts, nextRetryAt }`. The `fault` is a [`Fault<E>`](./fault.md) — one of `Fail<E>`, `Defect`, or `Interrupted`. When `nextRetryAt` is a non-null timestamp, the scheduler has queued the next attempt automatically. When it is `null`, the derived has given up.

```ts
import { match } from "aljabr"
import { Fault } from "aljabr/prelude"

match(profile.state(), {
    Uncomputed: () => null,
    Loading:    () => <Spinner />,
    Ready:      ({ value }) => <Profile user={value} />,
    Reloading:  ({ value }) => <Profile user={value} stale />,
    Failed:     ({ fault, nextRetryAt }) =>
        nextRetryAt
            ? <RetryBanner at={nextRetryAt} />
            : <ErrorView message={describeFault(fault)} />,
    Disposed:   () => null,
})
```

### `.hasValue()` / `.getValue()` / `.getFault()`

All `AsyncDerivedState` variants expose three convenience methods via the `AsyncDerivedLifecycle` trait:

```ts
state.hasValue(): boolean     // true for Ready and Reloading
state.getValue(): T | null    // the value for Ready/Reloading, null otherwise
state.getFault(): Fault<E> | null  // the fault for Failed, null otherwise
```

These are useful as guards when you need a quick null-check without a full `match`:

```ts
const state = profile.state()
if (state.hasValue()) {
    renderProfile(state.getValue()!)
}

const fault = state.getFault()
if (fault) handleFault(fault)
```

### Type definitions

```ts
type AsyncDerivedState<T, E = unknown> =
    | Variant<"Uncomputed", { value: null }>
    | Variant<"Loading",    { value: null }>
    | Variant<"Ready",      { value: T }>
    | Variant<"Reloading",  { value: T }>
    | Variant<"Failed",     { value: null; fault: Fault<E>; attempts: number; nextRetryAt: number | null }>
    | Variant<"Disposed",   { value: null }>
```

---

## Examples

### Derived display string

```ts
const items    = Signal.create<string[]>([])
const count    = Derived.create(() => items.get()?.length ?? 0)
const subtitle = Derived.create(() =>
    count.get() === 0 ? "No items" : `${count.get()} items`
)

subtitle.get()        // "No items"
items.set(["a", "b"])
subtitle.get()        // "2 items"
```

### Async search results

```ts
const query   = Signal.create("")
const results = AsyncDerived.create(async (signal) => {
    const q = query.get()!
    if (!q) return []
    return searchApi(q, signal)
})

await results.run() // Done([])
query.set("hello")
results.peekState() // Reloading (prior empty array preserved)
await results.run() // Done([...search results for "hello"])
```

### Handling failures

```ts
import { match } from "aljabr"
import { Fault } from "aljabr/prelude"

const user = AsyncDerived.create<User, ApiError>(async (signal) => {
    const res = await fetch("/api/me", { signal })
    if (!res.ok) throw Fault.Fail(new ApiError(res.status))
    return res.json()
})

match(user.state(), {
    Loading:  () => showSpinner(),
    Ready:    ({ value }) => render(value),
    Reloading:({ value }) => render(value, /* stale */ true),
    Failed:   ({ fault }) => match(fault, {
        Fail:        ({ error }) => showApiError(error),
        Defect:      ({ thrown }) => showUnexpectedError(thrown),
        Interrupted: () => { /* disposed or superseded — ignore */ },
    }),
    Uncomputed: () => null,
    Disposed:   () => null,
})
```

---

## See also

- [`Signal`](./signal.md) — the mutable source values deriveds subscribe to
- [`Fault`](./fault.md) — the three-variant error union carried by `Failed`
- [`watch`](./effect.md#watch) — run async side effects reactively
- [`Schedule`](./schedule.md) — retry-delay policies for `AsyncOptions`
- [`batch`](./context.md#batch) — coalesce multiple signal writes
- [`runInContext`](./context.md#runincontext) — preserve reactive ownership across async boundaries
- [Resilient async guide](../../guides/resilient-async.md) — retry, backoff, and timeout patterns
