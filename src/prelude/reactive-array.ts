import { Signal } from "./signal.ts";
import { Derived } from "./derived.ts";
import { createOwner, trackIn, untrack } from "./context.ts";

// ---------------------------------------------------------------------------
// IteratorOptions<T>
// ---------------------------------------------------------------------------

/**
 * Options for reactive iterator methods (`filter`, `sort`) on `RefArray` and
 * `ReactiveArray`.
 *
 * Providing a `key` function enables surgical per-index invalidation: only
 * the output positions whose keyed item changed are notified. Without a key,
 * identity falls back to reference equality (`item => item`), which works for
 * primitives but breaks for objects under `Ref`'s immutable-update model.
 *
 * **Dev-mode warnings are emitted when:**
 * - No key is provided and items are objects (reference equality is unreliable)
 * - Two items produce the same key (ambiguous identity)
 */
export type IteratorOptions<T> = {
    key?: (item: T) => unknown;
};

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function isPrimitiveLike(v: unknown): boolean {
    return v === null || (typeof v !== "object" && typeof v !== "function");
}

// ---------------------------------------------------------------------------
// ReactiveArray<T>
// ---------------------------------------------------------------------------

/**
 * A read-only, per-index reactive view of an array. Returned by `map`,
 * `filter`, and `sort` on `RefArray` and `ReactiveArray`.
 *
 * Each index is backed by a dedicated `Signal<T | undefined>`. When the
 * underlying source changes, only the positions whose values actually changed
 * (by reference, or by key for `filter`/`sort`) notify their subscribers.
 *
 * `length()` is a dedicated signal that fires only when the output size changes.
 *
 * Iterator methods are chainable — each call returns a new `ReactiveArray`.
 *
 * @example
 * const state = Ref.create({ items: [1, 2, 3, 4, 5] });
 *
 * const evens = state.at("items")          // RefArray<number>
 *     .filter(x => x % 2 === 0);           // ReactiveArray<number>
 *
 * const doubled = state.at("items")
 *     .filter(x => x % 2 === 0)
 *     .map(x => x * 2);                    // ReactiveArray<number>
 */
export class ReactiveArray<T> {
    readonly #signals: Map<number, Signal<T | undefined>> = new Map();
    readonly #lengthSignal: Signal<number>;
    #items: T[];
    readonly #keyFn: ((item: T) => unknown) | null;
    readonly #keyIsDefault: boolean;
    readonly #computation: ReturnType<typeof createOwner>;
    #disposed = false;
    #keyDefaultWarnEmitted = false;
    #duplicateKeyWarnEmitted = false;

    /** @internal */
    static _create<T>(
        computeFn: () => T[],
        keyFn: ((item: T) => unknown) | null,
        keyIsDefault = false,
    ): ReactiveArray<T> {
        return new ReactiveArray(computeFn, keyFn, keyIsDefault);
    }

