# API Reference: List

```ts
import { Store, List } from "aljabr/prelude"
```

See also: [`Store<T>`](./store.md) — the reactive container for structured objects; returns a `List<E>` from `.at(path)` when the path resolves to an array.

---

## Overview

`List<T>` is a reactive mutable container for a root-level array. Returned by `Store.create(T[])` and by `store.at(path)` when the path resolves to an array.

Unlike `Store<T[]>`, `List<T>` exposes **pathless mutation methods** and **per-index reactive reads** without requiring a path argument. The element type `T` is the item type, not the array type.

`List` is the single home for array mutations across the prelude — `Store` does not duplicate them. To mutate an array nested inside a Store, traverse to it: `store.at("scores").push(4)`.

---

## `List<T>`

### `List.create()`

```ts
List.create<T>(initial: T[]): List<T>
```

Creates a standalone `List`. Equivalent to `Store.create(T[])` — prefer the latter for consistency with the bucket-1 construction rule.

```ts
const items = List.create([10, 20, 30])
items.get(0)    // 10
items.length()  // 3
```

---

### `.isUnset`

```ts
list.isUnset: boolean
```

`true` if the List was created without an initial value. (`List.create([])` produces an empty-but-set list — `isUnset` is `false`.)

---

### `.get()`

```ts
list.get(): T[]
list.get(i: number): T | undefined
```

Read the entire array or a single element, registering a reactive dependency.

**No-arg form** — subscribes to the root signal (the same signal notified by every mutation). Re-evaluates whenever any element changes or the array grows/shrinks. Returns a snapshot copy of the underlying array.

**Indexed form** — fine-grained: only subscribers to index `i` are notified when `items[i]` changes.

Returns `[]` (no-arg) or `undefined` (indexed) for out-of-bounds or disposed state.

```ts
const items = Store.create([1, 2, 3])

items.get()   // [1, 2, 3] — tracked; fires on any mutation
items.get(0)  // 1 — tracked; fires only when index 0 changes

const first = Derived.create(() => items.get(0))
items.splice(0, 1, 99)
first.get()  // 99
```

---

### `.peek()`

```ts
list.peek(): T[]
list.peek(i: number): T | undefined
```

Untracked read — same overloads as `.get()` but wrapped in `untrack()`. Does not register any reactive dependency.

```ts
items.peek()   // [1, 2, 3] — no dependency registered
items.peek(0)  // 1 — no dependency registered
```

---

### `.getOr(i, default)`

```ts
list.getOr(i: number, defaultValue: T): T
```

Tracked read with a fallback. Returns `defaultValue` when the index is out of bounds; otherwise returns the element at `i`.

The bucket-1 canonical "read with default" verb — same shape across `Signal`, `Derived`, `Store`, and `Dispatcher`.

```ts
items.getOr(99, -1)   // -1 if index 99 is OOB
```

---

### `.subscribe(callback)`

```ts
list.subscribe(callback: (value: T[]) => void): () => void
```

Register a synchronous push subscriber. The callback fires after every mutation with the current array snapshot. Returns an unsubscribe function.

`subscribe` is the **escape hatch** for bridging to external systems. For declarative reactive coordination prefer `watch`.

```ts
const unsubscribe = items.subscribe((arr) => console.log("now:", arr))
items.push(4)             // logs: now: [1, 2, 3, 4]
unsubscribe()
```

---

### `.at(i)`

```ts
list.at(i: number): Derived<T | undefined>
```

Returns a `Derived<T | undefined>` handle for index `i`. Each call creates a new `Derived` — cache it if reused frequently.

```ts
const firstHandle = items.at(0)  // Derived<number | undefined>
firstHandle.get()  // 1
```

---

### `.length()`

```ts
list.length(): number
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
list.push(...items: T[]): void
```

Append one or more items to the end.

#### `.pop()`

```ts
list.pop(): Option<T>
```

Remove and return the last item as an `Option`. Returns `Option.Some(value)` on success or `Option.None()` when the array is empty. Destructive reads return `Option<T>` per the style-guide write-rule.

```ts
import { match } from "aljabr"

match(items.pop(), {
    Some: ({ value }) => console.log("removed", value),
    None: ()          => console.warn("array was empty"),
})
```

#### `.splice(start, deleteCount, ...items)`

```ts
list.splice(start: number, deleteCount: number, ...items: T[]): void
```

Remove and/or insert elements starting at `start`. Signals for indices that no longer exist are disposed.

#### `.move(from, to)`

```ts
list.move(from: number, to: number): void
```

Swap the elements at indices `from` and `to`. Only signals at those two positions are notified. No-op if `from === to` or either index is out of bounds.

#### `.set(index, value)`

```ts
list.set(index: number, value: T): void
```

Replace the element at `index` in-place. Fine-grained: dirties only the per-index signal for `index`, leaving all other indices and the length signal untouched.

No-op if `index` is out of bounds or `value === items.peek(index)`. Does **not** extend the array — use `push` to append or `splice` to insert. Callers that need the prior value should `peek(index)` before calling.

```ts
const prev = items.peek(2)
items.set(2, 99)
console.log("replaced", prev, "with 99")
```

