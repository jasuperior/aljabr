# Resource Lifetime

The reactive graph from the [Reactive UI](./reactive-ui.md) guide — a `Ref` for view state, `Derived` computations, an `AsyncDerived` for detail loading, a `watchEffect` for URL sync — has a lifetime. At some point the panel it belongs to is removed from the screen. When that happens, the signals should stop notifying, the in-flight fetch should abort, the URL sync should stop, and any external subscriptions should be released.

Without explicit lifetime management, that cleanup is a collection of individual teardown calls scattered wherever the component was created. With `Scope`, it's a single boundary that guarantees everything inside it tears down together, in the right order.

---

## Scope as a lifetime boundary

`Scope()` creates a context for structured cleanup. Finalizers registered via `.defer()` run in LIFO order when the scope disposes. Resources acquired via `.acquire()` are released automatically — the release always mirrors the acquisition.

The most direct way to use a scope is to create one explicitly and dispose it when the component's lifetime ends:

```ts
import { Scope, watchEffect } from "aljabr/prelude"

const panelScope = Scope()

// The reactive graph from guide 3, now bounded by this scope
const view = Ref.create<TableState>({ /* ... */ })
const visibleOrders = Derived.create(/* ... */)
const orderDetail = AsyncDerived.create(/* ... */)

// Register cleanup for anything not auto-owned by the scope
const urlSync = watchEffect(async () => {
  const filter = view.get("filter") ?? ""
  history.replaceState(null, "", `?filter=${filter}`)
})

panelScope.defer(() => urlSync.stop())
panelScope.defer(() => view.dispose())

// When the panel is removed
async function unmount() {
  await panelScope.dispose()
  // urlSync stopped, view disposed — in that order
}
```

LIFO order matters: things acquired last are released first. `urlSync` was registered after `view`, so it stops before `view` disposes. A component that reads `view` inside `watchEffect` won't fire on a stale signal after disposal.

---

## defer for non-Resource cleanup

`defer` is for any cleanup that doesn't fit the acquire/release bracket — event listeners, external subscriptions, timers, analytics tracking:

```ts
// Subscribe to an inventory update stream
const inventoryStream = openInventoryStream()
panelScope.defer(() => inventoryStream.close())

// Register a keyboard shortcut
const handler = (e: KeyboardEvent) => {
  if (e.key === "Escape") view.set("selected", null)
}
document.addEventListener("keydown", handler)
panelScope.defer(() => document.removeEventListener("keydown", handler))

// Start a polling interval
const pollTimer = setInterval(() => refreshOrders(), 30_000)
panelScope.defer(() => clearInterval(pollTimer))
```

Each `defer` call adds a finalizer to the stack. When `panelScope.dispose()` runs, they execute in reverse registration order: `clearInterval`, then `removeEventListener`, then `inventoryStream.close()`.

---

## Resource and acquire for the bracket pattern

`Resource` pairs an acquisition function with a release function. Neither runs until the resource is consumed via `scope.acquire()`. This is the bracket pattern: acquire, use, release — with release guaranteed even if the middle part throws or is interrupted.

The detail loader from the reactive UI guide makes a fetch on every selection change. Wrapping it in a `Resource` makes the connection lifecycle explicit:

```ts
import { Resource } from "aljabr/prelude"

// A resource for the order detail HTTP client
const DetailClientResource = Resource(
  async () => {
    const client = new ApiClient({ baseUrl: "/api/orders" })
    await client.authenticate()
    return client
  },
  async (client) => client.close(),
)

// Acquire once for the panel's lifetime
const client = await panelScope.acquire(DetailClientResource)

// Now use it in the AsyncDerived
const orderDetail = AsyncDerived.create(async (signal) => {
  const id = view.get("selected")
  if (!id) return null as unknown as OrderDetail
  return client.get(`/${id}/detail`, { signal })
})
```

