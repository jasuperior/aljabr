# Guide: Resilient Async Lifecycles

Network requests fail. APIs go down. Rate limits hit. This guide walks through aljabr's retry, backoff, timeout, and cancellation primitives — starting from a bare `AsyncDerived`, then progressively hardening it against real-world failure.

Failures are represented as [`Fault<E>`](../api/prelude/fault.md) — a three-variant union that distinguishes expected domain errors (`Fault.Fail<E>`), unexpected panics (`Fault.Defect`), and aborted computations (`Fault.Interrupted`). Understanding `Fault` is the key to reading the `Failed` state in any of the examples below.

---

## Starting point: a bare async derived

```ts
import { Signal, AsyncDerived, Fault } from "aljabr/prelude"

const userId = Signal.create(1)

const profile = AsyncDerived.create<UserProfile, ApiError>(async (signal) => {
    const res = await fetch(`/api/users/${userId.get()!}`, { signal })
    if (!res.ok) throw Fault.Fail(new ApiError(res.status, res.statusText))
    return res.json()
})
```

Throwing `Fault.Fail(e)` marks `e` as an expected domain error. Any other throw (an uncaught `TypeError`, a null dereference) becomes `Fault.Defect`. Explicit `Fault.Fail` is required to distinguish "the API said 503" from "there is a bug in the code."

If the request fails, `profile.state` immediately transitions to `Failed` with `nextRetryAt: null` — the derived has given up. The user sees an error with no recovery path.

---

## Step 1: Add automatic retry with exponential backoff

Pass a `schedule` to enable automatic retry after failure. Exponential backoff is the right default for most network calls.

```ts
import { Signal, AsyncDerived, Schedule, Fault } from "aljabr/prelude"

const profile = AsyncDerived.create<UserProfile, ApiError>(
    async (signal) => {
        const res = await fetch(`/api/users/${userId.get()!}`, { signal })
        if (!res.ok) throw Fault.Fail(new ApiError(res.status, res.statusText))
        return res.json()
    },
    {
        schedule: Schedule.Exponential({ initialDelay: 200, maxDelay: 30_000 }),
    },
)
```

The scheduler now waits 200 ms, then 400 ms, then 800 ms, doubling up to 30 seconds. The derived stays in `Failed` between attempts, with `nextRetryAt` set to the next scheduled timestamp.

Only `Fault.Fail` faults are retried by default. `Fault.Defect` (programming errors) and `Fault.Interrupted` (aborted runs) are terminal unless you override `shouldRetry`.

You can show retry state to users:

```ts
import { match } from "aljabr"

match(profile.state, {
    Loading:    () => showSpinner(),
    Ready:      ({ value }) => renderProfile(value),
    Reloading:  ({ value }) => renderProfile(value, { stale: true }),
    Failed:     ({ fault, nextRetryAt }) =>
        nextRetryAt
            ? showCountdown(nextRetryAt)
            : showPermanentError(fault),
    Uncomputed: () => null,
    Disposed:   () => null,
})
```

---

## Step 2: Cap retries with `maxRetries`

Without a cap, the scheduler retries indefinitely (for `Fault.Fail` faults). Add `maxRetries` to give up after N attempts.

```ts
const profile = AsyncDerived.create(
    async (signal) => { /* ... */ },
    {
        schedule:   Schedule.Exponential({ initialDelay: 200, maxDelay: 30_000 }),
        maxRetries: 5,
    },
)
```

After the 5th failed attempt, the scheduler emits `ScheduleError.MaxRetriesExceeded` wrapped in a `Fault.Fail` as the fault. The derived settles into `Failed` with `nextRetryAt: null`.

```ts
import { match, getTag } from "aljabr"
import { ScheduleError, Fault } from "aljabr/prelude"

match(profile.state, {
    Failed: ({ fault }) => {
        match(fault, {
            Fail: ({ error }) => {
                if (variantOf(ScheduleError, error)) {
                    match(error as ScheduleError, {
                        MaxRetriesExceeded: ({ attempts }) =>
                            showError(`Failed after ${attempts} attempts. Please try again.`),
                        TimedOut: ({ elapsed }) =>
                            showError(`Request timed out after ${elapsed} ms.`),
                    })
                } else {
                    showError(String(error))
                }
            },
            Defect:      ({ thrown }) => showError(`Unexpected error: ${thrown}`),
            Interrupted: () => { /* aborted — typically safe to ignore */ },
        })
    },
    // ...
})
```

---

## Step 3: Add a timeout

Some requests hang indefinitely rather than failing cleanly. `timeout` aborts the in-flight request after the given number of milliseconds. An aborted run surfaces as `Fault.Interrupted`.

```ts
const profile = AsyncDerived.create(
    async (signal) => { /* ... */ },
    {
        schedule:   Schedule.Exponential({ initialDelay: 200, maxDelay: 30_000 }),
        maxRetries: 5,
        timeout:    8_000,  // abort after 8 seconds
    },
)
```

A timeout produces `Fault.Interrupted` and, by default, is **not retried** (the default `shouldRetry` only retries `Fault.Fail`). To make timeouts retryable while keeping other interruptions terminal:

```ts
import { getTag } from "aljabr"

const profile = AsyncDerived.create(
    async (signal) => { /* ... */ },
    {
        schedule:    Schedule.Exponential({ initialDelay: 200, maxDelay: 30_000 }),
        maxRetries:  5,
        timeout:     8_000,
        shouldRetry: (fault) =>
            getTag(fault) === "Fail" || getTag(fault) === "Interrupted",
    },
)
```

---

## Step 4: Selective retry with `shouldRetry`

Not all errors are worth retrying. A `404 Not Found` is permanent; retrying it wastes bandwidth. A `503 Service Unavailable` is transient; retrying makes sense.

