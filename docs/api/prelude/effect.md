# API Reference: Effect / watchEffect

```ts
import { Effect, watchEffect, type Idle, type Running, type Done, type Stale } from "aljabr/prelude"
```

---

## Overview

`Effect<T, E>` is a four-variant union that represents the lifecycle of an async computation: not yet run (`Idle`), currently running (`Running`), completed (`Done`), and completed but with stale dependencies (`Stale`). All variants share `run()`, `map()`, `flatMap()`, and `recover()` via the `Computable<T, E>` impl mixin.

`watchEffect` is the reactive runner: it executes an async thunk with dependency tracking and calls a callback whenever the thunk's dependencies change.

---

## `Effect<T, E>`

### Variants

| Variant | Payload | Meaning |
|---|---|---|
| `Idle<T, E>` | `{ thunk: () => Promise<T> }` | Created but not yet run |
| `Running<T, E>` | `{ pending: Promise<Done<T, E>> }` | Currently executing |
| `Done<T, E>` | `{ signal: SignalState<T>; error: E \| null }` | Execution finished; `signal` is `Active` on success, `Disposed` on failure |
| `Stale<T, E>` | `{ signal: SignalState<T>; error: E \| null; thunk: () => Promise<T> }` | Previously done; one or more dependencies have since changed |

A `Done` result stores its value as a `SignalState<T>` — check `done.signal.isActive()` to distinguish success from failure, and `done.signal.get()` to read the value.

### Factories

```ts
Effect.Idle<T, E>(thunk: () => Promise<T>): Idle<T, E>
Effect.Running<T, E>(pending: Promise<Done<T, E>>): Running<T, E>
Effect.Done<T, E>(signal: SignalState<T>, error: E | null): Done<T, E>
Effect.Stale<T, E>(signal: SignalState<T>, error: E | null, thunk: () => Promise<T>): Stale<T, E>
```

---

## `Computable<T, E>` — shared behavior

### `.run()`

```ts
effect.run(): Promise<Done<T, E>>
```

Execute the effect and return a `Done`. If the effect is already `Running`, awaits the existing promise. If already `Done`, resolves immediately. If `Stale`, re-runs the thunk.

```ts
const effect = Effect.Idle(async () => fetchData())

const done = await effect.run()
if (done.signal.isActive()) {
    console.log("result:", done.signal.get())
} else {
    console.error("failed:", done.error)
}
```

### `.map<U>(fn)`

```ts
effect.map<U>(fn: (value: T) => U): Idle<U, E>
```

Transform the success value. Returns a new `Idle` whose thunk runs the original effect, applies `fn` to the result, and produces a `Done<U, E>`. Does not run anything immediately.

```ts
const names = Effect.Idle(async () => fetchUsers())
    .map(users => users.map(u => u.name))

const done = await names.run()
done.signal.get() // string[]
```

### `.flatMap<U>(fn)`

```ts
effect.flatMap<U>(fn: (value: T) => Effect<U, E>): Idle<U, E>
```

Chain two effects. The second effect is created from the first effect's success value. Both effects run in sequence. Returns a new `Idle`.

```ts
const user    = Effect.Idle(async () => fetchUser(1))
const profile = user.flatMap(u => Effect.Idle(async () => fetchProfile(u.id)))

const done = await profile.run()
```

### `.recover<F>(fn)`

```ts
effect.recover<F>(fn: (error: E) => Effect<T, F>): Idle<T, F>
```

Handle a failure by running a fallback effect. If the original effect succeeds, its value is passed through unchanged. If it fails, `fn` is called with the error and the fallback effect is run. Returns a new `Idle`.

```ts
const data = Effect.Idle(async () => fetchFromPrimary())
    .recover(() => Effect.Idle(async () => fetchFromFallback()))

const done = await data.run()
```

---

## `watchEffect`

