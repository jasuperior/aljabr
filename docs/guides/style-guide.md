# Aljabr Style Guide

This document defines the conventions every public API in aljabr follows. It is descriptive of where the library is going (post-v0.3.10 migration) and prescriptive for any new abstraction added beyond it. When in doubt, follow the rules here over precedent in older code; older code that conflicts will be migrated.

The guide is organized around four buckets. Every public abstraction belongs to exactly one. The bucket dictates its construction shape, read API, write API, disposal semantics, and operator coverage.

---

## The four buckets

| Bucket | Description | Members |
|---|---|---|
| **1. Reactive containers** | Hold a value, notify on change, can be disposed | `Signal`, `Derived` / `WritableDerived`, `AsyncDerived`, `Store`, `List`, `Dispatcher` |
| **2. Algebraic data types** | Closed unions with operations; values, no lifecycle | `Result`, `Option`, `Validation`, `Tree`, `Fault`, `Schedule`, `Effect`, `CommandError`, `DecodeError`; `Schema` (DSL exception) |
| **3. Resource / lifetime primitives** | Own external lifetime, async-disposal-aware | `Scope`, `Resource` |
| **4. Top-level coordinators** | Operations that bridge categories | `watch`, `match`, `decode`, `encode`, `batch`, `untrack`, `runInContext`, `defer`, `acquire` |

Each bucket has one construction idiom, one disposal idiom, one read idiom. New abstractions pick a bucket first; the rest follows.

---

## Construction

### Bucket 1 — `X.create(...)` static

Every reactive container is constructed via a `static create()` method. No exceptions.

```ts
const count   = Signal.create(0)
const total   = Derived.create(() => a.get() + b.get())
const writable = Derived.writable({ get, set })
const profile = AsyncDerived.create(async (signal) => fetchUser(id, signal))
const state   = Store.create({ user: { name: "Ada" } })
const items   = List.create([1, 2, 3])
const counter = Dispatcher.create(0, protocol)
```

**Rules:**
- One factory per concrete type; no overloads that change the return type.
- `Derived` and `WritableDerived` are distinct types with distinct factories. `Derived.writable(...)` returns `WritableDerived<T> extends Derived<T>`. A variable typed `Derived<T>` accepts either; only `WritableDerived<T>` exposes `.set()`.
- `List` is the only path to a root reactive array. `Store.create([...])` does not exist.
- Persistence variants live as further statics on the same class: `Signal.persisted(initial, opts)` returns a `Signal<T>`. The instance method `signal.persist(opts)` returns a `WatchHandle` for in-place mirroring.

### Bucket 2 — variant factories

ADTs are constructed via the variant factories produced by `union(...)`.

```ts
Result.Accept(value)
Option.Some(value)
Validation.Valid(value)
Tree.Leaf(value)
Effect.Idle(thunk)
Schedule.Exponential({ initialDelay: 100, maxDelay: 30_000 })
Fault.Fail(error)
CommandError.Rejected(reason)
```

**The Schema exception:** `Schema` is presented as a lowercase builder DSL (`Schema.string()`, `Schema.array(...)`, `Schema.object({...})`) because schemas compose in dense expressions where capitalized variant names would be noise. The internal `_Schema` union is hidden; users see the DSL. **This is the only case where an ADT departs from variant-factory naming, and the carve-out is deliberate.** Do not generalize.

### Bucket 3 — `X.create(...)` static

Resource and lifetime primitives use the same `.create()` idiom as bucket 1.

```ts
const scope    = Scope.create({ catchDefect: handler })
const resource = Resource.create(acquire, release)
```

The `signals/` submodule re-exports lowercase free-function aliases (`scope(...)`, `resource(...)`) for users who prefer the function-call style. The canonical form is the static.

### Bucket 4 — lowercase free functions

Coordinators are plain functions with single-word names where possible.

```ts
watch(thunk, onChange, options?)
match(value, matchers)
decode(schema, input)
encode(schema, value)
batch(fn)
untrack(fn)
defer(fn)
acquire(resource)
```

`runInContext` is the documented exception. Coordinator names that describe a precise async-boundary operation may exceed the one-word rule when no shorter name conveys the operation honestly.

---

## Read API (bucket 1)

Every reactive container exposes the same read vocabulary:

| Method | Returns | Tracked? | Notes |
|---|---|---|---|
| `get()` | extracted `T \| null` (lifecycle) or `T \| undefined` (positional) | yes | registers dependency in active reactive context |
| `getOr(default)` | `T` (non-nullable) | yes | tracked read with default |
| `peek()` | extracted, same nullability as `get()` | no | safe outside reactive contexts |
| `state()` | full state union | yes | only for lifecycle-bearing containers |
| `peekState()` | full state union | no | only for lifecycle-bearing containers |

