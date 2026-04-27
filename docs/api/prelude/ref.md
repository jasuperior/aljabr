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
Ref.create<T extends unknown[]>(initial: T): RefArray<T[number]>  // array (explicit type arg) → RefArray
Ref.create<T>(initial: T[]): RefArray<T>                          // array → RefArray
Ref.create<T extends object>(initial: T): Ref<T>                  // object → Ref (active state)
Ref.create<T extends object>(): Ref<T>                            // no value → Ref (Unset state)
```

Creates a new `Ref` or `RefArray` depending on the argument type.

- **Array argument** → returns `RefArray<T>`. The first overload (`T extends unknown[]`) is picked when an explicit type parameter is supplied (`Ref.create<Task[]>([])`), correctly resolving the element type via `T[number]` — e.g. `Ref.create<Task[]>([])` returns `RefArray<Task>`, not `RefArray<Task[]>`. The second overload covers the inferred case (`Ref.create([...tasks])`).
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

### `.get()`

```ts
ref.get(): T | undefined
ref.get<P extends Path<T>>(path: P): PathValue<T, P> | undefined
```

Read the value at a path (or the entire object when called with no arguments) and register it as a dependency in the active tracking context. One call = one subscription.

Returns `undefined` if the Ref is in `Unset` state or if the path has been deleted.

**No-arg form** — coarse dependency on the root signal, notified whenever any path in the Ref changes. Use this when you need the whole object as a value. For fine-grained path-level tracking, supply a path.

```ts
ref.get()              // { user: { name: "Alice", age: 30 }, scores: [1, 2, 3], active: true }
ref.get("user.name")   // "Alice"
ref.get("scores.0")    // 1
ref.get("active")      // true
```

---

### `.peek()`

```ts
ref.peek(): T | undefined
ref.peek<P extends Path<T>>(path: P): PathValue<T, P> | undefined
```

Untracked read — same overloads as `.get()` but wrapped in `untrack()`. Does not register any reactive dependency. Consistent with `Signal.peek()`.

```ts
ref.peek()             // { user: { name: "Alice", ... }, ... } — no dependency registered
ref.peek("user.name")  // "Alice" — no dependency registered
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
const evens = scoresRef.filter(x => x % 2 === 0)  // DerivedArray<number>

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
ref.pop<P extends ArrayPath<T>>(path: P): Option<ArrayItem<T, P>>
```

Remove and return the last element of the array at `path` as an `Option`. Returns `Option.Some(value)` on success or `Option.None()` if the array is empty.

```ts
import { match } from "aljabr"

match(ref.pop("scores"), {
    Some: ({ value }) => console.log("removed", value),
    None: ()          => console.warn("array was empty"),
})
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

### `.get()`

```ts
refArray.get(): T[]
refArray.get(i: number): T | undefined
```

Read the entire array or a single element, registering a reactive dependency.

**No-arg form** — subscribes to the root signal (the same signal notified by every mutation). Re-evaluates whenever any element changes or the array grows/shrinks. Returns a snapshot copy of the underlying array.

**Indexed form** — fine-grained: only subscribers to index `i` are notified when `items[i]` changes.

Returns `[]` (no-arg) or `undefined` (indexed) for out-of-bounds or disposed state.

```ts
const items = Ref.create([1, 2, 3])

items.get()   // [1, 2, 3] — tracked; fires on any mutation
items.get(0)  // 1 — tracked; fires only when index 0 changes

const first = Derived.create(() => items.get(0))
items.splice(0, 1, 99)
first.get()  // 99
```

---

### `.peek()`

```ts
refArray.peek(): T[]
refArray.peek(i: number): T | undefined
```

Untracked read — same overloads as `.get()` but wrapped in `untrack()`. Does not register any reactive dependency. Consistent with `Signal.peek()`.

```ts
items.peek()   // [1, 2, 3] — no dependency registered
items.peek(0)  // 1 — no dependency registered
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
refArray.pop(): Option<T>
```

Remove and return the last item as an `Option`. Returns `Option.Some(value)` on success or `Option.None()` when the array is empty.

```ts
import { match } from "aljabr"

match(items.pop(), {
    Some: ({ value }) => console.log("removed", value),
    None: ()          => console.warn("array was empty"),
})
```

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

#### `.set(index, value)`

```ts
refArray.set(index: number, value: T): Option<T>
```

Replace the element at `index` in-place. Fine-grained: dirties only the per-index signal for `index`, leaving all other indices and the length signal untouched.

Returns `Option.Some(oldValue)` on success (the previous value) or `Option.None()` if the index is out of bounds. Does **not** extend the array — use `push` to append or `splice` to insert.

```ts
import { match } from "aljabr"

match(items.set(2, 99), {
    Some: ({ value: prev }) => console.log("replaced", prev, "with 99"),
    None: ()                => console.warn("index out of bounds"),
})
```

#### `.shift()`

```ts
refArray.shift(): Option<T>
```

Remove and return the first element. Returns `Option.Some(value)` on success or `Option.None()` when the array is empty.

