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

export abstract class SignalLifecycle<T> extends Trait<{ value: unknown }> {
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
// SignalProtocol<S, T> — describes how to read T out of a custom state union S
// ---------------------------------------------------------------------------

export type SignalProtocol<S, T> = {
    /**
     * Extract the readable value from a state variant.
     * Return `null` to indicate "no value available in this state."
     */
    extract: (state: S) => T | null;
    /**
     * Return `true` to stop notifying subscribers (equivalent to `Disposed`).
     * Defaults to `() => false` if omitted — all state transitions notify.
     */
    isTerminal?: (state: S) => boolean;
};

// ---------------------------------------------------------------------------
// Signal<T, S> — reactive mutable container
//
// S defaults to `never`, which selects the standard SignalState<T> lifecycle.
// Provide S (a custom union) and a SignalProtocol<S, T> to replace the
// lifecycle with any domain-specific state machine.
// ---------------------------------------------------------------------------

/**
 * A reactive, mutable value container.
 *
 * **Default form** — `Signal<T>`:
 * Reading via `get()` inside a reactive context automatically registers this
 * signal as a dependency. Writing via `set(value)` wraps the value in `Active`
 * and notifies all dependents. The lifecycle state (`Unset | Active | Disposed`)
 * is available via `.peekState()` (untracked) and `.state()` (tracked).
 *
 * **Custom state form** — `Signal<T, S>`:
 * Pass any union type `S` and a `SignalProtocol<S, T>` to `Signal.create()`.
 * `set()` now accepts a full `S` variant. `get()` extracts `T | null` via the
 * protocol's `extract` function. `state()` returns the full `S` state (tracked).
 *
 * `.state()` is a tracked read that returns the full state union (either
 * `SignalState<T>` or `S`). Use it inside reactive contexts when you need to
 * pattern-match on the state rather than just extract the value.
 *
 * @example Default signal
 * const count = Signal.create(0);
 * count.set(1);
 * match(count.peekState(), {
 *   Unset:    () => "no value yet",
 *   Active:   ({ value }) => `value is ${value}`,
 *   Disposed: () => "cleaned up",
 * });
 *
 * @example Custom state signal (domain-specific lifecycle)
 * const field = Signal.create(Validation.Unvalidated<string, string>(), {
 *   extract: (state) => match(state, {
 *     Unvalidated: () => null,
 *     Valid:       ({ value }) => value,
 *     Invalid:     () => null,
 *   }),
 * });
 * field.set(Validation.Valid("hello@example.com"));
 * field.get();    // "hello@example.com"
 * field.state();   // Valid { value: "hello@example.com" }  (tracked)
 */
export class Signal<T, S = never> {
    readonly #protocol: SignalProtocol<S, T> | null;
    #rawState: SignalState<T> | S;
    #disposed = false;
    readonly #subscribers = new Map<Computation, () => void>();
    readonly #valueSubscribers = new Set<(value: T | null) => void>();

    private constructor(
        initialState: SignalState<T> | S,
        protocol: SignalProtocol<S, T> | null = null,
    ) {
        this.#rawState = initialState;
        this.#protocol = protocol;
    }

    /** Create a signal with no initial value (state starts as `Unset`). */
    static create<T>(): Signal<T>;
    /** Create a signal with an initial value (state starts as `Active`). */
    static create<T>(initial: T): Signal<T>;
    /**
     * Create a signal whose state is a custom union `S`.
     * `set()` accepts full `S` variants. `get()` extracts `T | null` via
     * `protocol.extract`. `read()` returns the full `S` state (tracked).
     */
    static create<T, S>(initial: S, protocol: SignalProtocol<S, T>): Signal<T, S>;
    static create<T, S>(
        initialOrState?: T | S,
        protocol?: SignalProtocol<S, T>,
    ): Signal<T> | Signal<T, S> {
        const owner = getCurrentComputation();

        if (protocol !== undefined) {
            const sig = new Signal<T, S>(initialOrState as S, protocol);
            if (owner) owner.cleanups.add(() => sig.dispose());
            return sig;
        }

        const defaultState =
            initialOrState !== undefined
                ? SignalState.Active(initialOrState as T)
                : SignalState.Unset();
        const sig = new Signal<T>(defaultState, null);
        if (owner) owner.cleanups.add(() => sig.dispose());
        return sig as Signal<T>;
    }

