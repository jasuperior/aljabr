# Aljabr Principles

These are the load-bearing rules of the library. Every change — new abstractions, refactors, migrations, bug fixes — must be checked against this guide. The style guide ([style-guide.md](style-guide.md)) describes *what* the API looks like; this document describes *what we will not compromise on regardless of how the API is shaped*.

When in doubt, the principles override the style guide. If the style guide says one thing and applying it would violate a principle, the style guide is wrong and must be updated. Principles are the trump card.

---

## P1 — Type safety is non-negotiable

Aljabr's value proposition is *correctness through types*. Every public API surface must be fully type-safe at the point of use. The moment a user has to reach for `as any`, an `// @ts-expect-error`, or a runtime cast to make a public API work, the library has failed at its job.

**What this means in practice:**

- **No public API may return `any`.** If a generic call collapses to `any` for a downstream consumer, the API's type signature is wrong.
- **No public API may silently lose generic information.** If `Union<typeof X>` evaluates to `any` because of how `X` is constructed, that's a regression.
- **`as` casts in implementation code are a smell, not a tool.** They're acceptable when (a) bridging an `unknown` value at a system boundary, (b) implementing a generic factory whose return type is documented, or (c) working around a TypeScript limitation that's been written down in a comment. They are never acceptable for "make this compile."
- **Inference must work without explicit type arguments at the call site.** Users should rarely need to write `Result.Accept<number>(1)` — `Result.Accept(1)` should infer `Accepted<number>`. When inference doesn't work, the API has a design flaw.
- **Variance is a real concern.** When a type appears in both covariant and contravariant positions across a union (`Result<T, E>`'s `Accepted<T>` carries `T` covariantly; `Rejected<E>` carries it as `Thenable<never, E>`), method signatures must accommodate the union's variance behavior. The widening cases (`flatMap<U, F>(...): Result<U, E | F>`) and the `getOr<U>(default: U): T | U` shape exist because of variance, not despite it.

**Before any change to public types or generics, verify:**

1. `npx tsc --noEmit -p tsconfig.json` reports zero errors in `src/`.
2. `npx tsc --noEmit -p tsconfig.test.json` reports no NEW errors versus the prior baseline. Pre-existing errors are tracked; introducing new ones is a regression.
3. The downstream demos under `public/` still type-check (`npx tsc --noEmit -p tsconfig.json` covers them).

**Before any rename, verify:**

1. The downstream demos under `public/` are updated alongside the library.
2. Re-exports from `src/main.ts` / `src/prelude/index.ts` still surface the renamed symbol.

If you discover a type regression — an API now returns `any`, a downstream callback parameter loses its inferred type, a `Union<typeof X>` collapses — **stop the migration and fix the regression before continuing**. Do not commit changes that propagate the regression to other files.

---

## P2 — Single responsibility per primitive

Every abstraction in aljabr fits one of four buckets (see the [style guide](style-guide.md)). The bucket dictates the abstraction's shape. Cross-bucket inheritance is forbidden — a reactive container is not an ADT, an ADT is not a coordinator, etc. When designing a new abstraction, the first question is "which bucket?" — if the answer is "two of them" or "none," the design is wrong before the code is written.

---

## P3 — Construction has one shape per bucket

- Reactive containers: `X.create(...)` static method.
- ADTs: variant factories (`X.Variant(...)`) produced by `union(...)`.
- Resource/lifetime primitives: `X.create(...)` static method.
- Coordinators: lowercase free functions.

The Schema DSL is the **only** documented carve-out. Do not generalize it. Adding a second carve-out means the rule is no longer a rule.

---

## P4 — Read API has one shape per reactive container

`get` / `getOr` / `peek` / `state` / `peekState`. Lifecycle absence → `null`. Positional/path absence → `undefined`. Tracked vs untracked is method vs `peek*`-prefixed-method. **No getters as a substitute for methods** — getters and methods cannot coexist on the same name, and the method form is the canonical one.

---

## P5 — Every reactive container fires push subscribers via `subscribe(callback)`

Each container keeps its own `#valueSubscribers` Set, distinct from the computation Map. The callback signature mirrors the container's `get()` return type. Granular subscription is composed via `at(path).subscribe(...)`.

---

## P6 — Sync `void dispose()` for in-process; async `Promise<Defect[]>` for resource owners

Every disposable container implements `[Symbol.dispose]` (sync) or `[Symbol.asyncDispose]` (async). Mixing the two contracts inside one container is forbidden.

---

## P7 — Trait extraction must preserve `[requirements]`

The union builder's `[requirements]` phantom is what enforces variant payload shape. When refactoring trait classes, **the requirement constraint on each ADT's local trait class must be preserved** — usually by extending `Trait<{ value: T }>` directly rather than going through a parameterless canonical trait.

Canonical traits (`Mappable`, `Bindable`, `Reducible`, `Foldable`) are **type-only interfaces** that ADT trait classes `implements` to advertise conformance. They do **not** form a class inheritance chain that ADT trait classes extend, because abstract method declarations in canonical classes leak `unknown` into variant types (no higher-kinded types in TypeScript).

**The pattern:**

```ts
// traits.ts — interface only
export interface Bindable<T> extends Mappable<T> { ... }

// option.ts — extends Trait directly, implements canonical interface
export abstract class Mappable<T>
    extends Trait<{ value: unknown }>           // payload requirement preserved
    implements Bindable<T>, Reducible<T>        // canonical conformance documented
{
    map<U>(fn: (value: T) => U): Option<U> { ... }
    flatMap<U>(fn: (value: T) => Option<U>): Option<U> { ... }
    getOr(defaultValue: T): T { ... }
}
```

---

## P8 — Demos are first-class consumers

The demos under `public/` (`todo.tsx`, `canvas.tsx`, etc.) are not throwaway example code — they are the canonical shape of how a user assembles aljabr in a real app. Every breaking change must update them in the same commit.

If a demo can't be migrated cleanly to the new API, the API change is wrong.

---

## P9 — Migrations land in coherent units

Phase 5's structure (additive steps 1–5, breaking steps 6–11 batched) is the template. Each commit must leave the tree:

- Compiling (`tsc` clean)
- Test-passing (`vitest run` green)
- Internally consistent (no half-renamed symbols, no orphaned exports)

A migration that leaves the tree in a temporarily broken state — even for one commit — is a workflow failure. If the change is too big to land in one piece, it must be decomposed into steps that each individually leave the tree clean.

---

## P10 — When in doubt, consult this guide

This document is the contract you have with the library and its users. Re-read it before:

- Renaming a public symbol
- Changing a generic signature
- Refactoring trait or class hierarchies
- Adding new methods to existing classes
- Modifying how `union(...)` or `match(...)` behave
- Touching `[requirements]`, `[tag]`, or any other phantom symbol

If you find yourself reaching for `any`, `as unknown as X`, `// @ts-expect-error`, or thinking "the type system is being annoying here" — pause. The type system is the product. Annoyance with the type system is a signal that the design is wrong, not that the type system is.