#### `.shift()`

```ts
list.shift(): Option<T>
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
list.unshift(...items: T[]): void
```

Insert one or more items at the front of the array. Notifies signals at the affected indices, the length signal, and ancestor paths.

```ts
items.unshift(0)      // prepend a single item
items.unshift(-2, -1) // prepend multiple items
```

---

### Query methods

Synchronous reactive reads. Call them inside a `Derived` or `watch` to register reactive dependencies.

#### `.find(predicate)`

```ts
list.find(predicate: (item: T, index: number) => boolean): Option<T>
```

Returns `Option.Some(item)` for the first element matching `predicate`, or `Option.None()` if no match is found.

Uses **precise dependency tracking** — calls `get(i)` only for each visited index and stops at the first match. Elements beyond the match point are not tracked.

```ts
import { match } from "aljabr"

const tasks = Store.create([{ id: 1, done: false }, { id: 2, done: true }])

match(tasks.find(t => t.done), {
    Some: ({ value }) => console.log("first done:", value.id),
    None: ()          => console.log("none done"),
})
```

#### `.findIndex(predicate)`

```ts
list.findIndex(predicate: (item: T, index: number) => boolean): Option<number>
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
list.findLastIndex(predicate: (item: T, index: number) => boolean): Option<number>
```

Returns `Option.Some(index)` for the **last** index whose element matches `predicate`, or `Option.None()` if no match. Scans from the end; uses precise dependency tracking — stops at the first match found from the right.

#### `.includes(value)`

```ts
list.includes(value: T): boolean
```

Returns `true` if the array contains `value` (by reference equality). Uses precise dependency tracking — stops at first match.

```ts
const items = Store.create([1, 2, 3])
items.includes(2) // true
items.includes(5) // false
```

#### `.join(separator?)`

```ts
list.join(separator?: string): string
```

Joins all elements into a string, separated by `separator` (default `","`). Full-array reactive read — tracks all per-index signals and the length signal. Re-evaluates whenever any element changes or the array grows/shrinks.

```ts
const tags = Store.create(["alpha", "beta", "gamma"])
const label = Derived.create(() => tags.join(", "))
// label.get() → "alpha, beta, gamma"
```

#### `.reduce(fn, initial)`

```ts
list.reduce<U>(fn: (acc: U, item: T, index: number) => U, initial: U): U
```

Left-to-right accumulation over all elements. Full-array reactive read — tracks all per-index signals and the length signal.

```ts
const nums = Store.create([1, 2, 3, 4])
const sum = Derived.create(() => nums.reduce((acc, x) => acc + x, 0))
// sum.get() → 10
```

#### `.reduceRight(fn, initial)`

```ts
list.reduceRight<U>(fn: (acc: U, item: T, index: number) => U, initial: U): U
```

Right-to-left accumulation over all elements. Full-array reactive read — tracks all per-index signals and the length signal.

---

### Iterator methods

All return a [`DerivedArray<U>`](./derived-array.md) — a read-only per-index reactive view.

#### `.map(fn, opts?)`

```ts
list.map<U>(
  fn: (item: T, i: number) => U,
  opts?: { key?: (item: T) => unknown },
): DerivedArray<U>
```

Returns a new `DerivedArray<U>` where each element is transformed by `fn`. 1:1 index correspondence is maintained — no key function needed by default. Pass `opts.key` to inject a key function for the renderer when mapping directly off a List.

```ts
const doubled = items.map(x => x * 2)  // DerivedArray<number>

const rows = tasks.map(task => <TaskItem task={task} />, { key: t => t.id })
```

#### `.filter(fn, opts?)`

```ts
list.filter(
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
list.sort(
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
list.dispose(): void
list[Symbol.dispose](): void
```

Dispose the List and all internal reactive nodes. `List` implements `Symbol.dispose` so it works with TC39 explicit-resource-management `using` blocks.

**No-op on sub-Lists** returned by `store.at()` — only root Lists (created via `Store.create(T[])` or `List.create()`) own the holder.

---

### Key function and dev warnings

`filter` and `sort` break index correspondence — without identity tracking, a mutation that reorders elements would fire every per-position subscriber. The `key` option enables surgical invalidation:

```ts
type IteratorOptions<T> = { key?: (item: T) => unknown }
```

**Default key:** `item => item` (reference equality). Works for primitive arrays. For object arrays, this breaks under the immutable-update model (every `patch` produces new references). **Always provide a `key` for object arrays.**

**Dev-mode warnings fire when:**
- No key is provided and items are objects (warning emitted once per `DerivedArray` instance)
- Two items produce the same key (duplicate keys → ambiguous identity)

---

## See also

- [`Store<T>`](./store.md) — reactive container for structured objects; returns `List<E>` from `.at()` for array paths
- [`DerivedArray<T>`](./derived-array.md) — read-only per-index reactive view returned by `map` / `filter` / `sort`
- [`Option<T>`](./option.md) — present/absent container; returned by destructive reads (`pop`, `shift`) and query methods (`find`, `findIndex`)
- [`batch`](./context.md#batch) — coalesce multiple List mutations into a single notification pass
