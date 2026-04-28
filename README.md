<div align="center">
    <h1>Aljabr</h1>
    <img src="assets/logo-flat-sm.png" alt="Description">
</div>

> _Al-jabr_ (الجبر) — the Arabic word that gave us "algebra." Bringing structure to chaos is, as it turns out, an ancient art.

**aljabr** is a TypeScript library built around one idea: that algebraic data types shouldn't live in isolation. Define your tagged unions once, then compose them — through pattern matching, schema validation, reactive state, and reactive UI — using the same model throughout.

It started as a pattern-matching utility. It grew into a small, coherent standard library: the union-centric toolkit for TypeScript, without a runtime, fibers, or a DI container. Zero dependencies.

---

## What's in the box

aljabr ships independent entry points. Use what you need; ignore what you don't.

| Entry point        | What it gives you                                                                                            |
| ------------------ | ------------------------------------------------------------------------------------------------------------ |
| `aljabr`           | Tagged unions, exhaustive `match()`, structural patterns, `is.*` wildcards, `select()` extraction            |
| `aljabr/prelude`   | Result, Option, Validation, Signal, Derived, Ref, RefArray, DerivedArray, Scope, Resource, watchEffect       |
| `aljabr/schema`    | Type-safe decode/encode pipeline for external data; errors surface as a `Validation`                         |
| `aljabr/signals`   | SolidJS-style convenience layer over the reactive primitives                                                 |
| `aljabr/ui`        | Reactive UI layer — JSX, function components, pluggable renderer host                                        |
| `aljabr/ui/dom`    | DOM rendering target (`domHost`) for browser apps                                                            |

