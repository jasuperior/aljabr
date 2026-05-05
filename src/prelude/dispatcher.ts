import { getTag } from "../union.ts";
import {
    type Computation,
    getCurrentComputation,
    scheduleNotification,
} from "./context.ts";
import { Validation } from "./validation.ts";
import { CommandError } from "./command-error.ts";

/**
 * The result of a successful `apply()` call: the next state plus an inverse
 * command suitable for undoing the transition.
 */
export type ApplyResult<S, Cmd> = {
    next: S;
    inverse: Cmd;
};

/**
 * Protocol describing how to read `T` out of a custom state union `S`, how to
 * apply a command to `S` to produce a new `S`, and which states are terminal.
 *
 * The `apply` slot is the heart of the dispatcher: it returns
 * `Validation<ApplyResult<S, Cmd>, CommandError>` so the protocol can either
 * commit a state transition (with its inverse) or reject with a structured
 * error list.
 */
export type CommandProtocol<S, T, Cmd> = {
    /**
     * Extract the readable value from a state variant.
     * Return `null` to indicate "no value available in this state."
     */
    extract: (state: S) => T | null;
    /**
     * Apply a command to the current state. Return `Valid({ next, inverse })`
     * to commit the transition, or `Invalid(errors)` to reject.
     */
    apply: (
        current: S,
        command: Cmd,
    ) => Validation<ApplyResult<S, Cmd>, CommandError>;
    /**
     * Return `true` to stop notifying subscribers (equivalent to a disposed
     * dispatcher). Defaults to `() => false` if omitted.
     */
    isTerminal?: (state: S) => boolean;
};

/**
 * A reactive container whose writes route through a typed `apply` function
 * returning `Validation<ApplyResult, CommandError>`.
 *
 * `Dispatcher` is the foundation for prose's document state and any other
 * domain that wants validated transactional updates: form validation, wizards,
 * state machines with rejectable transitions, anywhere a write must be
 * a discrete, named, validatable operation rather than a state replacement.
 *
 * The state union `S` is author-supplied; the command union `Cmd` is too.
 * The library does not ship a base `Command` namespace — authors define their
 * commands with `union(...)` and pair them with their own `CommandProtocol`.
 *
 * @example
 * const Counter = union({
 *     Increment: () => ({}),
 *     Decrement: () => ({}),
 *     Set: (n: number) => ({ n }),
 * });
 * type Counter = Union<typeof Counter>;
 *
 * const counter = Dispatcher.create(0, {
 *     extract: (n) => n,
 *     apply: (current, cmd) =>
 *         match(cmd, {
 *             Increment: () => Validation.Valid({ next: current + 1, inverse: Counter.Decrement() }),
 *             Decrement: () => Validation.Valid({ next: current - 1, inverse: Counter.Increment() }),
 *             Set: ({ n }) => Validation.Valid({ next: n, inverse: Counter.Set(current) }),
 *         }),
 * });
 *
 * counter.dispatch(Counter.Increment());
 * counter.get(); // 1
 */
export class Dispatcher<T, S, Cmd> {
    readonly #protocol: CommandProtocol<S, T, Cmd>;
    #state: S;
    #disposed = false;
    readonly #subscribers = new Map<Computation, () => void>();
    readonly #valueSubscribers = new Set<(value: T | null) => void>();

    private constructor(initial: S, protocol: CommandProtocol<S, T, Cmd>) {
        this.#state = initial;
        this.#protocol = protocol;
    }

    /**
     * Create a Dispatcher with an initial state and a protocol describing how
     * to read, apply, and (optionally) terminate.
     */
    static create<T, S, Cmd>(
        initial: S,
        protocol: CommandProtocol<S, T, Cmd>,
    ): Dispatcher<T, S, Cmd> {
        const owner = getCurrentComputation();
        const d = new Dispatcher<T, S, Cmd>(initial, protocol);
        if (owner) owner.cleanups.add(() => d.dispose());
        return d;
    }

    /**
     * Dispatch a command. Returns the `Validation` produced by `protocol.apply`.
     * On `Valid`, internal state is updated and dependents are notified.
     * On `Invalid`, state is unchanged and no notification fires.
     *
     * Throws if the dispatcher has been disposed.
     */
    dispatch(
        command: Cmd,
    ): Validation<ApplyResult<S, Cmd>, CommandError> {
        if (this.#disposed) {
            throw new Error("Dispatcher: cannot dispatch on a disposed instance");
        }
        const result = this.#protocol.apply(this.#state, command);
        if (getTag(result) === "Valid") {
            const { next } = (result as Validation<ApplyResult<S, Cmd>, CommandError> & {
                value: ApplyResult<S, Cmd>;
            }).value;
            this.#state = next;
            if (this.#protocol.isTerminal?.(next)) {
                this.#disposed = true;
                this.#subscribers.clear();
                for (const cb of this.#valueSubscribers) cb(null);
                this.#valueSubscribers.clear();
                return result;
            }
            const extracted = this.#protocol.extract(next);
            for (const cb of this.#valueSubscribers) cb(extracted);
            for (const comp of [...this.#subscribers.keys()]) {
                scheduleNotification(comp);
            }
        }
        return result;
    }

    /**
     * Register a synchronous callback that fires after every successful
     * dispatch. The callback receives the extracted `T | null`.
     *
     * Use this when bridging to external systems; prefer `watch` for
     * declarative reactive coordination.
     */
    subscribe(callback: (value: T | null) => void): () => void {
        this.#valueSubscribers.add(callback);
        return () => this.#valueSubscribers.delete(callback);
    }

    /**
     * Read the extracted value (`T | null`) and register this dispatcher as a
     * dependency in the active tracking context.
     */
    get(): T | null {
        const comp = getCurrentComputation();
        if (comp && !this.#subscribers.has(comp)) {
            this.#trackComputation(comp);
        }
        return this.#protocol.extract(this.#state);
    }

    /**
     * Read the extracted value with a fallback default. Tracked.
     * Returns `defaultValue` when the extracted value is `null`.
     */
    getOr(defaultValue: T): T {
        const value = this.get();
        return value === null ? defaultValue : value;
    }

    /**
     * Read the extracted value without registering a dependency.
     * Safe to call outside reactive contexts.
     */
    peek(): T | null {
        return this.#protocol.extract(this.#state);
    }

    /**
     * Read the full state union and register this dispatcher as a dependency
     * in the active tracking context.
     */
    state(): S {
        const comp = getCurrentComputation();
        if (comp && !this.#subscribers.has(comp)) {
            this.#trackComputation(comp);
        }
        return this.#state;
    }

    /**
     * Read the full state union without registering a dependency. Safe to
     * call outside reactive contexts.
     */
    peekState(): S {
        return this.#state;
    }

    /** Dispose this dispatcher; subsequent `dispatch` calls error. */
    dispose(): void {
        this.#disposed = true;
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
}
