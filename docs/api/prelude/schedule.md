# API Reference: Schedule / ScheduleError / AsyncOptions

```ts
import { Schedule, ScheduleError, type AsyncOptions } from "aljabr/prelude"
```

---

## Overview

The scheduling module provides declarative retry-delay policies for [`AsyncDerived`](./derived.md#asyncderivedt-e) and [`watchEffect`](./effect.md#watcheffect). Instead of wiring `setTimeout` chains manually, you describe the retry behavior as data — a `Schedule` variant — and pass it through `AsyncOptions`. The scheduler reads the policy after each failed attempt, computes the next delay, and queues the retry automatically.

---

## `Schedule`

A tagged union describing how delays between retry attempts are computed. Pass a `Schedule` value to `AsyncOptions.schedule` to enable automatic retry.

`attempt` is **1-indexed**: `1` on the first retry, `2` on the second, and so on.

### Variants

| Variant | Factory | Delay formula |
|---|---|---|
| `Fixed` | `Schedule.Fixed(delay)` | Constant `delay` ms on every attempt |
| `Linear` | `Schedule.Linear({ delayPerAttempt, jitter? })` | `delayPerAttempt × attempt` ms |
| `Exponential` | `Schedule.Exponential({ initialDelay, maxDelay, multiplier?, jitter? })` | `min(initialDelay × multiplierᵃᵗᵗᵉᵐᵖᵗ⁻¹, maxDelay)` ms |
| `Custom` | `Schedule.Custom(fn)` | `fn(attempt, error)` — return a `number` for a delay, `null` to stop |

**Jitter** (available on `Linear` and `Exponential`) randomises the computed delay within `[50%, 100%]` of its nominal value. This spreads retry storms across clients hitting the same endpoint simultaneously.

---

### `Schedule.Fixed(delay)`

```ts
Schedule.Fixed(delay: number): Fixed
```

Every retry fires after the same `delay` milliseconds, regardless of which attempt it is.

```ts
const every2s = Schedule.Fixed(2_000)
// attempt 1: 2 s, attempt 2: 2 s, attempt 3: 2 s …
```

---

### `Schedule.Linear({ delayPerAttempt, jitter? })`

```ts
Schedule.Linear(opts: { delayPerAttempt: number; jitter?: boolean }): Linear
```

Delay grows proportionally with the attempt number. Attempt 1 waits `delayPerAttempt`, attempt 2 waits `2 × delayPerAttempt`, and so on.

```ts
const linear = Schedule.Linear({ delayPerAttempt: 500, jitter: true })
// attempt 1: ~500 ms, attempt 2: ~1 s, attempt 3: ~1.5 s (jitter applied)
```

---

### `Schedule.Exponential({ initialDelay, maxDelay, multiplier?, jitter? })`

```ts
Schedule.Exponential(opts: {
    initialDelay: number
    maxDelay:     number
    multiplier?:  number   // default: 2
    jitter?:      boolean  // default: false
}): Exponential
```

Classic exponential backoff, capped at `maxDelay`. The default multiplier of `2` doubles the delay each attempt.

```ts
const backoff = Schedule.Exponential({ initialDelay: 100, maxDelay: 30_000 })
// attempt 1: 100 ms, attempt 2: 200 ms, attempt 3: 400 ms … capped at 30 s

const aggressiveBackoff = Schedule.Exponential({
    initialDelay: 200,
    maxDelay:     60_000,
    multiplier:   3,
    jitter:       true,
})
```

---

### `Schedule.Custom(fn)`

```ts
Schedule.Custom(fn: (attempt: number, error: unknown) => number | null): Custom
```

Full control over the delay. Returning `null` signals unconditional termination regardless of `maxRetries` — the error propagates as-is, without a `ScheduleError.MaxRetriesExceeded` wrapper.

```ts
import { ScheduleError } from "aljabr/prelude"

const smart = Schedule.Custom((attempt, error) => {
    // honour a server-provided Retry-After header
    if (error instanceof RateLimitError) return error.retryAfterMs
    // give up after three attempts on any other error
    if (attempt >= 3) return null
    return 1_000 * attempt
})
```

---

## `ScheduleError`

Errors emitted by the scheduler itself — distinct from domain errors thrown by the user's thunk. They appear as the `error` field on `AsyncDerivedState.Failed` and `Effect.Failed` when the retry loop terminates for a scheduler-driven reason.

Because `ScheduleError` is an Aljabr union, you can match over it exactly like any other union.

### Variants

| Variant | Payload | When emitted |
|---|---|---|
| `ScheduleError.TimedOut` | `{ elapsed: number; timeout: number }` | Thunk did not resolve within `AsyncOptions.timeout` ms |
| `ScheduleError.MaxRetriesExceeded` | `{ attempts: number; lastError: unknown }` | `AsyncOptions.maxRetries` attempts were exhausted |

```ts
import { match } from "aljabr"
import { ScheduleError } from "aljabr/prelude"

function describeError(e: unknown): string {
    if (!variantOf(ScheduleError, e)) return String(e)
    return match(e as ScheduleError, {
        TimedOut:           ({ elapsed, timeout }) =>
            `timed out after ${elapsed} ms (limit: ${timeout} ms)`,
        MaxRetriesExceeded: ({ attempts, lastError }) =>
            `gave up after ${attempts} attempts: ${lastError}`,
    })
}
```

---

## `AsyncOptions<E>`

Shared configuration bag accepted by both `AsyncDerived.create` and `watchEffect`. All fields are optional. Omitting `schedule` disables automatic retry entirely — the thunk runs once and any failure transitions directly to `Failed` with `nextRetryAt: null`.

```ts
type AsyncOptions<E = unknown> = {
    schedule?:    Schedule
    maxRetries?:  number
    shouldRetry?: (error: E) => boolean
    timeout?:     number
    onRetry?:     (attempt: number, error: E, nextDelay: number) => void
}
```

| Field | Type | Description |
|---|---|---|
| `schedule` | `Schedule` | Retry-delay policy. Required to enable automatic retries. |
| `maxRetries` | `number` | Cap on retry attempts. Undefined means retry indefinitely until `shouldRetry` or a `Custom.fn` returning `null` stops the loop. |
| `shouldRetry` | `(error: E) => boolean` | Called before each retry. Return `false` to abort immediately on a specific error class. Defaults to always `true`. |
| `timeout` | `number` | Abort the thunk after this many milliseconds. Emits `ScheduleError.TimedOut` on expiry and aborts the in-flight `AbortSignal`. |
| `onRetry` | `(attempt, error, nextDelay) => void` | Fired just before each retry fires. Use for logging, telemetry, or showing a countdown banner. |

### Timeout semantics

A timeout fires as `Failed(ScheduleError.TimedOut(...))` and counts as one attempt toward `maxRetries`. If you want a timeout to be immediately terminal, combine it with `shouldRetry`:

```ts
import { variantOf } from "aljabr"
import { ScheduleError } from "aljabr/prelude"

const options: AsyncOptions = {
    timeout:     5_000,
    schedule:    Schedule.Exponential({ initialDelay: 100, maxDelay: 10_000 }),
    shouldRetry: (e) => !variantOf(ScheduleError, e),  // stop on TimedOut or MaxRetriesExceeded
}
```

### `maxRetries` vs `Custom.fn` returning `null`

Both stop the retry loop, but with different semantics:

- `maxRetries: N` — the loop continues until attempt `N + 1`, then emits `ScheduleError.MaxRetriesExceeded` as the error.
- `Custom.fn` returning `null` — the loop stops immediately and propagates the **original domain error**, not a `ScheduleError`.

Use `Custom` when the decision to stop should be based on the error itself (e.g. a 404 is not retryable). Use `maxRetries` when you want a simple hard cap.

---

## See also

- [`AsyncDerived`](./derived.md#asyncderivedt-e) — pass `AsyncOptions` as the second argument to `create`
- [`watchEffect`](./effect.md#watcheffect) — same `AsyncOptions` apply via `WatchOptions`
- [`Effect.Failed`](./effect.md#variants) — the variant that surfaces retry context at read time
- [Resilient async guide](../../guides/resilient-async.md) — walkthrough of retry, backoff, and timeout patterns
