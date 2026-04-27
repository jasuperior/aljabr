import { Signal } from "./signal.ts";
import { Derived } from "./derived.ts";
import { type Computation, createOwner, trackIn, untrack } from "./context.ts";

// ---------------------------------------------------------------------------
// IteratorOptions<T>
// ---------------------------------------------------------------------------

/**
 * Options for reactive iterator methods (`filter`, `sort`) on `RefArray` and
 * `DerivedArray`.
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
// DerivedArray<T>
// ---------------------------------------------------------------------------

/**
 * A read-only, per-index reactive view of an array. Returned by `map`,
 * `filter`, and `sort` on `RefArray` and `DerivedArray`.
 *
 * Each index is backed by a dedicated `Signal<T | undefined>`. When the
 * underlying source changes, only the positions whose values actually changed
 * (by reference, or by key for `filter`/`sort`) notify their subscribers.
 *
 * `length()` is a dedicated signal that fires only when the output size changes.
 *
 * Iterator methods are chainable — each call returns a new `DerivedArray`.
 *
 * @example
 * const state = Ref.create({ items: [1, 2, 3, 4, 5] });
 *
 * const evens = state.at("items")          // RefArray<number>
 *     .filter(x => x % 2 === 0);           // DerivedArray<number>
 *
 * const doubled = state.at("items")
 *     .filter(x => x % 2 === 0)
 *     .map(x => x * 2);                    // DerivedArray<number>
 */
type MapSource<T> = {
    get(): T[];
    get(i: number): T | undefined;
    length(): number;
    peek(i: number): T | undefined;
};

export class DerivedArray<T> {
    readonly #signals: Map<number, Signal<T | undefined>> = new Map();
    readonly #lengthSignal: Signal<number>;
    #rootSignal!: Signal<T[]>;
    #items: T[];
    readonly #keyFn: ((item: T) => unknown) | null;
    readonly #keyIsDefault: boolean;
    readonly #indexKeyFn: ((i: number) => unknown) | null;
    readonly #computation: Computation;
    readonly #mapComputations: Map<number, Computation> = new Map();
    #disposed = false;
    #keyDefaultWarnEmitted = false;
    #duplicateKeyWarnEmitted = false;

    /** @internal */
    static _create<T>(
        computeFn: () => T[],
        keyFn: ((item: T) => unknown) | null,
        keyIsDefault = false,
        indexKeyFn: ((i: number) => unknown) | null = null,
    ): DerivedArray<T> {
        return new DerivedArray(computeFn, keyFn, keyIsDefault, indexKeyFn);
    }

