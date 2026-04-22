# Test Coverage Analysis — aljabr v0.3.2

_Generated 2026-04-21_

---

## Codebase Overview

| Property | Value |
|---|---|
| Language | TypeScript (strict mode, ES2023) |
| Package | `aljabr` v0.3.2 |
| Build Tool | Vite + vite-plugin-dts |
| Test Framework | Vitest v4.1.2 |
| Coverage Tool | @vitest/coverage-v8 |
| Type-checking in tests | ✅ enabled (`typecheck: { enabled: true }`) |

### Entry Points

| Export | Source |
|---|---|
| `aljabr` | `src/main.ts` → union + match |
| `aljabr/prelude` | `src/prelude/index.ts` |
| `aljabr/schema` | `src/schema/index.ts` |
| `aljabr/signals` | `src/signals/index.ts` |

---

## Existing Test Setup

**27 test files, 756 tests — all passing.**

```
test/
  example.test.ts
  match.test.ts
  union.test.ts
  prelude/
    batch.test.ts          context.test.ts    derived.test.ts
    effect.test.ts         fault.test.ts      option.test.ts
    persist.test.ts        reactive-array.test.ts  ref-array.test.ts
    ref.test.ts            schedule.test.ts   scope.test.ts
    signal.test.ts         tree.test.ts       validation.test.ts
  schema/
    decode.test.ts         encode.test.ts     helpers.test.ts
  signals/
    context.test.ts        effect.test.ts     memo.test.ts
    query.test.ts          scope.test.ts      signal.test.ts
```

**Scripts:**
```json
"test":          "vitest run"
"test:watch":    "vitest"
"test:coverage": "vitest run --coverage"
```

---

## Coverage Report (v0.3.2 baseline)

```
File                 | % Stmts | % Branch | % Funcs | % Lines | Uncovered
---------------------|---------|----------|---------|---------|----------
All files            |   89.37 |    84.72 |   88.67 |   91.43 |
 src/
  match.ts           |   98.43 |    98.78 |    100  |   98.24 | 245
  union.ts           |   100   |    95.23 |    100  |   100   | 436
 src/prelude/
  context.ts         |   100   |    100   |    90   |   100   |
  derived.ts         |   81.15 |    93.61 |    69.6 |   81.77 | AsyncDerived: 463-568, 606-608
  effect.ts          |   62.42 |    46.15 |   68.42 |   63.76 | 203-227, 316-335, 347-355
  fault.ts           |   100   |    100   |    100  |   100   |
  option.ts          |   100   |    100   |    100  |   100   |
  persist.ts         |   78.57 |    90.9  |   53.84 |    76   | 22-24, 29-31
  reactive-array.ts  |   93.16 |    88    |   96.29 |   95.87 | 221-222, 249-250
  ref.ts             |   90.43 |    80.51 |    100  |   96.58 | 963-965, 972-974
  result.ts          |   71.42 |    33.33 |   85.71 |   71.42 | 29-34, 47
  schedule.ts        |   100   |    100   |    100  |   100   |
  scope.ts           |   94.33 |    81.81 |    100  |    94   | 235-238
  signal.ts          |   96.25 |    96.77 |    92.3 |    100  | 139
  tree.ts            |   100   |    100   |    100  |   100   |
  validation.ts      |   100   |    100   |    100  |   100   |
 src/schema/
  index.ts           |   96.47 |    96    |   94.59 |   97.45 | 240, 332-333, 424
 src/signals/
  index.ts           |   100   |    85.71 |    100  |    100  | 163, 226
```

---

## Coverage Gap Analysis

### 🔴 High Priority — Significant gaps

#### `src/prelude/effect.ts` — 62.42% statements / 46.15% branches

The `effect` module is the most under-tested file. Uncovered areas:

- **Lines 203–227**: `watchEffect` async teardown / cancellation on re-run (abort signal handling)
- **Lines 316–335**: retry logic with `Schedule.Exponential` / `Schedule.Linear` under failure
- **Lines 347–355**: max-retry exhaustion path, final error propagation

Missing test scenarios:
- Effect that throws synchronously inside the async fn
- Effect with retry that succeeds on 2nd attempt
- Effect with retry that exhausts max retries → calls `onChange` with error
- Effect with concurrent execution guard (re-run cancels in-flight run)
- `AbortSignal` passed to async fn is aborted on re-run

#### `src/prelude/derived.ts` — 81.15% statements / 69.6% functions

Uncovered: `AsyncDerived` class (lines 463–568, 606–608)

- `AsyncDerived.create()` with retry policy
- `AsyncDerived` states: `Loading`, `Reloading`, `Failed`
- `AsyncDerived` with `scope` parameter (resource cleanup on re-run)
- `AsyncDerived.dispose()` while loading
- Timeout handling (`AsyncOptions.timeout`)

#### `src/prelude/result.ts` — 71.42% statements / 33.33% branches

- `Result.from()` factory (lines 29–34) — only happy path is tested
- `Result` methods: `.then()` chain when `Pending`, `.expect()` on `Reject`

---

### 🟡 Medium Priority — Minor gaps

#### `src/prelude/reactive-array.ts` — 93.16% statements / 88% branches

Uncovered lines 221–222, 249–250:

- Line 221–222: `#keyDefaultWarnEmitted` branch — the dev warning when no key is provided
  for an object array filter/sort. The existing warn test doesn't fully exercise the emit-once guard.
- Line 249–250: `#checkDuplicateKeys` emit-once guard — the `#duplicateKeyWarnEmitted = true`
  branch within the duplicate-key loop.

Suggested additions:
```ts
it("emits the no-key warning exactly once per ReactiveArray instance", () => {
  const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  const arr = Ref.create([{ id: 1 }, { id: 2 }]);
  const filtered = arr.filter(item => item.id > 0); // no key
  arr.push({ id: 3 });
  arr.push({ id: 4 }); // second mutation — warning should NOT fire again
  const warnCount = warnSpy.mock.calls.filter(c => c[0].includes("no key")).length;
  expect(warnCount).toBeLessThanOrEqual(1);
  warnSpy.mockRestore();
});
```

#### `src/prelude/ref.ts` — 90.43% statements / 80.51% branches

Uncovered lines 963–965, 972–974 (inside `Ref.#deleteAtPath`):
- Array splice branch when deleting from a nested array by path
- Recursive path walk into a nested array element

#### `src/prelude/persist.ts` — 78.57% statements / 53.84% functions

Lines 22–24, 29–31: `persistedSignal` options path — `onHydrate` callback and `serializeError` handling.

#### `src/prelude/scope.ts` — 94.33% / 81.81% branches

Lines 235–238: `Scope.dispose()` when a deferred cleanup throws (`Defect` collection).

#### `src/prelude/signal.ts` — 96.25% / 96.77% branches

Line 139: `SignalProtocol.isTerminal` returning `true` stops further `set()` notifications.

#### `src/signals/index.ts` — 100% statements / 85.71% branches

Lines 163, 226: `query()` error path and `scope()` with multiple resources failing.

---

### 🟢 Well covered — no gaps

`context.ts`, `fault.ts`, `option.ts`, `schedule.ts`, `tree.ts`, `validation.ts`, `schema/index.ts`

---

## Recommended Packages

The existing setup is well-configured. No new packages are required.

Optional: enforce coverage thresholds in CI by adding to `vitest.config.ts`:
```ts
coverage: {
  provider: "v8",
  thresholds: { statements: 90, branches: 85, functions: 90, lines: 92 },
},
```

---

## Proposed Test Plan

### Part 1 — `effect.ts` (highest impact, ~62% → 90%+)

**File:** `test/prelude/effect.test.ts`

1. **`watchEffect` async cancellation**
   - Effect re-runs while previous run is in flight → AbortSignal is aborted
   - Effect result from cancelled run is ignored

2. **Retry policies under failure**
   - `Schedule.Fixed` retries N times then gives up
   - `Schedule.Exponential` back-off: success on 2nd attempt
   - `onReject` fires when max retries exhausted

3. **Synchronous-throw inside async fn** → caught, counts as a retry attempt

4. **Dispose during active run** → AbortSignal aborted, effect stops retrying

### Part 2 — `AsyncDerived` in `derived.ts` (~70% → 90%+)

**File:** `test/prelude/derived.test.ts`

1. `AsyncDerived.create()` basic — Loading → Ready state transition
2. Reloading state — dependency changes mid-flight
3. Failed state — rejected promise
4. With `scope` — resource acquired/released across re-runs
5. `dispose()` while loading — cancels in-flight computation
6. With `timeout` — times out → Failed
7. Retry — succeeds on 3rd attempt

### Part 3 — `ReactiveArray` warning guards (~88% → 95%+)

**File:** `test/prelude/reactive-array.test.ts`

1. No-key warning emitted exactly once (emit-once guard)
2. Duplicate-key warning emitted exactly once
3. No warning for primitive arrays

### Part 4 — Remaining minor gaps

- **`result.ts`**: `Result.from()` reject path, `.then()` on `Pending`
- **`persist.ts`**: custom serializer throw, `onHydrate` callback
- **`scope.ts`**: panic collection during `dispose()`
- **`signal.ts`**: `isTerminal` guard on custom-protocol signal

---

## Summary Table

| Module | Stmt % | Branch % | Priority | Gap |
|---|---|---|---|---|
| `effect.ts` | 62% | 46% | 🔴 High | Async cancellation, retry policies |
| `derived.ts` | 81% | 94% | 🔴 High | `AsyncDerived` all lifecycle states |
| `result.ts` | 71% | 33% | 🟡 Medium | `Result.from()` reject, chain on `Pending` |
| `persist.ts` | 79% | 91% | 🟡 Medium | Custom serializer, `onHydrate` |
| `reactive-array.ts` | 93% | 88% | 🟡 Medium | Warn emit-once guards |
| `ref.ts` | 90% | 81% | 🟡 Medium | Nested array delete path |
| `scope.ts` | 94% | 82% | 🟢 Low | Panic collection in dispose |
| `signal.ts` | 96% | 97% | 🟢 Low | `isTerminal` guard |

---

**Would you like to proceed with implementing this test plan?**

Recommended starting point: **Part 1** (`effect.ts` — highest impact) or **Part 2** (`AsyncDerived` — closes the largest function-coverage gap).

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
