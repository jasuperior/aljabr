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

## Phase 3 — `delete(path)`

Single method for removing a property from an object or an element from an array by index
(as opposed to `splice`, which is position-based).

```ts
delete<P extends Path<T>>(path: P): void
```

### Semantics

- Cascades to all descendant signals — each receives `undefined` and notifies its subscribers.
- `get(path)` returns `undefined` after deletion. No distinction between "never set" and "deleted"
  at the type level — `Path<T>` reflects the static shape of `T`, not runtime state.
- Cached `.at()` sub-Ref handles remain alive and transition to `isUnset = true`. They are not
  disposed; re-setting the path later reactivates the same handle.
- Leaf signals at deleted paths are kept alive (not disposed) so existing handles stay valid.
- `PartialRef<T>` / making the path optional in the type after deletion is deferred — the
  `| undefined` return on `get()` is sufficient.

### `.maybeAt(path)` — deletion-aware handle

```ts
maybeAt<P extends Path<T>>(path: P): Derived<Option<PathValue<T, P>>>
```

Opt-in method for callers that need to observe presence/absence of a path. Returns
`Derived<Option<V>>` — `Some(value)` when the path exists, `None` when deleted or unset.
`.at(path)` is unchanged and deletion-unaware.

---

## Phase 3 — Signal bindings

### `Signal.subscribe(callback)`

A new method on `Signal<T>` that registers a synchronous callback fired on every value change.
Returns an unsubscribe function. Required to implement live bindings in `Ref` without an async
`watchEffect` bridge.

```ts
subscribe(callback: (value: T | null) => void): () => void
```

### `.bind(path, signal)` — live binding

```ts
bind<P extends Path<T>>(path: P, signal: Signal<PathValue<T, P>>): void
```

Establishes a live binding from `signal` to the Ref path. When `signal` changes, the Ref path
is updated synchronously via `Signal.subscribe`.

- Re-binding a path silently replaces the existing subscription.
- When the source signal is disposed, the path receives `undefined` and the binding is torn down.
- Calling `set(path, value)` on a bound path implicitly unbinds before writing — plain writes
  always win.

### `.unbind(path)` — explicit release

```ts
unbind<P extends Path<T>>(path: P): void
```

Releases the binding at `path` without writing a value. The path retains its last known value.

### `.boundAt(path)` — escape hatch

```ts
boundAt<P extends Path<T>>(path: P): Signal<PathValue<T, P>> | null
```

Returns the raw bound `Signal` at `path`, or `null` if no binding exists. Use this when you
need to access the full custom state `S` of a `Signal<T, S>` — `.at()` and `.maybeAt()` only
expose the extracted `T` value.

### Handle interaction summary

| Method           | Binding-aware | Returns                          | Use when                                    |
| ---------------- | ------------- | -------------------------------- | ------------------------------------------- |
| `.at(path)`      | No            | `Ref<V>` or `Derived<V>`         | Standard reactive handle                    |
| `.maybeAt(path)` | No            | `Derived<Option<V>>`             | Need to observe deletion / unset            |
| `.boundAt(path)` | Yes           | `Signal<V> \| null`              | Need full `S` state of a custom-lifecycle signal |

---

## Deferred

| Feature                           | Notes                                                            |
| --------------------------------- | ---------------------------------------------------------------- |
| `PartialRef<T>`                   | Deferred — `| undefined` on `get()` is sufficient for now        |
| `Ref<T>` from `Ref<U>` projection | Not yet discussed — map/transform a Ref into another shape       |
