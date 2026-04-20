<div align="center">
    <h1>Aljabr</h1>
    <img src="logo-sm.png" alt="Description">
</div>

> _Al-jabr_ (الجبر) — the Arabic word that gave us "algebra." Bringing structure to chaos is, as it turns out, an ancient art.

**aljabr** is a TypeScript library for defining tagged union types (algebraic sum types) and consuming them with exhaustive pattern matching. Define your variants once, get type-safe constructors, mix in shared behavior, and match over every case without ceremony.

---

## Features

- **Tagged variant factories** — define a sum type once, get a typed constructor per variant
- **Non-enumerable symbol tags** — the discriminant lives on the prototype: invisible to `JSON.stringify`, `Object.keys`, and casual object inspection
- **Impl class mixins** — attach shared properties and methods to all variants via ordinary classes
- **Trait constraints** — declare what payload fields an impl class requires; the type system enforces it per variant
- **Exhaustive `match()`** — compile-time coverage checking with two modes: exact (all variants required) and fallback (`[__]` catch-all)
- **`when()` arms** — structural patterns, guard functions, `pred()` wrappers, and catch-alls, composable in any order
- **Deep structural matching** — `when()` patterns recurse into plain object sub-patterns; recursion stops at Aljabr variant boundaries
- **`is` pattern namespace** — type wildcards (`is.string`, `is.number`, `is.nullish`, `is.array`, …), union membership (`is.variant`), and combinators (`is.not`, `is.union`) for expressive field-level matching; union factories pass directly to `is.union(Result, Option)` to match variants of either union
- **`is.not.*` namespace** — BDD-style negation: `is.not.string`, `is.not.number`, `is.not.array`, etc. as pre-computed values; `is.not.union(...)` and `is.not.variant(factory)` as parameterized mirrors
- **`select()` extraction** — bind matched fields to named slots injected as the handler's second argument; each slot is typed precisely from the variant's field type, narrowed by any inner pattern constraint (`is.not`, `is.number`, …)
- **Union identity & membership** — every factory carries a unique symbol; `variantOf(factory, value?)` checks membership at runtime (curried form composes with `pred()`); `is.variant(factory)` uses it as a `when()` field pattern
- **First-match-wins** — multiple `when()` arms per variant, evaluated left to right
- **Helpful runtime errors** — non-exhaustive matches throw with messages that tell you exactly what to fix
- **Generic variant types** — `Variant<Tag, Payload, Impl>` helper + `.typed()` builder preserve type parameters through factory definitions
- **Zero dependencies** — pure TypeScript, no runtime footprint

---

## Motivation

TypeScript discriminated unions are powerful, but verbose. You write the type, the discriminant field, the type guards — and then `switch` statements the compiler can only partially verify:

```ts
// Doing it by hand
type Shape =
    | { kind: "circle"; radius: number }
    | { kind: "rect"; w: number; h: number };

function area(s: Shape): number {
    switch (s.kind) {
        case "circle":
            return Math.PI * s.radius ** 2;
        case "rect":
            return s.w * s.h;
        // Forgot "triangle"? TypeScript won't always catch it.
    }
}
```

aljabr eliminates the ceremony and tightens the guarantees:

```ts
import { union, match, Union } from "aljabr";

const Shape = union({
    Circle: (radius: number) => ({ radius }),
    Rect: (w: number, h: number) => ({ w, h }),
});
type Shape = Union<typeof Shape>;

const area = (s: Shape): number =>
    match(s, {
        Circle: ({ radius }) => Math.PI * radius ** 2,
        Rect: ({ w, h }) => w * h,
        // Miss a variant? Compile error. Every time.
    });
```

### Why not `ts-pattern`?

