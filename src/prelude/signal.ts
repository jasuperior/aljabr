import { union, Trait, type Variant } from "../union.ts";
import { match } from "../match.ts";
import {
    type Computation,
    getCurrentComputation,
    scheduleNotification,
} from "./context.ts";

// ---------------------------------------------------------------------------
// SignalState<T> — immutable lifecycle union (the former Signal<T>)
// ---------------------------------------------------------------------------

export abstract class SignalLifecycle<T> extends Trait<{ value: unknown }>() {
    isActive(): boolean {
        return match(this as unknown as SignalState<T>, {
            Unset: () => false,
            Active: () => true,
            Disposed: () => false,
        });
    }

    get(): T | null {
        return match(this as unknown as SignalState<T>, {
            Unset: () => null,
            Active: ({ value }) => value,
            Disposed: () => null,
        });
    }
}

export type Unset = Variant<"Unset", { value: null }, SignalLifecycle<never>>;
export type Active<T> = Variant<"Active", { value: T }, SignalLifecycle<T>>;
export type Disposed = Variant<"Disposed", { value: null }, SignalLifecycle<never>>;
export type SignalState<T> = Unset | Active<T> | Disposed;

export const SignalState = union([SignalLifecycle]).typed({
    Unset: () => ({ value: null }) as Unset,
    Active: <T>(value: T) => ({ value }) as Active<T>,
    Disposed: () => ({ value: null }) as Disposed,
});

// ---------------------------------------------------------------------------
// Signal<T> — reactive mutable container
// ---------------------------------------------------------------------------

/**
 * A reactive, mutable value container.
 *
 * Reading via `get()` inside a reactive context (a `Derived` computation or
 * a `watchEffect` callback) automatically registers this signal as a
 * dependency. Writing via `set()` notifies all current dependents.
 *
 * The current lifecycle state is available as `signal.state` and is fully
 * pattern-matchable via `match`.
 *
 * @example
 * const count = Signal.create(0);
 * count.set(1);
 * match(count.state, {
 *   Unset:    () => "no value yet",
 *   Active:   ({ value }) => `value is ${value}`,
 *   Disposed: () => "cleaned up",
 * });
 */
export class Signal<T> {
    #state: SignalState<T>;
    readonly #subscribers = new Map<Computation, () => void>();

    private constructor(initial?: T) {
        this.#state =
            initial !== undefined
                ? SignalState.Active(initial)
                : SignalState.Unset();
    }

    /** Create a signal with no initial value (state starts as `Unset`). */
    static create<T>(): Signal<T>;
    /** Create a signal with an initial value (state starts as `Active`). */
    static create<T>(initial: T): Signal<T>;
    static create<T>(initial?: T): Signal<T> {
        const sig = new Signal<T>(initial as T);
        const owner = getCurrentComputation();
        if (owner) owner.cleanups.add(() => sig.dispose());
        return sig;
    }

    /** The current lifecycle state. Pattern-match this with `match`. */
    get state(): SignalState<T> {
        return this.#state;
    }

    /**
     * Read the current value. Registers this signal as a dependency in
     * the currently active tracking context, if any.
     */
    get(): T | null {
        const comp = getCurrentComputation();
        if (comp && !this.#subscribers.has(comp)) {
            this.#trackComputation(comp);
        }
        return this.#state.get();
    }

    /**
     * Read the current value without registering a dependency.
     * Safe to call outside reactive contexts or when you deliberately
     * want to avoid triggering re-evaluation.
     */
    peek(): T | null {
        return this.#state.get();
    }

    /**
     * Write a new value and notify all current dependents.
     * No-op if the signal has been disposed.
     */
    set(value: T): void {
        const disposed = match(this.#state, {
            Unset: () => false,
            Active: () => false,
            Disposed: () => true,
        });
        if (disposed) return;

        this.#state = SignalState.Active(value);

        for (const comp of [...this.#subscribers.keys()]) {
            scheduleNotification(comp);
        }
    }

    /**
     * Transition to `Disposed` and clear all subscribers.
     * After disposal, `set()` is a no-op and `get()` returns null.
     */
    dispose(): void {
        this.#state = SignalState.Disposed();
        this.#subscribers.clear();
    }

    /** @internal Remove a computation from this signal's subscriber set. */
    unsubscribe(computation: Computation): void {
        this.#subscribers.delete(computation);
    }

    #trackComputation(comp: Computation): void {
        this.#subscribers.set(comp, () => this.#subscribers.delete(comp));
        comp.sources.add(this);
    }
}
