# API Reference: Fault

```ts
import { Fault, type Fail, type Defect, type Interrupted } from "aljabr/prelude"
```

---

## Overview

`Fault<E>` is a three-variant union that classifies every failure in an async reactive pipeline. It replaces raw thrown values as the carrier of failure information in [`Effect.Failed`](./effect.md#variants), [`AsyncDerivedState.Failed`](./derived.md#asyncderivedstatet-e), and [`watchEffect`](./effect.md#watcheffect)'s `onChange` callback.

The three variants cover every failure mode:

| Variant | When | Payload |
|---|---|---|
| `Fault.Fail<E>` | User explicitly threw `Fault.Fail(myError)` | `{ error: E }` |
| `Fault.Defect` | Any unrecognised thrown value (unexpected panic) | `{ thrown: unknown }` |
| `Fault.Interrupted` | The `AbortSignal` fired before the thunk completed | `{ reason?: unknown }` |

**Only `Fail<E>` is retried by default.** `Defect` and `Interrupted` are treated as terminal — the scheduler will not queue a retry unless you override `shouldRetry`.

---

## Variants

### `Fault.Fail<E>`

```ts
Fault.Fail<E>(error: E): Fail<E>
```

Wraps an expected, domain-level error. Throw this from inside a thunk to signal a controlled failure that the scheduler should retry by default.

```ts
import { Fault } from "aljabr/prelude"

// ✓ domain error — will be retried according to schedule
throw Fault.Fail(new ApiError(response.status))

// ✓ string domain error
throw Fault.Fail("not_found")
```

If you throw any other value (a plain `Error`, a string, anything not created by `Fault.Fail`), it will be classified as `Fault.Defect` instead.

---

### `Fault.Defect`

```ts
Fault.Defect(thrown: unknown): Defect
```

Wraps an unexpected thrown value — a bug, a runtime panic, or anything the thunk did not explicitly wrap in `Fault.Fail`. Not retried by default.

`Defect` is created automatically by the classification logic; you rarely construct one directly.

```ts
// accessing .foo on null → TypeError → Fault.Defect({ thrown: TypeError })
async (signal) => {
    const data = await fetch(url, { signal }).then(r => r.json())
    return data.foo.bar  // TypeError if data.foo is undefined
}
```

---

### `Fault.Interrupted`

```ts
Fault.Interrupted(reason?: unknown): Interrupted
```

Signals that the `AbortSignal` was fired before the thunk finished. This happens when:

- A reactive dependency changed and the previous computation was aborted
- `.dispose()` was called on the `AsyncDerived` or `watchEffect` handle
- A timeout fired (the controller is aborted before the timeout error rejects)

Not retried by default. The `reason` field carries whatever value was passed to `controller.abort(reason)`.

```ts
match(fault, {
    Interrupted: ({ reason }) => console.log("aborted:", reason),
    // ...
})
```

---

## Classification rules

Inside a thunk, every thrown value is classified in this order:

1. **`instanceOf(Fault.Fail, e)`** → `Fault.Fail<E>` — pass through as-is
2. **`signal.aborted`** → `Fault.Interrupted(signal.reason)`
3. **Otherwise** → `Fault.Defect(e)`

The implication: if you `throw new Error("oops")`, it becomes `Fault.Defect({ thrown: Error("oops") })`. To produce a `Fault.Fail<E>`, you must explicitly `throw Fault.Fail(myError)`.

---

## Pattern matching on `Fault`

Because `Fault<E>` is an aljabr union you match it with `match()`:

```ts
import { match } from "aljabr"
import { Fault } from "aljabr/prelude"

function describeFault<E>(fault: Fault<E>): string {
    return match(fault, {
        Fail:        ({ error })  => `domain error: ${error}`,
        Defect:      ({ thrown }) => `unexpected panic: ${thrown}`,
        Interrupted: ({ reason }) => `aborted: ${reason ?? "no reason"}`,
    })
}
```

---

## Default retry behaviour

The built-in `shouldRetry` predicate retries only `Fault.Fail`:

```ts
// built-in default — only Fail is retried
(fault) => getTag(fault) === "Fail"
```

`Defect` and `Interrupted` are immediately terminal. To change this, pass your own `shouldRetry` to `AsyncOptions`:

```ts
import { getTag } from "aljabr"

AsyncDerived.create(thunk, {
    schedule:    Schedule.Exponential({ initialDelay: 100, maxDelay: 10_000 }),
    // Also retry Defects (e.g. transient parsing errors)
    shouldRetry: (fault) => getTag(fault) !== "Interrupted",
})
```

---

## Using `instanceOf` to narrow

`instanceOf` (from `aljabr`) lets you test whether a caught value is a specific union variant — useful when you need to re-throw non-domain errors:

```ts
import { instanceOf } from "aljabr"
import { Fault } from "aljabr/prelude"

try {
    // ...
} catch (e) {
    if (instanceOf(Fault.Fail, e)) {
        // e is Fault.Fail<E> — expected domain error
    } else {
        throw e  // re-throw unexpected errors
    }
}
```

---

## Type definitions

```ts
import { type Fault, type Fail, type Defect, type Interrupted } from "aljabr/prelude"

type Fail<E>     = Variant<"Fail",        { error: E },          FaultBase>
type Defect      = Variant<"Defect",      { thrown: unknown },   FaultBase>
type Interrupted = Variant<"Interrupted", { reason?: unknown },  FaultBase>

type Fault<E> = Fail<E> | Defect | Interrupted
```

---

## See also

- [`AsyncDerived`](./derived.md#asyncderivedstatet-e) — `state.getFault()` and `AsyncDerivedState.Failed`
- [`Effect`](./effect.md#variants) — `Effect.Failed` carries `Fault<E>`
- [`watchEffect`](./effect.md#watcheffect) — `Failed.fault` in `onChange`
- [`AsyncOptions`](./schedule.md#asyncoptionse) — `shouldRetry` and `afterRetry` receive `Fault<E>`
- [Resilient async guide](../../guides/resilient-async.md) — error classification in practice
