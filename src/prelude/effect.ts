import { union, Trait, type Variant, instanceOf } from "../union.ts";
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
import { type ScopeHandle, Scope, runInScope } from "./scope.ts";
import { type Fault, Fault as FaultUnion } from "./fault.ts";

// ---------------------------------------------------------------------------
// Default shouldRetry — only Fail faults are retried; Defect and Interrupted
// are always terminal.
// ---------------------------------------------------------------------------

function defaultShouldRetry<E>(fault: Fault<E>): boolean {
    return getTag(fault) === "Fail";
}

// ---------------------------------------------------------------------------
// Classify a caught value into a Fault<E>
// ---------------------------------------------------------------------------

function classifyError<E>(e: unknown, signal: AbortSignal): Fault<E> {
    if (instanceOf(FaultUnion.Fail, e)) return e as Fault<E>;
    if (signal.aborted) return FaultUnion.Interrupted(signal.reason);
    return FaultUnion.Defect(e);
}

export abstract class Computable<T, E> extends Trait {
    async run(): Promise<Done<T, E> | Failed<T, E>> {
        const self = this as unknown as Effect<T, E>;
        return match(self, {
            Idle: async ({ thunk }) => {
                const ctrl = new AbortController();
                try {
                    return Effect.Done(await thunk()) as Done<T, E>;
                } catch (e) {
                    return Effect.Failed(classifyError<E>(e, ctrl.signal), 1, null) as Failed<T, E>;
                }
            },
            Running: ({ pending }) => pending,
            Done:    (it) => Promise.resolve(it as Done<T, E>),
            Stale: async ({ thunk }) => {
                const ctrl = new AbortController();
                try {
                    return Effect.Done(await thunk()) as Done<T, E>;
                } catch (e) {
                    return Effect.Failed(classifyError<E>(e, ctrl.signal), 1, null) as Failed<T, E>;
                }
            },
            Failed: (it) => Promise.resolve(it as Failed<T, E>),
        });
    }

    map<U>(fn: (value: T) => U): Idle<U, E> {
        const self = this as unknown as Effect<T, E>;
        return Effect.Idle(async () => {
            const result = await self.run();
            if (getTag(result) === "Failed") throw (result as Failed<T, E>).fault;
            return fn((result as Done<T, E>).value);
        }) as Idle<U, E>;
    }

    flatMap<U>(fn: (value: T) => Effect<U, E>): Idle<U, E> {
        const self = this as unknown as Effect<T, E>;
        return Effect.Idle(async () => {
            const result = await self.run();
            if (getTag(result) === "Failed") throw (result as Failed<T, E>).fault;
            const next = fn((result as Done<T, E>).value);
            const nextResult = await next.run();
            if (getTag(nextResult) === "Failed") throw (nextResult as Failed<U, E>).fault;
            return (nextResult as Done<U, E>).value;
        }) as Idle<U, E>;
    }

