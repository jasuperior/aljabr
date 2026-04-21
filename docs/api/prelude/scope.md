# API Reference: Scope & Resource

```ts
import {
    Scope,
    Resource,
    ScopeState,
    defer,
    acquire,
    runInScope,
    getCurrentScope,
    type ScopeHandle,
    type ResourceHandle,
} from "aljabr/prelude"
```

---

## Overview

`Scope` and `Resource` are aljabr's primitives for **structured resource management** — guaranteeing that teardown logic always runs whether a computation succeeds, fails, or is interrupted.

A `Scope` holds a list of finalizers that execute in LIFO (last-in, first-out) order when the scope disposes. A `Resource` pairs an async acquisition function with a release function, ensuring release always mirrors acquisition.

Both integrate with `watchEffect` and `AsyncDerived`: every thunk execution receives a fresh `Scope` that disposes automatically when the thunk re-runs or the effect stops.

> **Error handling — Phase 4:** Finalizer errors and failed releases are handled best-effort in this release. A rejected finalizer logs a warning via `console.warn` and the disposal chain continues. A rejected `acquire` propagates as a rejected `Promise`. Structured defect tracking — distinguishing domain errors from runtime panics — is planned for a future phase.

---

## `ScopeState`

A two-variant union representing the lifecycle of a `Scope`. Non-reactive — read it as a snapshot, not a tracked signal.

```ts
type ScopeState = Active | Disposed

ScopeState.Active()    // → Active
ScopeState.Disposed()  // → Disposed
```

Match against `scope.state` for control flow:

```ts
import { match } from "aljabr"

match(scope.state, {
    Active:   () => "scope is live",
    Disposed: () => "scope has cleaned up",
})
```

The union is designed for extensibility — future phases may introduce additional states (`Errored`, `Suspended`, etc.) without changing the API shape.

---

## `ScopeHandle`

The interface returned by `Scope()`.

```ts
interface ScopeHandle {
    readonly state: ScopeState
    defer(fn: () => Promise<void> | void): void
    acquire<T>(resource: ResourceHandle<T>): Promise<T>
    dispose(): Promise<void>
    [Symbol.asyncDispose](): Promise<void>
}
```

---

## `Scope()`

```ts
function Scope(): ScopeHandle
```

Create a new scope for structured resource management.

When called inside a reactive computation (`watchEffect`, `AsyncDerived`), the scope auto-parents to the current reactive owner — disposing the owner also disposes the scope. When called at the top level (no active computation), creates a root scope managed entirely by the caller.

### `scope.defer(fn)`

```ts
scope.defer(fn: () => Promise<void> | void): void
```

Register a finalizer. Finalizers run in **LIFO order** on disposal. If `fn` returns a `Promise`, disposal awaits it before proceeding to the next finalizer.

```ts
const scope = Scope()

scope.defer(() => console.log("runs third"))
scope.defer(() => console.log("runs second"))
scope.defer(async () => {
    await flushBuffer()
    console.log("runs first")
})

await scope.dispose()
// → "runs first", "runs second", "runs third"
```

### `scope.acquire(resource)`

```ts
scope.acquire<T>(resource: ResourceHandle<T>): Promise<T>
```

Acquire a resource. Calls `resource.acquire()`, registers `resource.release(value)` as a `defer` finalizer, and returns the acquired value. The resource's lifetime is structurally tied to the scope — no manual cleanup needed.

```ts
const DbResource = Resource(
    () => connectToDb(url),
    (db) => db.disconnect(),
)

const scope = Scope()
const db = await scope.acquire(DbResource)
await doWork(db)
await scope.dispose()  // db.disconnect() called here
```

### `scope.dispose()`

```ts
scope.dispose(): Promise<void>
```

Run all finalizers in LIFO order, then dispose the underlying reactive computation. Idempotent — calling `dispose()` on an already-disposed scope is a no-op.

### `scope.state`

```ts
readonly state: ScopeState  // Active | Disposed
```

Non-reactive snapshot of the scope's lifecycle. Read it to inspect state without subscribing.

### `Symbol.asyncDispose`

`ScopeHandle` implements the TC39 Explicit Resource Management protocol. Use `await using` to auto-dispose on block exit:

```ts
{
    await using scope = Scope()
    const db = await scope.acquire(DbResource)
    await doWork(db)
}  // scope.dispose() fires automatically — db released
```

Requires TypeScript 5.2+ and `"lib": ["ESNext.Disposable"]` in `tsconfig.json`.

---

## `Resource<T>`

```ts
function Resource<T>(
    acquire: () => Promise<T>,
    release: (value: T) => Promise<void> | void,
): ResourceHandle<T>

interface ResourceHandle<T> {
    readonly acquire: () => Promise<T>
    readonly release: (value: T) => Promise<void> | void
}
```

Pair an async acquisition with a release. `Resource(...)` is a pure description — it does not open any connection or allocate anything until consumed via `scope.acquire()`.

