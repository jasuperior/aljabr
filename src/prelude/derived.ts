import { union, Trait, type Variant } from "../union.ts";
import { match } from "../match.ts";
import {
    type Computation,
    getCurrentComputation,
    trackIn,
    createOwner,
    scheduleNotification,
} from "./context.ts";

// ---------------------------------------------------------------------------
// DerivedState<T> — lifecycle union for computed values
// ---------------------------------------------------------------------------
//
// NOTE: Individual variant types are intentionally NOT re-exported from this
// module. The "Disposed" tag name is shared with SignalState — re-exporting
// both from prelude/index.ts would cause a collision. Users pattern-match on
// DerivedState<T> using match() without needing the individual type names.

abstract class DerivedLifecycle<T> extends Trait<{ value: unknown }>() {
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
 * const full = Derived.create({
 *   get: () => `${firstName.get()} ${lastName.get()}`,
 *   set: (v) => { const [f, l] = v.split(" "); firstName.set(f); lastName.set(l); },
 * });
 * full.set("grace hopper");
 */
export class Derived<T> {
    #fn: () => T;
    #setter: ((value: T) => void) | undefined;
    #state: DerivedState<T> = DerivedState.Uncomputed();
    #computation: Computation;
    readonly #subscribers = new Map<Computation, () => void>();

    private constructor(fn: () => T, setter?: (value: T) => void) {
        this.#fn = fn;
        this.#setter = setter;

        this.#computation = createOwner();
        this.#computation.dirty = () => {
            // Only propagate on the Computed → Stale transition.
            // If already Stale/Uncomputed/Disposed, dependents were already
            // notified and re-notifying would cause duplicate flush work.
            const wasComputed = match(this.#state, {
                Uncomputed: () => false,
                Computed:   () => true,
                Stale:      () => false,
                Disposed:   () => false,
            });
            if (wasComputed) {
                this.#state = DerivedState.Stale(this.#state.getValue() as T);
                for (const comp of [...this.#subscribers.keys()]) {
                    scheduleNotification(comp);
                }
            }
        };
    }

    /** Create a read-only derived value. */
    static create<T>(fn: () => T): Derived<T>;
    /** Create a derived value with a writable set-handler. */
    static create<T>(options: WritableDerivedOptions<T>): Derived<T>;
    static create<T>(
        fnOrOptions: (() => T) | WritableDerivedOptions<T>,
    ): Derived<T> {
        if (typeof fnOrOptions === "function") {
            return new Derived(fnOrOptions);
        }
        return new Derived(fnOrOptions.get, fnOrOptions.set);
    }

    /** The current lifecycle state. Pattern-match this with `match`. */
    get state(): DerivedState<T> {
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
     * Read the last known value without triggering re-evaluation or
     * registering a dependency. Returns null if never computed or disposed.
     */
    peek(): T | null {
        return this.#state.getValue();
    }

    /**
     * Write a value using the provided set-handler.
     * The handler is responsible for updating the upstream Signals that feed
     * into this derivation — the derived's own computation is not bypassed.
     *
     * @throws If this derived was created without a set-handler.
     */
    set(value: T): void {
        if (!this.#setter) {
            throw new Error(
                "Derived is read-only — provide a set handler via Derived.create({ get, set }) to make it writable.",
            );
        }
        this.#setter(value);
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
    }
}

// ---------------------------------------------------------------------------
// AsyncDerivedState<T, E> — lifecycle union for async computed values
// ---------------------------------------------------------------------------

abstract class AsyncDerivedLifecycle<T, E> extends Trait<{ value: unknown }>() {
    hasValue(): boolean {
        return match(this as unknown as AsyncDerivedState<T, E>, {
            Uncomputed: () => false,
            Loading:    () => false,
            Ready:      () => true,
            Reloading:  () => true,
            Failed:     () => false,
            Disposed:   () => false,
        });
    }

    getValue(): T | null {
        return match(this as unknown as AsyncDerivedState<T, E>, {
            Uncomputed: () => null,
            Loading:    () => null,
            Ready:      ({ value }) => value,
            Reloading:  ({ value }) => value,
            Failed:     () => null,
            Disposed:   () => null,
        });
    }

