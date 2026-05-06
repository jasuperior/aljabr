# API Reference: Store

```ts
import {
  Store,
  type Path, type PathValue,
} from "aljabr/prelude"
```

See also: [`List<T>`](./list.md) — the reactive root-array container returned by `Store.create([...])` and `store.at(arrayPath)`.

---

## Overview

`Store<T>` is a reactive mutable container for **structured objects and arrays**. Where a [`Signal<T>`](./signal.md) holds a single flat value, a `Store<T>` decomposes a nested value into per-path reactive nodes internally — enabling **fine-grained path-level subscriptions**.

Reading `store.get("user.name")` inside a reactive context subscribes to exactly `"user.name"`. A change to `"user.age"` does not re-run that computation.

Internally, `Store<T>` maintains a flat `Map<string, Signal<unknown>>` of leaf signals keyed by dot-separated path. Signals are created lazily on first access. All sub-Stores created via `.at()` share the same signal map as the root — there is only ever one owner.

---

## `Store<T>`

### `Store.create()`

```ts
Store.create<T extends unknown[]>(initial: T): List<T[number]>  // array (explicit type arg) → List
Store.create<T>(initial: T[]): List<T>                          // array → List
Store.create<T extends object>(initial: T): Store<T>            // object → Store (active state)
Store.create<T extends object>(): Store<T>                      // no value → Store (Unset state)
```

Creates a new `Store` or `List` depending on the argument type.

- **Array argument** → returns [`List<T>`](./list.md). The first overload is picked when an explicit type parameter is supplied (`Store.create<Task[]>([])`), correctly resolving the element type via `T[number]` — e.g. `Store.create<Task[]>([])` returns `List<Task>`, not `List<Task[]>`. The second overload covers the inferred case (`Store.create([...tasks])`).
- **Object argument** → returns `Store<T>` in active state.
- **No argument** → returns `Store<T>` in `Unset` state; `get()` returns `undefined` until first `set()`.

If called inside a reactive computation, the result is automatically disposed when the owner is disposed.

```ts
// Object Store (active)
const state = Store.create({
    user: { name: "Alice", age: 30 },
    scores: [1, 2, 3],
    active: true,
})

// Root array → List<number>
const items = Store.create([1, 2, 3, 4, 5])
items.push(6)           // List methods available at the root
items.length()          // 6

// Unset — no initial value; get() returns undefined until first set()
const pending = Store.create<{ name: string }>()
pending.isUnset // true
```

---

### `.isUnset`

```ts
store.isUnset: boolean
```

`true` if the Store was created without an initial value and has never been written to. Transitions to `false` on the first `set()` or `patch()`.

---

### `.get()`

```ts
store.get(): T | undefined
store.get<P extends Path<T>>(path: P): PathValue<T, P> | undefined
```

Read the value at a path (or the entire object when called with no arguments) and register it as a dependency in the active tracking context. One call = one subscription.

Returns `undefined` if the Store is in `Unset` state or if the path has been deleted.

**No-arg form** — coarse dependency on the root signal, notified whenever any path in the Store changes. Use this when you need the whole object as a value. For fine-grained path-level tracking, supply a path.

```ts
store.get()              // { user: { name: "Alice", age: 30 }, scores: [1, 2, 3], active: true }
store.get("user.name")   // "Alice"
store.get("scores.0")    // 1
store.get("active")      // true
```

---

### `.peek()`

```ts
store.peek(): T | undefined
store.peek<P extends Path<T>>(path: P): PathValue<T, P> | undefined
```

Untracked read — same overloads as `.get()` but wrapped in `untrack()`. Does not register any reactive dependency. Consistent with `Signal.peek()`.

```ts
store.peek()             // { user: { name: "Alice", ... }, ... } — no dependency registered
store.peek("user.name")  // "Alice" — no dependency registered
```

---

### `.getOr(path, default)`

```ts
store.getOr<P extends Path<T>>(path: P, defaultValue: PathValue<T, P>): PathValue<T, P>
```

Tracked read with a fallback. Returns `defaultValue` when the path is `undefined` or the Store is unset; otherwise returns the path's current value.

