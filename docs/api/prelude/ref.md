# API Reference: Ref · RefArray

```ts
import {
  Ref,
  RefArray,
  type Path, type PathValue,
  type ArrayPath, type ArrayItem,
} from "aljabr/prelude"
```

---

## Overview

`Ref<T>` is a reactive mutable container for **structured objects and arrays**. Where a [`Signal<T>`](./signal.md) holds a single flat value, a `Ref<T>` decomposes a nested value into per-path reactive nodes internally — enabling **fine-grained path-level subscriptions**.

Reading `ref.get("user.name")` inside a reactive context subscribes to exactly `"user.name"`. A change to `"user.age"` does not re-run that computation.

Internally, `Ref<T>` maintains a flat `Map<string, Signal<unknown>>` of leaf signals keyed by dot-separated path. Signals are created lazily on first access. All sub-Refs created via `.at()` share the same signal map as the root — there is only ever one owner.

---

## `Ref<T>`

### `Ref.create()`

```ts
Ref.create<T>(initial: T[]): RefArray<T>            // array → RefArray
Ref.create<T extends object>(initial: T): Ref<T>    // object → Ref (active state)
Ref.create<T extends object>(): Ref<T>              // no value → Ref (Unset state)
```

Creates a new `Ref` or `RefArray` depending on the argument type.

- **Array argument** → returns `RefArray<T>`. Prefer this over `Ref.create<T[]>({...})` when the root IS the array.
- **Object argument** → returns `Ref<T>` in active state.
- **No argument** → returns `Ref<T>` in `Unset` state; `get()` returns `undefined` until first `set()`.

If called inside a reactive computation, the result is automatically disposed when the owner is disposed.

```ts
// Object Ref (active)
const state = Ref.create({
    user: { name: "Alice", age: 30 },
    scores: [1, 2, 3],
    active: true,
})

// Root array → RefArray<number>
const items = Ref.create([1, 2, 3, 4, 5])
items.push(6)           // RefArray methods available at the root
items.length()          // 6

// Unset — no initial value; get() returns undefined until first set()
const pending = Ref.create<{ name: string }>()
pending.isUnset // true
```

---

### `.isUnset`

```ts
ref.isUnset: boolean
```

`true` if the Ref was created without an initial value and has never been written to. Transitions to `false` on the first `set()` or `patch()`.

---

### `.get(path)`

```ts
ref.get<P extends Path<T>>(path: P): PathValue<T, P> | undefined
```

Read the value at `path` and register it as a dependency in the active tracking context. One call = one subscription.

Returns `undefined` if the Ref is in `Unset` state or if the path has been deleted.

```ts
ref.get("user.name")   // "Alice"
ref.get("scores.0")    // 1
ref.get("active")      // true
```

---

### `.set(path, value)`

```ts
ref.set<P extends Path<T>>(path: P, value: PathValue<T, P>): void
```

Replace the subtree at `path` and notify **all** signals at related paths (the exact path, its descendants, and its ancestors). No structural diffing is performed.

**Equality guard:** if `value === current`, no notification is emitted.