**Path/index variants** — `Store` and `List` accept a path or index in `get`/`getOr`/`peek`:

```ts
store.get("user.name")               // PathValue<T, "user.name"> | undefined
store.getOr("user.name", "anon")     // PathValue<T, "user.name">
list.get(0)                          // T | undefined
list.getOr(0, defaultItem)           // T
```

**Lifecycle exposure:**
- Containers with a non-trivial state union (`Signal`, `Derived`, `AsyncDerived`, `Dispatcher`) expose `state()` / `peekState()`.
- Containers whose lifecycle is just "set/unset" (`Store`, `List`) expose an `isUnset` boolean getter instead. Do not invent a single-state union just to fit the pattern.

**Async reads:**
- `AsyncDerived.get()` is **synchronous** and returns the last-known extracted value (`T | null`). Tracked.
- `AsyncDerived.run(): Promise<Done<T, E> | Failed<T, E>>` triggers evaluation and resolves with the settled state — same shape as `Effect.run()`.
- `AsyncDerived.runOr(default): Promise<T>` for the simpler "give me the value or the default" case — same shape as `Effect.runOr(default)`.

**Nullability rule:** `null` for lifecycle absence (Unset, Disposed, Loading); `undefined` for positional/path absence (out-of-bounds index, missing object path). The split is intentional.

---

## Write API (bucket 1)

**Structural writes return `void`.** Read-then-mutate is the caller's responsibility — call `peek()` first if you need the prior value.

```ts
signal.set(value)                   // void
derived.set(value)                  // void  (only on WritableDerived<T>)
store.set("user.name", "Ada")       // void
store.patch("user", { name: "Ada" })// void
list.push(item)                     // void
list.set(i, value)                  // void   ← was Option<T>; no longer
list.splice(start, count, ...items) // void
list.move(from, to)                 // void
```

**Destructive reads return the removed value as `Option<T>`.**

```ts
list.pop()    // Option<T>
list.shift()  // Option<T>
```

**Transactional writes return `Validation<...>`.** This is the codified exception for dispatchers:

```ts
dispatcher.dispatch(command)  // Validation<ApplyResult<S, Cmd>, CommandError>
```

The rationale: dispatching is fundamentally validated, may be rejected, and the caller needs the structured error path. All other structural writes are unconditional (the type system guards them) so `void` is honest.

---

## Subscription

Every reactive container exposes `subscribe(callback): () => void` for push-based observation.

```ts
signal.subscribe(value => log(value))
derived.subscribe(value => sync(value))
store.subscribe(snapshot => mirror(snapshot))
list.subscribe(items => render(items))
dispatcher.subscribe(value => track(value))
```

**Callback shape mirrors the container's `get()` return:**

| Container | callback receives |
|---|---|
| `Signal<T>` | `T \| null` |
| `Derived<T>` | `T \| null` |
| `AsyncDerived<T>` | `T \| null` |
| `Store<T>` | `T \| undefined` (whole snapshot) |
| `List<T>` | `T[]` (whole array) |
| `Dispatcher<T, S, Cmd>` | `T \| null` |

**Granular subscription** — subscribe to a path or index by going through `at()`:

```ts
store.at("user.name").subscribe(...)
list.at(0).subscribe(...)
```

`at()` returns a `Store`, `List`, or `Derived` — all of which have `subscribe`. One mechanism, composable.

**When to use `subscribe` vs `watch`:**
- `watch` is the default for declarative reactive coordination inside the reactive graph.
- `subscribe` is the escape hatch for bridging to external systems (RxJS, Redux, Zustand, custom telemetry, devtools, time-travel) and for imperative side effects that don't belong in the reactive graph.

---

## Disposal

Two contracts, one rule per bucket.

**Sync containers** (Signal, Derived, AsyncDerived, Store, List, Dispatcher, WatchHandle):

```ts
sig.dispose(): void
```

Each implements `Symbol.dispose` for TC39 explicit resource management:

```ts
using sig = Signal.create(0)
// disposed automatically at block exit
```

**Async lifetime owners** (Scope):

```ts
await scope.dispose(): Promise<Defect[]>
```

Returns the flat list of defects from any finalizer that threw. Empty array means clean disposal. Implements `Symbol.asyncDispose`:

```ts
await using scope = Scope.create()
// disposed automatically at block exit; defects warned
```

**Style-guide rule:** in-process synchronous disposal returns `void`; resource/lifetime owners return `Promise<Defect[]>`. Never pretend a sync disposal is async to match Scope, and never lose the defect list from Scope to match Signal.

---