The bucket-1 canonical "read with default" verb — same shape on `Signal`, `Derived`, `AsyncDerived`, `List`, and `Dispatcher`.

```ts
store.getOr("user.nickname", "anonymous")
```

---

### `.set(path, value)`

```ts
store.set<P extends Path<T>>(path: P, value: PathValue<T, P>): void
```

Replace the subtree at `path` and notify **all** signals at related paths (the exact path, its descendants, and its ancestors). No structural diffing is performed.

**Equality guard:** if `value === current`, no notification is emitted.

If a [live binding](#bindpath-signal) exists at `path`, calling `set()` implicitly unbinds it — a plain write always wins.

```ts
store.set("user.name", "Bob")
store.set("scores", [10, 20, 30])
```

Use `patch()` when only some fields of a sub-object changed and you want to avoid notifying unchanged sibling subscribers.

---

### `.patch(path, value)`

```ts
store.patch<P extends Path<T>>(path: P, value: PathValue<T, P>): void
```

Deep-diff `value` against the current value at `path` and notify only the signals whose values actually changed. Reference equality is checked at each node before recursing — unchanged sub-trees are skipped entirely.

**Equality guard:** if `value === current` at the root, no update occurs.

```ts
// Only the "user.name" signal is notified; "user.age" is unchanged
store.patch("user", { name: "Bob", age: 30 })
```

| | `set` | `patch` |
|---|---|---|
| Diffing | None — notifies all related signals | Deep structural diff |
| Use when | You know exactly what changed, or value is a primitive | Value is a complex object and only some fields changed |

---

### `.delete(path)`

```ts
store.delete<P extends Path<T>>(path: P): void
```

Remove the value at `path` and all descendant paths.

- All signals at or under `path` receive `undefined` and notify their subscribers.
- Ancestor signals are updated to reflect the structural change.
- Cached `.at()` sub-Store handles at `path` remain alive and transition to `isUnset = true`. Re-setting the path later reactivates them.
- Any [live binding](#bindpath-signal) at `path` or a descendant is released.
- `get(path)` returns `undefined` after deletion.

```ts
store.delete("user.name")
store.get("user.name")  // undefined

const userStore = store.at("user")
store.delete("user")
userStore.isUnset  // true — handle is still alive, just empty
```

---

### `.subscribe(callback)`

```ts
store.subscribe(callback: (value: T | undefined) => void): () => void
```

Register a synchronous push subscriber. The callback fires after every mutation to this Store (or sub-Store) with the current snapshot. Returns an unsubscribe function.

`subscribe` is the **escape hatch** for bridging to external systems. For declarative reactive coordination inside the library, prefer `watch` — it integrates with the dependency-tracking computation graph; `subscribe` does not.

For granular subscription, compose with `.at(path)`:

```ts
store.at("user.name").subscribe((name) => console.log("name changed:", name))
```

---

### `.at(path)`

```ts
store.at<P extends Path<T>>(path: P):
    PathValue<T, P> extends any[]
        ? List<PathValue<T, P>[number]>
        : PathValue<T, P> extends object
          ? Store<PathValue<T, P> & object>
          : WritableDerived<PathValue<T, P> | undefined>
```

Returns a stable reactive handle for the subtree or leaf at `path`.

- **Array path** → [`List<E>`](./list.md), a scoped reactive array backed by the same shared holder. All mutations propagate to the root's signal map and vice versa.
- **Object path** → `Store<V>`, a scoped view that forwards mutations to the root's signal map.
- **Primitive (leaf) path** → [`WritableDerived<V | undefined>`](./derived.md), a writable reactive handle. Reads track through the Store's signal for `path`; writes route back through `store.set(path, value)`.

Repeated calls with the same `path` return the **same cached instance**.

`.at()` is **binding-unaware** — it always returns the same type of handle regardless of whether a signal has been bound to the path via `.bind()`.

```ts
const scoresList = store.at("scores")    // List<number>
const userStore  = store.at("user")      // Store<{ name: string; age: number }>
const nameD      = store.at("user.name") // WritableDerived<string | undefined>

// List: per-index reads + iterator methods
scoresList.get(0)            // 1 — tracked
scoresList.length()          // 3 — tracked
const evens = scoresList.filter(x => x % 2 === 0)  // DerivedArray<number>

// Primitive WritableDerived: tracked read and write
nameD.get()           // tracked read
nameD.set("Bob")      // forwards to store.set("user.name", "Bob")
```

---

### `.maybeAt(path)`

```ts
store.maybeAt<P extends Path<T>>(path: P): Derived<Option<PathValue<T, P>>>
```

Returns a `Derived<Option<V>>` handle for `path` — `Some(value)` when the path exists and has a value, `None` when deleted or unset.

Use this when you need to **observe the presence or absence** of a path, not just its value. `.at()` is deletion-unaware; `.maybeAt()` is the opt-in deletion-aware alternative.

Each call creates a new `Derived` — unlike `.at()`, handles are not cached.

```ts
const name = store.maybeAt("user.name")

import { match } from "aljabr"
import { Option } from "aljabr/prelude"

match(name.get()!, {
    Some: ({ value }) => console.log("name:", value),
    None: ()          => console.log("no name set"),
})

store.delete("user.name")
name.get()  // Option.None()
```

---

### `.bind(path, signal)`

```ts
store.bind<P extends Path<T>>(path: P, signal: Signal<PathValue<T, P>>): void
```

Establish a **live binding** from an external `Signal` to `path`. When the signal changes, the Store path is updated synchronously.

- The path is set to the signal's current value immediately.
- Re-binding a path silently replaces the existing subscription.
- When the source signal is disposed, the path receives `undefined` and the binding is released automatically.
- Calling `set(path, value)` on a bound path implicitly unbinds — a plain write always wins.

```ts
const nameSignal = Signal.create("Alice")
store.bind("user.name", nameSignal)

nameSignal.set("Bob")
store.get("user.name")  // "Bob"

// Plain write unbinds:
store.set("user.name", "Carol")
nameSignal.set("Dave")
store.get("user.name")  // "Carol" — no longer tracking nameSignal
```

---

### `.unbind(path)`

```ts
store.unbind<P extends Path<T>>(path: P): void
```

Release the binding at `path` without writing a value. The path retains its last known value and the source signal no longer drives it.

No-op if no binding exists at `path`.

```ts
store.bind("user.name", nameSignal)
store.unbind("user.name")

nameSignal.set("Eve")
store.get("user.name")  // unchanged — "Alice" (the value when bind was called)
```

---

### `.boundAt(path)`

```ts
store.boundAt<P extends Path<T>>(path: P): Signal<PathValue<T, P>> | null
```

Returns the raw bound `Signal` at `path`, or `null` if no binding exists.

Use this as an **escape hatch** when you need to access the full custom state `S` of a `Signal<T, S>` that was bound via `.bind()`. `.at()` and `.maybeAt()` only expose the extracted `T` value.

```ts
const sig = Signal.create("Bound")
store.bind("user.name", sig)

store.boundAt("user.name")  // the Signal instance
store.boundAt("user.age")   // null
```

---

### Array mutations

`Store` does not expose array mutation methods directly. To mutate an array at a path, traverse to it with `.at(path)` — when the path resolves to an array, `.at()` returns a [`List<T>`](./list.md) whose `push` / `pop` / `splice` / `move` / `set` methods notify only the affected signals (no full-array diff).

```ts
const scores = store.at("scores")    // List<number>
scores.push(4)
scores.push(5, 6)

match(scores.pop(), {
    Some: ({ value }) => console.log("removed", value),
    None: ()          => console.warn("array was empty"),
})

scores.splice(1, 1)    // remove 1 element at index 1
scores.move(0, 2)      // swap first and last
```

See [`List<T>`](./list.md) for the full pathless mutation API.

---

### `.dispose()`

```ts
store.dispose(): void
store[Symbol.dispose](): void
```

Dispose the root Store and all internal reactive nodes. Releases all bindings, disposes all leaf signals, and clears all cached handles.

`Store` implements `Symbol.dispose` so it works with TC39 explicit-resource-management `using` blocks. Disposal is synchronous — no async cleanup is awaited.

**No-op on sub-Stores** created via `.at()` — only the root Store (created via `Store.create()`) owns the internal state and can be disposed.

```ts
store.dispose()
store.set("active", false)  // no-op after dispose

// or via TC39 explicit resource management:
{
    using state = Store.create({ active: true })
    // ... work
}   // state.dispose() runs at block exit
```

---

## Handle comparison

| Method | Deletion-aware | Binding-aware | Returns | Cached |
|---|---|---|---|---|
| `.at(path)` — array | No | No | `List<E>` | Yes |
| `.at(path)` — object | No | No | `Store<V>` | Yes |
| `.at(path)` — leaf | No | No | `WritableDerived<V \| undefined>` | Yes |
| `.maybeAt(path)` | Yes | No | `Derived<Option<V>>` | No |
| `.boundAt(path)` | — | Yes | `Signal<V> \| null` | — |

---

## Path types

### `Path<T>`

All valid dot-separated paths into `T`, including array index paths. Array indices use dot notation: `"users.0.name"`. Depth is capped at 10 levels.

```ts
type Path<{ user: { name: string }; scores: number[] }>
// "user" | "user.name" | "scores" | "scores.0" | ...
```

### `PathValue<T, P>`

The value type at a given path `P` into `T`.

```ts
type PathValue<State, "user.name">  // string
type PathValue<State, "scores.0">   // number
```

---

## Examples

### Fine-grained subscriptions

```ts
const store = Store.create({
    user: { name: "Alice", age: 30 },
    scores: [1, 2, 3],
})

// Two independent computations — each subscribes to exactly one path
const nameComp = Derived.create(() => store.get("user.name"))
const ageComp  = Derived.create(() => store.get("user.age"))

store.set("user.name", "Bob")  // only nameComp re-evaluates
```

### patch vs set

```ts
// patch: only notifies user.name subscribers — user.age is unchanged
store.patch("user", { name: "Bob", age: 30 })

// set: notifies all subscribers under "user" — including user.age
store.set("user", { name: "Bob", age: 30 })
```

### Sub-Store scoping

```ts
const userStore = store.at("user") as Store<{ name: string; age: number }>

// Reads and writes on userStore forward to the root signal map
userStore.get("name" as any)         // "Alice"
userStore.set("name" as any, "Bob")
store.get("user.name")               // "Bob"
```

### Deletion and maybeAt

```ts
const nameHandle = store.maybeAt("user.name")

import { match } from "aljabr"

const display = () => match(nameHandle.get()!, {
    Some: ({ value }) => `Name: ${value}`,
    None: ()          => "No name",
})

display()                    // "Name: Alice"
store.delete("user.name")
display()                    // "No name"
store.set("user.name", "Carol")
display()                    // "Name: Carol"
```

### Live bindings

```ts
const formName = Signal.create("Alice")

const store = Store.create({ user: { name: "" } })
store.bind("user.name", formName)

formName.set("Bob")
store.get("user.name")  // "Bob" — live

// Unbind explicitly to stop tracking
store.unbind("user.name")
formName.set("Carol")
store.get("user.name")  // "Bob" — frozen at last known value
```

### Unset state

```ts
const store = Store.create<{ name: string }>()

store.isUnset            // true
store.get("name")        // undefined

store.set("name", "Ada")
store.isUnset            // false
store.get("name")        // "Ada"
```

---

## See also

- [`Signal<T, S>`](./signal.md) — flat reactive value container; used internally by `Store`
- [`Derived<T>` / `WritableDerived<T>`](./derived.md) — lazy computed reactive value; returned by `.at()` for leaf paths
- [`List<T>`](./list.md) — reactive root-array container; returned by `.at()` for array paths
- [`DerivedArray<T>`](./derived-array.md) — read-only per-index reactive view returned by iterator methods on `List`
- [`Option<T>`](./option.md) — present/absent container; returned by `.maybeAt()`
- [`batch`](./context.md#batch) — coalesce multiple Store writes into a single notification pass
