# API Reference: Effect / watchEffect

```ts
import {
    Effect,
    watchEffect,
    type Idle,
    type Running,
    type Done,
    type Stale,
    type Failed,
    type Fault,
    type ScopeHandle,
} from "aljabr/prelude"
```

---

## Overview

`Effect<T, E>` is a five-variant union representing the lifecycle of an async computation: not yet run (`Idle`), currently executing (`Running`), completed successfully (`Done`), previously completed but with stale dependencies (`Stale`), or failed (`Failed`). All variants share `.run()`, `.map()`, `.flatMap()`, and `.recover()` via the `Computable<T, E>` impl mixin.

`watchEffect` is the reactive runner: it executes an async thunk with automatic dependency tracking and calls a callback whenever a tracked dependency changes or the thunk settles.

Failures in both APIs are represented as [`Fault<E>`](./fault.md) — a three-variant union that distinguishes expected domain errors (`Fail<E>`), unexpected panics (`Defect`), and aborted computations (`Interrupted`).

---

## `Effect<T, E>`

### Variants

| Variant | Payload | Meaning |
|---|---|---|
| `Idle<T, E>` | `{ thunk: (signal: AbortSignal) => Promise<T> }` | Created but not yet run |
| `Running<T, E>` | `{ pending: Promise<Done<T, E> \| Failed<T, E>> }` | Currently executing |
| `Done<T, E>` | `{ value: T }` | Execution completed successfully |
| `Stale<T, E>` | `{ value: T \| null; thunk: () => Promise<T> }` | Previously done; one or more dependencies have since changed |
| `Failed<T, E>` | `{ fault: Fault<E>; attempts: number; nextRetryAt: number \| null }` | Execution failed; `nextRetryAt` is set when a retry is scheduled |

`nextRetryAt` is a millisecond timestamp of the next scheduled retry attempt, or `null` when the effect has given up (max retries exceeded, `shouldRetry` returned `false`, or a `Custom` schedule returned `null`).

`fault` is a [`Fault<E>`](./fault.md): `Fault.Fail<E>` for domain errors thrown via `throw Fault.Fail(e)`, `Fault.Defect` for unexpected panics, and `Fault.Interrupted` when the `AbortSignal` fired.

### Factories

```ts
Effect.Idle<T, E>(thunk: (signal: AbortSignal) => Promise<T>): Idle<T, E>
Effect.Running<T, E>(pending: Promise<Done<T, E> | Failed<T, E>>): Running<T, E>
Effect.Done<T, E>(value: T): Done<T, E>
Effect.Stale<T, E>(value: T | null, thunk: () => Promise<T>): Stale<T, E>
Effect.Failed<T, E>(fault: Fault<E>, attempts: number, nextRetryAt: number | null): Failed<T, E>
```

---

## `Computable<T, E>` — shared behavior

### `.run()`

```ts
effect.run(): Promise<Done<T, E> | Failed<T, E>>
```

Execute the effect and return a settled result. Behavior by current state:

- `Idle` — runs the thunk, returns `Done` on success or `Failed` on error.
- `Running` — awaits the existing in-flight promise and returns its result.
- `Done` — resolves immediately with the existing `Done`.
- `Stale` — re-runs the thunk with a fresh `AbortController`.
- `Failed` — resolves immediately with the existing `Failed`.

```ts
const effect = Effect.Idle(async (signal) => {
    const res = await fetch("/api/data", { signal })
    return res.json()
})

const result = await effect.run()
match(result, {
    Done:   ({ value }) => console.log("got:", value),
    Failed: ({ fault }) => console.error("failed:", fault),
})
```

### `.map<U>(fn)`

```ts
effect.map<U>(fn: (value: T) => U): Idle<U, E>
```

Transform the success value. Returns a new `Idle` whose thunk runs the original effect and applies `fn` to the resolved value. Does not execute immediately.

```ts
const names = Effect.Idle(async (signal) => fetchUsers(signal))
    .map(users => users.map(u => u.name))

const result = await names.run()
match(result, {
    Done:   ({ value }) => console.log(value), // string[]
    Failed: ({ fault }) => console.error(fault),
})
```

### `.flatMap<U>(fn)`

```ts
effect.flatMap<U>(fn: (value: T) => Effect<U, E>): Idle<U, E>
```

Chain two effects sequentially. The second effect is created from the first's success value. Both run in sequence. Returns a new `Idle`.

```ts
const user    = Effect.Idle(async (signal) => fetchUser(1, signal))
const profile = user.flatMap(u =>
    Effect.Idle(async (signal) => fetchProfile(u.id, signal))
)

const result = await profile.run()
```

