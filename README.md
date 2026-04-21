<div align="center">
    <h1>Aljabr</h1>
    <img src="assets/logo-flat-sm.png" alt="Description">
</div>

> _Al-jabr_ (الجبر) — the Arabic word that gave us "algebra." Bringing structure to chaos is, as it turns out, an ancient art.

**aljabr** is a TypeScript library built around one idea: that algebraic data types shouldn't live in isolation. Define your tagged unions once, then compose them — through pattern matching, schema validation, reactive state, and resource lifetimes — using the same model throughout.

It started as a pattern-matching utility. It grew into a small, coherent standard library: the union-centric toolkit for TypeScript, without a runtime, fibers, or a DI container.

---

## What's in the box

aljabr ships four independent entry points. Use what you need; ignore what you don't.

| Entry point      | What it gives you                                                                                                         |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `aljabr`         | Tagged union factories, exhaustive `match()`, `when()` arms, structural patterns, `is.*` wildcards, `select()` extraction |
| `aljabr/prelude` | Result, Option, Validation, Signal, Derived, Ref, Scope, Resource, watchEffect, persistence                               |
| `aljabr/schema`  | Type-safe decode/encode pipeline for external data; errors surface as a `Validation`                                      |
| `aljabr/signals` | Convenience layer over the reactive primitives (`signal()`, `memo()`, `effect()`, `scope()`, `query()`)                   |

---

## Features

**Core (tagged unions + pattern matching)**

- **Variant factories** — define a sum type once, get a typed constructor per variant
- **Non-enumerable symbol tags** — the discriminant lives on the prototype: invisible to `JSON.stringify`, `Object.keys`, and casual object inspection
- **Exhaustive `match()`** — compile-time coverage checking; two modes: exact (all variants required) and fallback (`[__]` catch-all)
- **`when()` arms** — structural patterns, guard functions, `pred()` wrappers, and catch-alls, composable in any order
- **Deep structural matching** — patterns recurse into plain object sub-fields; recursion stops at variant boundaries
- **`is.*` pattern namespace** — type wildcards (`is.string`, `is.number`, `is.nullish`, …), membership tests (`is.variant`, `is.union`), and BDD-style negations (`is.not.string`, `is.not.array`, …)
- **`select()` extraction** — bind matched fields to named slots injected as the handler's second argument; each slot is typed precisely from the variant field, narrowed by any inner pattern constraint
- **Impl class mixins** — attach shared properties and methods to all variants via ordinary classes
- **Trait constraints** — declare what payload fields an impl class requires; the type system enforces it per variant
- **Union identity & membership** — `variantOf(factory, value?)` checks membership at runtime; curried form composes with `pred()`
- **Generic variant types** — `Variant<Tag, Payload, Impl>` helper + `.typed()` builder preserve type parameters

**Prelude (functional containers + reactive system)**

- **Result** — sync success, async pending, or failure; directly awaitable via Promise chaining
- **Option** — null-safe chaining with `map`, `flatMap`, `getOrElse`
- **Validation** — three states (Unvalidated, Valid, Invalid); errors accumulate across all fields rather than short-circuiting
- **Signal** — reactive mutable container; accepts a custom state union for domain-specific lifecycles
- **Derived / AsyncDerived** — lazy computed values; async variant with Loading, Reloading, Ready, Failed, and Disposed states
- **Ref** — reactive container for structured objects and arrays; per-path subscriptions, two-way signal bindings, first-class array mutations (`push`, `pop`, `splice`, `move`)
- **Scope / Resource** — structured resource lifetime with LIFO cleanup guarantees; `Resource(acquire, release)` bracket pattern; `defer()` / `acquire()` for implicit scope stacks; `Symbol.asyncDispose` support
- **watchEffect** — reactive async side effects with configurable retry policies (`Schedule.Fixed`, `.Linear`, `.Exponential`, `.Custom`), timeouts, `AbortSignal` cancellation, and `afterRetry` hooks
- **Fault** — classify async failures into Fail (retryable domain error), Defect (unexpected panic), and Interrupted (abort)
- **Persistence** — `persistedSignal()` survives page reloads; pluggable `PersistAdapter` for custom storage backends
- **Reactive context** — `batch()`, `untrack()`, `createOwner()`, owner-tree context threading
- **Tree** — recursive binary tree with `map`, `fold`, and traversal