`client.close()` is now tied to `panelScope`. When the panel unmounts, `panelScope.dispose()` closes the client — regardless of whether the `AsyncDerived` is mid-fetch, stale, or idle.

### Resources inside watchEffect

`watchEffect` and `AsyncDerived` each receive a fresh `Scope` on every run. Resources acquired inside a thunk's scope are released before the next run begins — so the previous connection always closes before a new one opens:

```ts
import { Signal, watchEffect, Resource } from "aljabr/prelude"

const roomId = Signal.create("orders")

const WsResource = Resource(
  (id: string) => connectWebSocket(`/updates/${id}`),
  (ws) => ws.close(),
)

// Each time roomId changes, the stale connection closes before the new one opens
const wsHandle = watchEffect(
  async (signal, scope) => {
    const id = roomId.get()!
    const ws = await scope.acquire(WsResource(id))
    ws.send(JSON.stringify({ type: "subscribe" }))
    return receiveNextMessage(ws, signal)
  },
  (result) => match(result, {
    Done:   ({ value }) => processUpdate(value),
    Failed: ({ error }) => console.error("WebSocket error:", error),
    Stale:  () => {},
  }),
  { eager: true },
)

panelScope.defer(() => wsHandle.stop())
```

The inner scope (per-run) handles the connection lifecycle. The outer scope (`panelScope`) handles the effect itself. These are independent lifetimes with a clear containment relationship.

---

## The reactive graph, wrapped

Putting the full panel together with its scope:

```ts
async function mountOrderPanel(): Promise<() => Promise<void>> {
  const panelScope = Scope()

  // State
  const view = Ref.create<TableState>({
    filter: "",
    sortField: "confirmedAt",
    sortDir: "desc",
    page: 1,
    selected: null,
  })

  // External resource — client for the lifetime of the panel
  const client = await panelScope.acquire(DetailClientResource)

  // Reactive graph
  const visibleOrders = Derived.create(() => computeVisibleOrders(view, orders))
  const summary       = Derived.create(() => computeSummary(visibleOrders))
  const orderDetail   = AsyncDerived.create(async (signal) => {
    const id = view.get("selected")
    if (!id) return null as unknown as OrderDetail
    return client.get(`/${id}/detail`, { signal })
  })

  // Side effect — URL sync
  const urlSync = watchEffect(async () => {
    const params = buildParams(view)
    history.replaceState(null, "", `?${params}`)
  })

  // WebSocket for live order updates
  const wsHandle = watchEffect(
    async (signal, scope) => {
      const ws = await scope.acquire(WsResource("orders"))
      ws.send(JSON.stringify({ type: "subscribe" }))
      return receiveNextMessage(ws, signal)
    },
    (result) => match(result, {
      Done:   ({ value }) => applyOrderUpdate(value, view),
      Failed: ({ error }) => console.error(error),
      Stale:  () => {},
    }),
    { eager: true },
  )

  // Keyboard shortcut
  const keyHandler = (e: KeyboardEvent) => {
    if (e.key === "Escape") view.set("selected", null)
  }
  document.addEventListener("keydown", keyHandler)

  // Register all teardown in the scope
  panelScope.defer(() => wsHandle.stop())
  panelScope.defer(() => urlSync.stop())
  panelScope.defer(() => document.removeEventListener("keydown", keyHandler))
  panelScope.defer(() => view.dispose())

  renderPanel({ view, visibleOrders, summary, orderDetail })

  // Return the unmount function
  return () => panelScope.dispose()
}

// Usage
const unmount = await mountOrderPanel()

// Later — navigation, modal close, tab close
await unmount()
// wsHandle stopped → urlSync stopped → keyHandler removed → view disposed → client closed
```

`mountOrderPanel` returns a single `unmount` function. Everything inside the scope tears down in LIFO order — the things registered last (the internal effects) stop before the things registered first (the external client).

---

## Nested scopes