[`ts-pattern`](https://github.com/gvergnaud/ts-pattern) is excellent and more feature-rich. aljabr is smaller, tag-first, and opinionated: your variants carry their own identity via a symbol discriminant, so `match()` dispatches by tag — not by structural inference over arbitrary objects. The tradeoffs:

|                          | aljabr                                | ts-pattern                       |
| ------------------------ | ------------------------------------- | -------------------------------- |
| Dispatch mechanism       | Symbol tag on prototype               | Structural inference             |
| Serialization safety     | Tag invisible to JSON                 | Discriminant field is enumerable |
| Shared variant behavior  | Impl class mixins + Trait constraints | Not in scope                     |
| Pattern matching breadth | Variant-scoped arms                   | Full structural, deep matching   |
| Bundle size              | Tiny                                  | Small                            |

aljabr is for cases where you're defining the union yourself and want the full stack — factory, mixin, match — in one coherent API.

---

## Installation

```sh
npm install aljabr
# pnpm add aljabr
# yarn add aljabr
```

---

## Quick Start

### 1. Define a union

```ts
import { union, Union } from "aljabr";

const Result = union({
    Ok: (value: number) => ({ value }),
    Err: (message: string) => ({ message }),
});
type Result = Union<typeof Result>;

const ok = Result.Ok(42); // { value: 42 }
const err = Result.Err("oops"); // { message: "oops" }
```

Variant instances are plain objects with a non-enumerable symbol tag on the prototype — safe to spread, serialize, or log without surprise.

### 2. Match over it

```ts
import { match } from "aljabr";

function display(r: Result): string {
    return match(r, {
        Ok: ({ value }) => `Value: ${value}`,
        Err: ({ message }) => `Error: ${message}`,
    });
}
```

Miss a variant? Compile error. Add a variant and forget to handle it? Compile error.

### 3. Add shared behavior with impl classes

Impl classes let you mix properties and methods into every variant without inheritance:

```ts
import { union, Trait, Union, getTag } from "aljabr";

abstract class Auditable extends Trait<{ id: string }> {
    createdAt = Date.now();
    describe() {
        return `[${getTag(this as any)}] id=${(this as any).id}`;
    }
}

const Event = union([Auditable])({
    Created: (id: string) => ({ id }),
    Deleted: (id: string) => ({ id }),
});
type Event = Union<typeof Event>;

const e = Event.Created("abc-123");
e.createdAt; // number
e.describe(); // "[Created] id=abc-123"
```

`Trait<{ id: string }>` tells the type system that every variant factory must return an object with an `id: string`. If one doesn't, you get a compile error on that specific variant.

### 4. Pattern arms with `when()`

For variants that need sub-matching — conditional handling based on field values, predicates, runtime guards, or extracted sub-values:

```ts
import { union, match, when, pred, is, select, __, Union } from "aljabr";

const Key = union({
    Press: (key: string, shift: boolean) => ({ key, shift }),
});
type Key = Union<typeof Key>;

const handle = (k: Key): string =>
    match(k, {
        Press: [
            when({ key: "Enter" }, () => "submit"),
            when({ key: is.union("Tab", "Escape") }, () => "navigation"),
            when({ key: pred((k) => k.startsWith("F")) }, () => "function key"),
            when(
                { key: select("k") },
                (_, { k }) => `shifted: ${k}`,
                (v) => v.shift,
            ),
            when(__, () => "character"),
        ],
    });
```

Pattern field values can be literals (strict equality), [`pred()`](docs/api/union.md#pred) wrappers, [`is.*`](docs/api/union.md#is) type wildcards and combinators, or [`select()`](docs/api/union.md#select) extraction bindings. Arms are evaluated left to right; the first match wins.

---

## Prelude

aljabr ships a second entry point — `aljabr/prelude` — containing a standard library of algebraic data types and reactive primitives, all built on the same `union` + `match` foundation.

```ts
import {
    Result,
    Option,
    Validation,
    Signal,
    Derived,
    watchEffect,
} from "aljabr/prelude";
```

### Functional containers

```ts
// Result — synchronous success, async pending, or failure. Directly awaitable.
const user = await Result.Accept(42).then((id) => fetchUser(id));

// Option — null-safe chaining
const city = Option.Some(user)
    .flatMap((u) => (u.address ? Option.Some(u.address) : Option.None()))
    .map((a) => a.city.toUpperCase())
    .getOrElse("UNKNOWN");

// Validation — three states: Unvalidated (initial), Valid, Invalid
// Errors accumulate across all fields rather than short-circuiting.
const form = validateName(input.name)
    .combine(validateAge(input.age))
    .combine(validateEmail(input.email));

match(form, {
    Unvalidated: () => showPlaceholder(),
    Valid: ({ value: [[name, age], email] }) => submit({ name, age, email }),
    Invalid: ({ errors }) => errors.forEach(showError),
});
```

### Reactive primitives

A fine-grained reactive system with explicit, pattern-matchable lifecycle states:

```ts
const x = Signal.create(1)
const y = Signal.create(2)
const sum = Derived.create(() => (x.get() ?? 0) + (y.get() ?? 0))

batch(() => { x.set(10); y.set(20) })
sum.get() // 30 — re-evaluated once, not twice

// Async derived — preserves stale value while reloading
const userId  = Signal.create(1)
const profile = AsyncDerived.create(async () => fetchProfile(userId.get()!))

match(profile.state, {
    Loading:   () => <Spinner />,
    Ready:     ({ value }) => <Profile user={value} />,
    Reloading: ({ value }) => <Profile user={value} stale />,
    // ...
})
```

`Ref<T>` extends this system to **structured objects and arrays**, with per-path subscriptions:

```ts
import { Ref } from "aljabr/prelude";

const state = Ref.create({
    user: { name: "Alice", age: 30 },
    scores: [1, 2, 3],
});

// Subscribe to exactly one leaf — "user.age" changes don't re-run this
const greeting = Derived.create(() => `Hello, ${state.get("user.name")}`);

state.patch("user", { name: "Bob", age: 30 }); // only name subscribers notified
state.push("scores", 4); // first-class array mutation

// Bind an external Signal to a path — live, synchronous, two-way
const formField = Signal.create("Carol");
state.bind("user.name", formField);
formField.set("Dave");
state.get("user.name"); // "Dave"
```

### Reactive effects and persistence

```ts
// watchEffect — run an async thunk, re-run it when dependencies change
// The thunk receives an AbortSignal aborted before each new attempt
const handle = watchEffect(
    async (signal) => api.search(query.get()!, { signal }),
    (result) => updateResults(result),
    {
        eager: true,
        schedule: Schedule.Exponential({ initialDelay: 100, maxDelay: 30_000 }),
        maxRetries: 5,
    },
);
handle.stop();

// persistedSignal — survive page reloads
const theme = persistedSignal<"light" | "dark">("light", { key: "app.theme" });
theme.set("dark"); // written to localStorage; restored on next load
```

**[Full Prelude documentation →](docs/api/prelude/index.md)**

---

## API Reference

### Core

- [`union()`](docs/api/union.md) — define a sum type and get variant constructors
- [`Trait<R>`](docs/api/union.md#traitr) — declare required payload properties on impl classes
- [`pred()`](docs/api/union.md#pred) — wrap a predicate for use in `when()` patterns
- [`is`](docs/api/union.md#is) — type wildcards (`is.string`, `is.number`, …) and combinators (`is.not`, `is.union`)
- [`select()`](docs/api/union.md#select) — mark a pattern field for extraction into the handler's second argument
- [`when()`](docs/api/union.md#when) — construct a pattern match arm
- [`getTag()`](docs/api/union.md#gettag) — read the variant name from an instance
- [`match()`](docs/api/match.md) — exhaustive pattern matching engine
- [Type utilities](docs/api/union.md#types) — `Union<T>`, `FactoryPayload<T>`, `Variant<Tag, Payload, Impl>`

### Prelude (`aljabr/prelude`)

- [Prelude overview](docs/api/prelude/index.md) — all modules at a glance
- [`Result<T, E>`](docs/api/prelude/result.md) — synchronous/async success or failure
- [`Option<T>`](docs/api/prelude/option.md) — present or absent value
- [`Validation<T, E>`](docs/api/prelude/validation.md) — error-accumulating validation
- [`Signal<T, S>`](docs/api/prelude/signal.md) — reactive mutable container; accepts a custom state union `S` + `SignalProtocol<S, T>` for domain-specific lifecycles
- [`Ref<T>`](docs/api/prelude/ref.md) — reactive container for structured objects and arrays; per-path subscriptions, live signal bindings, array mutation methods
- [`Derived<T>` / `AsyncDerived<T, E>`](docs/api/prelude/derived.md) — lazy computed reactive values
- [`Effect<T, E>` / `watchEffect`](docs/api/prelude/effect.md) — reactive async effects with `Failed` lifecycle state
- [`Schedule` / `ScheduleError` / `AsyncOptions`](docs/api/prelude/schedule.md) — declarative retry policies, timeouts, and observability hooks
- [`Tree<T>`](docs/api/prelude/tree.md) — recursive binary tree
- [Persistence](docs/api/prelude/persist.md) — `persistedSignal`, `syncToStore`
- [Reactive context](docs/api/prelude/context.md) — `batch`, `runInContext`, `createOwner`

## Guides

- [Getting Started](docs/guides/getting-started.md) — walkthrough from first union to real-world patterns
- [Advanced Patterns](docs/guides/advanced-patterns.md) — impl classes, Trait constraints, complex `when()` compositions
- [Resilient Async](docs/guides/resilient-async.md) — retry, exponential backoff, timeouts, and `AbortSignal` cancellation

---

## Roadmap (v0.3.0)

The next major release expands aljabr across seven progressive phases, each building on the tag-first, zero-dependency foundation:

| Phase                                                   | Focus                                                                                                                                                                                                                           |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1 — Deep Structural Matching** ✓                      | `select` bindings for nested extraction, wildcards, combinators (`is.not`, `is.union`), deep recursive sub-patterns                                                                                                             |
| **1.5 — Type Inference for `select` and Combinators** ✓ | Precise `selections` typing: each `select("name")` infers from the variant's field type; `is.not(is.nullish)` narrows to `Exclude<T, null \| undefined>`; `is.union("a","b")` narrows to `"a" \| "b"`                           |
| **1.6 — Union Identity & `is.not.*` Namespace** ✓       | Per-factory identity symbol brands every variant prototype; `variantOf`, `is.variant`, `is.union(Factory)` and `is.not(Factory)` for cross-union membership matching; full `is.not.*` namespace for BDD-style pattern authoring |
| **2 — Data Boundary (`aljabr/schema`)** ✓               | Decode untyped external data (API payloads, form inputs) into typed variants; bidirectional encode/decode roundtrips                                                                                                            |
| **3 — Resilient Async Lifecycles** ✓                    | Declarative `Schedule` policies (exponential backoff, jitter) and native timeout/race primitives for `AsyncDerived` and `watchEffect`                                                                                           |
| **4 — Resource Scoping & DI**                           | `Scope` finalizers for safe teardown of WebSockets, timers, and file handles; type-safe context injection via Tags and Layers                                                                                                   |
| **5 — Error & Defect Tracking**                         | Formal separation of expected domain errors from unexpected runtime panics; a `Cause` structure to capture sequential, parallel, and interrupted failures                                                                       |
| **6 — Solid-Inspired Factory API**                      | `createSignal`, `createMemo`, `createEffect`, and `createRoot` wrappers that preserve raw-value ergonomics while surfacing Aljabr's state machine via a `.state()` accessor                                                     |
| **7 — Ecosystem Bindings**                              | `@aljabr/react` hooks via `useSyncExternalStore`; `@aljabr/hookform-resolver` for schema-backed form validation; intentionally no bundled UI matching components                                                                |

For the full design rationale and API sketches, see [docs/roadmap/v0.3.0.md](docs/roadmap/v0.3.0.md).
