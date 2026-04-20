import { Signal, type SignalState } from "../prelude/signal.ts";
import {
    Derived,
    AsyncDerived,
    type DerivedState,
    type AsyncDerivedState,
} from "../prelude/derived.ts";
import type { AsyncOptions } from "../prelude/schedule.ts";
import {
    type ScopeHandle,
    type Defect,
    Scope,
    runInScope,
} from "../prelude/scope.ts";
import {
    createOwner,
    getCurrentComputation,
    runInContext,
    trackIn,
} from "../prelude/context.ts";

// ---------------------------------------------------------------------------
// Getter<T, S> — callable function with tracked .state() accessor
// ---------------------------------------------------------------------------

export type Getter<T, S> = {
    (): T | null;
    state(): S;
};

export type Setter<T> = (value: T | ((prev: T | null) => T)) => void;

// ---------------------------------------------------------------------------
// signal<T>() — reactive mutable value
// ---------------------------------------------------------------------------

export function signal<T>(): [Getter<T, SignalState<T>>, Setter<T>];
export function signal<T>(initial: T): [Getter<T, SignalState<T>>, Setter<T>];
export function signal<T>(
    ...args: [] | [T]
): [Getter<T, SignalState<T>>, Setter<T>] {
    const sig =
        args.length === 0 ? Signal.create<T>() : Signal.create<T>(args[0]!);

    const getter = Object.assign(
        (): T | null => sig.get(),
        { state: (): SignalState<T> => sig.state() },
    );

    const setter: Setter<T> = (value) => {
        sig.set(
            typeof value === "function"
                ? (value as (prev: T | null) => T)(sig.peek())
                : (value as T),
        );
    };

    return [getter, setter];
}

// ---------------------------------------------------------------------------
// memo<T>() — lazy computed value
// ---------------------------------------------------------------------------

export function memo<T>(fn: () => T): Getter<T, DerivedState<T>> {
    const d = Derived.create(fn);
    return Object.assign(
        (): T | null => d.get(),
        {
            state(): DerivedState<T> {
                d.get(); // registers tracking + evaluates
                return d.state;
            },
        },
    );
}

// ---------------------------------------------------------------------------
// effect() — reactive side effect
// ---------------------------------------------------------------------------

export function effect(fn: () => void): () => void {
    const owner = createOwner(getCurrentComputation());

    const run = (): void => {
        for (const source of [...owner.sources]) source.unsubscribe(owner);
        owner.sources.clear();
        trackIn(owner, fn);
    };

    owner.dirty = run;
    run();

    return () => owner.dispose();
}

// ---------------------------------------------------------------------------
// scope<T>() — disposable reactive boundary over Scope
// ---------------------------------------------------------------------------

export function scope<T>(
    fn: (dispose: () => Promise<Defect[]>) => T,
): [T, () => Promise<Defect[]>] {
    const owner = createOwner(getCurrentComputation());
    const s = runInContext(owner, () => Scope());

    const dispose = async (): Promise<Defect[]> => {
        const defects = await s.dispose();
        owner.dispose();
        return defects;
    };

    const value = runInContext(owner, () =>
        runInScope(s, () => fn(dispose)),
    );

    return [value, dispose];
}

// ---------------------------------------------------------------------------
// context<T>() — owner-tree value threading
// ---------------------------------------------------------------------------

const contextStore = new WeakMap<object, Map<symbol, unknown>>();

export type Context<T> = {
    provide(value: T, fn: () => void): void;
    use(): T;
};

export function context<T>(defaultValue: T): Context<T> {
    const key = Symbol();

    return {
        provide(value: T, fn: () => void): void {
            const owner = createOwner(getCurrentComputation());
            let map = contextStore.get(owner);
            if (!map) {
                map = new Map();
                contextStore.set(owner, map);
            }
            map.set(key, value);
            runInContext(owner, fn);
        },

        use(): T {
            let current = getCurrentComputation();
            while (current !== null) {
                const map = contextStore.get(current);
                if (map?.has(key)) return map.get(key) as T;
                current = current.owner;
            }
            return defaultValue;
        },
    };
}

// ---------------------------------------------------------------------------
// query<T, E>() — async derived data with refetch
// ---------------------------------------------------------------------------

export function query<T, E = unknown>(
    fn: (signal: AbortSignal, scope: ScopeHandle) => Promise<T>,
    options?: AsyncOptions<E>,
): [Getter<T, AsyncDerivedState<T, E>>, { refetch(): void }] {
    const trigger = Signal.create(0);
    let isActive = false;

    const d = AsyncDerived.create<T, E>(
        async (abortSignal, sc) => {
            trigger.get();
            return fn(abortSignal, sc);
        },
        options,
    );

    // Push-based re-evaluation: when d notifies subscribers (goes Reloading),
    // evalOwner.dirty() fires and immediately calls d.get() to start the next fetch.
    const evalOwner = createOwner(getCurrentComputation());
    evalOwner.dirty = (): void => {
        void d.get();
    };

    const getter = Object.assign(
        (): T | null => {
            if (!isActive) {
                isActive = true;
                // Subscribe evalOwner to d so future dirty notifications auto-trigger.
                trackIn(evalOwner, () => { void d.get(); });
            }
            return d.peek();
        },
        {
            state(): AsyncDerivedState<T, E> {
                return d.state;
            },
        },
    );

    const refetch = (): void => {
        trigger.set((trigger.peek() ?? 0) + 1);
    };

    return [getter, { refetch }];
}
