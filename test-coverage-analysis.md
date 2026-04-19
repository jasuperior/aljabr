# Test Coverage Analysis — aljabr

## Codebase Overview

- **Language**: TypeScript (strict, ES2023)
- **Framework**: Algebraic sum-type / reactive signal library (no UI framework)
- **Build Tool**: Vite + vite-plugin-dts
- **Test Framework**: Vitest with `@vitest/coverage-v8`
- **Entry Points**: `main` (union + match), `prelude` (reactive primitives), `schema` (encode/decode)

---

## Existing Test Setup

| Config | Status |
|---|---|
| `vitest.config.ts` | Present — pattern `test/**/*.test.ts`, typecheck enabled |
| `test:coverage` script | Present — `vitest run --coverage` |
| Test framework | Vitest |
| Type-level tests | `expectTypeOf` used extensively in match and signal tests |

---

## Coverage Summary

| Module | Status | Gap Severity |
|---|---|---|
| `union.ts` | ✅ Complete | — |
| `match.ts` | ✅ Complete | — |
| `prelude/option.ts` | ✅ Complete | — |
| `prelude/result.ts` | ✅ Complete | — |
| `prelude/signal.ts` | ✅ Complete | — |
| `prelude/ref.ts` | ✅ Complete | — |
| `prelude/tree.ts` | ✅ Complete | — |
| `prelude/validation.ts` | ✅ Complete | — |
| `prelude/batch` (via `batch.test.ts`) | ✅ Complete | — |
| `prelude/effect.ts` | ✅ Complete | — |
| `prelude/fault.ts` | ❌ **Zero coverage** | Critical |
| `prelude/scope.ts` | ❌ **Zero coverage** | Critical |
| `prelude/context.ts` | ❌ **Zero coverage** | Critical |
| `prelude/schedule.ts` | ❌ **Zero coverage** | Critical |
| `prelude/derived.ts` — `Derived<T>` | ⚠️ Partial | High |
| `prelude/derived.ts` — `AsyncDerived<T,E>` | ❌ **Zero coverage** | Critical |
| `prelude/persist.ts` | ❌ **Zero coverage** | Medium |
| `schema/index.ts` — core encode/decode | ✅ Good | — |
| `schema/index.ts` — transform/roundtrip/defineCodec | ⚠️ Missing | Low |

---

## Gap Analysis

### 1. `prelude/fault.ts` — No tests

**API surface**:
```ts
Fault.Fail<E>(error: E)           // expected domain error
Fault.Defect(thrown: unknown)     // unexpected runtime panic
Fault.Interrupted(reason?)        // AbortSignal fired
```

**Missing tests**:
- Construct each variant and verify tag + payload fields
- Pattern-match exhaustively with `match()`
- `instanceOf(Fault.Fail, e)` detection used in `AsyncDerived` catch blocks
- Generic `Fault<E>` type inference

---

### 2. `prelude/schedule.ts` — No tests

**API surface**:
```ts
Schedule.Fixed(delay)
Schedule.Linear({ delayPerAttempt, jitter? })
Schedule.Exponential({ initialDelay, maxDelay, multiplier?, jitter? })
Schedule.Custom(fn)

ScheduleError.TimedOut(elapsed, timeout)
ScheduleError.MaxRetriesExceeded(attempts, lastError)

computeDelay(schedule, attempt, error): number | null
```

**Missing tests**:
- Each `Schedule` variant construction and field defaults (`multiplier` defaults to `2`, `jitter` to `false`)
- `computeDelay` for each policy at attempt=1, 2, 3
- `Linear` delay grows linearly: `attempt × delayPerAttempt`
- `Exponential` delay caps at `maxDelay`
- `Custom` returning `null` signals unconditional stop
- Jitter reduces delay to 50–100% of nominal (stochastic — assert range)
- `ScheduleError` variant construction

---

### 3. `prelude/context.ts` — No tests

**API surface**:
```ts
getCurrentComputation(): Computation | null
trackIn<T>(computation, fn): T
createOwner(parent?): Computation
runInContext<T>(owner, fn): T
untrack<T>(fn): T
batch(fn): void
scheduleNotification(comp): void
```

**Missing tests**:
- `getCurrentComputation()` returns `null` outside any context
- `trackIn` pushes/pops correctly; returns the active computation during execution
- Nested `trackIn` — inner computation visible inside, outer restored after
- `createOwner(null)` creates a root (no parent)
- `createOwner()` without args auto-parents to current computation
- `dispose()` on a parent removes it from its parent and disposes all children recursively
- `dispose()` runs all `cleanups` callbacks
- `untrack` suppresses tracking — signals read inside do not subscribe
- `runInContext` behaves identically to `trackIn`
- `scheduleNotification` defers inside a batch, fires immediately outside

---

