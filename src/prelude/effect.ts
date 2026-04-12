import { union, Trait, type Variant } from "../union.ts";
import { match } from "../match.ts";
import { SignalState } from "./signal.ts";
import {
    type Computation,
    getCurrentComputation,
    trackIn,
    createOwner,
} from "./context.ts";

export abstract class Computable<T, E> extends Trait<{}>() {
    async run(): Promise<Done<T, E>> {
        const self = this as unknown as Effect<T, E>;
        return await match(self, {
            Idle: async ({ thunk }) => {
                try {
                    const value = await thunk();
                    return Effect.Done(
                        SignalState.Active(value),
                        null,
                    ) as Done<T, E>;
                } catch (e) {
                    return Effect.Done(
                        SignalState.Disposed(),
                        e as E,
                    ) as Done<T, E>;
                }
            },
            Running: ({ pending }) => pending,
            Done: (it) => Promise.resolve(it as Done<T, E>),
            Stale: async ({ thunk }) => {
                try {
                    const value = await thunk();
                    return Effect.Done(
                        SignalState.Active(value),
                        null,
                    ) as Done<T, E>;
                } catch (e) {
                    return Effect.Done(
                        SignalState.Disposed(),
                        e as E,
                    ) as Done<T, E>;
                }
            },
        });
    }

    map<U>(fn: (value: T) => U): Idle<U, E> {
        const self = this as unknown as Effect<T, E>;
        return Effect.Idle(async () => {
            const done = await self.run();
            if (!done.signal.isActive()) {
                throw done.error ?? new Error("effect failed");
            }
            return fn(done.signal.get() as T);
        }) as Idle<U, E>;
    }

    flatMap<U>(fn: (value: T) => Effect<U, E>): Idle<U, E> {
        const self = this as unknown as Effect<T, E>;
        return Effect.Idle(async () => {
            const done = await self.run();
            if (!done.signal.isActive()) {
                throw done.error ?? new Error("effect failed");
            }
            const next = fn(done.signal.get() as T);
            const nextDone = await next.run();
            if (!nextDone.signal.isActive()) {
                throw nextDone.error ?? new Error("chained effect failed");
            }
            return nextDone.signal.get() as U;
        }) as Idle<U, E>;
    }

    recover<F>(fn: (error: E) => Effect<T, F>): Idle<T, F> {
        const self = this as unknown as Effect<T, E>;
        return Effect.Idle(async () => {
            const done = await self.run();
            if (done.signal.isActive()) {
                return done.signal.get() as T;
            }
            const recoveryDone = await fn(done.error as E).run();
            if (!recoveryDone.signal.isActive()) {
                throw recoveryDone.error ?? new Error("recovery failed");
            }
            return recoveryDone.signal.get() as T;
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
    { pending: Promise<Done<T, E>> },
    Computable<T, E>
>;
export type Done<T, E = never> = Variant<
    "Done",
    { signal: SignalState<T>; error: E | null },
    Computable<T, E>
>;
/**
 * The effect has previously completed but one or more of its signal
 * dependencies have since changed. The last result is preserved in `signal`
 * so callers can render stale-while-revalidating. Call `.run()` to
 * re-execute the thunk and produce a fresh `Done`.
 */
export type Stale<T, E = never> = Variant<
    "Stale",
    { signal: SignalState<T>; error: E | null; thunk: () => Promise<T> },
    Computable<T, E>
>;
export type Effect<T, E = never> =
    | Idle<T, E>
    | Running<T, E>
    | Done<T, E>
    | Stale<T, E>;

export const Effect = union([Computable]).typed({
    Idle: <T, E = never>(thunk: () => Promise<T>) => ({ thunk }) as Idle<T, E>,
    Running: <T, E = never>(pending: Promise<Done<T, E>>) =>
        ({ pending }) as Running<T, E>,
    Done: <T, E = never>(signal: SignalState<T>, error: E | null) =>
        ({ signal, error }) as Done<T, E>,
    Stale: <T, E = never>(
        signal: SignalState<T>,
        error: E | null,
        thunk: () => Promise<T>,
    ) => ({ signal, error, thunk }) as Stale<T, E>,
});

// ---------------------------------------------------------------------------
// watchEffect — reactive effect runner
// ---------------------------------------------------------------------------

type WatchHandle = { stop(): void };

type WatchOptions = {
    /**
     * When `true`, the effect re-runs automatically whenever a dependency
     * changes, without the caller needing to invoke `.run()` on the `Stale`
     * value. The `onChange` callback still fires so callers can observe each
     * completed result.
     *
     * @default false
     */
    eager?: boolean;
};

/**
 * Run an async thunk reactively. Any `Signal.get()` calls inside `thunk`
 * are automatically tracked as dependencies. When a dependency changes, the
 * effect transitions to `Stale` and `onChange` is called with the stale
 * variant so the caller can decide when to re-run.
 *
 * Call `.run()` on the `Stale` value to re-execute the thunk, or pass
 * `{ eager: true }` to have it re-run automatically on every dependency change.
 *
 * Returns a handle with `stop()` to cancel tracking and dispose the
 * underlying computation.
 *
 * @example Lazy (default)
 * const src = Signal.create("hello");
 * const handle = watchEffect(
 *   async () => src.get()!.toUpperCase(),
 *   (stale) => stale.run().then(done => console.log(done.signal.get())),
 * );
 * src.set("world"); // onChange called with Stale; caller drives re-run
 * handle.stop();
 *
 * @example Eager
 * const handle = watchEffect(
 *   async () => src.get()!.toUpperCase(),
 *   (done) => console.log("latest:", done.signal.get()),
 *   { eager: true },
 * );
 * src.set("world"); // re-runs immediately; onChange called with Done result
 */
export function watchEffect<T, E = never>(
    thunk: () => Promise<T>,
    onChange: (result: Stale<T, E> | Done<T, E>) => void,
    options: WatchOptions = {},
): WatchHandle {
    const { eager = false } = options;
    const computation: Computation = createOwner(getCurrentComputation());

    let lastDone: Done<T, E> | null = null;

    const rerun = async () => {
        for (const source of [...computation.sources]) {
            source.unsubscribe(computation);
        }
        computation.sources.clear();

        try {
            const value = await trackIn(computation, thunk);
            lastDone = Effect.Done(SignalState.Active(value), null) as Done<T, E>;
        } catch (e) {
            lastDone = Effect.Done(SignalState.Disposed(), e as E) as Done<T, E>;
        }
        onChange(lastDone);
    };

    computation.dirty = () => {
        if (lastDone === null) return;
        if (eager) {
            rerun();
        } else {
            const stale = Effect.Stale(lastDone.signal, lastDone.error, thunk) as Stale<T, E>;
            onChange(stale);
        }
    };

    // Run immediately with dependency tracking; suppress initial onChange call
    // so the caller only hears about *changes*, not the initial computation.
    (async () => {
        for (const source of [...computation.sources]) {
            source.unsubscribe(computation);
        }
        computation.sources.clear();
        try {
            const value = await trackIn(computation, thunk);
            lastDone = Effect.Done(SignalState.Active(value), null) as Done<T, E>;
        } catch (e) {
            lastDone = Effect.Done(SignalState.Disposed(), e as E) as Done<T, E>;
        }
    })();

    return {
        stop() {
            computation.dispose();
        },
    };
}