    /** @internal — per-index reactive map, avoids bulk recomputation */
    static _createMap<T, U>(
        source: MapSource<T>,
        fn: (item: T, i: number) => U,
        indexKeyFn: ((i: number) => unknown) | null,
    ): DerivedArray<U> {
        const initialLen = untrack(() => source.length());
        const initialItems: U[] = [];
        for (let i = 0; i < initialLen; i++) {
            initialItems.push(fn(source.peek(i)!, i));
        }

        const arr = new DerivedArray<U>(null, null, false, indexKeyFn, initialItems);
        if (arr.#disposed) return arr;

        const rootComp = arr.#computation;

        const mountIndex = (i: number): void => {
            const indexComp = createOwner(rootComp);
            arr.#mapComputations.set(i, indexComp);
            let prevSourceItem = source.peek(i);

            const recompute = (): void => {
                if (arr.#disposed) return;
                for (const src of [...indexComp.sources]) src.unsubscribe(indexComp);
                indexComp.sources.clear();
                const newSourceItem = trackIn(indexComp, () => source.get(i));
                if (newSourceItem === prevSourceItem) return;
                prevSourceItem = newSourceItem;
                if (newSourceItem === undefined) return;
                const mapped = fn(newSourceItem, i);
                arr.#items[i] = mapped;
                const sig = arr.#signals.get(i);
                if (sig) sig.set(mapped);
                // rootSignal is fired by the length watcher after source.get() settles,
                // guaranteeing rows.#items has the correct length before onUpdate runs.
            };

            indexComp.dirty = recompute;
            trackIn(indexComp, () => source.get(i));
        };

        for (let i = 0; i < initialLen; i++) mountIndex(i);

        // Watcher subscribed to source.get() (root signal) — fires last in #applyUpdate,
        // after all per-index signals have fired and recompute() has updated arr.#items[i].
        // This guarantees arr.#items is fully consistent before we fire arr.#rootSignal.
        const lengthComp = createOwner(rootComp);
        let watchedLen = initialLen;

        const onLengthChange = (): void => {
            if (arr.#disposed) return;
            for (const src of [...lengthComp.sources]) src.unsubscribe(lengthComp);
            lengthComp.sources.clear();
            const sourceItems = trackIn(lengthComp, () => source.get());
            const newLen = sourceItems.length;
            if (newLen > watchedLen) {
                for (let i = watchedLen; i < newLen; i++) {
                    arr.#items.push(fn(source.peek(i)!, i));
                    mountIndex(i);
                }
                arr.#lengthSignal.set(newLen);
            } else if (newLen < watchedLen) {
                for (let i = watchedLen - 1; i >= newLen; i--) {
                    arr.#mapComputations.get(i)?.dispose();
                    arr.#mapComputations.delete(i);
                    const sig = arr.#signals.get(i);
                    if (sig) { sig.dispose(); arr.#signals.delete(i); }
                    arr.#items.pop();
                }
                arr.#lengthSignal.set(newLen);
            }
            watchedLen = newLen;
            // Always fire rootSignal — triggers renderer onUpdate for reorders, adds, removes.
            // arr.#items is consistent at this point (per-index comps already ran).
            arr.#rootSignal.set([...arr.#items]);
        };

        lengthComp.dirty = onLengthChange;
        trackIn(lengthComp, () => source.get());

        return arr;
    }

    private constructor(
        computeFn: (() => T[]) | null,
        keyFn: ((item: T) => unknown) | null,
        keyIsDefault: boolean,
        indexKeyFn: ((i: number) => unknown) | null,
        initialItems: T[] = [],
    ) {
        this.#keyFn = keyFn;
        this.#keyIsDefault = keyIsDefault;
        this.#indexKeyFn = indexKeyFn;

        const comp = createOwner(null);
        this.#computation = comp;

        if (computeFn !== null) {
            this.#items = trackIn(comp, computeFn);
            const self = this;
            comp.dirty = function () {
                if (self.#disposed) return;
                for (const source of [...comp.sources]) source.unsubscribe(comp);
                comp.sources.clear();
                const newItems = trackIn(comp, computeFn);
                self.#applyUpdate(newItems);
            };
        } else {
            this.#items = initialItems;
        }

        this.#lengthSignal = untrack(() => Signal.create<number>(this.#items.length));
        this.#rootSignal = untrack(() => Signal.create<T[]>(this.#items));
    }

    /**
     * Read the entire array and register it as a dependency. Re-evaluates whenever
     * any element changes or the array grows/shrinks.
     */
    get(): T[]
    /**
     * Read the item at index `i` and register it as a dependency in the active
     * tracking context. Returns `undefined` for out-of-bounds indices or after disposal.
     */
    get(i: number): T | undefined
    get(i?: number): T[] | T | undefined {
        if (i === undefined) {
            if (this.#disposed) return [];
            this.#rootSignal.get();
            return [...this.#items];
        }
        if (this.#disposed) return undefined;
        this.#getOrCreateSignal(i).get();
        return this.#items[i];
    }

    /**
     * Read the entire array without registering a reactive dependency.
     */
    peek(): T[]
    /**
     * Read the item at index `i` without registering a reactive dependency.
     */
    peek(i: number): T | undefined
    peek(i?: number): T[] | T | undefined {
        return i === undefined
            ? untrack(() => this.get())
            : untrack(() => this.get(i));
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
     * Returns the reconciliation key for index `i`, or `null` if this array
     * has no key function. Used by the renderer to choose keyed vs
     * position-based DOM reconciliation.
     */
    keyAt(i: number): unknown | null {
        if (this.#keyFn !== null && !this.#keyIsDefault) {
            return this.#keyFn(this.#items[i]);
        }
        if (this.#indexKeyFn !== null) {
            return this.#indexKeyFn(i);
        }
        return null;
    }

    /**
     * Returns a new `ReactiveArray<U>` where each element is transformed by `fn`.
     * 1:1 index correspondence is maintained — no key function required.
     */
    map<U>(fn: (item: T, i: number) => U): DerivedArray<U> {
        const sourceKeyFn = !this.#keyIsDefault ? this.#keyFn : null;
        const indexKeyFn = sourceKeyFn !== null
            ? (i: number) => sourceKeyFn(this.peek(i)!)
            : null;
        return DerivedArray._createMap(this, fn, indexKeyFn);
    }

    /**
     * Returns a new `ReactiveArray<T>` containing only items for which `fn` returns `true`.
     *
     * Provide a `key` function via `opts` for surgical per-index invalidation
     * when items are objects. Without a key, reference equality is used, which
     * breaks under `Ref`'s immutable-update model.
     */
    filter(fn: (item: T, i: number) => boolean, opts?: IteratorOptions<T>): DerivedArray<T> {
        const sourceKey = !this.#keyIsDefault ? this.#keyFn : null;
        const keyFn = opts?.key ?? sourceKey ?? ((item: T) => item);
        const keyIsDefault = !opts?.key && sourceKey === null;
        const self = this;
        return DerivedArray._create<T>(() => {
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
    sort(comparator: (a: T, b: T) => number, opts?: IteratorOptions<T>): DerivedArray<T> {
        const sourceKey = !this.#keyIsDefault ? this.#keyFn : null;
        const keyFn = opts?.key ?? sourceKey ?? ((item: T) => item);
        const keyIsDefault = !opts?.key && sourceKey === null;
        const self = this;
        return DerivedArray._create<T>(() => {
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
        this.#computation.dispose(); // disposes all child computations (map index comps, length comp)
        this.#mapComputations.clear();
        for (const sig of this.#signals.values()) sig.dispose();
        this.#signals.clear();
        this.#lengthSignal.dispose();
        this.#rootSignal.dispose();
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
                        "[aljabr] DerivedArray: no key function provided for an object array. " +
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

        this.#rootSignal.set(newItems);
    }

    #checkDuplicateKeys(items: T[], keyFn: (item: T) => unknown): void {
        if (this.#duplicateKeyWarnEmitted) return;
        const seen = new Set<unknown>();
        for (const item of items) {
            const key = keyFn(item);
            if (seen.has(key)) {
                console.warn(
                    "[aljabr] DerivedArray: duplicate key detected. " +
                    "Ensure key function returns unique values per item.",
                );
                this.#duplicateKeyWarnEmitted = true;
                return;
            }
            seen.add(key);
        }
    }
}