**Schema (decode / encode)**

- **Schema builders** — `Schema.string()`, `.number()`, `.boolean()`, `.literal()`, `.optional()`, `.nullable()`, `.array()`, `.object()`, `.union()`, `.variant()`, `.transform()`
- **Object modes** — `strip` (default, drop unknown fields), `strict` (reject unknown), `passthrough` (preserve unknown)
- **Variant decoding** — discriminant field remapping for external formats (`type: "ok"` → `Result.Accept`)
- **Deep error paths** — every `DecodeError` carries `path: (string | number)[]`; errors accumulate like `Validation`
- **Custom codecs** — `defineDecoder<I, O>()` and `defineCodec<I, O>()` for bespoke decode/encode pipelines
- **`decode()` / `encode()` / `roundtrip()`** — returns a `Validation<T, DecodeError>`

**Zero dependencies — pure TypeScript, no runtime footprint.**

---

## Motivation

### What aljabr is for

TypeScript discriminated unions are powerful but verbose. You define the type, the discriminant field, the type guards — and then `switch` statements the compiler can only partially verify. aljabr eliminates the ceremony and tightens the guarantees:

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
        // Miss a variant? Compile error. Add a variant? Compile error on every callsite.
    });
```

But the core match engine is only the starting point. The rest of aljabr — prelude types, schema, reactive primitives — is designed so that the same union model extends naturally to error handling, reactive state, and external data. You're not buying a pattern-matching utility and then reaching for four other libraries. The composition stays in-model.

### What aljabr is not

**It's not a replacement for [Effect-ts](https://effect.website/).** Effect is a full runtime with fibers, a service layer, structured concurrency, and a mature ecosystem. If you want that and are willing to invest in the framework, Effect is excellent. aljabr is for the case where you want the algebraic data types and you want them to compose, but you're not buying into a framework to get there.

**It's not competing with [ts-pattern](https://github.com/gvergnaud/ts-pattern).** ts-pattern is a great library for structural pattern matching over arbitrary objects. aljabr's dispatch mechanism is different — it's tag-first, nominal rather than structural, which gives you clean serialization and shared variant behavior. If you need exhaustive matching over third-party types or deeply structural patterns over data you didn't define, ts-pattern is likely the better fit. aljabr is for the case where you're defining the union yourself and want the whole stack — factory, mixin, match, schema, reactive state — in one coherent model.

**[Awaitly](https://github.com/jagreehal/awaitly) is doing something related but shifted.** It's focused on typed async workflow orchestration — step composition, automatic error union inference, retry policies — using a Result/Either pattern. Good thinking in a similar space. The difference is orientation: Awaitly is workflow-first (async steps as the primary primitive); aljabr is ADT-first (tagged unions as the substrate, async and reactive as things that compose through that model). The author also wrote a [thoughtful post](https://arrangeactassert.com/posts/algebraic-thinking-without-the-ceremony/) on the trade-offs of bringing algebraic thinking to TypeScript without ceremony — worth a read if this space interests you.

---

## Installation

```sh
npm install aljabr
# pnpm add aljabr
# yarn add aljabr
```

---

## Quick Start

### 1. Define a union and match over it

```ts
import { union, match, Union } from "aljabr";

const Result = union({
    Ok: (value: number) => ({ value }),
    Err: (message: string) => ({ message }),
});
type Result = Union<typeof Result>;

const ok = Result.Ok(42); // { value: 42 }
const err = Result.Err("oops"); // { message: "oops" }

function display(r: Result): string {
    return match(r, {
        Ok: ({ value }) => `Value: ${value}`,
        Err: ({ message }) => `Error: ${message}`,
    });
}
```

Variant instances are plain objects with a non-enumerable symbol tag on the prototype — safe to spread, serialize, or log without surprise.

### 2. Add shared behavior with impl classes

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

### 3. Pattern arms with `when()`

For variants that need sub-matching — field values, predicates, runtime guards, or extracted sub-values:

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
                (_, { k }) => `key: ${k}`,
                (v) => v.shift,
            ),
            when(__, () => "character"),
        ],
    });
```