    getError(): E | null {
        return match(this as unknown as AsyncDerivedState<T, E>, {
            Uncomputed: () => null,
            Loading:    () => null,
            Ready:      () => null,
            Reloading:  () => null,
            Failed:     ({ error }) => error,
            Disposed:   () => null,
        });
    }
}

type AsyncUncomputed = Variant<"Uncomputed", { value: null }, AsyncDerivedLifecycle<never, never>>;
type AsyncLoading    = Variant<"Loading",    { value: null }, AsyncDerivedLifecycle<never, never>>;
type AsyncReady<T>   = Variant<"Ready",      { value: T   }, AsyncDerivedLifecycle<T, never>>;
/** Dependencies changed while a value exists — the stale value is preserved
 *  and a new computation is in flight. */
type AsyncReloading<T> = Variant<"Reloading", { value: T }, AsyncDerivedLifecycle<T, never>>;
type AsyncFailed<E>  = Variant<"Failed",     { value: null; error: E }, AsyncDerivedLifecycle<never, E>>;
type AsyncDisposed   = Variant<"Disposed",   { value: null }, AsyncDerivedLifecycle<never, never>>;

export type AsyncDerivedState<T, E = unknown> =
    | AsyncUncomputed
    | AsyncLoading
    | AsyncReady<T>
    | AsyncReloading<T>
    | AsyncFailed<E>
    | AsyncDisposed;

const AsyncDerivedState = union([AsyncDerivedLifecycle]).typed({
    Uncomputed: () => ({ value: null }) as AsyncUncomputed,
    Loading:    () => ({ value: null }) as AsyncLoading,
    Ready:      <T>(value: T) => ({ value }) as AsyncReady<T>,
    Reloading:  <T>(value: T) => ({ value }) as AsyncReloading<T>,
    Failed:     <E>(error: E) => ({ value: null, error }) as AsyncFailed<E>,
    Disposed:   () => ({ value: null }) as AsyncDisposed,
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
 * @example
 * const userId = Signal.create(1);
 * const profile = AsyncDerived.create(async () => {
 *   const id = userId.get()!;
 *   const res = await fetch(`/api/users/${id}`);
 *   return res.json();
 * });
 *
 * await profile.get(); // triggers fetch, returns Ready value
 * userId.set(2);
 * profile.state; // Reloading — stale value from user 1 still available
 * await profile.get(); // re-fetches for user 2, returns Ready value
 */
export class AsyncDerived<T, E = unknown> {
    #fn: () => Promise<T>;
    #state: AsyncDerivedState<T, E> = AsyncDerivedState.Uncomputed();
    #computation: Computation;
    readonly #subscribers = new Map<Computation, () => void>();

    private constructor(fn: () => Promise<T>) {
        this.#fn = fn;

        this.#computation = createOwner();
        this.#computation.dirty = () => {
            const transition = match(this.#state, {
                Uncomputed: () => null,
                Loading:    () => null,          // already in-flight, ignore
                Ready:      ({ value }) => value, // preserve stale value
                Reloading:  () => null,           // already reloading, ignore
                Failed:     () => null,
                Disposed:   () => null,
            });
            if (transition !== null) {
                this.#state = AsyncDerivedState.Reloading(transition as T);
                for (const comp of [...this.#subscribers.keys()]) {
                    scheduleNotification(comp);
                }
            }
        };
    }

    static create<T, E = unknown>(fn: () => Promise<T>): AsyncDerived<T, E> {
        return new AsyncDerived(fn);
    }

    /** The current lifecycle state. Pattern-match this with `match`. */
    get state(): AsyncDerivedState<T, E> {
        return this.#state;
    }

    /**
     * Read the current value, triggering evaluation if the state is
     * `Uncomputed`, `Reloading`, or `Failed`. Returns a Promise that
     * resolves to the value on success or rejects on failure.
     *
     * Registers this derived as a dependency in the active tracking context.
     */
    async get(): Promise<T> {
        const comp = getCurrentComputation();
        if (comp && !this.#subscribers.has(comp)) {
            this.#trackComputation(comp);
        }

        const needsEval = match(this.#state, {
            Uncomputed: () => true,
            Loading:    () => false,
            Ready:      () => false,
            Reloading:  () => true,
            Failed:     () => true,
            Disposed:   () => false,
        });

        if (needsEval) {
            await this.#evaluate();
        }

        return match(this.#state, {
            Uncomputed: () => { throw new Error("AsyncDerived evaluation produced no value"); },
            Loading:    () => { throw new Error("AsyncDerived evaluation produced no value"); },
            Ready:      ({ value }) => value,
            Reloading:  ({ value }) => value,
            Failed:     ({ error }) => { throw error; },
            Disposed:   () => { throw new Error("AsyncDerived is disposed"); },
        });
    }

    /**
     * Read the last known value synchronously without triggering re-evaluation
     * or registering a dependency. Returns null if never computed or disposed.
     */
    peek(): T | null {
        return this.#state.getValue();
    }

    /** Dispose this derived value and clear all subscriptions. */
    dispose(): void {
        this.#computation.dispose();
        this.#state = AsyncDerivedState.Disposed();
        for (const comp of [...this.#subscribers.keys()]) {
            scheduleNotification(comp);
        }
        this.#subscribers.clear();
    }

    /** @internal */
    unsubscribe(computation: Computation): void {
        this.#subscribers.delete(computation);
    }

    #trackComputation(comp: Computation): void {
        this.#subscribers.set(comp, () => this.#subscribers.delete(comp));
        comp.sources.add(this);
    }

    async #evaluate(): Promise<void> {
        const hadValue = this.#state.hasValue();
        this.#state = hadValue
            ? AsyncDerivedState.Reloading(this.#state.getValue() as T)
            : AsyncDerivedState.Loading();

        for (const source of [...this.#computation.sources]) {
            source.unsubscribe(this.#computation);
        }
        this.#computation.sources.clear();

        try {
            const value = await trackIn(this.#computation, this.#fn);
            this.#state = AsyncDerivedState.Ready(value);
        } catch (e) {
            this.#state = AsyncDerivedState.Failed(e as E);
        }
    }
}
