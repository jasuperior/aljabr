import { union, Trait, type Variant } from "../union.ts";
import { getTag } from "../union.ts";
import { match } from "../match.ts";
import {
    type Computation,
    getCurrentComputation,
    trackIn,
    createOwner,
} from "./context.ts";
import {
    type AsyncOptions,
    ScheduleError,
    computeDelay,
} from "./schedule.ts";

export abstract class Computable<T, E> extends Trait {
    async run(): Promise<Done<T, E> | Failed<T, E>> {
        const self = this as unknown as Effect<T, E>;
        return match(self, {
            Idle: async ({ thunk }) => {
                try {
                    return Effect.Done(await thunk()) as Done<T, E>;
                } catch (e) {
                    return Effect.Failed(e as E, 1, null) as Failed<T, E>;
                }
            },
            Running: ({ pending }) => pending,
            Done:    (it) => Promise.resolve(it as Done<T, E>),
            Stale: async ({ thunk }) => {
                try {
                    return Effect.Done(await thunk()) as Done<T, E>;
                } catch (e) {
                    return Effect.Failed(e as E, 1, null) as Failed<T, E>;
                }
            },
            Failed: (it) => Promise.resolve(it as Failed<T, E>),
        });
    }

    map<U>(fn: (value: T) => U): Idle<U, E> {
        const self = this as unknown as Effect<T, E>;
        return Effect.Idle(async () => {
            const result = await self.run();
            if (getTag(result) === "Failed") throw (result as Failed<T, E>).error;
            return fn((result as Done<T, E>).value);
        }) as Idle<U, E>;
    }

    flatMap<U>(fn: (value: T) => Effect<U, E>): Idle<U, E> {
        const self = this as unknown as Effect<T, E>;
        return Effect.Idle(async () => {
            const result = await self.run();
            if (getTag(result) === "Failed") throw (result as Failed<T, E>).error;
            const next = fn((result as Done<T, E>).value);
            const nextResult = await next.run();
            if (getTag(nextResult) === "Failed") throw (nextResult as Failed<U, E>).error;
            return (nextResult as Done<U, E>).value;
        }) as Idle<U, E>;
    }

    recover<F>(fn: (error: E) => Effect<T, F>): Idle<T, F> {
        const self = this as unknown as Effect<T, E>;
        return Effect.Idle(async () => {
            const result = await self.run();
            if (getTag(result) !== "Failed") return (result as Done<T, E>).value;
            const recovery = fn((result as Failed<T, E>).error);
            const recoveryResult = await recovery.run();
            if (getTag(recoveryResult) === "Failed") throw (recoveryResult as Failed<T, F>).error;
            return (recoveryResult as Done<T, F>).value;
        }) as Idle<T, F>;
    }
}

export type Idle<T, E = never> = Variant<
    "Idle",
    { thunk: () => Promise<T> },
    Computable<T, E>
>;
export type Running<T, E = never> = Variant<
    "Running",
    { pending: Promise<Done<T, E> | Failed<T, E>> },
    Computable<T, E>
>;
/** Settled successfully — contains the resolved value. */
export type Done<T, E = never> = Variant<
    "Done",
    { value: T },
    Computable<T, E>
>;
/**
 * The effect has previously completed but one or more of its signal
 * dependencies have since changed. The last known value is preserved so
 * callers can render stale-while-revalidating. Call `.run()` to re-execute
 * the thunk and produce a fresh `Done` or `Failed`.
 */
export type Stale<T, E = never> = Variant<
    "Stale",
    { value: T | null; thunk: () => Promise<T> },
    Computable<T, E>
>;
/** Settled with an error — carries retry context when automatic retry is configured. */
export type Failed<T, E = never> = Variant<
    "Failed",
    { error: E; attempts: number; nextRetryAt: number | null },
    Computable<T, E>
>;

export type Effect<T, E = never> =
    | Idle<T, E>
    | Running<T, E>
    | Done<T, E>
    | Stale<T, E>
    | Failed<T, E>;

export const Effect = union([Computable]).typed({
    Idle:    <T, E = never>(thunk: () => Promise<T>) =>
        ({ thunk }) as Idle<T, E>,
    Running: <T, E = never>(pending: Promise<Done<T, E> | Failed<T, E>>) =>
        ({ pending }) as Running<T, E>,
    Done:    <T, E = never>(value: T) =>
        ({ value }) as Done<T, E>,
    Stale:   <T, E = never>(value: T | null, thunk: () => Promise<T>) =>
        ({ value, thunk }) as Stale<T, E>,
    Failed:  <T, E = never>(error: E, attempts: number, nextRetryAt: number | null) =>
        ({ error, attempts, nextRetryAt }) as Failed<T, E>,
});

// ---------------------------------------------------------------------------
// watchEffect — reactive effect runner
// ---------------------------------------------------------------------------

type WatchHandle = { stop(): void };

type WatchOptions<E = never> = AsyncOptions<E> & {
    /**
     * When `true`, the effect re-runs automatically whenever a dependency
     * changes, without the caller needing to invoke `.run()` on the `Stale`
     * value. The `onChange` callback still fires on every settled result.
     *
     * @default false
     */
    eager?: boolean;
};