## Operator coverage (bucket 2)

ADTs come in three flavors:

1. **Computational-flow ADTs** carry trait methods.
2. **Inert (descriptor) ADTs** carry no methods. Consumers use `match` to discriminate.
3. **Schema** is the documented DSL exception (no traits; everything is functions on the namespace).

**Inert ADTs:** `Fault`, `Schedule`, `CommandError`, `DecodeError`. They describe data — there is nothing meaningful to `map` over.

### Canonical traits

These are the reusable trait classes that ADTs mix in via `union([...]).typed({...})`. Each defines one responsibility.

| Trait | Methods | Used by |
|---|---|---|
| `Mappable<T>` | `map<U>(fn): Self<U>` | every monadic ADT |
| `Bindable<T> extends Mappable<T>` | `flatMap<U>(fn: T → Self<U>): Self<U>` | every monadic ADT with sequencing |
| `Reducible<T>` | `getOr(default: T): T` | every ADT that can collapse to its success value |
| `Foldable<T>` | `fold<U>(fn, initial): U` | structures with non-monadic traversal |
| `Combinable<T, E>` | `combine(other): Self<...>` | types that accumulate (Validation) |
| `Thenable<T, E>` | `then`, `catch` | types that interop with `await` (Result) |
| `Computable<T, E>` | `run`, `recover` | types that represent runnable computation (Effect) |

### Trait composition per type

| Type | Traits |
|---|---|
| `Option<T>` | Bindable, Reducible |
| `Result<T, E>` | Bindable, Reducible, Thenable |
| `Validation<T, E>` | Bindable, Reducible, Combinable |
| `Effect<T, E>` | Bindable, Computable |
| `Tree<T>` | Mappable, Foldable |

### The `getOr` verb

Every type that can collapse to a success value uses `getOr(default)`. Single verb, single meaning across the library.

```ts
option.getOr(0)
result.getOr(fallback)
validation.getOr(empty)
signal.getOr(0)
derived.getOr(fallback)
store.getOr("path", default)
list.getOr(i, default)
```

(`Option.getOr` is renamed to `Option.getOr` as part of v0.3.10.)

### Static aggregators

`Promise.all`-shaped helpers are surfaced on the namespace, not the instance:

```ts
Option.all([opt1, opt2])              // fail-fast: None if any None
Result.all([res1, res2])              // fail-fast: Reject on first
Validation.all([val1, val2])          // accumulates errors across Invalids
Effect.all([eff1, eff2])              // parallel-fail-fast (mirrors Promise.all)
Effect.allSettled([eff1, eff2])       // parallel-collect, returns all settlements
```

`allSettled` is provided only where parallelism and async make collect-vs-fail-fast a live distinction.

---

## Async coordinators

- `watch` is the canonical async-reactive runner. Its `onChange` callback receives `Effect` variants (`Done | Stale | Failed`) so consumers pattern-match with the same vocabulary used elsewhere in the library.
- `signal.persist(opts)` returns a `WatchHandle` (with `.dispose()`) — same shape as `watch`. Avoids inventing a third "thing you stop later" idiom.
- `AsyncDerived.run()` and `Effect.run()` share their return shape (`Promise<Done | Failed>`). `runOr(default)` is provided on both.
- `runInContext(owner, fn)` keeps its long name. Coordinator names describing precise async-boundary operations are exempt from the one-word rule.

---

## Naming conventions

- **Single-word type names** for every primary abstraction. Two-word names are reserved for type relationships expressed in the type system (`WritableDerived extends Derived`).
- **`Variant<"Tag", payload, Trait>`** is the cast pattern for typed factories.
- **`Union<typeof X>`** extracts the TypeScript union type from a factory object.
- **Lifecycle absence → `null`. Positional/path absence → `undefined`.** Codified at the type level.

---

## Adding a new abstraction — the checklist

1. Pick a bucket. If it doesn't fit any of the four, the bucket model is wrong before the abstraction is.
2. **Construction:** match the bucket's idiom exactly.
3. **Disposal:** sync `void` for in-process containers, async `Promise<Defect[]>` for resource owners. Symbol-dispose where applicable.
4. **Read API (bucket 1):** if there is meaningful state, expose `state()` / `peekState()`. Always expose `get()` / `getOr()` / `peek()` / `subscribe()`.
5. **Write API (bucket 1):** structural writes return `void`. Destructive reads return `Option<T>`. Transactional writes return `Validation<..., ...>` and only if validation is genuinely the type's job.
6. **Operators (bucket 2):** if the type is computational, mix in `Bindable` and `Reducible` minimum. If it's a descriptor, mix in nothing.
7. **Naming:** single-word type, single-word free function where possible.
