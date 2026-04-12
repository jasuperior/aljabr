import { Signal } from "./signal.ts";
import { watchEffect } from "./effect.ts";

// ---------------------------------------------------------------------------
// Persistence helpers
// ---------------------------------------------------------------------------
//
// These utilities connect Signal<T> values to an external store (localStorage,
// sessionStorage, or any custom adapter). They are deliberately thin — each
// helper returns a plain Signal<T> so the rest of your reactive graph needs no
// knowledge of where the value persists.

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

/**
 * Create a `Signal<T>` that is automatically persisted to and rehydrated from
 * an external store (localStorage by default).
 *
 * On creation the store is read and, if a persisted value exists, the signal
 * starts `Active` with the stored value. Every subsequent `set()` is mirrored
 * to the store via `watchEffect`.
 *
 * @example
 * const theme = persistedSignal<"light" | "dark">("theme", "light");
 * theme.set("dark"); // written to localStorage["theme"]
 * // On next page load, theme.peek() === "dark"
 */
export function persistedSignal<T>(
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

    // Mirror every write to the store
    watchEffect(
        async () => {
            const value = signal.get();
            if (value !== null) {
                adapter.set(key, serialize(value));
            } else {
                adapter.remove(key);
            }
        },
        () => { /* writes are the side-effect; onChange is a no-op here */ },
    );

    return signal;
}

/**
 * Persist an existing `Signal<T>` to an external store, keeping it in sync
 * for its entire lifetime. Returns a cleanup function that stops syncing.
 *
 * Unlike `persistedSignal`, this does not rehydrate — use it when you already
 * have a signal whose value you want to mirror out-of-band.
 *
 * @example
 * const pos = Signal.create({ line: 0, col: 0 });
 * const stop = syncToStore(pos, { key: "cursor" });
 * // Later, to stop persisting:
 * stop();
 */
export function syncToStore<T>(
    signal: Signal<T>,
    options: PersistOptions<T>,
): () => void {
    const {
        key,
        serialize = JSON.stringify,
        adapter = localStorageAdapter,
    } = options;

    const handle = watchEffect(
        async () => {
            const value = signal.get();
            if (value !== null) adapter.set(key, serialize(value));
        },
        () => {},
    );

    return () => handle.stop();
}