### `.recover<F>(fn)`

```ts
effect.recover<F>(fn: (fault: Fault<E>) => Effect<T, F>): Idle<T, F>
```

Handle a failure by running a fallback effect. If the original succeeds, its value passes through unchanged. If it fails, `fn` is called with the [`Fault<E>`](./fault.md) and the fallback runs.

```ts
const data = Effect.Idle(async (signal) => fetchFromPrimary(signal))
    .recover(() => Effect.Idle(async (signal) => fetchFromFallback(signal)))

const result = await data.run()
```

To inspect the fault before deciding on a fallback:

```ts
import { match } from "aljabr"

const data = Effect.Idle<Data, ApiError>(async (signal) => fetchData(signal))
    .recover((fault) => match(fault, {
        Fail:        ({ error }) => error.status === 404
            ? Effect.Done(defaultData)
            : Effect.Idle(async (signal) => fetchFromCache(signal)),
        Defect:      () => Effect.Done(defaultData),
        Interrupted: () => Effect.Done(defaultData),
    }))
```

---

## `watchEffect`

```ts
function watchEffect<T, E = never>(
    thunk: (signal: AbortSignal, scope: ScopeHandle) => Promise<T>,
    onChange: (result: Done<T, E> | Stale<T, E> | Failed<T, E>) => void,
    options?: WatchOptions<E>,
): { stop(): void }
```

Run an async thunk with automatic reactive dependency tracking. Any `Signal.get()` calls inside `thunk` are recorded as dependencies. When a dependency changes, `onChange` is called with a `Stale` (lazy mode) or a new `Done`/`Failed` (eager mode).

The thunk runs immediately on creation. The `onChange` callback is **not** called for the initial run — only for subsequent dependency changes. If the initial run fails and a `schedule` is configured, the first retry queues silently.

Failures are classified as [`Fault<E>`](./fault.md): `Fault.Fail<E>` when the thunk throws `Fault.Fail(e)`, `Fault.Interrupted` when the `AbortSignal` fires, and `Fault.Defect` for any other thrown value. Only `Fault.Fail` is retried by default — override via `shouldRetry`.

Returns a handle with `stop()` to cancel tracking, abort any in-flight request, and dispose the underlying computation.

### `AbortSignal` threading

The thunk receives an `AbortSignal` as its first argument. The signal is aborted automatically before each new attempt (dep change or retry), preventing stale in-flight requests from resolving into current state.

```ts
watchEffect(
    async (signal) => {
        const res = await fetch("/api/data", { signal })
        return res.json()
    },
    onChange,
)
```

### `Scope` threading

The thunk receives a fresh `Scope` as its second argument on every execution. Use it to register cleanup logic that runs when the effect re-runs or stops. The previous run's scope disposes before each new run begins.

```ts
watchEffect(
    async (signal, scope) => {
        const db = await scope.acquire(DbResource)  // released when scope disposes
        return db.query("SELECT * FROM items", { signal })
    },
    onChange,
)
```

See [`Scope & Resource`](./scope.md) for the full resource management API.

### Parameters

| Parameter | Type | Description |
|---|---|---|
| `thunk` | `(signal: AbortSignal, scope: ScopeHandle) => Promise<T>` | The async computation to run and track |
| `onChange` | `(result: Done \| Stale \| Failed) => void` | Called when a dependency changes or the thunk settles after a retry |
| `options.eager` | `boolean` | Default `false`. When `true`, re-runs the thunk automatically on every dep change; `onChange` receives `Done` or `Failed`. When `false`, `onChange` receives `Stale` and the caller decides when to re-run. |
| `options.schedule` | `Schedule` | Retry-delay policy. Enables automatic retry on failure. |
| `options.maxRetries` | `number` | Hard cap on retry attempts. |
| `options.shouldRetry` | `(fault: Fault<E>) => boolean` | Return `false` to suppress retrying for a specific fault. Defaults to retrying only `Fault.Fail`. |
| `options.timeout` | `number` | Abort the thunk after this many ms; the aborted run surfaces as `Fault.Interrupted`. |
| `options.afterRetry` | `(attempt, fault, nextDelay) => void` | Called just before each retry fires. |

### Lazy mode (default)

`onChange` receives a `Stale` value. The caller controls when the thunk re-runs by calling `.run()` on it.

