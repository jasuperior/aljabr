# API Reference: Persistence

```ts
import {
    persistedSignal,
    syncToStore,
    localStorageAdapter,
    sessionStorageAdapter,
    type PersistAdapter,
    type PersistOptions,
} from "aljabr/prelude"
```

---

## Overview

The persistence helpers connect `Signal<T>` values to an external key-value store (localStorage, sessionStorage, or any custom adapter). They return plain `Signal<T>` instances — no special wrapper type — so the rest of your reactive graph works without any knowledge of persistence.

---

## `persistedSignal<T>`

```ts
function persistedSignal<T>(
    initialValue: T,
    options: PersistOptions<T>,
): Signal<T>
```

Create a `Signal<T>` that is automatically persisted to and rehydrated from an external store.

**On creation:** the store is read via `adapter.get(key)`. If a stored value exists, it is deserialized and used as the signal's initial value; `initialValue` is only used as a fallback when nothing is stored or deserialization fails.

**On every `set()`:** the new value is serialized and written to the store via `watchEffect`.

```ts
import { persistedSignal } from "aljabr/prelude"

const theme = persistedSignal<"light" | "dark">("light", {
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

## `syncToStore<T>`

```ts
function syncToStore<T>(
    signal: Signal<T>,
    options: PersistOptions<T>,
): () => void
```

Mirror an existing `Signal<T>` to an external store for its entire lifetime. Unlike `persistedSignal`, this does **not** rehydrate — use it when you already have a signal and want to persist its writes out-of-band.

Returns a cleanup function that stops syncing.

```ts
const cursor = Signal.create({ line: 0, col: 0 })

const stop = syncToStore(cursor, { key: "editor.cursor" })

cursor.set({ line: 10, col: 5 }) // written to localStorage["editor.cursor"]

stop() // stop syncing; future writes are not persisted
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

Backed by `window.localStorage`. The default adapter for `persistedSignal` and `syncToStore`.

```ts
import { localStorageAdapter } from "aljabr/prelude"

persistedSignal("default", {
    key: "my.key",
    adapter: localStorageAdapter, // this is the default; optional
})
```

### `sessionStorageAdapter`

Backed by `window.sessionStorage`. Values are cleared when the browser tab closes.

```ts
import { sessionStorageAdapter } from "aljabr/prelude"

const sessionToken = persistedSignal<string | null>(null, {
    key: "auth.token",
    adapter: sessionStorageAdapter,
})
```

---

## Examples

### Custom serialization

```ts
import { persistedSignal } from "aljabr/prelude"

type DateRange = { from: Date; to: Date }

const range = persistedSignal<DateRange>(
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
import { type PersistAdapter, persistedSignal } from "aljabr/prelude"

function memoryAdapter(): PersistAdapter {
    const store = new Map<string, string>()
    return {
        get: (key) => store.get(key) ?? null,
        set: (key, value) => store.set(key, value),
        remove: (key) => store.delete(key),
    }
}

const sig = persistedSignal("initial", {
    key: "test.key",
    adapter: memoryAdapter(),
})
```

### Syncing a derived document state

```ts
import { Signal, Derived, syncToStore } from "aljabr/prelude"

const title   = Signal.create("Untitled")
const content = Signal.create("")

// title is persisted directly
const stopTitle = syncToStore(title, { key: "doc.title" })

// content is not persisted (volatile scratch area)
// Stop sync when navigating away
window.addEventListener("beforeunload", () => stopTitle())
```

---

## See also

- [`Signal`](./signal.md) — the reactive container these helpers persist
- [`watchEffect`](./effect.md#watcheffect) — the mechanism used internally to track signal writes