See the [API Reference](#api-reference) below for the full per-module surface, and the [Guides](#guides) for narrative docs.

---

## A taste

A small reactive shape editor — touches unions, exhaustive matching, reactive state, and the UI layer in one go:

```tsx
/** @jsxImportSource aljabr/ui */
import { union, match, type Union } from "aljabr";
import { Ref, Derived } from "aljabr/prelude";
import { createRenderer } from "aljabr/ui";
import { domHost } from "aljabr/ui/dom";

const Shape = union({
    Circle: (id: number, radius: number) => ({ id, radius }),
    Rect:   (id: number, w: number, h: number) => ({ id, w, h }),
});
type Shape = Union<typeof Shape>;

const area = (s: Shape) => match(s, {
    Circle: ({ radius }) => Math.PI * radius ** 2,
    Rect:   ({ w, h })   => w * h,
});

const shapes = Ref.create<Shape[]>([Shape.Circle(1, 5), Shape.Rect(2, 3, 4)]);
const total  = Derived.create(() => shapes.reduce((sum, s) => sum + area(s), 0));

const rows = shapes.map(
    s => <li>{area(s).toFixed(2)}</li>,
    { key: s => s.id },
);

const { mount } = createRenderer(domHost);
mount(() =>
    <div>
        <ul>{rows}</ul>
        <p>Total: {() => total.get()?.toFixed(2)}</p>
        <button onClick={() => shapes.push(Shape.Circle(Date.now(), 10))}>
            Add Circle
        </button>
    </div>,
    document.body,
);
```

`Shape` is the substrate. `match` checks exhaustively. `Ref.create<Shape[]>([...])` returns a `RefArray` — a reactive list with per-index subscriptions. `.map(fn, { key })` produces a keyed `DerivedArray`, so the renderer reconciles by `id` instead of position. `Derived.create(...)` recomputes the total only when the list changes. The `() => total.get()?.toFixed(2)` child is a reactive region: only that one text node updates when `total` changes.

---

## Try the demo

A small todo app lives at [`public/`](public/) — unions, `Ref`, `RefArray`, the iterator chain, and the DOM renderer wired together end-to-end. It runs against the local source build, so it's also the fastest way to poke at the library while hacking on it.

```sh
git clone https://github.com/jasuperior/aljabr.git
cd aljabr
npm install
npm run dev
```

Then open the URL Vite prints (typically `http://localhost:5173`).

---

## Motivation

TypeScript discriminated unions are powerful but verbose. You define the type, the discriminant field, the type guards — and then `switch` statements the compiler can only partially verify. aljabr eliminates the ceremony and tightens the guarantees, then extends the same union model out to error handling, reactive state, schema validation, and UI rendering. You're not buying a pattern-matching utility and then reaching for four other libraries — the composition stays in-model.

## What aljabr is not

aljabr's surface area now overlaps with several other libraries. None of them are wrong; they're aimed at different things.

**vs. [Effect-ts](https://effect.website/).** Effect is a full runtime: fibers, service layer, structured concurrency, mature ecosystem. aljabr has no runtime — it's algebraic data types and the things that compose through them. Reach for Effect when you want the framework; reach for aljabr when you don't.

**vs. [ts-pattern](https://github.com/gvergnaud/ts-pattern).** ts-pattern is structural pattern matching over arbitrary objects. aljabr's dispatch is tag-first and nominal — better for unions you define yourself, with clean serialization and shared variant behavior. ts-pattern is the better fit for matching over third-party shapes.

**vs. [React](https://react.dev) / [Solid](https://www.solidjs.com).** aljabr's UI layer has no virtual DOM and no diff cycle; it renders a static tree once and surgically updates only the regions whose signal dependencies change — closer to Solid than React. Unlike either, the renderer host is pluggable: DOM, canvas, SSR, or anything you implement against `RendererHost<N, E>` are equal peers. Components are plain functions; there are no hooks, no rules-of-hooks, and no registration.

**vs. [Preact Signals](https://preactjs.com/guide/v10/signals/) / standalone signal libraries.** Signals are the smallest piece of aljabr's reactive system. The prelude also ships `Ref` (per-path subscriptions over structured objects), `RefArray` / `DerivedArray` (per-index reactive lists with keyed reconciliation), `Scope` / `Resource` (structured cleanup), and `watchEffect` (retry policies, timeouts, cancellation). If you want signals only, a dedicated signals library is lighter; if you want the reactive substrate to extend to structured state and resource lifetimes, that's what aljabr is for.

**vs. [Awaitly](https://github.com/jagreehal/awaitly).** Workflow-first vs. ADT-first. Awaitly orients around typed async step composition; aljabr orients around tagged unions, with async and reactive as things that compose through them. Worth reading the author's [post on algebraic thinking in TypeScript](https://arrangeactassert.com/posts/algebraic-thinking-without-the-ceremony/).

---

## Installation

```sh
npm install aljabr
# pnpm add aljabr
# yarn add aljabr
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

### UI (`aljabr/ui`)

- [`view()` / `Fragment` / `ViewNode`](docs/api/ui.md) — element, component, and fragment factories
- [`createRenderer()` / `mount()`](docs/api/ui.md#createrendererhost-protocol) — renderer factory and mounting
- [`RendererHost<N, E>`](docs/api/ui.md#rendererhost) — contract for custom rendering targets
- [`domHost`](docs/api/ui.md#domhost) — production DOM implementation
- [JSX reference](docs/api/ui.md#jsx-reference) — tsconfig setup and JSX/`view()` equivalence

### Prelude (`aljabr/prelude`)

- [Prelude overview](docs/api/prelude/index.md) — all modules at a glance
- [`Result<T, E>`](docs/api/prelude/result.md)
- [`Option<T>`](docs/api/prelude/option.md)
- [`Validation<T, E>`](docs/api/prelude/validation.md)
- [`Signal<T, S>`](docs/api/prelude/signal.md) — reactive mutable container; custom state protocols
- [`Derived<T>` / `AsyncDerived<T, E>`](docs/api/prelude/derived.md) — lazy computed reactive values
- [`Ref<T>`](docs/api/prelude/ref.md) — structured reactive objects and arrays
- [`RefArray<T>`](docs/api/prelude/ref.md#refarrayt) — reactive root-level array; pathless mutations, per-index reads, iterator methods
- [`DerivedArray<T>`](docs/api/prelude/derived-array.md) — read-only per-index reactive view; key-based incremental diffing; chainable `map` / `filter` / `sort`
- [`Scope` / `Resource`](docs/api/prelude/scope.md) — structured resource lifetimes
- [`Effect<T, E>` / `watchEffect`](docs/api/prelude/effect.md) — reactive async effects
- [`Fault<E>`](docs/api/prelude/fault.md) — classify async failures
- [`Schedule` / `AsyncOptions`](docs/api/prelude/schedule.md) — retry policies and timeouts
- [`Tree<T>`](docs/api/prelude/tree.md) — recursive binary tree
- [Persistence](docs/api/prelude/persist.md) — `persistedSignal`, `syncToStore`
- [Reactive context](docs/api/prelude/context.md) — `batch`, `untrack`, `createOwner`

---

## Guides

- [Building UI with aljabr](docs/guides/ui.md) — static tree → reactive regions → components → lifecycle → reactive lists
- [Getting Started](docs/guides/getting-started.md) — first union through real-world patterns
- [Union Patterns](docs/guides/union-patterns.md) — `is.*`, `select()`, destructuring, guards
- [Schema](docs/guides/schema.md) — decoding external data, error paths, object modes, variant mapping
- [Resilient Async](docs/guides/resilient-async.md) — retry, backoff, timeouts, `AbortSignal`
- [Advanced Patterns](docs/guides/advanced/index.md)
    - [Union Branching](docs/guides/advanced/union-branching.md) — Result chaining, Option as null discipline
    - [Signal Protocols](docs/guides/advanced/signal-protocols.md) — domain-specific signal state machines
    - [Reactive UI Patterns](docs/guides/advanced/reactive-ui.md) — Ref + Derived + AsyncDerived composition for complex data-layer state
    - [Resource Lifetime](docs/guides/advanced/resource-lifetime.md) — Scope boundaries, bracket patterns
    - [Parser Construction](docs/guides/advanced/parser-construction.md) — token/AST unions, recursive match