### 4. Decode and validate external data

```ts
import { Schema, decode } from "aljabr/schema";
import { match } from "aljabr";

const UserSchema = Schema.object({
    id: Schema.number(),
    name: Schema.string(),
    email: Schema.optional(Schema.string()),
});

const result = decode(UserSchema, JSON.parse(rawResponse));

match(result, {
    Valid: ({ value }) => console.log("User:", value.name),
    Invalid: ({ errors }) => errors.forEach((e) => console.error(e)),
    Unvalidated: () => {},
});
```

### 5. Reactive state and resource lifetimes

```ts
import { Signal, Derived, Scope, Resource, watchEffect } from "aljabr/prelude";
import { match } from "aljabr";

const userId = Signal.create(1);
const profile = AsyncDerived.create(async () => fetchProfile(userId.get()!));

// Stale-while-reloading: renders old value while refetching
match(profile.state, {
    Loading: () => showSpinner(),
    Ready: ({ value }) => render(value),
    Reloading: ({ value }) => render(value, { stale: true }),
    Failed: ({ error }) => showError(error),
    // ...
});

// Structured cleanup — finalizers always run, LIFO order
const scope = Scope();
const conn = await scope.acquire(
    Resource(
        () => openConnection(userId.get()!),
        (c) => c.close(),
    ),
);
// ... use conn ...
await scope.dispose(); // conn.close() called automatically
```

---

## Prelude

The `aljabr/prelude` entry point contains the full standard library.

### Functional containers

```ts
import { Result, Option, Validation } from "aljabr/prelude";

// Result — sync success, async pending, or failure; directly awaitable
const user = await Result.Accept(42).then((id) => fetchUser(id));

// Option — null-safe chaining
const city = Option.Some(user)
    .flatMap((u) => (u.address ? Option.Some(u.address) : Option.None()))
    .map((a) => a.city.toUpperCase())
    .getOrElse("UNKNOWN");

// Validation — errors accumulate; never short-circuits
const form = validateName(input.name)
    .combine(validateAge(input.age))
    .combine(validateEmail(input.email));

match(form, {
    Unvalidated: () => showPlaceholder(),
    Valid: ({ value: [name, age, email] }) => submit({ name, age, email }),
    Invalid: ({ errors }) => errors.forEach(showError),
});
```

### Reactive primitives

```ts
import { Signal, Derived, Ref, batch } from "aljabr/prelude";

const x = Signal.create(1);
const y = Signal.create(2);
const sum = Derived.create(() => (x.get() ?? 0) + (y.get() ?? 0));

batch(() => {
    x.set(10);
    y.set(20);
});
sum.get(); // 30 — re-evaluated once, not twice
```

`Ref<T>` extends the reactive system to **structured objects and arrays** with per-path subscriptions:

```ts
import { Ref } from "aljabr/prelude";

const state = Ref.create({
    user: { name: "Alice", age: 30 },
    scores: [1, 2, 3],
});

const greeting = Derived.create(() => `Hello, ${state.get("user.name")}`);

state.patch("user", { name: "Bob", age: 30 }); // only "user.name" subscribers notified
state.push("scores", 4); // first-class array mutation

// Two-way signal binding
const formField = Signal.create("Carol");
state.bind("user.name", formField);
formField.set("Dave");
state.get("user.name"); // "Dave"
```

### Async effects and retry

```ts
import { watchEffect, Schedule } from "aljabr/prelude";

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
```

### Persistence

```ts
import { persistedSignal } from "aljabr/prelude";

const theme = persistedSignal<"light" | "dark">("light", { key: "app.theme" });
theme.set("dark"); // written to localStorage; restored on next load
```

---

## Signals convenience layer

`aljabr/signals` wraps the reactive prelude into a lighter, SolidJS-style API:

