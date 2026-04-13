# Ref<T> — Mutable Reference State

## Summary

A reactive mutable container for objects and arrays. `Ref<T>` decomposes a structured value into
per-leaf `Signal` nodes internally, enabling fine-grained path-level subscriptions. Consumers
subscribe to exactly the paths they access — changes to unread paths do not re-run their
computations.

Exports from `src/prelude/ref.ts`, re-exported from `src/prelude/index.ts`.

---

## Phase 1 — Core `Ref<T>`

### Path type machinery

File: `src/prelude/ref.ts`

```ts
// Dot-separated string paths into T, including array indices (e.g. "users.0.name")
type Path<T> = ...

// The value type at a given path
type PathValue<T, P extends Path<T>> = ...
```

- Dot notation only — no bracket syntax. Array indices are dots: `"users.0.name"`
- Path depth limit is a TypeScript recursion concern, not a runtime one. Real-world paths are
  shallow. Do not prematurely optimize the type machinery for depth.

### `Ref<T>` class

```ts
class Ref<T extends object> {
    static create<T extends object>(initial: T): Ref<T>;

    // Tracked read — registers exactly `path` as a dependency in the current Computation.
    // One call = one subscription. Does NOT subscribe to intermediate paths.
    get<P extends Path<T>>(path: P): PathValue<T, P>;

    // Replace the subtree at `path` with `value`.
    // Notifies ALL leaf Signal subscribers under `path` — no diffing.
    // Equality guard: if ref-equal to current value, no notification is emitted.
    set<P extends Path<T>>(path: P, value: PathValue<T, P>): void;

    // Deep structural diff of old vs new value at `path`.
    // Only notifies leaf Signals whose values actually changed.
    // Equality guard applied at each node before recursing (Strategy C).
    patch<P extends Path<T>>(path: P, value: PathValue<T, P>): void;

    // Dispose all internal leaf Signals and remove from owner tree.
    dispose(): void;
}
```

### Internal model

- `Ref<T>` owns a flat `Map<string, Signal<unknown>>` of leaf signals, keyed by full dot path.
- Leaf Signal entries are created lazily on first `.get(path)` or `.set(path, value)` access.
- `Ref.create(initial)` registers disposal with the current owner (same as `Signal.create()`).
- `batch()` works automatically — leaf Signals are standard Signals, batching is inherited.

### `set` vs `patch` semantics

| Method               | Diffing                                      | Use when                                               |
| -------------------- | -------------------------------------------- | ------------------------------------------------------ |
| `set(path, value)`   | None — notifies all leaves under path        | You know exactly what changed, or value is a primitive |
| `patch(path, value)` | Deep structural diff with ref-equality guard | Value is a complex object and only some fields changed |

Both methods perform a top-level `===` equality guard before doing any work. If the new value is
reference-equal to the current value, no notification is emitted.

---

## Phase 2 — `.at()`, `Unset`, and array methods

### `.at(path)` — stable reactive handles

```ts
// Returns Ref<V> for object paths (sub-tree view, writes forward to root leaf Signals)
// Returns Signal<V> for leaf paths (standard reactive Signal)
at<P extends Path<T>>(path: P): PathValue<T, P> extends object ? Ref<PathValue<T, P>> : Signal<PathValue<T, P>>
```

- A sub-`Ref<V>` returned by `.at("user")` is a scoped view — its `.set()` and `.patch()` forward
  writes to the root's leaf Signals. It does not own its own Signal map.
- A `Signal<V>` returned by `.at("user.name")` is the underlying leaf Signal directly.
- Stable: repeated calls to `.at(path)` return the same handle (cached by path).

### `Unset` state

- `Ref.create()` (no argument) produces a `Ref` in `Unset` state.
- `ref.get(path)` on an `Unset` Ref returns `undefined` (or typed as `PathValue<T, P> | undefined`).
- `ref.set(path, value)` on an `Unset` Ref transitions it to active and initializes the leaf.
- Consider adding `ref.isUnset(): boolean` guard.

### Array mutation methods

First-class methods that notify only the affected leaf Signals — no full-array diff needed.

```ts
push<P extends ArrayPath<T>>(path: P, ...items: ArrayItem<T, P>[]): void
pop<P extends ArrayPath<T>>(path: P): ArrayItem<T, P> | undefined
splice<P extends ArrayPath<T>>(path: P, start: number, deleteCount: number, ...items: ArrayItem<T, P>[]): void
move<P extends ArrayPath<T>>(path: P, from: number, to: number): void
```

- `push` notifies only the new index Signal and the `length` pseudo-Signal.
- `splice` reindexes affected Signals (shift subscribers for indices >= start).
- `move` is a swap — notifies only the two affected index Signals.
- Index reuse and keyed diffing strategy TBD — design carefully to avoid stale subscribers at
  reused indices.

---

## Phase 2 or 3 — `remove` / `delete`

Scope TBD.

Removing a property from an object-type Ref (or an element from an array by key rather
than splice) requires:

- Disposing the leaf Signal at that path
- Notifying any subscribers that the path no longer exists
- Deciding what `.get(path)` returns after deletion (`undefined` vs `Unset` vs throws)
- TypeScript: making the path optional in the type after deletion (likely requires a type parameter
  mutation or separate `PartialRef<T>` variant)

The user would like to enable `Ref`'s to accept `Signal` values as properties. Setting a property to a `Signal` or `Ref` type requires:

- Deciding what happens when `.set(path, Signal<T>)` is called. does the signal delegate its values to the slot?
- Deciding what happens when a `Signal` value is removed and replaced.
    - Signal will have to be cleaned up somehow when detached
- Deciding what happens when `.at(path)` if a `Signal` has been set? Should the source `Signal` be returned, or a new one?

Defer until the scope is clear. Do not add to phase 1 or 2 without a full design pass.

---

## Deferred

| Feature                           | Notes                                                       |
| --------------------------------- | ----------------------------------------------------------- |
| `Unset` state                     | Phase 2 — requires careful typing of get() return           |
| `.at(path)`                       | Phase 2 — depends on stable handle caching strategy         |
| Array methods                     | Phase 2 — index reuse + keyed diffing needs separate design |
| `remove`/`delete`                 | Phase 2 or 3 — PartialRef typing is non-trivial             |
| `.set(path, Signal<T>)`           | Phase 2 or 3 — requires further clarification of scope.     |
| `Ref<T>` from `Ref<U>` projection | Not yet discussed — map/transform a Ref into another shape  |
