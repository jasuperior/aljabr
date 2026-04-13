# Prelude

```ts
import { ... } from "aljabr/prelude"
```

---

## Overview

The prelude is aljabr's standard library — a set of production-ready algebraic data types and reactive primitives, all built on the same `union` + `match` foundation exposed by the core package. Every type in the prelude is a tagged union: you create values with factory constructors and consume them with exhaustive `match()`.

The prelude is published at the separate entry point `aljabr/prelude` to keep the core zero-dependency surface minimal.

---

## Modules

### Functional containers

Types for modeling values that may be absent, failed, or require validation.

| Export | Description |
|---|---|
| [`Result<T, E>`](./result.md) | Synchronous success (`Accept`), async pending (`Expect`), or failure (`Reject`). Implements `.then()` — directly awaitable. |
| [`Option<T>`](./option.md) | Present (`Some`) or absent (`None`). Chainable via `.map()`, `.flatMap()`, `.getOrElse()`. |
| [`Validation<T, E>`](./validation.md) | Three states: unvalidated (`Unvalidated`), valid (`Valid`), or invalid with accumulated errors (`Invalid`). Combine independent checks without short-circuiting. |

### Reactive primitives

A fine-grained push/pull reactive system with explicit lifecycle states.

| Export | Description |
|---|---|
| [`Signal<T, S>`](./signal.md) | A mutable reactive container. Default lifecycle is `SignalState<T>`; pass a `SignalProtocol<S, T>` to use any custom union as the state. Reads inside computations auto-subscribe; writes notify dependents. |
| [`Derived<T>`](./derived.md) | A lazy computed value. Re-evaluates only when read after a dependency changes. Supports a writable form. |
| [`AsyncDerived<T, E>`](./derived.md#asyncderivedT-E) | Like `Derived`, but async. Preserves the last known value in `Reloading` state for stale-while-revalidating. |

### Effects

Tools for running async computations inside the reactive graph.

| Export | Description |
|---|---|
| [`Effect<T, E>`](./effect.md) | A composable async computation union: `Idle`, `Running`, `Done`, `Stale`. Supports `.map()`, `.flatMap()`, `.recover()`. |
| [`watchEffect`](./effect.md#watcheffect) | Run an async thunk reactively. Tracks signal reads automatically; calls a callback on dependency changes. |

### Data structures

| Export | Description |
|---|---|
| [`Tree<T>`](./tree.md) | A recursive binary tree: `Leaf` and `Branch`. Supports `.map()`, `.fold()`, `.depth()`. |

### Persistence

| Export | Description |
|---|---|
| [`persistedSignal`](./persist.md#persistedsignal) | Create a `Signal<T>` that rehydrates from and syncs to an external store (localStorage by default). |
| [`syncToStore`](./persist.md#synctostore) | Mirror an existing signal to a store; returns a stop function. |
| [`localStorageAdapter`](./persist.md#built-in-adapters) | Built-in adapter backed by `localStorage`. |
| [`sessionStorageAdapter`](./persist.md#built-in-adapters) | Built-in adapter backed by `sessionStorage`. |

### Reactive context

Low-level utilities for controlling notification scheduling and reactive ownership.

| Export | Description |
|---|---|
| [`batch`](./context.md#batch) | Coalesce multiple signal writes into a single notification pass. |
| [`createOwner`](./context.md#createowner) | Create a scoped owner node; disposing it tears down all owned signals and deriveds. |
| [`runInContext`](./context.md#runincontext) | Restore a reactive owner across async boundaries (`await`, `setTimeout`, workers). |

---

## Quick examples

### Result — async-aware error handling

```ts
import { Result } from "aljabr/prelude"

const r = Result.Accept(42)
    .then(n => n * 2)      // Result<number>
    .then(n => n.toString()) // Result<string>

const s = await r // "84"
```

### Option — null-safe chaining

```ts
import { Option } from "aljabr/prelude"

const city = Option.Some(user)
    .flatMap(u => u.address ? Option.Some(u.address) : Option.None())
    .map(a => a.city.toUpperCase())
    .getOrElse("UNKNOWN")
```

### Validation — accumulate all errors

```ts
import { Validation } from "aljabr/prelude"

const result = validateName(input.name)
    .combine(validateAge(input.age))
    .combine(validateEmail(input.email))

match(result, {
    Unvalidated: () => showPlaceholder(),
    Valid:        ({ value: [[name, age], email] }) => createUser({ name, age, email }),
    Invalid:      ({ errors }) => errors.forEach(showError),
})
```

### Signal + Derived — reactive state

```ts
import { Signal, Derived, batch } from "aljabr/prelude"

const x = Signal.create(1)
const y = Signal.create(2)
const sum = Derived.create(() => (x.get() ?? 0) + (y.get() ?? 0))

batch(() => { x.set(10); y.set(20) })
sum.get() // 30
```

### watchEffect — reactive async side effects

```ts
import { watchEffect } from "aljabr/prelude"

const userId = Signal.create(1)

const handle = watchEffect(
    async () => {
        const id = userId.get()!
        return fetch(`/api/users/${id}`).then(r => r.json())
    },
    (result) => updateUI(result),
    { eager: true },
)

userId.set(2)    // re-fetches and calls updateUI automatically
handle.stop()    // stop tracking
```

### persistedSignal — survive page reloads

```ts
import { persistedSignal } from "aljabr/prelude"

const theme = persistedSignal<"light" | "dark">("light", { key: "app.theme" })
theme.set("dark") // written to localStorage; restored on next load
```

---

## Design notes

**Everything is a union.** `Result`, `Option`, `Validation`, `Signal` lifecycle states, `Derived` lifecycle states, `AsyncDerived` lifecycle states, and `Effect` are all tagged unions. You consume them with `match()`, get exhaustiveness checking at compile time, and add variants without ceremony.

**Reactive ownership is explicit.** Signals and deriveds created inside a reactive computation are automatically owned by it. When the owner is disposed, all owned resources clean up recursively. Use `createOwner` and `runInContext` when you need fine-grained control.

**Pull-based derivation.** `Derived` and `AsyncDerived` are lazy: they re-evaluate only when read after a dependency changes. This avoids unnecessary computation and lets you keep stale values visible (`Stale`, `Reloading`) while fresh data loads.

---

## See also

- [Getting Started](../../guides/getting-started.md) — core `union` / `match` walkthrough
- [Advanced Patterns](../../guides/advanced-patterns.md) — generic unions, `Trait` constraints
- [Core API: union](../union.md)
- [Core API: match](../match.md)