A page with multiple panels has a natural scope hierarchy: each panel scope is a child of the page scope. When the page unloads, all panels tear down. When a single panel closes, only its resources are released.

```ts
async function mountOrdersPage(): Promise<() => Promise<void>> {
  const pageScope = Scope()

  // Page-level resources — shared across all panels
  const pageClient = await pageScope.acquire(PageApiClientResource)
  const analytics  = await pageScope.acquire(AnalyticsSessionResource)

  // Mount panels — each has its own child scope
  let panelUnmount: (() => Promise<void>) | null = null

  async function openDetailPanel(orderId: string): Promise<void> {
    // Close the previous panel first
    if (panelUnmount) await panelUnmount()

    // Each panel scope is independent — disposing the panel doesn't affect the page
    const panelScope = Scope()
    const ws = await panelScope.acquire(WsResource(`orders/${orderId}`))

    panelUnmount = () => panelScope.dispose()
    renderDetailPanel({ orderId, ws, close: panelUnmount })
  }

  // Register page-level teardown
  pageScope.defer(async () => {
    if (panelUnmount) await panelUnmount()
  })

  return () => pageScope.dispose()
  // → active panel disposes → analytics closes → pageClient closes
}
```

Panel scopes are created and disposed independently. The page scope disposes whatever panel is currently open as part of its teardown, but the panel can be opened and closed repeatedly without touching the page-level resources.

This is the core benefit of explicit lifetime management: the containment relationship between scopes is declared once and enforced structurally, not by convention.

---

## `Symbol.asyncDispose` for automatic cleanup

If your environment supports the TC39 Explicit Resource Management proposal (TypeScript 5.2+, modern runtimes), `ScopeHandle` implements `Symbol.asyncDispose`. Use `await using` to bind the scope's lifetime to the enclosing block:

```ts
async function handleOrderRequest(req: Request): Promise<Response> {
  await using scope = Scope()

  const db     = await scope.acquire(DbResource)
  const client = await scope.acquire(ApiClientResource)
  const order  = await db.orders.findById(req.params.id)

  return Response.json(order)
  // scope.dispose() fires automatically — client closes, db disconnects
}
```

`await using` is equivalent to a `try/finally` around `scope.dispose()`, but the scope is always disposed when the block exits — on return, on throw, and on any other exit path.

---

## Patterns worth noting

**Idempotent disposal.** Calling `scope.dispose()` on an already-disposed scope is a no-op. This means cleanup code can call `unmount()` multiple times without double-releasing resources — useful for framework integrations that may call cleanup callbacks more than once.

**Checking scope state.** `scope.state` is a matchable `ScopeState` union (`Active | Disposed`). Read it when you need to guard against writing to a disposed scope:

```ts
import { match } from "aljabr"

match(panelScope.state, {
  Active:   () => view.set("filter", ""),  // safe
  Disposed: () => {},                       // panel is gone, skip
})
```

**Registering defer inside watchEffect.** The `defer` implicit hook registers on the thunk's per-run scope, not on any enclosing scope. Use the explicit `scope` argument when you need a finalizer tied to the effect's *outer* scope:

```ts
const handle = watchEffect(async (signal, runScope) => {
  const ws = new WebSocket(url)
  runScope.defer(() => ws.close())  // closed before each re-run

  // Don't use defer() here — it would target the per-run scope, not the panel scope
  return receiveMessage(ws, signal)
})

panelScope.defer(() => handle.stop())  // stops the entire effect
```

---

## See also

- [Reactive UI](./reactive-ui.md) — the reactive graph this guide gives a lifetime to
- [Signal Protocols](./signal-protocols.md) — protocol signals that are owned by a scope
- [Resilient Async](../resilient-async.md) — Schedule, Fault, and retry policies for async effects
- [API Reference: Scope & Resource](../../api/prelude/scope.md)
- [API Reference: watchEffect](../../api/prelude/effect.md)
