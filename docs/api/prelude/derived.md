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

### `Derived.create({ get, set })`

```ts
Derived.create<T>(options: { get: () => T; set: (value: T) => void }): Derived<T>
```

Create a writable derived value. The `set` handler must update the upstream `Signal`(s) that feed into this derivation; calling `derived.set()` does not bypass the getter. The derived re-evaluates on the next `.get()` after those upstream signals change.

```ts
const firstName = Signal.create("ada")
const lastName  = Signal.create("lovelace")

const fullName = Derived.create({
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

### `.peek()`

```ts
derived.peek(): T | null
```

Read the last known value without triggering re-evaluation or registering a dependency. Returns `null` if never computed or disposed.

### `.set(value)`

```ts
derived.set(value: T): void
```

Write a value via the `set` handler provided to `Derived.create({ get, set })`.

Throws if called on a read-only derived (created without a `set` handler).

### `.dispose()`

```ts
derived.dispose(): void
```

Dispose this derived and clear all subscriptions. Downstream computations that depend on this derived will be notified as stale.

### `.state`

```ts
derived.state: DerivedState<T>
```

The current lifecycle state. Pattern-match to distinguish not-yet-computed, fresh, stale, and disposed.

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
match(derived.state, {
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
async derived.get(): Promise<T>
```

Read the current value, triggering evaluation if the state is `Uncomputed`, `Reloading`, or `Failed`. Registers this derived as a dependency in the active tracking context.

Rejects with a `Fault<E>` if the computation failed (state transitions to `Failed`). Rejects with an `Error` if the derived is `Disposed`.

```ts
const user = await profile.get() // triggers fetch on first call
userId.set(2)
const user2 = await profile.get() // re-fetches for user 2
```

To handle failure without throwing, match on `.state` before calling `.get()`, or use `.peek()` for the last known value.

### `.peek()`

```ts
derived.peek(): T | null
```

Read the last known value synchronously without triggering re-evaluation or registering a dependency.

### `.dispose()`

```ts
derived.dispose(): void
```

Dispose the derived and clear all subscriptions.

### `.state`

```ts
derived.state: AsyncDerivedState<T, E>
```

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

match(profile.state, {
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
if (profile.state.hasValue()) {
    renderProfile(profile.state.getValue()!)
}

const fault = profile.state.getFault()
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

await results.get() // []
query.set("hello")
results.state       // Reloading (prior empty array preserved)
await results.get() // [...search results for "hello"]
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

match(user.state, {
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
- [`watchEffect`](./effect.md#watcheffect) — run async side effects reactively
- [`Schedule`](./schedule.md) — retry-delay policies for `AsyncOptions`
- [`batch`](./context.md#batch) — coalesce multiple signal writes
- [`runInContext`](./context.md#runincontext) — preserve reactive ownership across async boundaries
- [Resilient async guide](../../guides/resilient-async.md) — retry, backoff, and timeout patterns