/**
 * Run an async thunk reactively. Any `Signal.get()` calls inside `thunk`
 * are automatically tracked as dependencies. When a dependency changes, the
 * effect transitions to `Stale` and `onChange` is called so the caller can
 * decide when to re-run.
 *
 * The thunk receives an `AbortSignal` that is aborted before each new
 * attempt, enabling clean cancellation of in-flight requests.
 *
 * When `schedule` is provided in options, failed computations are
 * automatically retried according to the policy. `onChange` is called with
 * a `Failed` variant (carrying `nextRetryAt`) before each retry fires.
 *
 * Returns a handle with `stop()` to cancel tracking and dispose the
 * underlying computation.
 *
 * @example Lazy (default)
 * const src = Signal.create("hello");
 * const handle = watchEffect(
 *   async (signal) => fetchData(src.get()!, signal),
 *   (result) => match(result, {
 *     Done:   ({ value }) => console.log(value),
 *     Stale:  (s) => s.run(),
 *     Failed: ({ error }) => console.error(error),
 *   }),
 * );
 *
 * @example Eager with retry
 * const handle = watchEffect(
 *   async (signal) => fetch("/api/data", { signal }).then(r => r.json()),
 *   (result) => match(result, {
 *     Done:   ({ value }) => setState(value),
 *     Failed: ({ nextRetryAt }) => showRetryBanner(nextRetryAt),
 *     Stale:  () => {},
 *   }),
 *   { eager: true, schedule: Schedule.exponential({ initialDelay: 100, maxDelay: 30_000 }) },
 * );
 */
export function watchEffect<T, E = never>(
    thunk: (signal: AbortSignal) => Promise<T>,
    onChange: (result: Done<T, E> | Stale<T, E> | Failed<T, E>) => void,
    options: WatchOptions<E> = {},
): WatchHandle {
    const { eager = false, ...asyncOptions } = options;
    const computation: Computation = createOwner(getCurrentComputation());

    let lastResult: Done<T, E> | Failed<T, E> | null = null;
    let currentController: AbortController | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let attempts = 0;

    const cancelRetryTimer = () => {
        if (retryTimer !== null) { clearTimeout(retryTimer); retryTimer = null; }
    };

    const withTimeout = (promise: Promise<T>, timeoutMs: number): Promise<T> =>
        new Promise<T>((resolve, reject) => {
            const start = Date.now();
            const timer = setTimeout(() => {
                currentController?.abort();
                reject(ScheduleError.TimedOut(Date.now() - start, timeoutMs));
            }, timeoutMs);
            promise.then(
                (v) => { clearTimeout(timer); resolve(v); },
                (e) => { clearTimeout(timer); reject(e); },
            );
        });

    const handleFailure = (error: E): void => {
        const { schedule, maxRetries, shouldRetry, onRetry } = asyncOptions;

        const retriable =
            schedule !== undefined &&
            (shouldRetry === undefined || shouldRetry(error));

        if (!retriable) {
            lastResult = Effect.Failed<T, E>(error, attempts, null);
            onChange(lastResult);
            return;
        }

        if (maxRetries !== undefined && attempts > maxRetries) {
            lastResult = Effect.Failed<T, E>(
                ScheduleError.MaxRetriesExceeded(attempts, error) as unknown as E,
                attempts,
                null,
            );
            onChange(lastResult);
            return;
        }

        const delay = computeDelay(schedule, attempts, error);
        if (delay === null) {
            lastResult = Effect.Failed<T, E>(error, attempts, null);
            onChange(lastResult);
            return;
        }

        const nextRetryAt = Date.now() + delay;
        onRetry?.(attempts, error, delay);

        lastResult = Effect.Failed<T, E>(error, attempts, nextRetryAt);
        onChange(lastResult);

        retryTimer = setTimeout(() => { retryTimer = null; void rerun(); }, delay);
    };

    const rerun = async () => {
        attempts++;
        currentController?.abort();
        currentController = new AbortController();
        const { signal } = currentController;

        for (const source of [...computation.sources]) {
            source.unsubscribe(computation);
        }
        computation.sources.clear();

        try {
            const promise = trackIn(computation, () => thunk(signal));
            const value = asyncOptions.timeout !== undefined
                ? await withTimeout(promise, asyncOptions.timeout)
                : await promise;

            attempts = 0;
            lastResult = Effect.Done<T, E>(value);
            onChange(lastResult);
        } catch (e) {
            handleFailure(e as E);
        }
    };

    computation.dirty = () => {
        if (lastResult === null) return;
        cancelRetryTimer();

        if (eager) {
            void rerun();
        } else {
            // Preserve the last known good value for stale-while-revalidating.
            const lastValue = getTag(lastResult) === "Done"
                ? (lastResult as Done<T, E>).value
                : null;
            // Wrap with a fresh AbortController for manual re-run via .run().
            const staleThunk = () => {
                const ctrl = new AbortController();
                return thunk(ctrl.signal);
            };
            onChange(Effect.Stale<T, E>(lastValue, staleThunk));
        }
    };

    // Run immediately with dependency tracking.
    // The initial execution is suppressed — onChange only fires on changes.
    // If the initial run fails and a schedule is configured, the first retry
    // is silently queued so the automatic retry loop starts without noise.
    (async () => {
        currentController = new AbortController();
        const { signal } = currentController;

        for (const source of [...computation.sources]) {
            source.unsubscribe(computation);
        }
        computation.sources.clear();

        try {
            const promise = trackIn(computation, () => thunk(signal));
            const value = asyncOptions.timeout !== undefined
                ? await withTimeout(promise, asyncOptions.timeout)
                : await promise;

            lastResult = Effect.Done<T, E>(value);
        } catch (e) {
            // Silent initial failure: set state but do not call onChange.
            lastResult = Effect.Failed<T, E>(e as E, 0, null);

            // Silently queue the first retry if the schedule permits.
            const { schedule, shouldRetry } = asyncOptions;
            if (schedule !== undefined && (shouldRetry === undefined || shouldRetry(e as E))) {
                const delay = computeDelay(schedule, 1, e);
                if (delay !== null) {
                    retryTimer = setTimeout(() => { retryTimer = null; void rerun(); }, delay);
                }
            }
        }
    })();

    return {
        stop() {
            cancelRetryTimer();
            currentController?.abort();
            computation.dispose();
        },
    };
}