### 4. `prelude/scope.ts` — No tests

**API surface**:
```ts
Scope(options?): ScopeHandle
Resource<T>(acquire, release): ResourceHandle<T>
runInScope<T>(scope, fn): T
getCurrentScope(): ScopeHandle | null
defer(fn): void          // implicit hook
acquire<T>(resource): Promise<T>  // implicit hook

ScopeHandle.state: ScopeState  // Active | Disposed
ScopeHandle.defer(fn)
ScopeHandle.acquire<T>(resource): Promise<T>
ScopeHandle.dispose(): Promise<Defect[]>
ScopeHandle[Symbol.asyncDispose](): Promise<void>
```

**Missing tests**:
- `Scope()` creates an `Active` scope
- `scope.defer(fn)` — `fn` is called on `dispose()`
- LIFO order: multiple finalizers run last-registered first
- `scope.dispose()` transitions to `Disposed`; calling `dispose()` again returns `[]`
- Finalizer that throws → collected as `Defect[]`, does not abort remaining finalizers
- `scope.acquire(resource)` — calls `resource.acquire()`, auto-registers `resource.release()` as defer
- `Resource(acquire, release)` — inert until consumed
- `runInScope(scope, fn)` — `getCurrentScope()` returns the scope inside `fn`, `null` outside
- Implicit `defer()` throws when called outside a scope
- Implicit `acquire()` throws when called outside a scope
- `Symbol.asyncDispose` — clean disposal produces no warnings; defects produce `console.warn`
- `catchDefect` option — invoked on cascade disposal failures instead of `console.warn`
- Cascade: when owning computation disposes, scope disposes automatically

---

### 5. `prelude/derived.ts` — Partial (`Derived`) + Zero (`AsyncDerived`)

#### `Derived<T>` gaps

**Missing tests**:
- `Derived.create({ get, set })` writable form — `set()` delegates to the handler, which updates upstream signals
- `set()` on a read-only derived throws with the expected error message
- `peek()` returns `null` before first evaluation, returns last known value without re-evaluating
- `DerivedState` lifecycle: `Uncomputed → Computed → Stale → Disposed`
- `dispose()` notifies downstream subscribers and transitions to `Disposed`
- Dependency tracking: changing a dependency invalidates the derived (Computed → Stale)
- Re-evaluation clears stale subscriptions and re-tracks fresh ones

#### `AsyncDerived<T, E>` — Zero coverage

**API surface**:
```ts
AsyncDerived.create<T, E>(
  fn: (signal: AbortSignal, scope: ScopeHandle) => Promise<T>,
  options?: AsyncOptions<E>
): AsyncDerived<T, E>

asyncDerived.state: AsyncDerivedState<T, E>
// Uncomputed | Loading | Ready | Reloading | Failed | Disposed
asyncDerived.get(): Promise<T>
asyncDerived.peek(): T | null
asyncDerived.dispose(): void
```

**Missing tests**:
- Initial state is `Uncomputed`
- `get()` transitions `Uncomputed → Loading → Ready(value)`
- `peek()` returns `null` before first evaluation; returns value after `Ready`
- Dependency change after `Ready` transitions to `Reloading` (stale value preserved)
- `Failed` state on rejection — `fault` is `Fault.Defect`
- `Failed` state with `Fault.Fail` when thunk throws `Fault.Fail(e)`
- `Interrupted` fault when `AbortSignal` fires
- Retry with `Schedule.Fixed` — transitions `Failed → Loading` after delay, eventually `Ready`
- `maxRetries` exceeded → `Failed` with `Fault.Fail(ScheduleError.MaxRetriesExceeded(...))`
- `shouldRetry` returning `false` stops retries immediately
- `timeout` exceeded → `Failed` with `ScheduleError.TimedOut` (wrapped in `Fault.Defect`)
- `afterRetry` callback invoked with attempt number and delay
- `dispose()` — cancels in-flight request (aborts `AbortSignal`), transitions to `Disposed`
- `dispose()` — cancels pending retry timer

---

### 6. `prelude/persist.ts` — No tests (requires storage mock)

**API surface**:
```ts
persistedSignal<T>(initialValue, options): Signal<T>
syncToStore<T>(signal, options): () => void  // returns stop fn
localStorageAdapter: PersistAdapter
sessionStorageAdapter: PersistAdapter
```

**Missing tests** (use a fake `PersistAdapter` — no real localStorage needed):
- `persistedSignal` with a stored value → signal starts with stored value (rehydrated)
- `persistedSignal` with no stored value → starts with `initialValue`
- `persistedSignal` with corrupted storage → falls back to `initialValue`
- Setting the signal → adapter `set()` is called with serialized value
- Signal set to `null` → adapter `remove()` is called
- Custom `serialize`/`deserialize` options are used
- `syncToStore` — mirrors signal writes to the adapter
- `syncToStore` stop function — calling it stops syncing

