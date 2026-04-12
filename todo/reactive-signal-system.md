# Reactive Signal System

## Summary

Replace the immutable `Signal<T>` lifecycle union with a reactive pull-based mutable container.
Add `Derived<T>` for computed values. Extend `Effect<T, E>` with a `Stale` variant and reactive
re-run semantics. Introduce a global tracking context with owner-tree cleanup.

---

## Phase 1 — Rename current `Signal<T>` internals → `SignalState<T>`

- Rename the `Unset | Active<T> | Disposed` union type from `Signal<T>` to `SignalState<T>`
- Rename the union factory from `Signal` to `SignalState`
- Rename the `Lifecycle<T>` Trait class to `SignalLifecycle<T>` to avoid ambiguity
- The `Disposed` variant tag is reused in `DerivedState<T>` — do NOT re-export individual
  variant types from `derived.ts` to avoid name collisions via `index.ts`

## Phase 2 — New reactive `Signal<T>` class

File: `src/prelude/signal.ts`

```ts
class Signal<T> {
  static create<T>(initial?: T): Signal<T>
  get state(): SignalState<T>        // matchable lifecycle state
  get(): T | null                    // read + auto-track dependency
  peek(): T | null                   // read without tracking
  set(value: T): void                // write + notify dependents
  dispose(): void                    // transition to Disposed, clear subscribers
}
```

- `get()` registers this signal as a dependency in the current `Computation` context
- `set()` is a no-op if state is `Disposed`
- Signals created inside a tracking context are owned by it and disposed with it

## Phase 3 — Tracking context + owner tree

File: `src/prelude/context.ts`

```ts
type Computation = {
  dirty(): void                                        // called when a dep changes
  dispose(): void                                      // cleanup self + children + cleanups
  sources: Set<{ unsubscribe(c: Computation): void }>  // signals/derived this reads
  owner: Computation | null                            // parent in owner tree
  children: Set<Computation>                           // child computations
  cleanups: Set<() => void>                            // arbitrary cleanup callbacks
}

function getCurrentComputation(): Computation | null
function trackIn<T>(computation: Computation, fn: () => T): T
function createOwner(parent?: Computation | null): Computation

/** @todo Implement cross-boundary context passing (worker/SSR) */
function runInContext<T>(owner: Computation, fn: () => T): T

/** @todo Not yet implemented — currently calls fn immediately */
function batch(fn: () => void): void
```

## Phase 4 — `Derived<T>`

File: `src/prelude/derived.ts`

Variants: `Uncomputed | Computed<T> | Stale<T> | Disposed`

```ts
class Derived<T> {
  static create<T>(fn: () => T): Derived<T>
  static create<T>(options: { get: () => T; set: (v: T) => void }): Derived<T>

  get state(): DerivedState<T>    // matchable
  get(): T | null                 // lazy eval + track; re-evaluates if Uncomputed or Stale
  peek(): T | null                // read last known value without tracking or re-evaluating
  set(value: T): void             // calls user set-handler; throws if read-only
  dispose(): void
}
```

- `set` handler must update upstream `Signal`s — it does NOT override the derived's own value
- When a dep changes: `Computed → Stale` (lazy — does NOT re-run immediately)
- `Stale` carries the last known value so callers can render stale-while-revalidating

**Variant names are NOT re-exported** from `derived.ts` to avoid collision with `SignalState`'s
`Disposed`. Only `DerivedState<T>` and `Derived<T>` are exported.

## Phase 5 — Extend `Effect<T, E>`

File: `src/prelude/effect.ts`

Changes:
- Replace all `Signal<T>` references with `SignalState<T>` (type rename only)
- Add `Stale<T, E>` variant: `{ signal: SignalState<T>; error: E | null; thunk: () => Promise<T> }`
- `Computable.run()` handles `Stale` identically to `Idle` (re-runs the stored thunk)
- Add `watchEffect<T, E>(thunk, onChange)` module-level function:
  - Runs the thunk inside `trackIn`, collecting Signal deps
  - When any dep changes, transitions `Done → Stale` and calls `onChange`
  - Returns `{ stop() }` to cancel

Lifecycle: `Idle → Running → Done → Stale → Idle → Running → Done → ...`

By default, re-evaluation is **lazy** — `Stale` does not auto-run; caller must invoke `.run()`
or respond to `onChange`.

**Eager mode** (auto-rerun on dep change) — stubbed as a `TODO`, not implemented in first pass.

## Phase 6 — Batching stub

- `batch(fn: () => void): void` exported from `context.ts`
- Calls `fn()` immediately with no batching
- TSDoc documents intent and marks as `@todo`

---

## Deferred

| Feature | Notes |
|---|---|
| Batching implementation | API surface locked via `batch()` stub |
| Eager effect mode | `watchEffect` option flag, not wired up |
| `runInContext` cross-boundary | Stub present, worker/SSR impl deferred |
| Async `Derived<T>` | Requires async thunk + loading state |
| Persistence helpers | Can be built on top of `watchEffect` |
