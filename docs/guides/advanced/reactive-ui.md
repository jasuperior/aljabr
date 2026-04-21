# Reactive UI

`Ref`, `Derived`, `AsyncDerived`, and `watchEffect` are four different answers to the same question: how does state flow through a UI? Each one occupies a distinct position in the reactive graph, and the patterns that emerge from composing them are more than the sum of their parts.

This guide walks through those patterns using a data table with filtering, sorting, and on-demand async loading. The table is the vehicle — what matters is how each primitive fits, why it fits there, and what the composition looks like. The domain type throughout is `OrderLifecycle` from the [Union Branching](./union-branching.md) guide.

---

## The shape of a reactive system

Before any code: a map of responsibilities.

- **`Signal<T>`** is a mutable value that notifies dependents when it changes. It's the input to everything else — user events, external data, URL params.
- **`Ref<T>`** is a `Signal` for structured objects. It tracks subscriptions per dot-separated path, so a change to one field only re-runs computations that read that field.
- **`Derived<T>`** is a lazy computed value. It reads signals and other deriveds, re-evaluates only when read after a dependency changes, and preserves a stale value in the interim.
- **`AsyncDerived<T, E>`** is `Derived` with an async computation. It knows about the four states of async work — uncomputed, loading, ready, reloading — and hands them to you as matchable variants.
- **`watchEffect`** is for side effects that run in response to reactive state: writing to a URL, posting to an API, syncing to external storage.

The data flow is unidirectional: signals → deriveds → effects. Effects never write to signals that feed into their own computation.

---

## Setting up state

The table has two kinds of state: **view state** (filter text, sort column, selected row) and **data state** (the loaded orders). View state belongs in a `Ref` — it's structured, multiple fields change independently, and individual components subscribe to only the paths they care about.

```ts
import { Ref, Derived, AsyncDerived, batch } from "aljabr/prelude"
import type { OrderLifecycle } from "./domain"  // from the Union Branching guide

type SortField = "orderId" | "confirmedAt" | "status"
type SortDir   = "asc" | "desc"

type TableState = {
  filter:    string
  sortField: SortField
  sortDir:   SortDir
  page:      number
  selected:  string | null  // orderId
}

const view = Ref.create<TableState>({
  filter:    "",
  sortField: "confirmedAt",
  sortDir:   "desc",
  page:      1,
  selected:  null,
})
```

Each field is a distinct reactive path. A component that renders the filter input subscribes to `"filter"`. A component that renders sort headers subscribes to `"sortField"` and `"sortDir"`. They don't re-render when `selected` changes.

---

## Computing derived views

`Derived` sits between raw state and rendered output. It handles the computation that would otherwise live in component render functions — and re-runs only when its dependencies actually change.

```ts
const orders: OrderLifecycle[] = loadInitialOrders()  // from cache, SSR, etc.

// Filtering and sorting — re-computes only when filter, sortField, or sortDir change
const visibleOrders = Derived.create((): OrderLifecycle[] => {
  const filter    = view.get("filter")?.toLowerCase() ?? ""
  const sortField = view.get("sortField") ?? "confirmedAt"
  const sortDir   = view.get("sortDir") ?? "desc"

  const filtered = filter
    ? orders.filter(o => o.orderId.toLowerCase().includes(filter))
    : orders

  return [...filtered].sort((a, b) => {
    const aVal = getSortValue(a, sortField)
    const bVal = getSortValue(b, sortField)
    return sortDir === "asc"
      ? String(aVal).localeCompare(String(bVal))
      : String(bVal).localeCompare(String(aVal))
  })
})

// Summary string — depends on visibleOrders, re-computes transitively
const summary = Derived.create(() => {
  const rows = visibleOrders.get()
  if (!rows) return ""
  return rows.length === orders.length
    ? `${rows.length} orders`
    : `${rows.length} of ${orders.length} orders`
})
```

`summary` depends on `visibleOrders`, which depends on `view`. The dependency chain is implicit — no subscriptions to register, no teardown to manage. When `view.get("filter")` reads happen inside `Derived.create`, they register automatically.

### Writable derived for two-way binding

A filter input needs to both read and write the `"filter"` path. `Derived.create({ get, set })` creates a writable derived that routes writes back upstream:

```ts
const filterText = Derived.create({
  get: () => view.get("filter") ?? "",
  set: (v) => {
    batch(() => {
      view.set("filter", v)
      view.set("page", 1)  // reset page on filter change
    })
  },
})

// Bind to an input element
filterInput.addEventListener("input", (e) => {
  filterText.set((e.target as HTMLInputElement).value)
})
```

`batch` coalesces the two writes into one notification pass — `visibleOrders` only recomputes once, even though two paths changed.

---

## Loading async detail

When the user selects a row, you need to load order detail from the API. That's an `AsyncDerived` — the selection is the dependency, the fetch is the computation.

```ts
const orderDetail = AsyncDerived.create<OrderDetail, ApiError>(async (signal) => {
  const id = view.get("selected")
  if (!id) return null as unknown as OrderDetail  // no selection → nothing to load

  const res = await fetch(`/api/orders/${id}/detail`, { signal })
  if (!res.ok) throw Fault.Fail(new ApiError(res.status, await res.text()))
  return res.json()
})
```

The `signal` argument is an `AbortSignal` that's cancelled before each new evaluation — if the user selects a new row while a fetch is in flight, the stale request is automatically aborted.

### Rendering every state

`AsyncDerivedState` has six variants. The `Reloading` state is the one most codebases silently discard — and the one that makes the most difference to perceived performance. Matching it explicitly lets you show the previous order while the new one loads:

```ts
import { match } from "aljabr"
import { Fault } from "aljabr/prelude"

function renderDetailPanel(): HTMLElement {
  return match(orderDetail.state, {
    Uncomputed: () => renderEmpty("Select an order to view details"),
    Loading:    () => renderSpinner(),
    Ready:      ({ value }) => renderOrderDetail(value),
    Reloading:  ({ value }) => renderOrderDetail(value, { stale: true }),
    Failed:     ({ fault, nextRetryAt }) =>
      match(fault, {
        Fail:        ({ error }) => renderApiError(error),
        Defect:      ({ thrown }) => renderUnexpectedError(thrown),
        Interrupted: () => renderEmpty("Loading cancelled"),
      }),
    Disposed:   () => renderEmpty(),
  })
}
```

`Reloading` carries the last successful value. Passing `{ stale: true }` to `renderOrderDetail` lets the component show a loading indicator over the previous content rather than replacing it with a spinner. That's the stale-while-revalidating pattern — and it's just a variant.

### Retry configuration

If the API is flaky, add a retry schedule to the `AsyncDerived`:

```ts
import { Schedule } from "aljabr/prelude"

const orderDetail = AsyncDerived.create<OrderDetail, ApiError>(
  async (signal) => {
    const id = view.get("selected")
    if (!id) return null as unknown as OrderDetail
    const res = await fetch(`/api/orders/${id}/detail`, { signal })
    if (!res.ok) throw Fault.Fail(new ApiError(res.status, await res.text()))
    return res.json()
  },
  {
    schedule:   Schedule.Exponential({ initialDelay: 200, maxDelay: 5_000 }),
    maxRetries: 3,
  },
)
```

When the fetch fails, the scheduler queues the next attempt automatically. `state.Failed.nextRetryAt` is a timestamp you can use to render a countdown.

---

## Syncing to the URL

`watchEffect` runs an async side effect whenever its dependencies change. Here it syncs the view state to URL search params — so filter, sort, and page survive a page reload:

```ts
import { watchEffect } from "aljabr/prelude"

const urlSync = watchEffect(async () => {
  const filter    = view.get("filter") ?? ""
  const sortField = view.get("sortField") ?? "confirmedAt"
  const sortDir   = view.get("sortDir") ?? "desc"
  const page      = view.get("page") ?? 1

  const params = new URLSearchParams({ filter, sortField, sortDir, page: String(page) })
  history.replaceState(null, "", `?${params}`)
})
```

The reads inside the thunk register as dependencies. Any time `filter`, `sortField`, `sortDir`, or `page` changes, the effect re-runs. `selected` is intentionally excluded — deep-linking to a specific detail panel isn't part of this feature.

Stopping the sync is one call:

```ts
urlSync.stop()
```

### Restoring from URL on load

The reverse direction — URL → `Ref` — runs once at startup and isn't reactive (the URL doesn't change externally once the page is live):