```ts
import { signal, memo, effect, scope, query } from "aljabr/signals";

const [count, setCount] = signal(0);
const doubled = memo(() => count() * 2);
const stop = effect(() => console.log(doubled()));

const [data, { refetch }] = query(() => fetchUser(count()));
```

---

## API Reference

### Core

- [`union()`](docs/api/union.md) — define a sum type and get variant constructors
- [`match()`](docs/api/match.md) — exhaustive pattern matching engine
- [`Trait<R>`](docs/api/union.md#traitr) — declare required payload properties on impl classes
- [`pred()`](docs/api/union.md#pred) — wrap a predicate for use in `when()` patterns
- [`is`](docs/api/union.md#is) — type wildcards and combinators
- [`select()`](docs/api/union.md#select) — mark a pattern field for extraction
- [`when()`](docs/api/union.md#when) — construct a pattern match arm
- [`getTag()`](docs/api/union.md#gettag) — read the variant name from an instance
- [Type utilities](docs/api/union.md#types) — `Union<T>`, `FactoryPayload<T>`, `Variant<Tag, Payload, Impl>`

### Schema (`aljabr/schema`)

- [`Schema.*`](docs/api/schema.md) — schema builders (string, number, object, variant, transform, …)
- [`decode()` / `encode()` / `roundtrip()`](docs/api/schema.md) — decode/encode pipeline
- [`DecodeError`](docs/api/schema.md) — TypeMismatch, MissingField, InvalidLiteral, UnrecognizedVariant, Custom

### Signals (`aljabr/signals`)

- [`signal()` / `memo()` / `effect()` / `scope()` / `query()`](docs/api/signals.md) — convenience reactive API

### Prelude (`aljabr/prelude`)

- [Prelude overview](docs/api/prelude/index.md) — all modules at a glance
- [`Result<T, E>`](docs/api/prelude/result.md)
- [`Option<T>`](docs/api/prelude/option.md)
- [`Validation<T, E>`](docs/api/prelude/validation.md)
- [`Signal<T, S>`](docs/api/prelude/signal.md) — reactive mutable container; custom state protocols
- [`Derived<T>` / `AsyncDerived<T, E>`](docs/api/prelude/derived.md) — lazy computed reactive values
- [`Ref<T>`](docs/api/prelude/ref.md) — structured reactive objects and arrays
- [`Scope` / `Resource`](docs/api/prelude/scope.md) — structured resource lifetimes
- [`Effect<T, E>` / `watchEffect`](docs/api/prelude/effect.md) — reactive async effects
- [`Fault<E>`](docs/api/prelude/fault.md) — classify async failures
- [`Schedule` / `AsyncOptions`](docs/api/prelude/schedule.md) — retry policies and timeouts
- [`Tree<T>`](docs/api/prelude/tree.md) — recursive binary tree
- [Persistence](docs/api/prelude/persist.md) — `persistedSignal`, `syncToStore`
- [Reactive context](docs/api/prelude/context.md) — `batch`, `untrack`, `createOwner`

---

## Guides

- [Getting Started](docs/guides/getting-started.md) — first union through real-world patterns
- [Union Patterns](docs/guides/union-patterns.md) — `is.*`, `select()`, destructuring, guards
- [Schema](docs/guides/schema.md) — decoding external data, error paths, object modes, variant mapping
- [Resilient Async](docs/guides/resilient-async.md) — retry, backoff, timeouts, `AbortSignal`
- [Advanced Patterns](docs/guides/advanced/index.md)
    - [Union Branching](docs/guides/advanced/union-branching.md) — Result chaining, Option as null discipline
    - [Signal Protocols](docs/guides/advanced/signal-protocols.md) — domain-specific signal state machines
    - [Reactive UI](docs/guides/advanced/reactive-ui.md) — Ref + Derived + AsyncDerived composition
    - [Resource Lifetime](docs/guides/advanced/resource-lifetime.md) — Scope boundaries, bracket patterns
    - [Parser Construction](docs/guides/advanced/parser-construction.md) — token/AST unions, recursive match
