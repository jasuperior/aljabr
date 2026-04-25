# ReactiveArray\<T\>

A read-only, per-index reactive view of an array. Returned by the iterator methods (`map`, `filter`, `sort`) on [`RefArray<T>`](./ref.md#refarrayt) and `ReactiveArray<T>` itself.

Each index is backed by a dedicated `Signal<T | undefined>`. When the underlying source changes, only the positions whose values actually changed (by reference, or by key for `filter`/`sort`) notify their subscribers. `length()` is a dedicated signal that fires only when the output size changes.

Iterator methods are chainable — each call returns a new `ReactiveArray`.

## Import

```ts
import { ReactiveArray, IteratorOptions } from "@aljabr/core";
// or from the prelude directly:
import { ReactiveArray } from "@aljabr/core/prelude";
```

`ReactiveArray` is not constructed directly. Obtain one via iterator methods on [`RefArray<T>`](./ref.md#refarrayt):

```ts
import { Ref } from "@aljabr/core";

const nums = Ref.create([1, 2, 3, 4, 5]); // RefArray<number>

const evens   = nums.filter(x => x % 2 === 0);   // ReactiveArray<number>
const doubled = nums.map(x => x * 2);             // ReactiveArray<number>
const sorted  = nums.sort((a, b) => a - b);       // ReactiveArray<number>
```

## Reading Elements

### `get(i: number): T | undefined`

Reads the item at index `i` and registers it as a reactive dependency in the active tracking context. Returns `undefined` for out-of-bounds indices and after disposal.

```ts
const evens = Ref.create([1, 2, 3, 4, 5]).filter(x => x % 2 === 0);

evens.get(0); // 2
evens.get(1); // 4
evens.get(2); // undefined
```

Fine-grained: only the subscriber that called `get(i)` is notified when index `i` changes.

### `at(i: number): Derived<T | undefined>`

Returns a stable [`Derived<T | undefined>`](./derived.md) handle for index `i`. Useful when you need to pass a reactive reference to a single element downstream.

```ts
const items = Ref.create([10, 20, 30]).map(x => x);
const first = items.at(0); // Derived<number | undefined>

first.get(); // 10
```

The returned `Derived` remains valid until it or its owning `ReactiveArray` is disposed.

### `length(): number`

Returns the current output length and registers it as a dependency. Notified only when the output size changes — not on element-only mutations.

```ts
const evens = Ref.create([1, 2, 3]).filter(x => x % 2 === 0);

evens.length(); // 1

// Effect: reacts to length changes
createEffect(() => {
    console.log("count:", evens.length());
});
```

## Iterator Methods

All iterator methods are chainable and return a new `ReactiveArray`.

### `map<U>(fn: (item: T, i: number) => U): ReactiveArray<U>`

Transforms each element 1:1. No key function is required because output indices correspond directly to input indices.

| Parameter | Description |
|---|---|
| `fn` | Transform function. Receives the item and its index. |

```ts
const nums   = Ref.create([1, 2, 3, 4, 5]);
const labels = nums.map((x, i) => `${i}: ${x}`);

labels.get(0); // "0: 1"
labels.get(4); // "4: 5"
```

### `filter(fn: (item: T, i: number) => boolean, opts?: IteratorOptions<T>): ReactiveArray<T>`

Keeps only items for which `fn` returns `true`. The output preserves source order.

| Parameter | Description |
|---|---|
| `fn` | Predicate function. Receives the item and its source index. |
| `opts.key` | Key function for surgical per-index invalidation (see [`IteratorOptions`](#iteratoroptionst)). |

```ts
const nums  = Ref.create([1, 2, 3, 4, 5]);
const evens = nums.filter(x => x % 2 === 0);

evens.length(); // 2
evens.get(0);   // 2
evens.get(1);   // 4
```

**Object arrays — always provide a key:**

```ts
const items = Ref.create([
    { id: 1, name: "Alice" },
    { id: 2, name: "Bob" },
    { id: 3, name: "Carol" },
]);

const selected = items.filter(
    item => item.id !== 2,
    { key: item => item.id },
);
```

Without a `key`, a dev-mode warning is emitted when items are objects, because reference equality is unreliable under `Ref`'s immutable-update model.

### `sort(comparator: (a: T, b: T) => number, opts?: IteratorOptions<T>): ReactiveArray<T>`

Returns a sorted view of the array using `comparator`. The source array is not mutated.

| Parameter | Description |
|---|---|
| `comparator` | Standard `Array.prototype.sort` comparator. |
| `opts.key` | Key function for surgical per-index invalidation (see [`IteratorOptions`](#iteratoroptionst)). |

```ts
const nums   = Ref.create([3, 1, 4, 1, 5]);
const sorted = nums.sort((a, b) => a - b);

sorted.get(0); // 1
sorted.get(4); // 5
```

**Sorting objects:**

```ts
const people = Ref.create([
    { id: 3, name: "Charlie" },
    { id: 1, name: "Alice" },
    { id: 2, name: "Bob" },
]);

const byId = people.sort(
    (a, b) => a.id - b.id,
    { key: item => item.id },
);

byId.get(0); // { id: 1, name: "Alice" }
```

## Chaining

Iterator methods can be composed arbitrarily:

```ts
const nums = Ref.create([1, 2, 3, 4, 5]);

const result = nums
    .filter(x => x > 1)        // [2, 3, 4, 5]
    .sort((a, b) => b - a)     // [5, 4, 3, 2]  (descending)
    .map(x => x * 10);         // [50, 40, 30, 20]

result.length(); // 4
result.get(0);   // 50
```

All mutations to `nums` propagate through the entire chain automatically and surgically.

## Disposal

### `dispose(): void`

Disposes this `ReactiveArray` and all internal reactive nodes. After disposal:

- `get()` returns `undefined`
- Updates are no longer applied
- No subscribers are notified

```ts
const doubled = Ref.create([1, 2, 3]).map(x => x * 2);

doubled.get(0); // 2
doubled.dispose();
doubled.get(0); // undefined
```

Disposing a `ReactiveArray` does not dispose the source `RefArray` or `ReactiveArray` it was created from.

## IteratorOptions\<T\>

```ts
type IteratorOptions<T> = {
    key?: (item: T) => unknown;
};
```

Passed as the second argument to `filter` and `sort` (on both `RefArray` and `ReactiveArray`).

### `key?: (item: T) => unknown`

A function that extracts a stable identity key from an item. Used for surgical per-index invalidation:

- **Without `key`**: falls back to reference equality (`item => item`). Correct for primitives; unreliable for objects under `Ref`'s immutable-update model.
- **With `key`**: only output positions whose key changed are notified, regardless of reference identity.

```ts
// Primitives — no key needed
nums.filter(x => x > 0);

// Objects — always provide a key
items.filter(
    item => item.active,
    { key: item => item.id },
);
```

**Dev-mode warnings are emitted when:**
- No `key` is provided and items are objects
- Two items produce the same key (duplicate identity)

Warnings are emitted at most once per `ReactiveArray` instance.

## Reactivity Model

### Per-index signals

Each index `i` is backed by a lazy `Signal<T | undefined>` created on first access via `get(i)`. Subscribers reading `get(i)` are only notified when the value at position `i` changes — not when other positions change.

### Length signal

`length()` is backed by a separate `Signal<number>` that fires only when the output size changes. Element-only mutations (e.g. replacing a value in-place) do not notify length subscribers.

### Snapshot-before-notify invariant

Before any signal notifications are dispatched, the internal `#items` snapshot is updated to the new state. This ensures that chained `ReactiveArray` instances (e.g. a `sort` downstream of a `filter`) always read current data when their `dirty()` callback fires synchronously.

## See Also

- [`RefArray<T>`](./ref.md#refarrayt) — mutable root reactive array; source of `ReactiveArray` instances
- [`Ref<T>`](./ref.md) — reactive object state; use `Ref.create(T[])` to get a `RefArray<T>`
- [`Derived<T>`](./derived.md) — reactive computed value; returned by `at(i)`
- [`Signal<T>`](./signal.md) — low-level reactive primitive underlying per-index tracking