```ts
match(items.shift(), {
    Some: ({ value }) => console.log("removed", value),
    None: ()          => console.warn("array was empty"),
})
```

#### `.unshift(...items)`

```ts
refArray.unshift(...items: T[]): void
```

Insert one or more items at the front of the array. Notifies signals at the affected indices, the length signal, and ancestor paths.

```ts
items.unshift(0)     // prepend a single item
items.unshift(-2, -1) // prepend multiple items
```

---

### Query methods

Synchronous reactive reads. Call them inside `derived()` or `effect()` to register reactive dependencies.

#### `.find(predicate)`

```ts
refArray.find(predicate: (item: T, index: number) => boolean): Option<T>
```

Returns `Option.Some(item)` for the first element matching `predicate`, or `Option.None()` if no match is found.

Uses **precise dependency tracking** — calls `get(i)` only for each visited index and stops at the first match. Elements beyond the match point are not tracked.

```ts
import { match } from "aljabr"

const tasks = Ref.create([{ id: 1, done: false }, { id: 2, done: true }])

match(tasks.find(t => t.done), {
    Some: ({ value }) => console.log("first done:", value.id),
    None: ()          => console.log("none done"),
})
```

#### `.findIndex(predicate)`

```ts
refArray.findIndex(predicate: (item: T, index: number) => boolean): Option<number>
```

Returns `Option.Some(index)` for the first index whose element matches `predicate`, or `Option.None()` if no match. Uses precise dependency tracking — stops at the first match.

```ts
match(tasks.findIndex(t => t.done), {
    Some: ({ value: idx }) => console.log("first done at index", idx),
    None: ()               => console.log("none done"),
})
```

#### `.findLastIndex(predicate)`

```ts
refArray.findLastIndex(predicate: (item: T, index: number) => boolean): Option<number>
```

Returns `Option.Some(index)` for the **last** index whose element matches `predicate`, or `Option.None()` if no match. Scans from the end; uses precise dependency tracking — stops at the first match found from the right.

#### `.includes(value)`

```ts
refArray.includes(value: T): boolean
```

Returns `true` if the array contains `value` (by reference equality). Uses precise dependency tracking — stops at first match.

```ts
const items = Ref.create([1, 2, 3])
items.includes(2) // true
items.includes(5) // false
```

#### `.join(separator?)`

```ts
refArray.join(separator?: string): string
```

Joins all elements into a string, separated by `separator` (default `","`). Full-array reactive read — tracks all per-index signals and the length signal. Re-evaluates whenever any element changes or the array grows/shrinks.

```ts
const tags = Ref.create(["alpha", "beta", "gamma"])
const label = Derived.create(() => tags.join(", "))
// label.get() → "alpha, beta, gamma"
```

#### `.reduce(fn, initial)`

```ts
refArray.reduce<U>(fn: (acc: U, item: T, index: number) => U, initial: U): U
```

Left-to-right accumulation over all elements. Full-array reactive read — tracks all per-index signals and the length signal.

```ts
const nums = Ref.create([1, 2, 3, 4])
const sum = Derived.create(() => nums.reduce((acc, x) => acc + x, 0))
// sum.get() → 10
```

#### `.reduceRight(fn, initial)`

```ts
refArray.reduceRight<U>(fn: (acc: U, item: T, index: number) => U, initial: U): U
```

Right-to-left accumulation over all elements. Full-array reactive read — tracks all per-index signals and the length signal.

---

### Iterator methods

All return a [`DerivedArray<U>`](./derived-array.md) — a read-only per-index reactive view.

#### `.map(fn)`

```ts
refArray.map<U>(fn: (item: T, i: number) => U): DerivedArray<U>
```

Returns a new `DerivedArray<U>` where each element is transformed by `fn`. 1:1 index correspondence is maintained — no key function needed.

```ts
const doubled = items.map(x => x * 2)  // DerivedArray<number>
```

#### `.filter(fn, opts?)`

```ts
refArray.filter(
  fn: (item: T, i: number) => boolean,
  opts?: { key?: (item: T) => unknown },
): DerivedArray<T>
```

Returns a `DerivedArray<T>` containing only items matching `fn`. Provide a `key` function for surgical per-position invalidation when items are objects.

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
): DerivedArray<T>
```

Returns a `DerivedArray<T>` sorted by `comparator`. Provide a `key` for surgical per-position invalidation.

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
- No key is provided and items are objects (warning emitted once per `DerivedArray` instance)
- Two items produce the same key (duplicate keys → ambiguous identity)

---

## See also

- [`Signal<T, S>`](./signal.md) — flat reactive value container; used internally by `Ref`
- [`Derived<T>`](./derived.md) — lazy computed reactive value; returned by `.at()` for leaf paths
- [`DerivedArray<T>`](./derived-array.md) — read-only per-index reactive view returned by iterator methods
- [`Option<T>`](./option.md) — present/absent container; returned by `.maybeAt()`
- [`batch`](./context.md#batch) — coalesce multiple Ref writes into a single notification pass