---

### 7. `schema/index.ts` — Minor gaps

**Missing tests**:
- `defineDecoder<I, O>(decoder)` — identity helper, returns the same decoder
- `defineCodec<I, O>(codec)` — identity helper, returns the same codec
- `roundtrip<T>(schema, value)` — `encode` then `decode` produces the original value

---

## Proposed Implementation Plan

### Part 1 — `prelude/fault.ts` (easiest, foundational for later parts)

New file: `test/prelude/fault.test.ts`

```ts
import { Fault } from "../../src/prelude/fault";
import { getTag, instanceOf } from "../../src/union";
import { match } from "../../src/match";
import { expectTypeOf } from "vitest";

// Variant construction and tag/field verification
// Exhaustive match()
// instanceOf(Fault.Fail, e) detection
// Generic type inference
```

### Part 2 — `prelude/schedule.ts`

New file: `test/prelude/schedule.test.ts`

```ts
import { Schedule, ScheduleError, computeDelay } from "../../src/prelude/schedule";

// Each variant construction and defaults
// computeDelay for Fixed, Linear, Exponential, Custom
// Exponential capping at maxDelay
// Custom returning null
// Jitter range assertions (50-100% of nominal) — run N times, assert all in range
// ScheduleError variants
```

### Part 3 — `prelude/context.ts`

New file: `test/prelude/context.test.ts`

```ts
import {
  getCurrentComputation, trackIn, createOwner,
  runInContext, untrack, scheduleNotification, batch
} from "../../src/prelude/context";

// null outside any context
// push/pop semantics with trackIn
// nested trackIn
// createOwner parent-child linkage
// dispose cascades to children and cleanups
// untrack suppresses subscription
// batch defers scheduleNotification
```

### Part 4 — `prelude/scope.ts`

New file: `test/prelude/scope.test.ts`

```ts
import { Scope, Resource, runInScope, getCurrentScope, defer, acquire } from "../../src/prelude/scope";
import { getTag } from "../../src/union";

// State: Active → Disposed
// LIFO finalizer order
// Defect collection (non-aborting)
// Resource acquire/release integration
// Idempotent dispose (second call returns [])
// Symbol.asyncDispose behavior
// getCurrentScope inside/outside runInScope
// Implicit defer/acquire throw outside scope
// catchDefect option
// Cascade disposal via owning computation
```

### Part 5 — `prelude/derived.ts` — fill gaps

New file: `test/prelude/derived.test.ts`

```ts
import { Derived, AsyncDerived, DerivedState } from "../../src/prelude/derived";
import { Signal } from "../../src/prelude/signal";
import { Schedule } from "../../src/prelude/schedule";
import { Fault } from "../../src/prelude/fault";
import { vi } from "vitest";

// Derived — writable form (set delegates to handler)
// Derived — set() on read-only throws
// Derived — peek() semantics
// Derived — DerivedState lifecycle
// Derived — dispose() propagation

// AsyncDerived — full lifecycle (Uncomputed → Loading → Ready)
// AsyncDerived — Reloading preserves stale value
// AsyncDerived — Failed with Defect / Fail / Interrupted
// AsyncDerived — retry with Schedule.Fixed (vi.useFakeTimers)
// AsyncDerived — maxRetries exceeded
// AsyncDerived — shouldRetry returning false
// AsyncDerived — timeout
// AsyncDerived — afterRetry callback
// AsyncDerived — dispose cancels in-flight and retry timer
```

### Part 6 — `prelude/persist.ts`

New file: `test/prelude/persist.test.ts`

```ts
import { persistedSignal, syncToStore } from "../../src/prelude/persist";
import { vi } from "vitest";

// Fake adapter — no real localStorage
const makeAdapter = () => ({
  store: {} as Record<string, string>,
  get: vi.fn((k: string) => store[k] ?? null),
  set: vi.fn((k: string, v: string) => { store[k] = v; }),
  remove: vi.fn((k: string) => { delete store[k]; }),
});
```

### Part 7 — `schema/index.ts` minor additions

Augment `test/schema/decode.test.ts` or create `test/schema/helpers.test.ts`:

```ts
import { defineDecoder, defineCodec, roundtrip, Schema } from "../../src/schema";

// defineDecoder is identity
// defineCodec is identity
// roundtrip on string/number/object schemas
```

---

## No New Packages Required

The existing stack (`vitest`, `@vitest/coverage-v8`) covers everything:
- `vi.fn()` / `vi.spyOn()` for spies
- `vi.useFakeTimers()` for retry timer tests in `AsyncDerived`
- `expectTypeOf` for type-level assertions
- Plain objects as fake `PersistAdapter` (no real `localStorage` mock needed)

---

**Would you like to proceed with implementing this test plan?**