```ts
// Database connection
const DbResource = Resource(
    () => connectToDb(process.env.DB_URL),
    (db) => db.disconnect(),
)

// HTTP client with async teardown
const ClientResource = Resource(
    async () => {
        const client = new ApiClient()
        await client.authenticate()
        return client
    },
    async (client) => client.close(),
)

// WebSocket
const WsResource = Resource(
    (url: string) => new Promise<WebSocket>((resolve, reject) => {
        const ws = new WebSocket(url)
        ws.onopen  = () => resolve(ws)
        ws.onerror = (e) => reject(e)
    }),
    (ws) => ws.close(),
)
```

---

## Implicit hooks

Inside a `watchEffect` or `AsyncDerived` thunk, two standalone functions operate on the thunk's ambient scope — the same `Scope` passed as the explicit second argument. Use whichever reads more naturally.

> Both throw if called outside an active Scope context. This is intentional — silent no-ops would hide misuse.

> Implicit hooks resolve the scope during the **synchronous execution frame** only. After an `await` boundary, use the explicit `scope` argument.

### `defer(fn)`

```ts
function defer(fn: () => Promise<void> | void): void
```

Register a finalizer on the current scope. Equivalent to `scope.defer(fn)`.

```ts
watchEffect(async (signal, scope) => {
    const ws = new WebSocket(wsUrl)
    defer(() => ws.close())            // same as scope.defer(() => ws.close())
    return receiveMessage(ws, signal)
}, onChange)
```

### `acquire(resource)`

```ts
function acquire<T>(resource: ResourceHandle<T>): Promise<T>
```

Acquire a resource via the current scope. Must be called before the first `await` in the thunk (the scope reference is captured synchronously).

```ts
watchEffect(async (signal, scope) => {
    const db = await acquire(DbResource)  // implicit — same as scope.acquire(DbResource)
    return db.query("SELECT * FROM users", { signal })
}, onChange)
```

### `runInScope(scope, fn)`

```ts
function runInScope<T>(scope: ScopeHandle, fn: () => T): T
```

Run `fn` with `scope` as the active context. Implicit `defer()` and `acquire()` calls inside `fn` resolve to this scope. Used internally by `watchEffect` and `AsyncDerived`; exposed for advanced composition.

### `getCurrentScope()`

```ts
function getCurrentScope(): ScopeHandle | null
```

Read the ambient scope without consuming it. Returns `null` outside any scope context.

---

## Integration with `watchEffect` and `AsyncDerived`

Both primitives create a **fresh `Scope` for each thunk execution**. The scope is passed as the explicit second argument and also activates the implicit hooks.

**Per-run lifecycle:**
1. Before a new run starts, the previous run's scope disposes — resources from stale runs always clean up before the next begins.
2. When the effect stops (`handle.stop()`) or its owning computation disposes, the current scope disposes automatically.

```ts
import { watchEffect, Resource, Signal } from "aljabr/prelude"

const roomId = Signal.create("lobby")

const WsResource = Resource(
    (id: string) => connectWebSocket(`/rooms/${id}`),
    (ws) => ws.close(),
)

// Each time roomId changes, the old connection closes before the new one opens.
const handle = watchEffect(
    async (signal, scope) => {
        const ws = await scope.acquire(WsResource(roomId.get()!))
        ws.send(JSON.stringify({ type: "subscribe" }))
        return receiveNextMessage(ws, signal)
    },
    (result) => match(result, {
        Done:   ({ value }) => renderMessage(value),
        Failed: ({ error }) => renderError(error),
        Stale:  () => {},
    }),
    { eager: true },
)
```

---

## Examples

### Manual lifecycle

```ts
const scope = Scope()

scope.defer(async () => {
    await cache.flush()
    console.log("cache flushed")
})

const db     = await scope.acquire(DbResource)
const client = await scope.acquire(HttpClientResource)

await runMigrations(db, client)
await scope.dispose()
// → client closes, db disconnects, cache flushes — LIFO
```

### TC39 explicit resource management

```ts
async function handleRequest(req: Request): Promise<Response> {
    await using scope = Scope()

    const db      = await scope.acquire(DbResource)
    const session = await scope.acquire(SessionResource)
    const user    = await db.findUser(session.userId)

    return Response.json(user)
    // scope.dispose() fires automatically — session closes, db disconnects
}
```

### Scoped event listeners

```ts
const emitter = getEventEmitter()

watchEffect(async (signal, scope) => {
    const handler = (e: AppEvent) => processEvent(e)
    emitter.on("event", handler)
    defer(() => emitter.off("event", handler))  // removed when effect re-runs or stops
    return waitForNextEvent(signal)
}, onChange, { eager: true })
```

---

## See also

- [`watchEffect`](./effect.md#watcheffect) — reactive async effects; each run receives a fresh scope
- [`AsyncDerived`](./derived.md#asyncderivedt-e) — pull-based async computed values; each evaluation receives a fresh scope
- [`context`](./context.md) — the reactive owner tree that scopes participate in
