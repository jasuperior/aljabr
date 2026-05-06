import { union, Trait, type Variant, instanceOf } from "../union.ts";
import { match } from "../match.ts";
import {
    type Computation,
    getCurrentComputation,
    trackIn,
    createOwner,
    scheduleNotification,
} from "./context.ts";
import { type AsyncOptions, ScheduleError, computeDelay } from "./schedule.ts";
import { getTag } from "../union.ts";
import { type ScopeHandle, Scope, runInScope } from "./scope.ts";
import { type Fault, Fault as FaultUnion } from "./fault.ts";
import { Effect, type Done, type Failed } from "./effect.ts";

// ---------------------------------------------------------------------------
// DerivedState<T> — lifecycle union for computed values
// ---------------------------------------------------------------------------
//
// NOTE: Individual variant types are intentionally NOT re-exported from this
// module. The "Disposed" tag name is shared with SignalState — re-exporting
// both from prelude/index.ts would cause a collision. Users pattern-match on
// DerivedState<T> using match() without needing the individual type names.

abstract class DerivedLifecycle<T> extends Trait<{ value: unknown }> {
    hasValue(): boolean {
        return match(this as unknown as DerivedState<T>, {
            Uncomputed: () => false,
            Computed: () => true,
            Stale: () => true,
            Disposed: () => false,
        });
    }

    getValue(): T | null {
        return match(this as unknown as DerivedState<T>, {
            Uncomputed: () => null,
            Computed: ({ value }) => value,
            Stale: ({ value }) => value,
            Disposed: () => null,
        });
    }
}

type DerivedUncomputed = Variant<
    "Uncomputed",
    { value: null },
    DerivedLifecycle<never>
>;
type DerivedComputed<T> = Variant<
    "Computed",
    { value: T },
    DerivedLifecycle<T>
>;
type DerivedStale<T> = Variant<"Stale", { value: T }, DerivedLifecycle<T>>;
type DerivedDisposed = Variant<
    "Disposed",
    { value: null },
    DerivedLifecycle<never>
>;

export type DerivedState<T> =
    | DerivedUncomputed
    | DerivedComputed<T>
    | DerivedStale<T>
    | DerivedDisposed;

const DerivedState = union([DerivedLifecycle]).typed({
    Uncomputed: () => ({ value: null }) as DerivedUncomputed,
    Computed: <T>(value: T) => ({ value }) as DerivedComputed<T>,
    Stale: <T>(value: T) => ({ value }) as DerivedStale<T>,
    Disposed: () => ({ value: null }) as DerivedDisposed,
});

// ---------------------------------------------------------------------------
// Derived<T> — lazy computed reactive value
// ---------------------------------------------------------------------------

type WritableDerivedOptions<T> = {
    get: () => T;
    /** Update the upstream Signal(s) that feed into this derivation. */
    set: (value: T) => void;
};

/**
 * A lazy computed value derived from one or more `Signal`s.
 *
 * `Derived` re-evaluates only when read after its dependencies have changed
 * (pull-based, like `createMemo` in Solid.js). The last known value is
 * preserved in the `Stale` state so callers can render stale-while-revalidating.
 *
 * By default a `Derived` is read-only. Pass a `set` handler to make it
 * writable — the handler must update the upstream `Signal`s that produce
 * this value; it does not override the derived's own computation.
 *
 * @example
 * const name = Signal.create("ada");
 * const upper = Derived.create(() => name.get()!.toUpperCase());
 * upper.get(); // "ADA"
 * name.set("grace");
 * upper.get(); // "GRACE" — re-evaluated lazily
 *
 * @example Writable derived
 * const firstName = Signal.create("ada");
 * const lastName  = Signal.create("lovelace");
 * const full = Derived.writable({
 *   get: () => `${firstName.get()} ${lastName.get()}`,
 *   set: (v) => { const [f, l] = v.split(" "); firstName.set(f); lastName.set(l); },
 * });
 * full.set("grace hopper");
 */
export class Derived<T> {
    #fn: () => T;
    /** @internal — accessed by WritableDerived subclass for set-handler dispatch. */
    protected _setter: ((value: T) => void) | undefined;
    #state: DerivedState<T> = DerivedState.Uncomputed();
    #computation: Computation;
    readonly #subscribers = new Map<Computation, () => void>();
    readonly #valueSubscribers = new Set<(value: T | null) => void>();