```ts
import { Signal, watchEffect } from "aljabr/prelude"

const src = Signal.create("hello")

const handle = watchEffect(
    async (signal) => {
        const q = src.get()!
        return fetch(`/api/search?q=${q}`, { signal }).then(r => r.json())
    },
    (result) => {
        match(result, {
            Stale: (stale) => {
                // Re-run when ready — e.g. on next user interaction
                stale.run().then(r => match(r, {
                    Done:   ({ value }) => renderResults(value),
                    Failed: ({ fault }) => renderError(fault),
                }))
            },
            Done:   ({ value }) => renderResults(value),
            Failed: ({ fault }) => renderError(fault),
        })
    },
)

src.set("world")  // onChange called with Stale
handle.stop()     // stop tracking
```

### Eager mode

`onChange` receives `Done` or `Failed` — the thunk has already re-run by the time `onChange` fires.

```ts
const handle = watchEffect(
    async (signal) => fetch("/api/data", { signal }).then(r => r.json()),
    (result) => {
        match(result, {
            Done:   ({ value }) => setState(value),
            Failed: ({ fault, nextRetryAt }) =>
                nextRetryAt
                    ? showRetryBanner(`Retrying at ${new Date(nextRetryAt).toLocaleTimeString()}`)
                    : showError(fault),
            Stale:  () => {},  // never fires in eager mode
        })
    },
    {
        eager:    true,
        schedule: Schedule.Exponential({ initialDelay: 100, maxDelay: 30_000 }),
    },
)
```

---

## Pattern matching on `Effect`

```ts
match(effect, {
    Idle:    ()               => "not started",
    Running: ()               => "in flight",
    Done:    ({ value })      => `success: ${value}`,
    Stale:   ({ value })      => `stale (was: ${value}), recomputing…`,
    Failed:  ({ fault, nextRetryAt }) =>
        nextRetryAt ? `retrying at ${nextRetryAt}` : `failed: ${fault}`,
})
```

---

## Type definitions

```ts
type Effect<T, E = never> = Idle<T, E> | Running<T, E> | Done<T, E> | Stale<T, E> | Failed<T, E>

type Idle<T, E>    = Variant<"Idle",    { thunk: (signal: AbortSignal) => Promise<T> }, Computable<T, E>>
type Running<T, E> = Variant<"Running", { pending: Promise<Done<T, E> | Failed<T, E>> }, Computable<T, E>>
type Done<T, E>    = Variant<"Done",    { value: T }, Computable<T, E>>
type Stale<T, E>   = Variant<"Stale",   { value: T | null; thunk: () => Promise<T> }, Computable<T, E>>
type Failed<T, E>  = Variant<"Failed",  { fault: Fault<E>; attempts: number; nextRetryAt: number | null }, Computable<T, E>>
```

---

## Examples

### Sequential pipeline

```ts
const pipeline = Effect.Idle(async (signal) => readFile("input.txt", signal))
    .map(contents => contents.trim().split("\n"))
    .map(lines => lines.filter(l => l.startsWith(">")))
    .flatMap(lines =>
        Effect.Idle(async (signal) => writeFile("output.txt", lines.join("\n"), signal))
    )

const result = await pipeline.run()
match(result, {
    Done:   () => console.log("written"),
    Failed: ({ fault }) => console.error(fault),
})
```

### Reactive fetch with stale-while-revalidating

```ts
import { Signal, watchEffect } from "aljabr/prelude"

const userId = Signal.create(1)

const handle = watchEffect(
    async (signal) => {
        const id = userId.get()!
        return fetch(`/api/users/${id}`, { signal }).then(r => r.json())
    },
    (result) => {
        match(result, {
            Stale: (stale) => {
                // Show stale data while re-fetching
                renderUser(stale.value!, /* stale */ true)
                stale.run().then(r => match(r, {
                    Done:   ({ value }) => renderUser(value),
                    Failed: ({ fault }) => renderError(fault),
                }))
            },
            Done:   ({ value }) => renderUser(value),
            Failed: ({ fault }) => renderError(fault),
        })
    },
)

userId.set(2)  // stale user 1 data still shown while user 2 loads
```

---

## See also

- [`Fault`](./fault.md) — the three-variant error union carried by `Failed`
- [`Signal`](./signal.md) — the reactive sources that `watchEffect` tracks
- [`AsyncDerived`](./derived.md#asyncderivedt-e) — pull-based async computed values with the same retry API
- [`Scope & Resource`](./scope.md) — structured resource management; each `watchEffect` run gets a fresh scope
- [`Schedule`](./schedule.md) — retry-delay policies (`Fixed`, `Linear`, `Exponential`, `Custom`)
- [`batch`](./context.md#batch) — coalesce multiple signal writes before the effect re-runs
- [Resilient async guide](../../guides/resilient-async.md) — walkthrough of retry, backoff, and timeout patterns
