# API Reference: Persistence

```ts
import {
    Signal,
    localStorageAdapter,
    sessionStorageAdapter,
    type PersistAdapter,
    type PersistOptions,
} from "aljabr/prelude"
```

---

## Overview

Persistence connects `Signal<T>` values to an external key-value store (localStorage, sessionStorage, or any custom adapter). The two entry points are static and instance methods on `Signal` itself — there is no separate `persistedSignal` / `syncToStore` namespace.

| Use case | API |
|---|---|
| Create a fresh signal that rehydrates and persists | [`Signal.persisted(initial, options)`](#signalpersisted) |
| Mirror an existing signal's writes to a store | [`signal.persist(options)`](#signalpersist) |

Both paths return interoperable handles — a `Signal<T>` from `Signal.persisted`, a `WatchHandle` from `signal.persist`. Disposal of the `WatchHandle` stops syncing; disposal of the persisted `Signal` stops both reads and writes.

---

## `Signal.persisted`

```ts
Signal.persisted<T>(
    initialValue: T,
    options: PersistOptions<T>,
): Signal<T>
```

Create a `Signal<T>` that is automatically persisted to and rehydrated from an external store.

**On creation:** the store is read via `adapter.get(key)`. If a stored value exists, it is deserialized and used as the signal's initial value; `initialValue` is only used as a fallback when nothing is stored or deserialization fails.

**On every `set()`:** the new value is serialized and written to the store via an internal `watch`.

```ts
const theme = Signal.persisted<"light" | "dark">("light", {
    key: "app.theme",
})

theme.peek()      // "light" on first load, or last saved value on reload
theme.set("dark") // written to localStorage["app.theme"]
// Next page load: theme.peek() === "dark"
```

### Parameters

| Parameter | Type | Description |
|---|---|---|
| `initialValue` | `T` | Fallback if nothing is stored or deserialization fails |
| `options.key` | `string` | The storage key |
| `options.serialize` | `(value: T) => string` | Default: `JSON.stringify` |
| `options.deserialize` | `(raw: string) => T` | Default: `JSON.parse` |
| `options.adapter` | `PersistAdapter` | Default: `localStorageAdapter` |

### Behavior on corrupted data

If the stored value fails to deserialize (throws), it is silently ignored and `initialValue` is used. This prevents a bad storage entry from crashing the app.

---

## `signal.persist`

```ts
signal.persist(options: PersistOptions<T>): WatchHandle
```

Instance method on `Signal<T>`. Mirrors the signal's writes to an external store for the lifetime of the returned `WatchHandle`. Unlike `Signal.persisted`, this does **not** rehydrate — use it when you already have a signal whose value you want to persist out-of-band.

`WatchHandle` is the standard reactive disposal handle. Call `.dispose()` (or rely on `Symbol.dispose` via `using`) to stop syncing.

```ts
const cursor = Signal.create({ line: 0, col: 0 })

const handle = cursor.persist({ key: "editor.cursor" })

cursor.set({ line: 10, col: 5 }) // written to localStorage["editor.cursor"]

handle.dispose() // stop syncing; future writes are not persisted
```

---

## `PersistAdapter`

```ts
type PersistAdapter = {
    get(key: string): string | null
    set(key: string, value: string): void
    remove(key: string): void
}
```

The interface any storage backend must implement. Both built-in adapters satisfy this contract; implement your own to target other stores (IndexedDB, a remote API, in-memory, etc.).

---

## `PersistOptions<T>`

```ts
type PersistOptions<T> = {
    key: string
    serialize?: (value: T) => string
    deserialize?: (raw: string) => T
    adapter?: PersistAdapter
}
```

---

## Built-in adapters

### `localStorageAdapter`

Backed by `window.localStorage`. The default adapter for both persistence entry points.

```ts
import { localStorageAdapter } from "aljabr/prelude"

Signal.persisted("default", {
    key: "my.key",
    adapter: localStorageAdapter, // this is the default; optional
})
```

### `sessionStorageAdapter`

Backed by `window.sessionStorage`. Values are cleared when the browser tab closes.

```ts
import { sessionStorageAdapter } from "aljabr/prelude"

const sessionToken = Signal.persisted<string | null>(null, {
    key: "auth.token",
    adapter: sessionStorageAdapter,
})
```

---

## Examples

### Custom serialization

```ts
type DateRange = { from: Date; to: Date }

const range = Signal.persisted<DateRange>(
    { from: new Date(), to: new Date() },
    {
        key: "filter.dateRange",
        serialize: ({ from, to }) =>
            JSON.stringify({ from: from.toISOString(), to: to.toISOString() }),
        deserialize: (raw) => {
            const { from, to } = JSON.parse(raw)
            return { from: new Date(from), to: new Date(to) }
        },
    },
)
```

### Custom adapter (in-memory, for testing)

```ts
import { type PersistAdapter, Signal } from "aljabr/prelude"

function memoryAdapter(): PersistAdapter {
    const store = new Map<string, string>()
    return {
        get: (key) => store.get(key) ?? null,
        set: (key, value) => store.set(key, value),
        remove: (key) => store.delete(key),
    }
}

const sig = Signal.persisted("initial", {
    key: "test.key",
    adapter: memoryAdapter(),
})
```

### Mirroring an existing signal

```ts
import { Signal } from "aljabr/prelude"

const title   = Signal.create("Untitled")
const content = Signal.create("")

// title is mirrored out-of-band
const titleHandle = title.persist({ key: "doc.title" })

// content is not persisted (volatile scratch area)
// Stop sync when navigating away
window.addEventListener("beforeunload", () => titleHandle.dispose())
```

---

## See also

- [`Signal`](./signal.md) — the reactive container these helpers persist
- [`watch`](./effect.md#watch) — the mechanism used internally to track signal writes; `signal.persist` returns the same `WatchHandle` shape