    protected constructor(fn: () => T, setter?: (value: T) => void) {
        this.#fn = fn;
        this._setter = setter;

        this.#computation = createOwner();
        this.#computation.dirty = () => {
            // Only propagate on the Computed → Stale transition.
            // If already Stale/Uncomputed/Disposed, dependents were already
            // notified and re-notifying would cause duplicate flush work.
            const wasComputed = match(this.#state, {
                Uncomputed: () => false,
                Computed: () => true,
                Stale: () => false,
                Disposed: () => false,
            });
            if (wasComputed) {
                this.#state = DerivedState.Stale(this.#state.getValue() as T);
                for (const comp of [...this.#subscribers.keys()]) {
                    scheduleNotification(comp);
                }
                // Push subscribers force eager re-evaluation so callbacks
                // fire without an external pull.
                if (this.#valueSubscribers.size > 0) {
                    this.#evaluate();
                }
            }
        };
    }

    /** Create a read-only derived value. */
    static create<T>(fn: () => T): Derived<T> {
        return new Derived(fn);
    }

    /**
     * Create a writable derived value. Returns `WritableDerived<T>`, which
     * extends `Derived<T>` and adds `.set(value)`. A variable typed
     * `Derived<T>` accepts either factory's return; only `WritableDerived<T>`
     * exposes the setter — calling `.set()` on a read-only `Derived<T>` is a
     * compile-time error.
     */
    static writable<T>(options: WritableDerivedOptions<T>): WritableDerived<T> {
        return new WritableDerived(options.get, options.set);
    }

    /**
     * Read the current lifecycle state and register this derived as a
     * dependency in the active tracking context.
     */
    state(): DerivedState<T> {
        const comp = getCurrentComputation();
        if (comp && !this.#subscribers.has(comp)) {
            this.#trackComputation(comp);
        }
        return this.#state;
    }

    /**
     * Read the current lifecycle state without registering a dependency.
     * Pattern-match this with `match`.
     */
    peekState(): DerivedState<T> {
        return this.#state;
    }

    /**
     * Read the current derived value, re-evaluating lazily if stale or
     * uncomputed. Registers this derived as a dependency in the currently
     * active tracking context, if any.
     */
    get(): T | null {
        const comp = getCurrentComputation();
        if (comp && !this.#subscribers.has(comp)) {
            this.#trackComputation(comp);
        }

        const needsEval = match(this.#state, {
            Uncomputed: () => true,
            Computed: () => false,
            Stale: () => true,
            Disposed: () => false,
        });

        if (needsEval) {
            this.#evaluate();
        }

        return this.#state.getValue();
    }

    /**
     * Read the current value with a fallback default. Tracked.
     * Returns `defaultValue` when the extracted value is `null`.
     */
    getOr(defaultValue: T): T {
        const value = this.get();
        return value === null ? defaultValue : value;
    }

    /**
     * Read the last known value without triggering re-evaluation or
     * registering a dependency. Returns null if never computed or disposed.
     */
    peek(): T | null {
        return this.#state.getValue();
    }


    /**
     * Register a synchronous callback that fires every time this derived
     * computes a new value. The callback receives the extracted `T | null`
     * (same as `get()`/`peek()`).
     *
     * Push subscriptions trigger evaluation eagerly when a dependency changes
     * — unlike `get()`, which is lazy. Use this when you need to observe
     * values from outside the reactive graph (e.g. bridging to RxJS, devtools).
     * Prefer `watch` for in-graph reactive coordination.
     *
     * Returns an unsubscribe function. Subscribers also receive `null` when
     * this derived disposes, then are cleared.
     */
    subscribe(callback: (value: T | null) => void): () => void {
        // Evaluate first (without firing the new callback) so source
        // subscriptions are established — otherwise dirty() would never
        // fire and the callback would never be invoked. Existing subscribers
        // (if any) are notified by the eval, but the new callback is added
        // afterward so it only sees future change notifications.
        const isUncomputed = match(this.#state, {
            Uncomputed: () => true,
            Computed: () => false,
            Stale: () => false,
            Disposed: () => false,
        });
        if (isUncomputed) this.#evaluate();
        this.#valueSubscribers.add(callback);
        return () => this.#valueSubscribers.delete(callback);
    }

    /**
     * Dispose this derived value. Clears all subscriptions and transitions
     * to the `Disposed` state. Downstream computations that depend on this
     * derived will be notified as stale.
     */
    dispose(): void {
        this.#computation.dispose();
        this.#state = DerivedState.Disposed();
        for (const comp of [...this.#subscribers.keys()]) {
            scheduleNotification(comp);
        }
        this.#subscribers.clear();
        for (const cb of this.#valueSubscribers) cb(null);
        this.#valueSubscribers.clear();
    }

    /** TC39 explicit resource management — equivalent to `dispose()`. */
    [Symbol.dispose](): void {
        this.dispose();
    }

    /** @internal Remove a computation from this derived's subscriber set. */
    unsubscribe(computation: Computation): void {
        this.#subscribers.delete(computation);
    }

    #trackComputation(comp: Computation): void {
        this.#subscribers.set(comp, () => this.#subscribers.delete(comp));
        comp.sources.add(this);
    }

    #evaluate(): void {
        // Clear stale dependency subscriptions before re-tracking
        for (const source of [...this.#computation.sources]) {
            source.unsubscribe(this.#computation);
        }
        this.#computation.sources.clear();

        const value = trackIn(this.#computation, this.#fn);
        this.#state = DerivedState.Computed(value);
        for (const cb of this.#valueSubscribers) cb(value);
    }
}

/**
 * A writable derived value: extends `Derived<T>` with a `.set(value)` method
 * that delegates to the set-handler provided at construction.
 *
 * Created via `Derived.writable({ get, set })`. The handler is responsible for
 * updating the upstream signals that feed into this derivation — the derived's
 * own computation is not bypassed.
 *
 * A variable typed `Derived<T>` accepts either form; `.set()` is only callable
 * when the static type is `WritableDerived<T>`. This is enforced at compile
 * time, replacing the runtime "Derived is read-only" throw.
 */
export class WritableDerived<T> extends Derived<T> {
    /** @internal — allow Derived.writable to invoke the protected constructor. */
    constructor(fn: () => T, setter: (value: T) => void) {
        super(fn, setter);
    }

    /**
     * Write a value using the provided set-handler.
     * The handler is responsible for updating the upstream Signals that feed
     * into this derivation — the derived's own computation is not bypassed.
     */
    set(value: T): void {
        this._setter!(value);
    }
}

// ---------------------------------------------------------------------------
// AsyncDerivedState<T, E> — lifecycle union for async computed values
// ---------------------------------------------------------------------------

abstract class AsyncDerivedLifecycle<T, E> extends Trait<{ value: unknown }> {
    hasValue(): boolean {
        return match(this as unknown as AsyncDerivedState<T, E>, {
            Uncomputed: () => false,
            Loading: () => false,
            Ready: () => true,
            Reloading: () => true,
            Failed: () => false,
            Disposed: () => false,
        });
    }

    getValue(): T | null {
        return match(this as unknown as AsyncDerivedState<T, E>, {
            Uncomputed: () => null,
            Loading: () => null,
            Ready: ({ value }) => value,
            Reloading: ({ value }) => value,
            Failed: () => null,
            Disposed: () => null,
        });
    }

    getFault(): Fault<E> | null {
        return match(this as unknown as AsyncDerivedState<T, E>, {
            Uncomputed: () => null,
            Loading: () => null,
            Ready: () => null,
            Reloading: () => null,
            Failed: ({ fault }) => fault,
            Disposed: () => null,
        });
    }
}

type AsyncUncomputed = Variant<
    "Uncomputed",
    { value: null },
    AsyncDerivedLifecycle<never, never>
>;
type AsyncLoading = Variant<
    "Loading",
    { value: null },
    AsyncDerivedLifecycle<never, never>
>;
type AsyncReady<T> = Variant<
    "Ready",
    { value: T },
    AsyncDerivedLifecycle<T, never>
>;
/** Dependencies changed while a value exists — the stale value is preserved
 *  and a new computation is in flight. */
type AsyncReloading<T> = Variant<
    "Reloading",
    { value: T },
    AsyncDerivedLifecycle<T, never>
>;
type AsyncFailed<E> = Variant<
    "Failed",
    {
        value: null;
        fault: Fault<E>;
        attempts: number;
        nextRetryAt: number | null;
    },
    AsyncDerivedLifecycle<never, E>
>;
type AsyncDisposed = Variant<
    "Disposed",
    { value: null },
    AsyncDerivedLifecycle<never, never>
>;

export type AsyncDerivedState<T, E = unknown> =
    | AsyncUncomputed
    | AsyncLoading
    | AsyncReady<T>
    | AsyncReloading<T>
    | AsyncFailed<E>
    | AsyncDisposed;

const AsyncDerivedState = union([AsyncDerivedLifecycle]).typed({
    Uncomputed: () => ({ value: null }) as AsyncUncomputed,
    Loading: () => ({ value: null }) as AsyncLoading,
    Ready: <T>(value: T) => ({ value }) as AsyncReady<T>,
    Reloading: <T>(value: T) => ({ value }) as AsyncReloading<T>,
    Failed: <E>(
        fault: Fault<E>,
        attempts: number,
        nextRetryAt: number | null,
    ) => ({ value: null, fault, attempts, nextRetryAt }) as AsyncFailed<E>,
    Disposed: () => ({ value: null }) as AsyncDisposed,
});

// ---------------------------------------------------------------------------
// AsyncDerived<T, E> — lazy async computed reactive value
// ---------------------------------------------------------------------------

/**
 * A lazy async computed value derived from one or more `Signal`s.
 *
 * Like `Derived`, re-evaluation is pull-based — it only runs when read after
 * its dependencies change. Because the computation is async, the state
 * machine includes `Loading` (first run, no prior value) and `Reloading`
 * (re-run after a dep change, stale value preserved for display).
 *
 * When `AsyncOptions` are provided, failed computations are automatically
 * retried according to the schedule. The thunk receives an `AbortSignal`
 * that is aborted before each new attempt, enabling clean cancellation of
 * in-flight network requests.
 *
 * @example Basic usage
 * const userId = Signal.create(1);
 * const profile = AsyncDerived.create(async (signal) => {
 *   const res = await fetch(`/api/users/${userId.get()!}`, { signal });
 *   return res.json();
 * });
 *
 * @example With retry
 * const data = AsyncDerived.create(
 *   async (signal) => fetchData(signal),
 *   { schedule: Schedule.exponential({ initialDelay: 100, maxDelay: 30_000 }), maxRetries: 5 },
 * );
 */
export class AsyncDerived<T, E = unknown> {
    #fn: (signal: AbortSignal, scope: ScopeHandle) => Promise<T>;
    #options: AsyncOptions<E>;
    #state: AsyncDerivedState<T, E> = AsyncDerivedState.Uncomputed();
    #computation: Computation;
    #attempts = 0;
    #currentController: AbortController | null = null;
    #currentScope: ScopeHandle | null = null;
    #retryTimer: ReturnType<typeof setTimeout> | null = null;
    readonly #subscribers = new Map<Computation, () => void>();
    readonly #valueSubscribers = new Set<(value: T | null) => void>();

    private constructor(
        fn: (signal: AbortSignal, scope: ScopeHandle) => Promise<T>,
        options: AsyncOptions<E> = {},
    ) {
        this.#fn = fn;
        this.#options = options;

        this.#computation = createOwner();
        this.#computation.dirty = () => {
            const transition = match(this.#state, {
                Uncomputed: () => null,
                Loading: () => null, // already in-flight, ignore
                Ready: ({ value }) => value, // preserve stale value
                Reloading: () => null, // already reloading, ignore
                Failed: () => null,
                Disposed: () => null,
            });
            if (transition !== null) {
                // Cancel any pending retry timer — dep change supersedes it.
                this.#cancelRetryTimer();
                this.#state = AsyncDerivedState.Reloading(transition as T);
                this.#notifySubscribers();
            }
        };
    }

    static create<T, E = unknown>(
        fn: (signal: AbortSignal, scope: ScopeHandle) => Promise<T>,
        options?: AsyncOptions<E>,
    ): AsyncDerived<T, E> {
        return new AsyncDerived(fn, options);
    }

    /**
     * Read the current lifecycle state and register this derived as a
     * dependency in the active tracking context.
     */
    state(): AsyncDerivedState<T, E> {
        const comp = getCurrentComputation();
        if (comp && !this.#subscribers.has(comp)) {
            this.#trackComputation(comp);
        }
        return this.#state;
    }

    /**
     * Read the current lifecycle state without registering a dependency.
     * Pattern-match this with `match`.
     */
    peekState(): AsyncDerivedState<T, E> {
        return this.#state;
    }

    /**
     * Read the last-known extracted value synchronously and register this
     * derived as a dependency in the active tracking context.
     *
     * Does NOT trigger evaluation. Returns `null` until the first successful
     * evaluation completes via `run()`. After Ready/Reloading transitions
     * the value is preserved and surfaced here.
     */
    get(): T | null {
        const comp = getCurrentComputation();
        if (comp && !this.#subscribers.has(comp)) {
            this.#trackComputation(comp);
        }
        return this.#state.getValue();
    }

    /**
     * Read the current value with a fallback default. Tracked.
     * Returns `defaultValue` when no value is available yet.
     */
    getOr(defaultValue: T): T {
        const value = this.get();
        return value === null ? defaultValue : value;
    }

    /**
     * Trigger evaluation if needed and resolve to the settled state
     * (`Done<T, E>` on success, `Failed<T, E>` on failure). Mirrors
     * `Effect.run()` so callers pattern-match with the same vocabulary.
     *
     * Registers this derived as a dependency in the active tracking context.
     */
    async run(): Promise<Done<T, E> | Failed<T, E>> {
        const comp = getCurrentComputation();
        if (comp && !this.#subscribers.has(comp)) {
            this.#trackComputation(comp);
        }

        const needsEval = match(this.#state, {
            Uncomputed: () => true,
            Loading: () => false,
            Ready: () => false,
            Reloading: () => true,
            Failed: () => true,
            Disposed: () => false,
        });

        if (needsEval) {
            await this.#evaluate();
        }

        return match(this.#state, {
            Uncomputed: () =>
                Effect.Failed<T, E>(
                    FaultUnion.Defect(
                        new Error("AsyncDerived evaluation produced no value"),
                    ),
                    0,
                    null,
                ) as Failed<T, E>,
            Loading: () =>
                Effect.Failed<T, E>(
                    FaultUnion.Defect(
                        new Error("AsyncDerived evaluation produced no value"),
                    ),
                    0,
                    null,
                ) as Failed<T, E>,
            Ready: ({ value }) => Effect.Done<T, E>(value) as Done<T, E>,
            Reloading: ({ value }) => Effect.Done<T, E>(value) as Done<T, E>,
            Failed: ({ fault, attempts, nextRetryAt }) =>
                Effect.Failed<T, E>(fault, attempts, nextRetryAt) as Failed<T, E>,
            Disposed: () =>
                Effect.Failed<T, E>(
                    FaultUnion.Defect(new Error("AsyncDerived is disposed")),
                    0,
                    null,
                ) as Failed<T, E>,
        });
    }

    /**
     * Run the derivation and return the resolved value, or `defaultValue` if
     * evaluation fails. Mirrors `Effect.runOr` and the `getOr` family.
     */
    async runOr(defaultValue: T): Promise<T> {
        const result = await this.run();
        if (getTag(result) === "Failed") return defaultValue;
        return (result as Done<T, E>).value;
    }

    /**
     * Read the last known value synchronously without triggering re-evaluation
     * or registering a dependency. Returns null if never computed or disposed.
     */
    peek(): T | null {
        return this.#state.getValue();
    }

    /**
     * Register a synchronous callback that fires every time this derived
     * settles (`Ready` or `Failed`). The callback receives the extracted
     * `T | null` (the value on `Ready`/`Reloading`, otherwise `null`).
     *
     * Push subscriptions trigger evaluation eagerly on dependency change.
     * Use this when bridging to external systems; prefer `watch` for
     * declarative reactive coordination.
     */
    subscribe(callback: (value: T | null) => void): () => void {
        this.#valueSubscribers.add(callback);
        return () => this.#valueSubscribers.delete(callback);
    }

    /** Dispose this derived value and clear all subscriptions. */
    dispose(): void {
        this.#cancelRetryTimer();
        this.#currentController?.abort();
        void this.#currentScope?.dispose();
        this.#computation.dispose();
        this.#state = AsyncDerivedState.Disposed();
        this.#notifySubscribers();
        this.#subscribers.clear();
        for (const cb of this.#valueSubscribers) cb(null);
        this.#valueSubscribers.clear();
    }

    /** TC39 explicit resource management — equivalent to `dispose()`. */
    [Symbol.dispose](): void {
        this.dispose();
    }

    /** @internal */
    unsubscribe(computation: Computation): void {
        this.#subscribers.delete(computation);
    }

    #trackComputation(comp: Computation): void {
        this.#subscribers.set(comp, () => this.#subscribers.delete(comp));
        comp.sources.add(this);
    }

    #notifySubscribers(): void {
        for (const comp of [...this.#subscribers.keys()]) {
            scheduleNotification(comp);
        }
        const value = this.#state.getValue();
        for (const cb of this.#valueSubscribers) cb(value);
    }

    #cancelRetryTimer(): void {
        if (this.#retryTimer !== null) {
            clearTimeout(this.#retryTimer);
            this.#retryTimer = null;
        }
    }

    async #evaluate(): Promise<void> {
        // Abort any previous in-flight request before starting a new one.
        this.#currentController?.abort();
        this.#currentController = new AbortController();
        const { signal } = this.#currentController;

        const hadValue = this.#state.hasValue();
        this.#state = hadValue
            ? AsyncDerivedState.Reloading(this.#state.getValue() as T)
            : AsyncDerivedState.Loading();

        for (const source of [...this.#computation.sources]) {
            source.unsubscribe(this.#computation);
        }
        this.#computation.sources.clear();

        try {
            if (
                this.#currentScope !== null &&
                getTag(this.#currentScope.state) !== "Disposed"
            ) {
                void this.#currentScope.dispose();
            }
            this.#currentScope = Scope.create();
            const scope = this.#currentScope;
            const promise = runInScope(scope, () =>
                trackIn(this.#computation, () => this.#fn(signal, scope)),
            );
            const value =
                this.#options.timeout !== undefined
                    ? await this.#withTimeout(promise, this.#options.timeout)
                    : await promise;

            this.#attempts = 0;
            this.#state = AsyncDerivedState.Ready(value);
        } catch (e) {
            const fault = instanceOf(FaultUnion.Fail, e)
                ? (e as Fault<E>)
                : signal.aborted
                  ? FaultUnion.Interrupted(signal.reason)
                  : FaultUnion.Defect(e);
            await this.#handleFailure(fault);
        }
    }

    async #withTimeout(promise: Promise<T>, timeoutMs: number): Promise<T> {
        return new Promise<T>((resolve, reject) => {
            const start = Date.now();
            const timer = setTimeout(() => {
                this.#currentController?.abort();
                reject(ScheduleError.TimedOut(Date.now() - start, timeoutMs));
            }, timeoutMs);

            promise.then(
                (value) => {
                    clearTimeout(timer);
                    resolve(value);
                },
                (error) => {
                    clearTimeout(timer);
                    reject(error);
                },
            );
        });
    }

    async #handleFailure(fault: Fault<E>): Promise<void> {
        this.#attempts++;
        const attempts = this.#attempts;
        const { schedule, maxRetries, shouldRetry, afterRetry } = this.#options;
        const retryCheck =
            shouldRetry ?? ((f: Fault<E>) => getTag(f) === "Fail");

        const retriable = schedule !== undefined && retryCheck(fault);

        if (!retriable) {
            this.#state = AsyncDerivedState.Failed(fault, attempts, null);
            this.#notifySubscribers();
            return;
        }

        if (maxRetries !== undefined && attempts > maxRetries) {
            this.#state = AsyncDerivedState.Failed(
                FaultUnion.Fail(
                    ScheduleError.MaxRetriesExceeded(
                        attempts,
                        fault,
                    ) as unknown as E,
                ),
                attempts,
                null,
            );
            this.#notifySubscribers();
            return;
        }

        const delay = computeDelay(schedule, attempts, fault);
        if (delay === null) {
            this.#state = AsyncDerivedState.Failed(fault, attempts, null);
            this.#notifySubscribers();
            return;
        }

        const nextRetryAt = Date.now() + delay;
        afterRetry?.(attempts, fault, delay);

        this.#state = AsyncDerivedState.Failed(fault, attempts, nextRetryAt);
        this.#notifySubscribers();

        this.#retryTimer = setTimeout(() => {
            this.#retryTimer = null;
            void this.#evaluate();
        }, delay);
    }
}