    /**
     * The current state. Untracked — safe to read outside reactive contexts.
     * Pattern-match this with `match`.
     *
     * For tracked reads inside reactive contexts, use `state()` instead.
     */
    peekState(): [S] extends [never] ? SignalState<T> : S {
        return this.#rawState as [S] extends [never] ? SignalState<T> : S;
    }

    /**
     * Read the current value, extracting `T | null` from the current state.
     * Registers this signal as a dependency in the active tracking context.
     *
     * For the full state union (e.g. to access error payloads on `Invalid`),
     * use `read()` instead.
     */
    get(): T | null {
        const comp = getCurrentComputation();
        if (comp && !this.#subscribers.has(comp)) {
            this.#trackComputation(comp);
        }
        if (this.#protocol !== null) {
            return this.#protocol.extract(this.#rawState as S);
        }
        return (this.#rawState as SignalState<T>).get();
    }

    /**
     * Read the full state union and register this signal as a dependency.
     *
     * Unlike `get()` which extracts only `T | null`, `state()` returns the
     * complete state — use it when you need to pattern-match inside a reactive
     * context (e.g. to handle `Invalid` errors, `Unset`, etc.).
     *
     * @example
     * watchEffect(async () => {
     *   return match(field.state(), {
     *     Unvalidated: () => null,
     *     Valid:       ({ value }) => submit(value),
     *     Invalid:     ({ errors }) => displayErrors(errors),
     *   });
     * }, onChange);
     */
    state(): [S] extends [never] ? SignalState<T> : S {
        const comp = getCurrentComputation();
        if (comp && !this.#subscribers.has(comp)) {
            this.#trackComputation(comp);
        }
        return this.#rawState as [S] extends [never] ? SignalState<T> : S;
    }

    /**
     * Read the current value without registering a dependency.
     * Safe to call outside reactive contexts or when you deliberately
     * want to avoid triggering re-evaluation.
     */
    peek(): T | null {
        if (this.#protocol !== null) {
            return this.#protocol.extract(this.#rawState as S);
        }
        return (this.#rawState as SignalState<T>).get();
    }

    /**
     * Write a new state and notify all current dependents.
     *
     * - Default `Signal<T>`: accepts a plain `T` value, wrapped in `Active`.
     * - Custom `Signal<T, S>`: accepts a full `S` variant.
     *
     * No-op after disposal or after `isTerminal` returns `true` for the
     * most recently set state.
     */
    set(value: [S] extends [never] ? T : S): void {
        if (this.#protocol !== null) {
            if (this.#disposed) return;
            const newState = value as unknown as S;
            this.#rawState = newState;
            if (this.#protocol.isTerminal?.(newState)) {
                this.#disposed = true;
                this.#subscribers.clear();
                return;
            }
            const extracted = this.#protocol.extract(newState);
            for (const cb of this.#valueSubscribers) cb(extracted);
            for (const comp of [...this.#subscribers.keys()]) {
                scheduleNotification(comp);
            }
        } else {
            if (this.#disposed) return;
            this.#rawState = SignalState.Active(value as unknown as T);
            const extracted = value as unknown as T;
            for (const cb of this.#valueSubscribers) cb(extracted);
            for (const comp of [...this.#subscribers.keys()]) {
                scheduleNotification(comp);
            }
        }
    }

    /**
     * Register a synchronous callback that fires on every value change.
     * The callback receives the extracted `T | null` value (same as `get()`).
     * Returns an unsubscribe function.
     *
     * Unlike `get()`, this does not register a reactive dependency — it is a
     * raw push subscription intended for bridging signals into external systems
     * (e.g. `Ref.bind()`).
     */
    subscribe(callback: (value: T | null) => void): () => void {
        this.#valueSubscribers.add(callback);
        return () => this.#valueSubscribers.delete(callback);
    }

    /**
     * Dispose this signal and clear all subscribers.
     *
     * For default signals, transitions state to `Disposed`.
     * For custom-union signals, marks the signal as inert without mutating
     * the state union — subsequent `set()` calls are no-ops.
     */
    dispose(): void {
        this.#disposed = true;
        if (this.#protocol === null) {
            this.#rawState = SignalState.Disposed();
        }
        this.#subscribers.clear();
        // Notify value subscribers with null to signal disposal, then clear
        for (const cb of this.#valueSubscribers) cb(null);
        this.#valueSubscribers.clear();
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