If a [live binding](#bindpath-signal) exists at `path`, calling `set()` implicitly unbinds it — a plain write always wins.

```ts
ref.set("user.name", "Bob")
ref.set("scores", [10, 20, 30])
```

Use `patch()` when only some fields of a sub-object changed and you want to avoid notifying unchanged sibling subscribers.

---

### `.patch(path, value)`

```ts
ref.patch<P extends Path<T>>(path: P, value: PathValue<T, P>): void
```

Deep-diff `value` against the current value at `path` and notify only the signals whose values actually changed. Reference equality is checked at each node before recursing — unchanged sub-trees are skipped entirely.

**Equality guard:** if `value === current` at the root, no update occurs.

```ts
// Only the "user.name" signal is notified; "user.age" is unchanged
ref.patch("user", { name: "Bob", age: 30 })
```

| | `set` | `patch` |
|---|---|---|
| Diffing | None — notifies all related signals | Deep structural diff |
| Use when | You know exactly what changed, or value is a primitive | Value is a complex object and only some fields changed |

---

### `.delete(path)`

```ts
ref.delete<P extends Path<T>>(path: P): void
```

Remove the value at `path` and all descendant paths.

- All signals at or under `path` receive `undefined` and notify their subscribers.
- Ancestor signals are updated to reflect the structural change.
- Cached `.at()` sub-Ref handles at `path` remain alive and transition to `isUnset = true`. Re-setting the path later reactivates them.
- Any [live binding](#bindpath-signal) at `path` or a descendant is released.
- `get(path)` returns `undefined` after deletion.

```ts
ref.delete("user.name")
ref.get("user.name")  // undefined

const userRef = ref.at("user")
ref.delete("user")
userRef.isUnset  // true — handle is still alive, just empty
```

---

### `.at(path)`

```ts
ref.at<P extends Path<T>>(path: P):
    PathValue<T, P> extends any[]
        ? RefArray<PathValue<T, P>[number]>
        : PathValue<T, P> extends object
          ? Ref<PathValue<T, P> & object>
          : Derived<PathValue<T, P> | undefined>
```

Returns a stable reactive handle for the subtree or leaf at `path`.

- **Array path** → `RefArray<E>`, a scoped reactive array backed by the same shared holder. All mutations propagate to the root's signal map and vice versa.
- **Object path** → `Ref<V>`, a scoped view that forwards mutations to the root's signal map.
- **Primitive (leaf) path** → `Derived<V | undefined>`, a writable reactive handle. Reads track through the Ref's signal for `path`; writes route back through `ref.set(path, value)`.

Repeated calls with the same `path` return the **same cached instance**.

`.at()` is **binding-unaware** — it always returns the same type of handle regardless of whether a signal has been bound to the path via `.bind()`.

```ts
const scoresRef = ref.at("scores")    // RefArray<number>
const userRef   = ref.at("user")      // Ref<{ name: string; age: number }>
const nameD     = ref.at("user.name") // Derived<string | undefined>

// RefArray: per-index reads + iterator methods
scoresRef.get(0)            // 1 — tracked
scoresRef.length()          // 3 — tracked
const evens = scoresRef.filter(x => x % 2 === 0)  // ReactiveArray<number>

// Primitive Derived: tracked read and write
nameD.get()           // tracked read
nameD.set("Bob")      // forwards to ref.set("user.name", "Bob")
```

---

### `.maybeAt(path)`

```ts
ref.maybeAt<P extends Path<T>>(path: P): Derived<Option<PathValue<T, P>>>
```

Returns a `Derived<Option<V>>` handle for `path` — `Some(value)` when the path exists and has a value, `None` when deleted or unset.

Use this when you need to **observe the presence or absence** of a path, not just its value. `.at()` is deletion-unaware; `.maybeAt()` is the opt-in deletion-aware alternative.

Each call creates a new `Derived` — unlike `.at()`, handles are not cached.

```ts
const name = ref.maybeAt("user.name")

import { match } from "aljabr"
import { Option } from "aljabr/prelude"

match(name.get()!, {
    Some: ({ value }) => console.log("name:", value),
    None: ()          => console.log("no name set"),
})

ref.delete("user.name")
name.get()  // Option.None()
```

---

### `.bind(path, signal)`

```ts
ref.bind<P extends Path<T>>(path: P, signal: Signal<PathValue<T, P>>): void
```

Establish a **live binding** from an external `Signal` to `path`. When the signal changes, the Ref path is updated synchronously.

- The path is set to the signal's current value immediately.
- Re-binding a path silently replaces the existing subscription.
- When the source signal is [disposed](./signal.md#dispose), the path receives `undefined` and the binding is released automatically.
- Calling `set(path, value)` on a bound path implicitly unbinds — a plain write always wins.

```ts
const nameSignal = Signal.create("Alice")
ref.bind("user.name", nameSignal)

nameSignal.set("Bob")
ref.get("user.name")  // "Bob"

// Plain write unbinds:
ref.set("user.name", "Carol")
nameSignal.set("Dave")
ref.get("user.name")  // "Carol" — no longer tracking nameSignal
```

---

### `.unbind(path)`

```ts
ref.unbind<P extends Path<T>>(path: P): void
```

Release the binding at `path` without writing a value. The path retains its last known value and the source signal no longer drives it.

No-op if no binding exists at `path`.

```ts
ref.bind("user.name", nameSignal)
ref.unbind("user.name")

nameSignal.set("Eve")
ref.get("user.name")  // unchanged — "Alice" (the value when bind was called)
```

---

### `.boundAt(path)`

```ts
ref.boundAt<P extends Path<T>>(path: P): Signal<PathValue<T, P>> | null
```

Returns the raw bound `Signal` at `path`, or `null` if no binding exists.

Use this as an **escape hatch** when you need to access the full custom state `S` of a `Signal<T, S>` that was bound via `.bind()`. `.at()` and `.maybeAt()` only expose the extracted `T` value.

```ts
const sig = Signal.create("Bound")
ref.bind("user.name", sig)

ref.boundAt("user.name")  // the Signal instance
ref.boundAt("user.age")   // null
```

---

### Array mutation methods

First-class methods that notify only the affected signals — no full-array diff needed.

#### `.push(path, ...items)`

```ts
ref.push<P extends ArrayPath<T>>(path: P, ...items: ArrayItem<T, P>[]): void
```

Append one or more items to the end of the array at `path`. Notifies signals at the new indices and ancestor paths.

```ts
ref.push("scores", 4)
ref.push("scores", 5, 6)
```

#### `.pop(path)`

```ts
ref.pop<P extends ArrayPath<T>>(path: P): ArrayItem<T, P> | undefined
```

Remove and return the last element of the array at `path`. Returns `undefined` if the array is empty.

```ts
const last = ref.pop("scores")
```

#### `.splice(path, start, deleteCount, ...items)`

```ts
ref.splice<P extends ArrayPath<T>>(
    path: P,
    start: number,
    deleteCount: number,
    ...items: ArrayItem<T, P>[]
): void
```

Remove and/or insert elements in the array at `path`, starting at `start`. Signals for indices that no longer exist after a shrink are disposed.

```ts
ref.splice("scores", 1, 1)        // remove 1 element at index 1
ref.splice("scores", 0, 0, 10)    // insert 10 at the front
```

#### `.move(path, from, to)`

```ts
ref.move<P extends ArrayPath<T>>(path: P, from: number, to: number): void
```

Swap the elements at indices `from` and `to`. Only signals at those two indices and ancestor paths are notified.

```ts
ref.move("scores", 0, 2)  // swap first and last
```

---

### `.dispose()`

```ts
ref.dispose(): void
```

Dispose the root Ref and all internal reactive nodes. Releases all bindings, disposes all leaf signals, and clears all cached handles.

**No-op on sub-Refs** created via `.at()` — only the root Ref (created via `Ref.create()`) owns the internal state and can be disposed.

```ts
ref.dispose()
ref.set("active", false)  // no-op after dispose
```

---

## Handle comparison

| Method | Deletion-aware | Binding-aware | Returns | Cached |
|---|---|---|---|---|
| `.at(path)` — array | No | No | `RefArray<E>` | Yes |
| `.at(path)` — object | No | No | `Ref<V>` | Yes |
| `.at(path)` — leaf | No | No | `Derived<V \| undefined>` | Yes |
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

### `ArrayPath<T>`

All paths in `T` whose resolved value is an array. Used to constrain array mutation methods.

### `ArrayItem<T, P>`

The element type of the array at path `P` in `T`.

---

## Examples

### Fine-grained subscriptions

```ts
const ref = Ref.create({
    user: { name: "Alice", age: 30 },
    scores: [1, 2, 3],
})

// Two independent computations — each subscribes to exactly one path
const nameComp = Derived.create(() => ref.get("user.name"))
const ageComp  = Derived.create(() => ref.get("user.age"))

ref.set("user.name", "Bob")  // only nameComp re-evaluates
```

### patch vs set

```ts
// patch: only notifies user.name subscribers — user.age is unchanged
ref.patch("user", { name: "Bob", age: 30 })

// set: notifies all subscribers under "user" — including user.age
ref.set("user", { name: "Bob", age: 30 })
```

### Sub-Ref scoping

```ts
const userRef = ref.at("user") as Ref<{ name: string; age: number }>

// Reads and writes on userRef forward to the root signal map
userRef.get("name" as any)         // "Alice"
userRef.set("name" as any, "Bob")
ref.get("user.name")               // "Bob"
```

### Deletion and maybeAt

```ts
const nameHandle = ref.maybeAt("user.name")

import { match } from "aljabr"

const display = () => match(nameHandle.get()!, {
    Some: ({ value }) => `Name: ${value}`,
    None: ()          => "No name",
})

display()                    // "Name: Alice"
ref.delete("user.name")
display()                    // "No name"
ref.set("user.name", "Carol")
display()                    // "Name: Carol"
```

### Live bindings

```ts
const formName = Signal.create("Alice")

const ref = Ref.create({ user: { name: "" } })
ref.bind("user.name", formName)

formName.set("Bob")
ref.get("user.name")  // "Bob" — live

// Unbind explicitly to stop tracking
ref.unbind("user.name")
formName.set("Carol")
ref.get("user.name")  // "Bob" — frozen at last known value
```

### Unset state

```ts
const ref = Ref.create<{ name: string }>()

ref.isUnset            // true
ref.get("name")        // undefined

ref.set("name", "Ada")
ref.isUnset            // false
ref.get("name")        // "Ada"
```

---

---

## `RefArray<T>`

```ts
import { Ref, RefArray } from "aljabr/prelude"
```

A reactive mutable container for a root-level array. Returned by `Ref.create(T[])` and `Ref.at(path)` when the path resolves to an array.

Unlike `Ref<T[]>`, `RefArray<T>` exposes **pathless mutation methods** and **per-index reactive reads** without requiring a path argument. The element type `T` is the item type, not the array type.

---

### `RefArray.create()`

```ts
RefArray.create<T>(initial: T[]): RefArray<T>
```

Creates a standalone `RefArray`. Equivalent to `Ref.create(T[])` — prefer the latter for consistency.

```ts
const items = RefArray.create([10, 20, 30])
items.get(0)    // 10
items.length()  // 3
```

---

### `.get(i)`

```ts
refArray.get(i: number): T | undefined
```

Read the item at index `i` and register it as a dependency in the active tracking context. Returns `undefined` for out-of-bounds indices.

Only subscribers to index `i` are notified when `items[i]` changes — other index subscribers are unaffected.

```ts
const items = Ref.create([1, 2, 3])
const first = Derived.create(() => items.get(0))

items.splice(0, 1, 99)
first.get()  // 99
```

---

### `.at(i)`

```ts
refArray.at(i: number): Derived<T | undefined>
```

Returns a `Derived<T | undefined>` handle for index `i`. Each call creates a new `Derived`. Cache it if reused frequently.

```ts
const firstHandle = items.at(0)  // Derived<number | undefined>
firstHandle.get()  // 1
```

---

### `.length()`

```ts
refArray.length(): number
```

Returns the current length of the array and registers it as a reactive dependency. Subscribers are notified **only when the array size changes**, not on element-only mutations.

```ts
const len = Derived.create(() => items.length())
items.push(4)   // len invalidated (3 → 4)
items.move(0, 3) // len NOT invalidated (size unchanged)
```

---

### Pathless mutations

All methods operate on the root array without requiring a path argument.

#### `.push(...items)`

```ts
refArray.push(...items: T[]): void
```

Append one or more items to the end.

#### `.pop()`

```ts
refArray.pop(): T | undefined
```

Remove and return the last item. Returns `undefined` on an empty array.

#### `.splice(start, deleteCount, ...items)`

```ts
refArray.splice(start: number, deleteCount: number, ...items: T[]): void
```

Remove and/or insert elements starting at `start`. Signals for indices that no longer exist are disposed.

#### `.move(from, to)`

```ts
refArray.move(from: number, to: number): void
```

Swap the elements at indices `from` and `to`. Only signals at those two positions are notified. No-op if `from === to` or either index is out of bounds.

---

### Iterator methods

All return a [`ReactiveArray<U>`](./reactive-array.md) — a read-only per-index reactive view.

#### `.map(fn)`

```ts
refArray.map<U>(fn: (item: T, i: number) => U): ReactiveArray<U>
```

Returns a new `ReactiveArray<U>` where each element is transformed by `fn`. 1:1 index correspondence is maintained — no key function needed.

```ts
const doubled = items.map(x => x * 2)  // ReactiveArray<number>
```

#### `.filter(fn, opts?)`

```ts
refArray.filter(
  fn: (item: T, i: number) => boolean,
  opts?: { key?: (item: T) => unknown },
): ReactiveArray<T>
```

Returns a `ReactiveArray<T>` containing only items matching `fn`. Provide a `key` function for surgical per-position invalidation when items are objects.

```ts
const evens = items.filter(x => x % 2 === 0)

// Object array — always provide a key:
const activeUsers = users.filter(
  u => u.active,
  { key: u => u.id },
)
```

#### `.sort(comparator, opts?)`

```ts
refArray.sort(
  comparator: (a: T, b: T) => number,
  opts?: { key?: (item: T) => unknown },
): ReactiveArray<T>
```

Returns a `ReactiveArray<T>` sorted by `comparator`. Provide a `key` for surgical per-position invalidation.

```ts
const sorted = items.sort((a, b) => a - b)
```

---

### `.dispose()`

```ts
refArray.dispose(): void
```

Dispose the RefArray and all internal reactive nodes. **No-op on sub-RefArrays** returned by `Ref.at()` — only root RefArrays (created via `Ref.create(T[])` or `RefArray.create()`) own the holder.

---

### Key function and dev warnings

`filter` and `sort` break index correspondence — without identity tracking, a mutation that reorders elements would fire every per-position subscriber. The `key` option enables surgical invalidation:

```ts
type IteratorOptions<T> = { key?: (item: T) => unknown }
```

**Default key:** `item => item` (reference equality). Works for primitive arrays. For object arrays, this breaks under `Ref`'s immutable-update model (every `patch` produces new references). **Always provide a `key` for object arrays.**

**Dev-mode warnings fire when:**
- No key is provided and items are objects (warning emitted once per `ReactiveArray` instance)
- Two items produce the same key (duplicate keys → ambiguous identity)

---

## See also

- [`Signal<T, S>`](./signal.md) — flat reactive value container; used internally by `Ref`
- [`Derived<T>`](./derived.md) — lazy computed reactive value; returned by `.at()` for leaf paths
- [`ReactiveArray<T>`](./reactive-array.md) — read-only per-index reactive view returned by iterator methods
- [`Option<T>`](./option.md) — present/absent container; returned by `.maybeAt()`
- [`batch`](./context.md#batch) — coalesce multiple Ref writes into a single notification pass
