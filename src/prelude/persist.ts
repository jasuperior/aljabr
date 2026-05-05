import { Signal } from "./signal.ts";
import { watch } from "./effect.ts";
import type { WatchHandle } from "./effect.ts";

// ---------------------------------------------------------------------------
// Persistence helpers
// ---------------------------------------------------------------------------
//
// These utilities connect Signal<T> values to an external store (localStorage,
// sessionStorage, or any custom adapter). They are surfaced as Signal statics
// and instance methods (`Signal.persisted`, `signal.persist(...)`) — see
// signal.ts for the public API.

/** Read / write adapter for an external key-value store. */
export type PersistAdapter = {
    get(key: string): string | null;
    set(key: string, value: string): void;
    remove(key: string): void;
};

/** The built-in adapter backed by `localStorage`. */
export const localStorageAdapter: PersistAdapter = {
    get: (key) => localStorage.getItem(key),
    set: (key, value) => localStorage.setItem(key, value),
    remove: (key) => localStorage.removeItem(key),
};

/** The built-in adapter backed by `sessionStorage`. */
export const sessionStorageAdapter: PersistAdapter = {
    get: (key) => sessionStorage.getItem(key),
    set: (key, value) => sessionStorage.setItem(key, value),
    remove: (key) => sessionStorage.removeItem(key),
};

export type PersistOptions<T> = {
    /** Storage key under which the value is persisted. */
    key: string;
    /** Serialise `T` to a string. Defaults to `JSON.stringify`. */
    serialize?: (value: T) => string;
    /** Deserialise a string back to `T`. Defaults to `JSON.parse`. */
    deserialize?: (raw: string) => T;
    /** Storage adapter to use. Defaults to `localStorageAdapter`. */
    adapter?: PersistAdapter;
};

// ---------------------------------------------------------------------------
// Internal implementations — invoked by Signal.persisted / signal.persist
// ---------------------------------------------------------------------------

/** @internal — implementation backing `Signal.persisted`. */
export function _createPersistedSignal<T>(
    initialValue: T,
    options: PersistOptions<T>,
): Signal<T> {
    const {
        key,
        serialize = JSON.stringify,
        deserialize = JSON.parse,
        adapter = localStorageAdapter,
    } = options;

    // Rehydrate from store on creation
    let startValue = initialValue;
    try {
        const raw = adapter.get(key);
        if (raw !== null) startValue = deserialize(raw);
    } catch {
        // Corrupted storage entry — fall back to initialValue
    }

    const signal = Signal.create(startValue);

    // Mirror every write to the store — eager so re-runs automatically on each change
    watch(
        async () => {
            const value = signal.get();
            if (value !== null) {
                adapter.set(key, serialize(value));
            } else {
                adapter.remove(key);
            }
        },
        () => {},
        { eager: true },
    );

    return signal;
}

/** @internal — implementation backing `signal.persist`. */
export function _persistSignal<T>(
    signal: Signal<T>,
    options: PersistOptions<T>,
): WatchHandle {
    const {
        key,
        serialize = JSON.stringify,
        adapter = localStorageAdapter,
    } = options;

    return watch(
        async () => {
            const value = signal.get();
            if (value !== null) adapter.set(key, serialize(value));
        },
        () => {},
        { eager: true },
    );
}