```ts
function watchEffect<T, E = never>(
    thunk: () => Promise<T>,
    onChange: (result: Stale<T, E> | Done<T, E>) => void,
    options?: { eager?: boolean },
): { stop(): void }
```

Run an async thunk with automatic dependency tracking. Any `Signal.get()` calls inside `thunk` are recorded as dependencies. When a dependency changes, `onChange` is called.

The thunk runs immediately on creation. The `onChange` callback is **not** called for the initial run — only for subsequent changes.

Returns a handle with `stop()` to cancel tracking and dispose the underlying computation.

### Parameters

| Parameter | Type | Description |
|---|---|---|
| `thunk` | `() => Promise<T>` | The async computation to run and track |
| `onChange` | `(result: Stale<T, E> \| Done<T, E>) => void` | Called when a dependency changes |
| `options.eager` | `boolean` | Default `false`. When `true`, re-runs the thunk automatically on every dependency change; `onChange` receives `Done` results. When `false`, `onChange` receives `Stale` and the caller decides when to re-run. |

### Lazy mode (default)

`onChange` receives a `Stale` value. The caller controls when the thunk re-runs by calling `.run()` on it.

```ts
const src = Signal.create("hello")

const handle = watchEffect(
    async () => src.get()!.toUpperCase(),
    (result) => {
        match(result, {
            Stale: (stale) => {
                // Decide when to re-run — e.g. on next user interaction
                stale.run().then(done => console.log(done.signal.get()))
            },
            Done: (done) => console.log("done:", done.signal.get()),
        })
    },
)

src.set("world") // onChange called with Stale
handle.stop()    // stop tracking
```

### Eager mode

`onChange` receives a `Done` value — the thunk has already re-run by the time `onChange` is called.

```ts
const handle = watchEffect(
    async () => src.get()!.toUpperCase(),
    (done) => {
        // done is always Done<string> in eager mode
        if ((done as Done<string>).signal.isActive()) {
            console.log("latest:", (done as Done<string>).signal.get())
        }
    },
    { eager: true },
)

src.set("world") // thunk re-runs immediately; onChange called with Done result
```

---

## Pattern matching on Effect

```ts
match(effect, {
    Idle:    ({ thunk }) => "not started",
    Running: ({ pending }) => "in flight",
    Done:    ({ signal, error }) =>
        signal.isActive()
            ? `success: ${signal.get()}`
            : `failure: ${error}`,
    Stale:   ({ signal }) => `stale (was: ${signal.get()})`,
})
```

---

## Examples

### Sequential pipeline

```ts
const pipeline = Effect.Idle(async () => readFile("input.txt"))
    .map(contents => contents.trim().split("\n"))
    .map(lines => lines.filter(l => l.startsWith(">")))
    .flatMap(lines =>
        Effect.Idle(async () => writeFile("output.txt", lines.join("\n")))
    )

const done = await pipeline.run()
console.log(done.signal.isActive() ? "written" : done.error)
```

### Reactive fetch with stale-while-revalidating

```ts
const userId = Signal.create(1)
let currentData: UserProfile | null = null

const handle = watchEffect(
    async () => {
        const id = userId.get()!
        return fetch(`/api/users/${id}`).then(r => r.json())
    },
    (result) => {
        match(result, {
            Stale: ({ signal }) => {
                // Show the stale data while re-fetching
                renderUser(signal.get()!, /* stale */ true)
                result.run().then(done => {
                    if (done.signal.isActive()) renderUser(done.signal.get()!)
                })
            },
            Done: ({ signal }) => {
                if (signal.isActive()) renderUser(signal.get()!)
            },
        })
    },
)

userId.set(2) // triggers re-fetch; stale user 1 data still shown
```

---

## See also

- [`Signal`](./signal.md) — the reactive sources that `watchEffect` tracks
- [`Derived`](./derived.md) — synchronous computed values, for when you don't need async
- [`batch`](./context.md#batch) — coalesce multiple signal writes before the effect re-runs
