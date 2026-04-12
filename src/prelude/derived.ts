import { union, Trait, type Variant } from "../union.ts";
import { match } from "../match.ts";
import {
    type Computation,
    getCurrentComputation,
    trackIn,
    createOwner,
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
            const hadValue = this.#state.hasValue();
            if (hadValue) {
                this.#state = DerivedState.Stale(this.#state.getValue() as T);
                // Propagate staleness to computations that depend on this derived
                for (const comp of [...this.#subscribers.keys()]) {
                    comp.dirty();
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
            comp.dirty();
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