`shouldRetry` receives the full `Fault<E>`. Since only `Fault.Fail<E>` carries a domain error, check the tag first:

```ts
import { getTag } from "aljabr"

class ApiError extends Error {
    constructor(public status: number, message: string) {
        super(message)
    }
}

const profile = AsyncDerived.create<UserProfile, ApiError>(
    async (signal) => {
        const res = await fetch(`/api/users/${userId.get()!}`, { signal })
        if (!res.ok) throw Fault.Fail(new ApiError(res.status, res.statusText))
        return res.json()
    },
    {
        schedule:    Schedule.Exponential({ initialDelay: 200, maxDelay: 30_000 }),
        maxRetries:  5,
        shouldRetry: (fault) => {
            if (getTag(fault) !== "Fail") return false  // never retry panics or aborts
            const error = (fault as Fail<ApiError>).error
            return error instanceof ApiError
                ? error.status >= 500   // retry server errors, not client errors
                : true                  // retry other domain errors (network failures, etc.)
        },
    },
)
```

When `shouldRetry` returns `false`, the scheduler stops immediately and the derived settles into `Failed` with `nextRetryAt: null`. The original fault is preserved as-is.

---

## Step 5: Observability with `afterRetry`

Log retries, update a UI indicator, or send telemetry before each attempt fires:

```ts
const profile = AsyncDerived.create(
    async (signal) => { /* ... */ },
    {
        schedule:    Schedule.Exponential({ initialDelay: 200, maxDelay: 30_000 }),
        maxRetries:  5,
        afterRetry:  (attempt, fault, nextDelay) => {
            console.warn(
                `[profile] attempt ${attempt} failed — retrying in ${nextDelay} ms`,
                fault,
            )
            analytics.track("profile.retry", { attempt, delay: nextDelay })
        },
    },
)
```

`afterRetry` fires just before the delay timer starts — not when the timer fires. `nextDelay` is the actual computed delay (including any jitter).

---

## Step 6: `AbortSignal` and cancellation

The thunk always receives an `AbortSignal`. The signal is aborted automatically in three situations:

1. **A dependency changes** — the old in-flight request is cancelled before the new one starts.
2. **A retry is about to fire** — the previous attempt's signal is aborted before the next attempt begins.
3. **A timeout fires** — the controller is aborted and the run surfaces as `Fault.Interrupted`.

Pass the signal to every cancellable I/O call:

```ts
const profile = AsyncDerived.create(async (signal) => {
    // signal is aborted if userId changes mid-flight
    const res = await fetch(`/api/users/${userId.get()!}`, { signal })
    const user = await res.json()

    // also pass signal to nested requests
    const orgRes = await fetch(`/api/orgs/${user.orgId}`, { signal })
    return { user, org: await orgRes.json() }
})
```

When the signal fires, `fetch` throws a `DOMException` with `name === "AbortError"`. Because this is not a `Fault.Fail` instance, `classifyError` promotes it to `Fault.Interrupted`. By default this is terminal. If you need to distinguish user-initiated cancellation from timeout-driven abort, inspect `signal.reason` inside `Fault.Interrupted.reason`.

---

## Using `watchEffect` for side effects

Everything above applies equally to `watchEffect`. The main difference: `watchEffect` calls a callback when results settle rather than exposing a pull-based `.get()`.

```ts
import { watchEffect, Schedule, Fault } from "aljabr/prelude"

const query = Signal.create("")

const handle = watchEffect(
    async (signal) => {
        const q = query.get()!
        if (!q) return []
        return searchApi(q, signal)
    },
    (result) => {
        match(result, {
            Done:   ({ value }) => renderResults(value),
            Stale:  (stale) => {
                // In lazy mode: caller decides when to re-run
                stale.run().then(r => match(r, {
                    Done:   ({ value }) => renderResults(value),
                    Failed: ({ fault }) => renderError(fault),
                }))
            },
            Failed: ({ fault, nextRetryAt }) =>
                nextRetryAt
                    ? showRetryBanner(nextRetryAt)
                    : renderError(fault),
        })
    },
    {
        schedule:   Schedule.Exponential({ initialDelay: 100, maxDelay: 10_000 }),
        maxRetries: 3,
    },
)

// When query changes, the old in-flight request is aborted automatically
query.set("aljabr")

// Stop tracking and abort any pending request
handle.stop()
```

Use `eager: true` if you want the effect to re-run automatically on every dependency change, without manual `.run()` calls on stale values.

---

## Choosing a `Schedule`

| Situation | Recommended schedule |
|---|---|
| Polling a known-stable endpoint | `Schedule.Fixed(5_000)` |
| Transient network blips | `Schedule.Exponential({ initialDelay: 200, maxDelay: 10_000, jitter: true })` |
| Rate-limited API with a `Retry-After` header | `Schedule.Custom((_, fault) => getTag(fault) === "Fail" && fault.error instanceof RateLimitError ? fault.error.retryAfterMs : null)` |
| Deterministic test environments | `Schedule.Fixed(0)` |

Jitter is strongly recommended for any production schedule that may be exercised by many clients simultaneously. Without it, all clients retry at the same moment after a service recovers, producing a retry storm.

---

## See also

- [`Fault`](../api/prelude/fault.md) — error classification: Fail, Defect, and Interrupted
- [`Schedule`](../api/prelude/schedule.md) — full API reference for all schedule variants and `AsyncOptions`
- [`AsyncDerived`](../api/prelude/derived.md#asyncderivedt-e) — pull-based async computed values
- [`watchEffect`](../api/prelude/effect.md#watcheffect) — push-based reactive async side effects
- [`ScheduleError`](../api/prelude/schedule.md#scheduleerror) — matching on timeout and max-retries-exceeded errors