    private constructor(
        computeFn: () => T[],
        keyFn: ((item: T) => unknown) | null,
        keyIsDefault: boolean,
    ) {
        this.#keyFn = keyFn;
        this.#keyIsDefault = keyIsDefault;

        const comp = createOwner(null);
        this.#computation = comp;

        // Initial run (tracked — subscribe to source dependencies)
        this.#items = trackIn(comp, computeFn);
        this.#lengthSignal = untrack(() => Signal.create<number>(this.#items.length));

        const self = this;
        comp.dirty = function () {
            if (self.#disposed) return;
            // Clear stale dependency subscriptions before re-tracking
            for (const source of [...comp.sources]) source.unsubscribe(comp);
            comp.sources.clear();
            const newItems = trackIn(comp, computeFn);
            self.#applyUpdate(newItems);
        };
    }

    /**
     * Read the item at index `i` and register it as a dependency in the active
     * tracking context. Returns `undefined` for out-of-bounds indices or after disposal.
     */
    get(i: number): T | undefined {
        if (this.#disposed) return undefined;
        this.#getOrCreateSignal(i).get();
        return this.#items[i];
    }

    /**
     * Returns a stable `Derived<T | undefined>` handle for index `i`.
     * Useful when you need to pass a reactive reference to a single element.
     */
    at(i: number): Derived<T | undefined> {
        const self = this;
        return untrack(() => Derived.create((): T | undefined => self.get(i)));
    }

    /**
     * Returns the current length of the array and registers it as a dependency.
     * Notified only when the output size changes.
     */
    length(): number {
        this.#lengthSignal.get();
        return this.#items.length;
    }

    /**
     * Returns a new `ReactiveArray<U>` where each element is transformed by `fn`.
     * 1:1 index correspondence is maintained — no key function required.
     */
    map<U>(fn: (item: T, i: number) => U): ReactiveArray<U> {
        const self = this;
        return ReactiveArray._create<U>(() => {
            const len = self.length();
            return Array.from({ length: len }, (_, i) => fn(self.get(i)!, i));
        }, null);
    }

    /**
     * Returns a new `ReactiveArray<T>` containing only items for which `fn` returns `true`.
     *
     * Provide a `key` function via `opts` for surgical per-index invalidation
     * when items are objects. Without a key, reference equality is used, which
     * breaks under `Ref`'s immutable-update model.
     */
    filter(fn: (item: T, i: number) => boolean, opts?: IteratorOptions<T>): ReactiveArray<T> {
        const keyFn = opts?.key ?? ((item: T) => item);
        const keyIsDefault = !opts?.key;
        const self = this;
        return ReactiveArray._create<T>(() => {
            const len = self.length();
            const items: T[] = Array.from({ length: len }, (_, i) => self.get(i)!);
            return items.filter(fn);
        }, keyFn, keyIsDefault);
    }

    /**
     * Returns a new `ReactiveArray<T>` sorted by `comparator`.
     *
     * Provide a `key` function via `opts` for surgical per-index invalidation.
     */
    sort(comparator: (a: T, b: T) => number, opts?: IteratorOptions<T>): ReactiveArray<T> {
        const keyFn = opts?.key ?? ((item: T) => item);
        const keyIsDefault = !opts?.key;
        const self = this;
        return ReactiveArray._create<T>(() => {
            const len = self.length();
            const items: T[] = Array.from({ length: len }, (_, i) => self.get(i)!);
            return [...items].sort(comparator);
        }, keyFn, keyIsDefault);
    }

    /**
     * Dispose this `ReactiveArray` and all internal reactive nodes.
     * After disposal, `get()` returns `undefined` and updates are no longer applied.
     */
    dispose(): void {
        if (this.#disposed) return;
        this.#disposed = true;
        this.#computation.dispose();
        for (const sig of this.#signals.values()) sig.dispose();
        this.#signals.clear();
        this.#lengthSignal.dispose();
    }

    // -------------------------------------------------------------------------
    // Internal
    // -------------------------------------------------------------------------

    #getOrCreateSignal(i: number): Signal<T | undefined> {
        let sig = this.#signals.get(i);
        if (!sig) {
            sig = untrack(() => Signal.create<T | undefined>(this.#items[i]));
            this.#signals.set(i, sig);
        }
        return sig;
    }

    #applyUpdate(newItems: T[]): void {
        const oldItems = this.#items;
        const keyFn = this.#keyFn;

        // Commit the new snapshot first so that any downstream computation
        // reading this array (e.g. a chained sort or map) sees the updated
        // state when its dirty() fires synchronously during signal.set().
        this.#items = newItems;

        if (keyFn === null) {
            // map (1:1): diff by reference at each index
            for (let i = 0; i < Math.max(oldItems.length, newItems.length); i++) {
                if (i >= newItems.length) {
                    const sig = this.#signals.get(i);
                    if (sig) {
                        sig.dispose();
                        this.#signals.delete(i);
                    }
                } else if (newItems[i] !== oldItems[i]) {
                    const sig = this.#signals.get(i);
                    if (sig) sig.set(newItems[i]);
                }
            }
        } else {
            // filter / sort: key-based incremental diff
            if (this.#keyIsDefault && !this.#keyDefaultWarnEmitted) {
                const hasObjects = newItems.some(item => !isPrimitiveLike(item));
                if (hasObjects) {
                    console.warn(
                        "[aljabr] ReactiveArray: no key function provided for an object array. " +
                        "Reference equality is unreliable under Ref's immutable-update model. " +
                        "Provide a key via { key: (item) => item.id }.",
                    );
                    this.#keyDefaultWarnEmitted = true;
                }
            }
            this.#checkDuplicateKeys(newItems, keyFn);

            const maxLen = Math.max(oldItems.length, newItems.length);
            for (let i = 0; i < maxLen; i++) {
                if (i >= newItems.length) {
                    const sig = this.#signals.get(i);
                    if (sig) {
                        sig.dispose();
                        this.#signals.delete(i);
                    }
                } else {
                    const newKey = keyFn(newItems[i]);
                    const oldKey = i < oldItems.length ? keyFn(oldItems[i]) : Symbol(); // unique sentinel
                    if (newKey !== oldKey || newItems[i] !== oldItems[i]) {
                        const sig = this.#signals.get(i);
                        if (sig) sig.set(newItems[i]);
                    }
                }
            }
        }

        if (newItems.length !== oldItems.length) {
            this.#lengthSignal.set(newItems.length);
        }
    }

    #checkDuplicateKeys(items: T[], keyFn: (item: T) => unknown): void {
        if (this.#duplicateKeyWarnEmitted) return;
        const seen = new Set<unknown>();
        for (const item of items) {
            const key = keyFn(item);
            if (seen.has(key)) {
                console.warn(
                    "[aljabr] ReactiveArray: duplicate key detected. " +
                    "Ensure key function returns unique values per item.",
                );
                this.#duplicateKeyWarnEmitted = true;
                return;
            }
            seen.add(key);
        }
    }
}