```ts
function restoreFromUrl(): void {
  const params = new URLSearchParams(window.location.search)

  batch(() => {
    view.set("filter",    params.get("filter") ?? "")
    view.set("sortField", (params.get("sortField") ?? "confirmedAt") as SortField)
    view.set("sortDir",   (params.get("sortDir") ?? "desc") as SortDir)
    view.set("page",      parseInt(params.get("page") ?? "1", 10))
  })
}

restoreFromUrl()
```

`batch` ensures the four writes produce one notification pass — `visibleOrders` recomputes once, not four times.

---

## The reactive graph, assembled

```
view (Ref)
  ├── "filter"    ─┐
  ├── "sortField" ─┼──→ visibleOrders (Derived) ──→ summary (Derived)
  ├── "sortDir"   ─┘
  ├── "page"      ──────────────────────────────────→ urlSync (watchEffect)
  └── "selected"  ──────────────────────────────────→ orderDetail (AsyncDerived)
```

Each node subscribes to only the paths it reads. `summary` updates when `visibleOrders` updates — but never when `selected` changes. `orderDetail` triggers a new fetch when `selected` changes — but not when the filter text changes.

This is the payoff of path-level subscriptions: the reactive graph is as fine-grained as the actual dependencies, not the entire state object.

---

## Domain unions in the reactive graph

The `OrderLifecycle` values flowing through `visibleOrders` are tagged unions — you match on them to extract the right fields at render time:

```ts
import { match } from "aljabr"
import { OrderLifecycle } from "./domain"

function renderRow(order: OrderLifecycle): HTMLElement {
  const row = document.createElement("tr")

  match(order, {
    Pending:   ({ orderId, items }) => {
      row.innerHTML = `<td>${orderId}</td><td>${items.length} items</td><td>Pending</td>`
    },
    Confirmed: ({ orderId, confirmedAt }) => {
      row.innerHTML = `<td>${orderId}</td><td>—</td><td>Confirmed ${formatDate(confirmedAt)}</td>`
    },
    Shipped:   ({ orderId, trackingCode }) => {
      row.innerHTML = `<td>${orderId}</td><td>—</td><td>Shipped · ${trackingCode}</td>`
    },
    Delivered: ({ orderId, deliveredAt }) => {
      row.innerHTML = `<td>${orderId}</td><td>—</td><td>Delivered ${formatDate(deliveredAt)}</td>`
    },
    Cancelled: ({ orderId, reason }) => {
      row.innerHTML = `<td>${orderId}</td><td>—</td><td>Cancelled: ${reason}</td>`
    },
  })

  row.addEventListener("click", () => view.set("selected", order.orderId))
  return row
}
```

The `match` here is exhaustive — add a new `OrderLifecycle` variant and every unhandled render site becomes a compile error. The reactive graph delivers the data; the domain union shapes how it's rendered.

---

## Patterns worth noting

**`peek()` for non-reactive reads.** If you need the current value of a signal or derived without subscribing — inside an event handler, for example — use `.peek()`:

```ts
filterInput.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    view.set("filter", "")  // write — always fine
    // If you need the current sort, use peek — you don't want this handler to re-run on sort changes
    const currentSort = view.get("sortField")  // this would subscribe if inside a Derived
  }
})
```

Inside a `Derived.create` thunk, every `.get()` registers a dependency. Event handlers aren't tracked contexts — but if you call a helper that runs inside one, `.peek()` is the safe choice.

**`maybeAt` for deletion-aware subscriptions.** When a path can be deleted (not just set to `null`), `.maybeAt()` returns `Derived<Option<V>>` and properly tracks the absence:

```ts
const selectedDetail = view.maybeAt("selected")
// Some(orderId) when selected, None when cleared
```

**`bind` for form-driven paths.** When a form field should drive a path on a `Ref`, `.bind()` creates a live connection that releases automatically when the signal is disposed:

```ts
const searchInput = Signal.create("")
view.bind("filter", searchInput)
// searchInput writes flow directly to view.filter
```

---

## See also

- [Union Branching](./union-branching.md) — the OrderLifecycle union used here
- [Signal Protocols](./signal-protocols.md) — encoding debounce and temporal state inside the signal itself
- [Resource Lifetime](./resource-lifetime.md) — disposing this reactive graph when the component unmounts
- [API Reference: Ref](../../api/prelude/ref.md)
- [API Reference: Derived / AsyncDerived](../../api/prelude/derived.md)
- [API Reference: Effect / watchEffect](../../api/prelude/effect.md)