    recover<F>(fn: (fault: Fault<E>) => Effect<T, F>): Idle<T, F> {
        const self = this as unknown as Effect<T, E>;
        return Effect.Idle(async () => {
            const result = await self.run();
            if (getTag(result) !== "Failed") return (result as Done<T, E>).value;
            const recovery = fn((result as Failed<T, E>).fault);
            const recoveryResult = await recovery.run();
            if (getTag(recoveryResult) === "Failed") throw (recoveryResult as Failed<T, F>).fault;
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
/** Settled with a fault — carries retry context when automatic retry is configured. */
export type Failed<T, E = never> = Variant<
    "Failed",
    { fault: Fault<E>; attempts: number; nextRetryAt: number | null },
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
    Failed:  <T, E = never>(fault: Fault<E>, attempts: number, nextRetryAt: number | null) =>
        ({ fault, attempts, nextRetryAt }) as Failed<T, E>,
});

// ---------------------------------------------------------------------------
// watchEffect — reactive effect runner
// ---------------------------------------------------------------------------

type WatchHandle = { stop(): void };

type WatchOptions<E = never> = AsyncOptions<E> & {
    /**
     * When `true`, re-runs the thunk automatically on every dep change;
     * `onChange` receives `Done` or `Failed`. When `false` (default),
     * `onChange` receives `Stale` and the caller decides when to re-run.
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
 * Failures are classified as `Fault.Fail` (user threw `Fault.Fail(e)`),
 * `Fault.Interrupted` (AbortSignal fired), or `Fault.Defect` (unexpected panic).
 * Only `Fault.Fail` is retried by default — override via `shouldRetry`.
 *
 * @example Lazy (default)
 * const src = Signal.create("hello");
 * const handle = watchEffect(
 *   async (signal) => fetchData(src.get()!, signal),
 *   (result) => match(result, {
 *     Done:   ({ value }) => console.log(value),
 *     Stale:  (s) => s.run(),
 *     Failed: ({ fault }) => match(fault, {
 *       Fail:        ({ error }) => console.error(error),
 *       Defect:      ({ thrown }) => console.error("panic:", thrown),
 *       Interrupted: () => {},
 *     }),
 *   }),
 * );
 *
 * @example Eager with retry
 * const handle = watchEffect(
 *   async (signal) => fetch("/api/data", { signal }).then(r => r.json()),
 *   (result) => match(result, {
 *     Done:   ({ value }) => setState(value),
 *     Failed: ({ fault, nextRetryAt }) => showBanner(fault, nextRetryAt),
 *     Stale:  () => {},
 *   }),
 *   { eager: true, schedule: Schedule.Exponential({ initialDelay: 100, maxDelay: 30_000 }) },
 * );
 */
export function watchEffect<T, E = never>(
    thunk: (signal: AbortSignal, scope: ScopeHandle) => Promise<T>,
    onChange: (result: Done<T, E> | Stale<T, E> | Failed<T, E>) => void,
    options: WatchOptions<E> = {},
): WatchHandle {
    const { eager = false, ...asyncOptions } = options;
    const computation: Computation = createOwner(getCurrentComputation());

    let lastResult: Done<T, E> | Failed<T, E> | null = null;
    let currentController: AbortController | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let attempts = 0;
    let currentScope: ScopeHandle | null = null;

    computation.cleanups.add(() => { void currentScope?.dispose(); });

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

    const handleFailure = (fault: Fault<E>): void => {
        const { schedule, maxRetries, shouldRetry, afterRetry } = asyncOptions;
        const retryCheck = shouldRetry ?? defaultShouldRetry;

        const retriable = schedule !== undefined && retryCheck(fault);

        if (!retriable) {
            lastResult = Effect.Failed<T, E>(fault, attempts, null);
            onChange(lastResult);
            return;
        }

        if (maxRetries !== undefined && attempts > maxRetries) {
            lastResult = Effect.Failed<T, E>(
                FaultUnion.Fail(ScheduleError.MaxRetriesExceeded(attempts, fault) as unknown as E),
                attempts,
                null,
            );
            onChange(lastResult);
            return;
        }

        const delay = computeDelay(schedule, attempts, fault);
        if (delay === null) {
            lastResult = Effect.Failed<T, E>(fault, attempts, null);
            onChange(lastResult);
            return;
        }

        const nextRetryAt = Date.now() + delay;
        afterRetry?.(attempts, fault, delay);

        lastResult = Effect.Failed<T, E>(fault, attempts, nextRetryAt);
        onChange(lastResult);

        retryTimer = setTimeout(() => { retryTimer = null; void rerun(); }, delay);
    };

    const runThunk = (signal: AbortSignal): Promise<T> => {
        if (currentScope !== null && getTag(currentScope.state) !== "Disposed") {
            void currentScope.dispose();
        }
        currentScope = Scope();
        const scope = currentScope;
        return runInScope(scope, () => trackIn(computation, () => thunk(signal, scope)));
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
            const promise = runThunk(signal);
            const value = asyncOptions.timeout !== undefined
                ? await withTimeout(promise, asyncOptions.timeout)
                : await promise;

            attempts = 0;
            lastResult = Effect.Done<T, E>(value);
            onChange(lastResult);
        } catch (e) {
            handleFailure(classifyError<E>(e, signal));
        }
    };

    computation.dirty = () => {
        if (lastResult === null) return;
        cancelRetryTimer();

        if (eager) {
            void rerun();
        } else {
            const lastValue = getTag(lastResult) === "Done"
                ? (lastResult as Done<T, E>).value
                : null;
            const staleThunk = () => {
                const ctrl = new AbortController();
                return runThunk(ctrl.signal);
            };
            onChange(Effect.Stale<T, E>(lastValue, staleThunk));
        }
    };

    (async () => {
        currentController = new AbortController();
        const { signal } = currentController;

        for (const source of [...computation.sources]) {
            source.unsubscribe(computation);
        }
        computation.sources.clear();

        try {
            const promise = runThunk(signal);
            const value = asyncOptions.timeout !== undefined
                ? await withTimeout(promise, asyncOptions.timeout)
                : await promise;

            lastResult = Effect.Done<T, E>(value);
        } catch (e) {
            const fault = classifyError<E>(e, signal);
            lastResult = Effect.Failed<T, E>(fault, 0, null);

            const { schedule, shouldRetry } = asyncOptions;
            const retryCheck = shouldRetry ?? defaultShouldRetry;
            if (schedule !== undefined && retryCheck(fault)) {
                const delay = computeDelay(schedule, 1, fault);
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
