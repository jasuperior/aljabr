# Changelog

All notable changes to aljabr are documented here. This project uses a rolling changelog — each entry covers one version. The most recent release is at the top.

---

## v0.3.5 — RefArray Hardening & DerivedArray Rename

_Patch release following v0.3.4. Motivated by first-party application code (a todo app built against the published package) that exposed type-system gaps and a missing method surface on `RefArray`._

### Breaking Changes

**`ReactiveArray<T>` renamed to `DerivedArray<T>`**

The `ReactiveArray` export no longer exists. Replace every import and type annotation with `DerivedArray` — a mechanical find-and-replace. The runtime behavior is identical.

```diff
- import { ReactiveArray } from "aljabr/prelude"
+ import { DerivedArray } from "aljabr/prelude"
```

**`RefArray.pop()` return type changed from `T | undefined` to `Option<T>`**

```diff
- const last: number | undefined = items.pop()
+ const last: Option<number> = items.pop()
+ // unwrap: items.pop().getOrElse(fallback)
```

**`Ref.pop(path)` return type changed from `ArrayItem<T, P> | undefined` to `Option<ArrayItem<T, P>>`**

Same pattern as `RefArray.pop()`. Both changes align destructive reads with the library's error-handling philosophy: absence is semantically meaningful and callers should handle it explicitly.

---

### New — `Ref.create<T[]>` type coercion fix

`Ref.create<Task[]>([])` now correctly returns `RefArray<Task>` instead of the erroneous `RefArray<Task[]>`. A new overload is prepended to the chain:

```ts
static create<T extends unknown[]>(initial: T): RefArray<T[number]>
```

TypeScript picks this overload first when an explicit array type parameter is supplied, resolving the element type via `T[number]`. The existing inferred-argument overload (`Ref.create([...tasks])`) is unaffected.

---

### New — `RefArray` methods

#### Mutations

| Method | Returns | Notes |
|---|---|---|
| `set(index, value)` | `Option<T>` | Replace in-place; fires only the per-index signal. `Some(oldValue)` on success, `None` if out of bounds. Does not extend the array. |
| `shift()` | `Option<T>` | Remove and return the first element. |
| `unshift(...items)` | `void` | Prepend one or more items. |

#### Precise-tracking reads

Stop at the first match; only visited indices are tracked as dependencies.

| Method | Returns |
|---|---|
| `find(predicate)` | `Option<T>` |
| `findIndex(predicate)` | `Option<number>` |
| `findLastIndex(predicate)` | `Option<number>` |
| `includes(value)` | `boolean` |

#### Full-array reactive reads

Track all per-index signals and the length signal; re-evaluate on any element or size change.

| Method | Returns |
|---|---|
| `join(separator?)` | `string` |
| `reduce(fn, initial)` | `U` |
| `reduceRight(fn, initial)` | `U` |

---

### New — whole-value `get()` and `peek()` overloads

All three array/object containers gain a no-argument `get()` overload that returns the entire underlying value as a reactive read, and a `peek()` method that mirrors it untracked.

| Call | Tracking | Returns |
|---|---|---|
| `RefArray.get()` | Coarse — root signal, fires on any mutation | `T[]` |
| `RefArray.get(i)` | Fine — per-index signal (unchanged) | `T \| undefined` |
| `RefArray.peek()` | None | `T[]` |
| `RefArray.peek(i)` | None | `T \| undefined` |
| `DerivedArray.get()` | Coarse — dedicated `#rootSignal`, fires on every re-computation | `T[]` |
| `DerivedArray.get(i)` | Fine — per-index signal (unchanged) | `T \| undefined` |
| `DerivedArray.peek()` | None | `T[]` |
| `DerivedArray.peek(i)` | None | `T \| undefined` |
| `Ref.get()` | Coarse — root path signal, fires on any write | `T \| undefined` |
| `Ref.get(path)` | Fine — per-path signal (unchanged) | `PathValue<T, P> \| undefined` |
| `Ref.peek()` | None | `T \| undefined` |
| `Ref.peek(path)` | None | `PathValue<T, P> \| undefined` |

The no-arg `get()` is deliberately coarse — use it when you need the full value. For fine-grained subscriptions, supply an index or path, or use iterator methods (`filter`, `find`, `reduce`, etc.).

---

### Intentionally unchanged

`RefArray.get(i)`, `DerivedArray.get(i)`, and `Ref.get(path)` remain `T | undefined` / `PathValue<T, P> | undefined`. Wrapping high-frequency reactive read primitives in `Option` would add ceremony at every internal callsite and break the common authoring pattern (`tasks.get(0)?.name`). See the v0.3.5 roadmap for the full rationale.

---

## v0.3.4

See [`docs/roadmap/v0.3.4.md`](./v0.3.4.md).

## v0.3.3

See [`docs/roadmap/v0.3.3.md`](./v0.3.3.md).

## v0.3.2

See [`docs/roadmap/v0.3.2.md`](./v0.3.2.md).

## v0.3.0

See [`docs/roadmap/v0.3.0.md`](./v0.3.0.md).
