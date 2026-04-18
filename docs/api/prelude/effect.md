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
} from "aljabr/prelude"
```

---

## Overview

`Effect<T, E>` is a five-variant union representing the lifecycle of an async computation: not yet run (`Idle`), currently executing (`Running`), completed successfully (`Done`), previously completed but with stale dependencies (`Stale`), or failed (`Failed`). All variants share `.run()`, `.map()`, `.flatMap()`, and `.recover()` via the `Computable<T, E>` impl mixin.

`watchEffect` is the reactive runner: it executes an async thunk with automatic dependency tracking and calls a callback whenever a tracked dependency changes or the thunk settles.

---

## `Effect<T, E>`

### Variants

| Variant | Payload | Meaning |
|---|---|---|
| `Idle<T, E>` | `{ thunk: (signal: AbortSignal) => Promise<T> }` | Created but not yet run |
| `Running<T, E>` | `{ pending: Promise<Done<T, E> \| Failed<T, E>> }` | Currently executing |
| `Done<T, E>` | `{ value: T }` | Execution completed successfully |
| `Stale<T, E>` | `{ value: T \| null; thunk: () => Promise<T> }` | Previously done; one or more dependencies have since changed |
| `Failed<T, E>` | `{ error: E; attempts: number; nextRetryAt: number \| null }` | Execution failed; `nextRetryAt` is set when a retry is scheduled |

`nextRetryAt` is a millisecond timestamp of the next scheduled retry attempt, or `null` when the effect has given up (max retries exceeded, `shouldRetry` returned `false`, or a `Custom` schedule returned `null`).

### Factories

```ts
Effect.Idle<T, E>(thunk: (signal: AbortSignal) => Promise<T>): Idle<T, E>
Effect.Running<T, E>(pending: Promise<Done<T, E> | Failed<T, E>>): Running<T, E>
Effect.Done<T, E>(value: T): Done<T, E>
Effect.Stale<T, E>(value: T | null, thunk: () => Promise<T>): Stale<T, E>
Effect.Failed<T, E>(error: E, attempts: number, nextRetryAt: number | null): Failed<T, E>
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
    Failed: ({ error }) => console.error("failed:", error),
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
    Failed: ({ error }) => console.error(error),
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
effect.recover<F>(fn: (error: E) => Effect<T, F>): Idle<T, F>
```

Handle a failure by running a fallback effect. If the original succeeds, its value passes through unchanged. If it fails, `fn` is called with the error and the fallback runs.

```ts
const data = Effect.Idle(async (signal) => fetchFromPrimary(signal))
    .recover(() => Effect.Idle(async (signal) => fetchFromFallback(signal)))

const result = await data.run()
```

---

## `watchEffect`

```ts
function watchEffect<T, E = never>(
    thunk: (signal: AbortSignal) => Promise<T>,
    onChange: (result: Done<T, E> | Stale<T, E> | Failed<T, E>) => void,
    options?: WatchOptions<E>,
): { stop(): void }
```

Run an async thunk with automatic reactive dependency tracking. Any `Signal.get()` calls inside `thunk` are recorded as dependencies. When a dependency changes, `onChange` is called with a `Stale` (lazy mode) or a new `Done`/`Failed` (eager mode).

The thunk runs immediately on creation. The `onChange` callback is **not** called for the initial run — only for subsequent dependency changes. If the initial run fails and a `schedule` is configured, the first retry queues silently.

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

### Parameters

| Parameter | Type | Description |
|---|---|---|
| `thunk` | `(signal: AbortSignal) => Promise<T>` | The async computation to run and track |
| `onChange` | `(result: Done \| Stale \| Failed) => void` | Called when a dependency changes or the thunk settles after a retry |
| `options.eager` | `boolean` | Default `false`. When `true`, re-runs the thunk automatically on every dep change; `onChange` receives `Done` or `Failed`. When `false`, `onChange` receives `Stale` and the caller decides when to re-run. |
| `options.schedule` | `Schedule` | Retry-delay policy. Enables automatic retry on failure. |
| `options.maxRetries` | `number` | Hard cap on retry attempts. |
| `options.shouldRetry` | `(error: E) => boolean` | Return `false` to abort retrying for a specific error. |
| `options.timeout` | `number` | Abort the thunk after this many ms; emits `ScheduleError.TimedOut`. |
| `options.onRetry` | `(attempt, error, nextDelay) => void` | Called just before each retry fires. |

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
                    Failed: ({ error }) => renderError(error),
                }))
            },
            Done:   ({ value }) => renderResults(value),
            Failed: ({ error }) => renderError(error),
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
            Failed: ({ error, nextRetryAt }) =>
                nextRetryAt
                    ? showRetryBanner(`Retrying at ${new Date(nextRetryAt).toLocaleTimeString()}`)
                    : showError(error),
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
    Failed:  ({ error, nextRetryAt }) =>
        nextRetryAt ? `retrying at ${nextRetryAt}` : `failed: ${error}`,
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
type Failed<T, E>  = Variant<"Failed",  { error: E; attempts: number; nextRetryAt: number | null }, Computable<T, E>>
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
    Failed: ({ error }) => console.error(error),
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
                    Failed: ({ error }) => renderError(error),
                }))
            },
            Done:   ({ value }) => renderUser(value),
            Failed: ({ error }) => renderError(error),
        })
    },
)

userId.set(2)  // stale user 1 data still shown while user 2 loads
```

---

## See also

- [`Signal`](./signal.md) — the reactive sources that `watchEffect` tracks
- [`AsyncDerived`](./derived.md#asyncderivedt-e) — pull-based async computed values with the same retry API
- [`Schedule`](./schedule.md) — retry-delay policies (`Fixed`, `Linear`, `Exponential`, `Custom`)
- [`batch`](./context.md#batch) — coalesce multiple signal writes before the effect re-runs
- [Resilient async guide](../../guides/resilient-async.md) — walkthrough of retry, backoff, and timeout patterns
