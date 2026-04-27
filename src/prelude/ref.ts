import { Signal } from "./signal.ts";
import { Derived } from "./derived.ts";
import { Option } from "./option.ts";
import { getCurrentComputation, untrack } from "./context.ts";
import { DerivedArray, type IteratorOptions } from "./derived-array.ts";

// ---------------------------------------------------------------------------
// Path type machinery
// ---------------------------------------------------------------------------

type Primitive = string | number | boolean | bigint | symbol | null | undefined;

type PathsOf<T, D extends 0[] = []> = D["length"] extends 10
    ? never
    : T extends Primitive
      ? never
      : T extends readonly unknown[]
        ? `${number}` | `${number}.${PathsOf<T[number], [...D, 0]>}`
        : {
              [K in keyof T & string]: T[K] extends Primitive
                  ? K
                  : K | `${K}.${PathsOf<T[K], [...D, 0]>}`;
          }[keyof T & string];

/**
 * All valid dot-separated paths into `T`, including array index paths.
 * Array indices use dot notation: `"users.0.name"`.
 * Depth is capped at 10 levels to stay within TypeScript recursion limits.
 */
export type Path<T> = PathsOf<T>;

/**
 * The value type at a given dot-separated path `P` into `T`.
 *
 * @example
 * type State = { user: { name: string; age: number }; scores: number[] };
 * type Name = PathValue<State, "user.name">;    // string
 * type Score = PathValue<State, "scores.0">;    // number
 */
export type PathValue<T, P extends string> = P extends `${infer K}.${infer Rest}`
    ? K extends keyof T
        ? PathValue<T[K], Rest>
        : T extends readonly unknown[]
          ? PathValue<T[number], Rest>
          : never
    : P extends keyof T
      ? T[P]
      : T extends readonly unknown[]
        ? T[number]
        : never;

// ---------------------------------------------------------------------------
// Array path helpers
// ---------------------------------------------------------------------------

/**
 * All paths into `T` whose resolved value type is an array.
 * Use with Ref's array mutation methods (`push`, `pop`, `splice`, `move`).
 */
export type ArrayPath<T> = {
    [P in Path<T>]: PathValue<T, P> extends unknown[] ? P : never;
}[Path<T>];

/**
 * The element type of the array at path `P` in `T`.
 */
export type ArrayItem<T, P extends string> = PathValue<T, P> extends (infer E)[]
    ? E
    : never;

// ---------------------------------------------------------------------------
// Internal shared state
// ---------------------------------------------------------------------------

type RefHolder = {
    state: unknown;
    unset: boolean;
    signals: Map<string, Signal<unknown>>;
    lengthSignals: Map<string, Signal<number>>;
    handles: Map<string, Ref<any> | Derived<unknown> | RefArray<any>>;
    bindings: Map<string, () => void>;       // path → unsubscribe fn
    boundSignals: Map<string, Signal<unknown>>; // path → source signal
    disposed: boolean;
};

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function resolveFullPath(prefix: string, path: string): string {
    return prefix ? `${prefix}.${path}` : path;
}

function getAtPath(obj: unknown, path: string): unknown {
    if (path === "") return obj;
    const parts = path.split(".");
    let current = obj;
    for (const part of parts) {
        if (current == null) return undefined;
        current = (current as Record<string, unknown>)[part];
    }
    return current;
}

function setAtPath(obj: unknown, path: string, value: unknown): unknown {
    if (path === "") return value;
    return deepSet(obj, path.split("."), value);
}

function deepSet(
    obj: unknown,
    parts: readonly string[],
    value: unknown,
): unknown {
    if (parts.length === 0) return value;
    const [head, ...tail] = parts;
    if (Array.isArray(obj)) {
        const arr = [...obj];
        const idx = Number(head);
        arr[idx] = tail.length === 0 ? value : deepSet(arr[idx], tail, value);
        return arr;
    }
    const record = (obj ?? {}) as Record<string, unknown>;
    return {
        ...record,
        [head]: tail.length === 0 ? value : deepSet(record[head], tail, value),
    };
}

function isRelated(signalPath: string, changedPath: string): boolean {
    if (changedPath === "") return true; // root changed → all signals are related
    if (signalPath === "") return true;  // root signal relates to any change
    return (
        signalPath === changedPath ||
        signalPath.startsWith(changedPath + ".") ||
        changedPath.startsWith(signalPath + ".")
    );
}

function isPrimitive(v: unknown): v is Primitive {
    return v === null || (typeof v !== "object" && typeof v !== "function");
}

function isObjectLike(v: unknown): v is object {
    return v !== null && typeof v === "object";
}

function collectLeafChanges(
    path: string,
    oldVal: unknown,
    newVal: unknown,
    out: Array<[string, unknown]>,
): void {
    if (oldVal === newVal) return;

    if (!isPrimitive(oldVal) && !isPrimitive(newVal)) {
        if (Array.isArray(oldVal) && Array.isArray(newVal)) {
            const len = Math.max(oldVal.length, newVal.length);
            for (let i = 0; i < len; i++) {
                const childPath = path ? `${path}.${i}` : `${i}`;
                collectLeafChanges(childPath, oldVal[i], newVal[i], out);
            }
            return;
        }
        if (!Array.isArray(oldVal) && !Array.isArray(newVal)) {
            const oldObj = oldVal as Record<string, unknown>;
            const newObj = newVal as Record<string, unknown>;
            const keys = new Set([
                ...Object.keys(oldObj),
                ...Object.keys(newObj),
            ]);
            for (const key of keys) {
                const childPath = path ? `${path}.${key}` : key;
                collectLeafChanges(childPath, oldObj[key], newObj[key], out);
            }
            return;
        }
    }

    // Leaf: primitives differ, or type mismatch (object ↔ primitive, array ↔ object, etc.)
    out.push([path, newVal]);
}

// ---------------------------------------------------------------------------
// Module-level reactive helpers (shared by Ref and RefArray)
// ---------------------------------------------------------------------------

function getOrCreateSignal(holder: RefHolder, fullPath: string): Signal<unknown> {
    let sig = holder.signals.get(fullPath);
    if (!sig) {
        const value = holder.unset ? undefined : getAtPath(holder.state, fullPath);
        sig = untrack(() => Signal.create<unknown>(value as unknown));
        holder.signals.set(fullPath, sig);
    }
    return sig;
}

function cleanupOutOfRangeSignals(
    holder: RefHolder,
    arrayPath: string,
    newLength: number,
): void {
    const prefix = arrayPath ? `${arrayPath}.` : "";
    for (const [key, sig] of [...holder.signals]) {
        const rest = arrayPath
            ? (key.startsWith(prefix) ? key.slice(prefix.length) : null)
            : key;
        if (rest === null) continue;
        const index = Number(rest.split(".")[0]);
        if (!isNaN(index) && index >= newLength) {
            sig.dispose();
            holder.signals.delete(key);
            holder.handles.delete(key);
        }
    }
}

function applyArrayMutation(
    holder: RefHolder,
    fullPath: string,
    oldArr: unknown[],
    newArr: unknown[],
): void {
    holder.state = setAtPath(holder.state, fullPath, newArr);
    holder.unset = false;

    const changes: Array<[string, unknown]> = [];
    collectLeafChanges(fullPath, oldArr, newArr, changes);

    const toNotify = new Set<string>();
    toNotify.add(fullPath);
    for (const [p] of changes) {
        toNotify.add(p);
        const parts = p.split(".");
        for (let i = parts.length - 1; i > 0; i--) {
            toNotify.add(parts.slice(0, i).join("."));
        }
    }
    for (const p of toNotify) {
        const sig = holder.signals.get(p);
        if (sig) sig.set(getAtPath(holder.state, p));
    }

    // Update length signal if present and size changed
    if (newArr.length !== oldArr.length) {
        const lengthSig = holder.lengthSignals.get(fullPath);
        if (lengthSig) lengthSig.set(newArr.length);
    }

    if (newArr.length < oldArr.length) {
        cleanupOutOfRangeSignals(holder, fullPath, newArr.length);
    }
}

// ---------------------------------------------------------------------------
// RefArray<T>  (defined before Ref so Ref.create can reference it)
// ---------------------------------------------------------------------------

/**
 * A reactive mutable container for a root-level array. Returned by
 * `Ref.create(T[])` and `Ref.at(path)` when the path resolves to an array.
 *
 * Unlike `Ref<T[]>`, `RefArray<T>` exposes pathless mutation methods that
 * operate directly on the root array without requiring a path argument.
 *
 * Per-index reads (`get(i)`, `at(i)`) and `length()` are all reactive —
 * they register fine-grained dependencies so that subscribers are notified
 * only when the specific index (or length) they read actually changes.
 *
 * Iterator methods (`map`, `filter`, `sort`) return a `DerivedArray<U>` —
 * a read-only derived view that maintains per-index reactivity across
 * structural mutations.
 *
 * @example
 * const items = Ref.create([1, 2, 3, 4, 5]);
 *
 * items.push(6);                                  // [1, 2, 3, 4, 5, 6]
 * items.pop();                                    // [1, 2, 3, 4, 5]
 * items.splice(1, 2, 10, 20);                     // [1, 10, 20, 4, 5]
 *
 * const evens = items.filter(x => x % 2 === 0);  // DerivedArray<number>
 * const doubled = evens.map(x => x * 2);          // DerivedArray<number>
 */
export class RefArray<T> {
    readonly #holder: RefHolder;
    readonly #prefix: string;

    private constructor(holder: RefHolder, prefix: string) {
        this.#holder = holder;
        this.#prefix = prefix;
    }

    /** @internal Create a RefArray backed by an existing shared holder. */
    static _fromHolder<T>(holder: RefHolder, prefix: string): RefArray<T> {
        return new RefArray<T>(holder, prefix);
    }

    /**
     * Create a `RefArray` with an initial array value.
     * Prefer `Ref.create(T[])` — this static is provided for direct use.
     */
    static create<T>(initial: T[]): RefArray<T> {
        const owner = getCurrentComputation();
        const holder: RefHolder = {
            state: initial,
            unset: false,
            signals: new Map(),
            lengthSignals: new Map(),
            handles: new Map(),
            bindings: new Map(),
            boundSignals: new Map(),
            disposed: false,
        };
        const refArray = new RefArray<T>(holder, "");
        if (owner) owner.cleanups.add(() => refArray.dispose());
        return refArray;
    }

    /** `true` if this RefArray was created without an initial value. */
    get isUnset(): boolean {
        return this.#holder.unset;
    }

    // -------------------------------------------------------------------------
    // Pathless root mutations
    // -------------------------------------------------------------------------

    /** Append one or more items to the end of the array. */
    push(...items: T[]): void {
        if (this.#holder.disposed) return;
        const arr = this.#getArr() ?? [];
        applyArrayMutation(this.#holder, this.#prefix, arr, [...arr, ...items]);
    }

    /**
     * Remove and return the last element of the array.
     * Returns `Option.Some(value)` on success, `Option.None()` if the array is empty.
     */
    pop(): Option<T> {
        if (this.#holder.disposed) return Option.None();
        const arr = this.#getArr() ?? [];
        if (arr.length === 0) return Option.None();
        const last = arr[arr.length - 1] as T;
        applyArrayMutation(this.#holder, this.#prefix, arr, arr.slice(0, -1));
        return Option.Some(last);
    }

    /**
     * Remove and return the first element of the array.
     * Returns `Option.Some(value)` on success, `Option.None()` if the array is empty.
     */
    shift(): Option<T> {
        if (this.#holder.disposed) return Option.None();
        const arr = this.#getArr() ?? [];
        if (arr.length === 0) return Option.None();
        const first = arr[0] as T;
        applyArrayMutation(this.#holder, this.#prefix, arr, arr.slice(1));
        return Option.Some(first);
    }

    /** Prepend one or more items to the beginning of the array. */
    unshift(...items: T[]): void {
        if (this.#holder.disposed) return;
        const arr = this.#getArr() ?? [];
        applyArrayMutation(this.#holder, this.#prefix, arr, [...items, ...arr]);
    }

    /**
     * Replace the element at `index` in place.
     * Fine-grained: only the per-index signal for `index` is dirtied.
     * Returns `Option.Some(oldValue)` on success, `Option.None()` if `index` is out of bounds.
     * Does not extend the array — use `push` or `splice` to append.
     */
    set(index: number, value: T): Option<T> {
        if (this.#holder.disposed) return Option.None();
        const arr = this.#getArr() ?? [];
        if (index < 0 || index >= arr.length) return Option.None();
        const old = arr[index] as T;
        if (old === value) return Option.Some(old);
        const newArr = [...arr];
        newArr[index] = value;
        applyArrayMutation(this.#holder, this.#prefix, arr, newArr);
        return Option.Some(old);
    }

    /** Remove and/or insert elements starting at `start`. */
    splice(start: number, deleteCount: number, ...items: T[]): void {
        if (this.#holder.disposed) return;
        const arr = this.#getArr() ?? [];
        const newArr = [...arr];
        newArr.splice(start, deleteCount, ...items);
        applyArrayMutation(this.#holder, this.#prefix, arr, newArr);
    }

    /** Swap elements at indices `from` and `to`. No-op if indices are equal or out of bounds. */
    move(from: number, to: number): void {
        if (this.#holder.disposed) return;
        const arr = this.#getArr() ?? [];
        if (from === to || from >= arr.length || to >= arr.length) return;
        const newArr = [...arr];
        [newArr[from], newArr[to]] = [newArr[to], newArr[from]];
        applyArrayMutation(this.#holder, this.#prefix, arr, newArr);
    }

    // -------------------------------------------------------------------------
    // Per-index reactive reads
    // -------------------------------------------------------------------------

    /**
     * Read the entire array and register it as a dependency. Re-evaluates on any mutation.
     */
    get(): T[]
    /**
     * Read the item at index `i` and register it as a tracked dependency.
     * Returns `undefined` for out-of-bounds indices or when unset.
     */
    get(i: number): T | undefined
    get(i?: number): T[] | T | undefined {
        if (i === undefined) {
            getOrCreateSignal(this.#holder, this.#prefix).get();
            return this.#getArr() ?? [];
        }
        const fullPath = this.#prefix ? `${this.#prefix}.${i}` : `${i}`;
        getOrCreateSignal(this.#holder, fullPath).get();
        if (this.#holder.unset) return undefined;
        const arr = this.#getArr();
        return arr ? (arr[i] as T) : undefined;
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
     * Returns a `Derived<T | undefined>` handle for index `i`.
     * Each call creates a new Derived — cache it if reused frequently.
     */
    at(i: number): Derived<T | undefined> {
        const self = this;
        return untrack(() => Derived.create((): T | undefined => self.get(i)));
    }

    /**
     * Returns the current length of the array and registers it as a dependency.
     * Subscribers are notified only when the array size changes.
     */
    length(): number {
        this.#getOrCreateLengthSignal().get();
        const arr = this.#getArr();
        return arr ? arr.length : 0;
    }

    // -------------------------------------------------------------------------
    // Precise-tracking query methods
    // -------------------------------------------------------------------------

    /**
     * Returns `Option.Some(item)` for the first element matching `predicate`,
     * `Option.None()` if none match.
     * Precise tracking: registers per-index dependencies only for visited elements.
     */
    find(predicate: (item: T, i: number) => boolean): Option<T> {
        const len = this.length();
        for (let i = 0; i < len; i++) {
            const item = this.get(i)!;
            if (predicate(item, i)) return Option.Some(item);
        }
        return Option.None();
    }

    /**
     * Returns `Option.Some(index)` for the first element matching `predicate`,
     * `Option.None()` if none match.
     * Precise tracking: registers per-index dependencies only for visited elements.
     */
    findIndex(predicate: (item: T, i: number) => boolean): Option<number> {
        const len = this.length();
        for (let i = 0; i < len; i++) {
            if (predicate(this.get(i)!, i)) return Option.Some(i);
        }
        return Option.None();
    }

    /**
     * Returns `Option.Some(index)` for the last element matching `predicate`,
     * `Option.None()` if none match.
     * Precise tracking: registers per-index dependencies only for visited elements (scans from end).
     */
    findLastIndex(predicate: (item: T, i: number) => boolean): Option<number> {
        const len = this.length();
        for (let i = len - 1; i >= 0; i--) {
            if (predicate(this.get(i)!, i)) return Option.Some(i);
        }
        return Option.None();
    }

    /**
     * Returns `true` if `value` is present in the array (using `===`).
     * Precise tracking: stops at the first match.
     */
    includes(value: T): boolean {
        const len = this.length();
        for (let i = 0; i < len; i++) {
            if (this.get(i) === value) return true;
        }
        return false;
    }

    // -------------------------------------------------------------------------
    // Full-tracking query methods
    // -------------------------------------------------------------------------

    /**
     * Joins all elements into a string separated by `separator`.
     * Full tracking: reads every index — re-evaluates when any element or length changes.
     */
    join(separator = ","): string {
        const len = this.length();
        const parts: string[] = [];
        for (let i = 0; i < len; i++) parts.push(String(this.get(i) ?? ""));
        return parts.join(separator);
    }

    /**
     * Applies `fn` left-to-right, accumulating a result.
     * Full tracking: reads every index — re-evaluates when any element or length changes.
     */
    reduce<U>(fn: (acc: U, item: T, i: number) => U, initial: U): U {
        const len = this.length();
        let acc = initial;
        for (let i = 0; i < len; i++) acc = fn(acc, this.get(i)!, i);
        return acc;
    }

    /**
     * Applies `fn` right-to-left, accumulating a result.
     * Full tracking: reads every index — re-evaluates when any element or length changes.
     */
    reduceRight<U>(fn: (acc: U, item: T, i: number) => U, initial: U): U {
        const len = this.length();
        let acc = initial;
        for (let i = len - 1; i >= 0; i--) acc = fn(acc, this.get(i)!, i);
        return acc;
    }

    // -------------------------------------------------------------------------
    // Iterator methods → DerivedArray
    // -------------------------------------------------------------------------

    /**
     * Returns a `DerivedArray<U>` where each element is transformed by `fn`.
     * 1:1 index mapping is maintained — no key function required.
     */
    map<U>(fn: (item: T, i: number) => U): DerivedArray<U> {
        const self = this;
        return DerivedArray._create<U>(() => {
            const len = self.length();
            return Array.from({ length: len }, (_, i) => fn(self.get(i)!, i));
        }, null);
    }

    /**
     * Returns a `DerivedArray<T>` containing only items for which `fn` returns `true`.
     *
     * Provide a `key` function via `opts` for surgical per-index invalidation
     * when items are objects.
     */
    filter(fn: (item: T, i: number) => boolean, opts?: IteratorOptions<T>): DerivedArray<T> {
        const keyFn = opts?.key ?? ((item: T) => item);
        const keyIsDefault = !opts?.key;
        const self = this;
        return DerivedArray._create<T>(() => {
            const len = self.length();
            const items: T[] = Array.from({ length: len }, (_, i) => self.get(i)!);
            return items.filter(fn);
        }, keyFn, keyIsDefault);
    }

    /**
     * Returns a `DerivedArray<T>` sorted by `comparator`.
     *
     * Provide a `key` function via `opts` for surgical per-index invalidation.
     */
    sort(comparator: (a: T, b: T) => number, opts?: IteratorOptions<T>): DerivedArray<T> {
        const keyFn = opts?.key ?? ((item: T) => item);
        const keyIsDefault = !opts?.key;
        const self = this;
        return DerivedArray._create<T>(() => {
            const len = self.length();
            const items: T[] = Array.from({ length: len }, (_, i) => self.get(i)!);
            return [...items].sort(comparator);
        }, keyFn, keyIsDefault);
    }

    // -------------------------------------------------------------------------
    // Lifecycle
    // -------------------------------------------------------------------------

    /**
     * Dispose this RefArray and all internal reactive nodes.
     *
     * No-op on sub-RefArrays created via `Ref.at()` — only root RefArrays
     * (created via `Ref.create(T[])` or `RefArray.create()`) own the holder.
     */
    dispose(): void {
        if (this.#prefix !== "") return; // non-root shares holder with parent Ref
        if (this.#holder.disposed) return;
        this.#holder.disposed = true;
        for (const unsub of this.#holder.bindings.values()) unsub();
        this.#holder.bindings.clear();
        this.#holder.boundSignals.clear();
        for (const sig of this.#holder.signals.values()) sig.dispose();
        this.#holder.signals.clear();
        for (const sig of this.#holder.lengthSignals.values()) sig.dispose();
        this.#holder.lengthSignals.clear();
        this.#holder.handles.clear();
    }

    // -------------------------------------------------------------------------
    // Internal
    // -------------------------------------------------------------------------

    #getArr(): T[] | undefined {
        if (this.#holder.unset) return undefined;
        return getAtPath(this.#holder.state, this.#prefix) as T[] | undefined;
    }

    #getOrCreateLengthSignal(): Signal<number> {
        let sig = this.#holder.lengthSignals.get(this.#prefix);
        if (!sig) {
            const arr = this.#getArr();
            const len = arr ? arr.length : 0;
            sig = untrack(() => Signal.create<number>(len));
            this.#holder.lengthSignals.set(this.#prefix, sig);
        }
        return sig;
    }
}

// ---------------------------------------------------------------------------
// Ref<T>
// ---------------------------------------------------------------------------

/**
 * A reactive mutable container for structured objects and arrays.
 *
 * `Ref<T>` tracks per-path subscriptions. Each `get(path)` call inside a
 * reactive context registers exactly that path as a dependency — changes to
 * other paths do not re-run the computation.
 *
 * Internally, a lazy `Signal` is created for each accessed path. All
 * sub-Refs created via `.at(path)` share the same internal signal map and
 * state holder as the root `Ref`.
 *
 * **`set(path, value)`** — replaces the subtree at `path` and notifies all
 * signals at related paths (the exact path, descendants, and ancestors).
 * No structural diffing is performed.
 *
 * **`patch(path, value)`** — deep-diffs the new value against the current
 * value and notifies only the signals whose values actually changed.
 * Reference equality is checked at each node before recursing.
 *
 * **`.at(path)`** — returns a stable reactive handle:
 * - Array path → `RefArray<E>`, a scoped reactive array.
 * - Object path → `Ref<V>`, a scoped view that forwards mutations to the
 *   root's signal map.
 * - Primitive (leaf) path → `Derived<V>`, a writable reactive handle that
 *   routes reads and writes through the Ref's signal machinery.
 *
 * @example
 * const state = Ref.create({ user: { name: "Alice", age: 30 }, scores: [1, 2, 3] });
 *
 * watchEffect(async () => {
 *   console.log(state.get("user.name")); // reruns only when user.name changes
 * }, onChange);
 *
 * state.set("scores", [1, 2, 3, 4]);              // replace array
 * state.patch("user", { name: "Bob", age: 30 });  // only notifies "user.name"
 * state.push("scores", 5);                         // appends 5
 *
 * const scoresRef  = state.at("scores");           // RefArray<number>
 * const userRef    = state.at("user");             // Ref<{ name: string; age: number }>
 * const nameHandle = state.at("user.name");        // Derived<string>
 */
export class Ref<T extends object> {
    readonly #holder: RefHolder;
    readonly #prefix: string;

    private constructor(holder: RefHolder, prefix: string) {
        this.#holder = holder;
        this.#prefix = prefix;
    }

    /** Create a `RefArray<E>` from a typed array literal — unwraps `T[]` to `RefArray<T>`. */
    static create<T extends unknown[]>(initial: T): RefArray<T[number]>;
    /** Create a `RefArray<T>` from a root array. */
    static create<T>(initial: T[]): RefArray<T>;
    /** Create a Ref with an initial value (active state). */
    static create<T extends object>(initial: T): Ref<T>;
    /**
     * Create a Ref in `Unset` state — no initial value.
     * `get(path)` returns `undefined` until the first `set(path, value)` call.
     */
    static create<T extends object>(): Ref<T>;
    static create<T extends object>(initial?: T | T[]): Ref<T> | RefArray<any> {
        if (Array.isArray(initial)) {
            return RefArray.create(initial);
        }
        const owner = getCurrentComputation();
        const holder: RefHolder = {
            state: initial ?? null,
            unset: initial === undefined,
            signals: new Map(),
            lengthSignals: new Map(),
            handles: new Map(),
            bindings: new Map(),
            boundSignals: new Map(),
            disposed: false,
        };
        const ref = new Ref<T>(holder, "");
        if (owner) owner.cleanups.add(() => ref.dispose());
        return ref;
    }

    /** `true` if this Ref was created without an initial value and has not been set yet. */
    get isUnset(): boolean {
        return this.#holder.unset;
    }

    /**
     * Read the entire object and register it as a dependency. Re-evaluates on any mutation.
     * Returns `undefined` if the Ref is in Unset state.
     */
    get(): T | undefined
    /**
     * Read the value at `path` and register it as a dependency in the active
     * tracking context. Returns `undefined` if the Ref is in Unset state or
     * if the path does not resolve to a value.
     */
    get<P extends Path<T>>(path: P): PathValue<T, P> | undefined
    get<P extends Path<T>>(path?: P): T | PathValue<T, P> | undefined {
        if (path === undefined) {
            getOrCreateSignal(this.#holder, this.#prefix).get();
            if (this.#holder.unset) return undefined;
            return getAtPath(this.#holder.state, this.#prefix) as T;
        }
        const fullPath = resolveFullPath(this.#prefix, path as string);
        getOrCreateSignal(this.#holder, fullPath).get();
        if (this.#holder.unset) return undefined;
        return getAtPath(this.#holder.state, fullPath) as PathValue<T, P>;
    }

    /**
     * Read the entire object without registering a reactive dependency.
     * Returns `undefined` if the Ref is in Unset state.
     */
    peek(): T | undefined
    /**
     * Read the value at `path` without registering a reactive dependency.
     */
    peek<P extends Path<T>>(path: P): PathValue<T, P> | undefined
    peek<P extends Path<T>>(path?: P): T | PathValue<T, P> | undefined {
        return path === undefined
            ? untrack(() => this.get())
            : untrack(() => this.get(path));
    }

    /**
     * Replace the subtree at `path` with `value` and notify all reactive
     * subscribers at related paths (the path itself, descendants, and ancestors).
     * No structural diffing is performed.
     *
     * Equality guard: if `value === current`, no update occurs.
     * Use `patch` when only some fields of a sub-object changed.
     */
    set<P extends Path<T>>(path: P, value: PathValue<T, P>): void {
        if (this.#holder.disposed) return;
        const fullPath = resolveFullPath(this.#prefix, path as string);
        const current = this.#holder.unset
            ? undefined
            : getAtPath(this.#holder.state, fullPath);
        if (current === value) return;
        // Implicitly unbind — a plain write always wins over a live binding
        const unsub = this.#holder.bindings.get(fullPath);
        if (unsub) {
            unsub();
            this.#holder.bindings.delete(fullPath);
            this.#holder.boundSignals.delete(fullPath);
        }
        this.#holder.state = this.#holder.unset
            ? setAtPath(null, fullPath, value)
            : setAtPath(this.#holder.state, fullPath, value);
        this.#holder.unset = false;
        this.#notifyRelated(fullPath);
    }

    /**
     * Deep-diff `value` against the current value at `path` and notify only
     * the signals at paths whose values actually changed.
     *
     * Reference equality is applied at each node before recursing — if a
     * subtree reference is unchanged, that subtree is skipped entirely.
     *
     * Equality guard: if `value === current` at the root, no update occurs.
     */
    patch<P extends Path<T>>(path: P, value: PathValue<T, P>): void {
        if (this.#holder.disposed) return;
        const fullPath = resolveFullPath(this.#prefix, path as string);
        const current = this.#holder.unset
            ? undefined
            : getAtPath(this.#holder.state, fullPath);
        if (current === value) return;

        const changes: Array<[string, unknown]> = [];
        collectLeafChanges(fullPath, current, value, changes);
        if (changes.length === 0) return;

        let next: unknown = this.#holder.unset ? null : this.#holder.state;
        for (const [p, v] of changes) next = setAtPath(next, p, v);
        this.#holder.state = next;
        this.#holder.unset = false;

        const toNotify = new Set<string>();
        toNotify.add(fullPath);
        for (const [p] of changes) {
            toNotify.add(p);
            const parts = p.split(".");
            for (let i = parts.length - 1; i > 0; i--) {
                toNotify.add(parts.slice(0, i).join("."));
            }
        }
        for (const p of toNotify) {
            const sig = this.#holder.signals.get(p);
            if (sig) sig.set(getAtPath(this.#holder.state, p));
        }
    }

    /**
     * Returns a stable reactive handle for the subtree or leaf at `path`.
     *
     * - **Array path** → `RefArray<E>`, a scoped reactive array.
     * - **Object path** → `Ref<V>`, a scoped view into this Ref's internal state.
     *   Mutations forward to the root's signal map. Repeated calls return the
     *   identical `Ref<V>` instance.
     * - **Primitive (leaf) path** → `Derived<V>`, a writable reactive handle.
     *   Reads track through this Ref's signal for `path`. Writes route back
     *   through `set(path, value)`. Repeated calls return the same `Derived<V>`.
     *
     * @example
     * const scoresRef = state.at("scores");    // RefArray<number>
     * const userRef   = state.at("user");      // Ref<{ name: string; age: number }>
     * const nameD     = state.at("user.name"); // Derived<string>
     * nameD.get();                             // tracked read
     * nameD.set("Bob");                        // forwards to state.set("user.name", "Bob")
     */
    at<P extends Path<T>>(
        path: P,
    ): PathValue<T, P> extends any[]
        ? RefArray<PathValue<T, P>[number]>
        : PathValue<T, P> extends object
          ? Ref<PathValue<T, P> & object>
          : Derived<PathValue<T, P> | undefined> {
        const fullPath = resolveFullPath(this.#prefix, path as string);
        const cached = this.#holder.handles.get(fullPath);
        if (cached) return cached as any;

        const currentValue = this.#holder.unset
            ? undefined
            : getAtPath(this.#holder.state, fullPath);

        let handle: Ref<any> | Derived<unknown> | RefArray<any>;
        if (Array.isArray(currentValue)) {
            // Array path → shared RefArray
            handle = RefArray._fromHolder(this.#holder, fullPath);
        } else if (isObjectLike(currentValue)) {
            // Object path — scoped sub-Ref sharing the same holder
            handle = new Ref(this.#holder, fullPath);
        } else {
            // Primitive or undefined — writable Derived that routes through Ref
            // eslint-disable-next-line @typescript-eslint/no-this-alias
            const self = this;
            handle = untrack(() =>
                Derived.create({
                    get: (): PathValue<T, P> | undefined => self.get(path),
                    set: (v: PathValue<T, P> | undefined) => {
                        if (v !== undefined) self.set(path, v);
                    },
                }),
            ) as Derived<unknown>;
        }

        this.#holder.handles.set(fullPath, handle as any);
        return handle as any;
    }

    /**
     * Append one or more items to the end of the array at `path`.
     * Notifies signals at the new indices and ancestor paths.
     */
    push<P extends ArrayPath<T>>(path: P, ...items: ArrayItem<T, P>[]): void {
        if (this.#holder.disposed) return;
        const fullPath = resolveFullPath(this.#prefix, path as string);
        const arr = (getAtPath(this.#holder.state, fullPath) as unknown[]) ?? [];
        applyArrayMutation(this.#holder, fullPath, arr, [...arr, ...items]);
    }

    /**
     * Remove and return the last element of the array at `path`.
     * Notifies signals at the removed index and ancestor paths.
     * Returns `Option.Some(value)` on success, `Option.None()` if the array is empty.
     */
    pop<P extends ArrayPath<T>>(path: P): Option<ArrayItem<T, P>> {
        if (this.#holder.disposed) return Option.None();
        const fullPath = resolveFullPath(this.#prefix, path as string);
        const arr = (getAtPath(this.#holder.state, fullPath) as unknown[]) ?? [];
        if (arr.length === 0) return Option.None();
        applyArrayMutation(this.#holder, fullPath, arr, arr.slice(0, -1));
        return Option.Some(arr[arr.length - 1] as ArrayItem<T, P>);
    }

    /**
     * Remove and/or insert elements in the array at `path`, starting at `start`.
     * Signals at affected indices and ancestor paths are notified.
     * Signals for indices that no longer exist (array shrink) are disposed.
     */
    splice<P extends ArrayPath<T>>(
        path: P,
        start: number,
        deleteCount: number,
        ...items: ArrayItem<T, P>[]
    ): void {
        if (this.#holder.disposed) return;
        const fullPath = resolveFullPath(this.#prefix, path as string);
        const arr = (getAtPath(this.#holder.state, fullPath) as unknown[]) ?? [];
        const newArr = [...arr];
        newArr.splice(start, deleteCount, ...items);
        applyArrayMutation(this.#holder, fullPath, arr, newArr);
    }

    /**
     * Swap the elements at indices `from` and `to` in the array at `path`.
     * Only signals at those two indices and ancestor paths are notified.
     */
    move<P extends ArrayPath<T>>(path: P, from: number, to: number): void {
        if (this.#holder.disposed) return;
        const fullPath = resolveFullPath(this.#prefix, path as string);
        const arr = (getAtPath(this.#holder.state, fullPath) as unknown[]) ?? [];
        if (from === to || from >= arr.length || to >= arr.length) return;
        const newArr = [...arr];
        [newArr[from], newArr[to]] = [newArr[to], newArr[from]];
        applyArrayMutation(this.#holder, fullPath, arr, newArr);
    }

    /**
     * Establish a live binding from `signal` to `path`.
     *
     * When `signal` changes, the Ref path is updated synchronously. Re-binding
     * a path silently replaces the existing subscription. Calling `set(path, v)`
     * after binding implicitly unbinds — plain writes always win.
     *
     * When the source signal is disposed, the path receives `undefined` and
     * the binding is released.
     */
    bind<P extends Path<T>>(path: P, signal: Signal<PathValue<T, P>>): void {
        if (this.#holder.disposed) return;
        const fullPath = resolveFullPath(this.#prefix, path as string);
        this.#attachBinding(fullPath, signal as Signal<unknown>);
    }

    /**
     * Release the binding at `path` without writing a value.
     * The path retains its last known value. No-op if no binding exists.
     */
    unbind<P extends Path<T>>(path: P): void {
        const fullPath = resolveFullPath(this.#prefix, path as string);
        const unsub = this.#holder.bindings.get(fullPath);
        if (unsub) {
            unsub();
            this.#holder.bindings.delete(fullPath);
            this.#holder.boundSignals.delete(fullPath);
        }
    }

    /**
     * Returns the raw bound `Signal` at `path`, or `null` if no binding exists.
     *
     * Use this to access the full custom state `S` of a `Signal<T, S>` that
     * was bound via `.bind()`. `.at()` and `.maybeAt()` only expose the
     * extracted `T` value.
     */
    boundAt<P extends Path<T>>(path: P): Signal<PathValue<T, P>> | null {
        const fullPath = resolveFullPath(this.#prefix, path as string);
        return (this.#holder.boundSignals?.get(fullPath) as Signal<PathValue<T, P>>) ?? null;
    }

    /**
     * Dispose this Ref and all internal reactive nodes.
     *
     * No-op on sub-Refs created via `.at()` — only the root Ref (created via
     * `Ref.create()`) owns the internal state and can be disposed.
     */
    dispose(): void {
        if (this.#prefix !== "") return; // sub-Refs are not root owners
        if (this.#holder.disposed) return;
        this.#holder.disposed = true;
        for (const unsub of this.#holder.bindings.values()) unsub();
        this.#holder.bindings.clear();
        this.#holder.boundSignals.clear();
        for (const sig of this.#holder.signals.values()) sig.dispose();
        this.#holder.signals.clear();
        for (const sig of this.#holder.lengthSignals.values()) sig.dispose();
        this.#holder.lengthSignals.clear();
        this.#holder.handles.clear();
    }

    /**
     * Remove the value at `path` and all descendant paths.
     *
     * All descendant signals receive `undefined` and notify their subscribers.
     * Cached `.at()` sub-Ref handles remain alive and transition to `isUnset`.
     * Any binding at `path` or a descendant is also released.
     * `get(path)` returns `undefined` after deletion.
     */
    delete<P extends Path<T>>(path: P): void {
        if (this.#holder.disposed) return;
        const fullPath = resolveFullPath(this.#prefix, path as string);

        // Release any bindings at or under this path
        for (const [key, unsub] of [...this.#holder.bindings]) {
            if (key === fullPath || key.startsWith(fullPath + ".")) {
                unsub();
                this.#holder.bindings.delete(key);
            }
        }

        // Remove the subtree from state
        this.#holder.state = this.#deleteAtPath(this.#holder.state, fullPath.split("."));

        // If root state becomes empty/null, mark unset
        if (this.#prefix === "" && (this.#holder.state === null || this.#holder.state === undefined)) {
            this.#holder.unset = true;
        }

        // Notify all signals at or under fullPath with undefined
        for (const [key, sig] of this.#holder.signals) {
            if (key === fullPath || key.startsWith(fullPath + ".")) {
                sig.set(undefined as unknown);
            }
        }

        // Update ancestor signals to reflect the structural change
        const parts = fullPath.split(".");
        for (let i = parts.length - 1; i > 0; i--) {
            const ancestorPath = parts.slice(0, i).join(".");
            const sig = this.#holder.signals.get(ancestorPath);
            if (sig) sig.set(getAtPath(this.#holder.state, ancestorPath));
        }

        // Transition any cached sub-Ref handle to isUnset
        const subRef = this.#holder.handles.get(fullPath);
        if (subRef instanceof Ref) {
            subRef.#holder.unset = true;
        }
    }

    /**
     * Returns a `Derived<Option<V>>` handle for `path` — `Some(value)` when
     * the path exists, `None` when deleted or unset.
     *
     * Use this when you need to observe the presence or absence of a path.
     * `.at()` is unchanged and deletion-unaware.
     */
    maybeAt<P extends Path<T>>(
        path: P,
    ): Derived<Option<PathValue<T, P>>> {
        // eslint-disable-next-line @typescript-eslint/no-this-alias
        const self = this;
        return untrack(() =>
            Derived.create((): Option<PathValue<T, P>> => {
                const value = self.get(path);
                return value === undefined
                    ? Option.None()
                    : Option.Some(value as NonNullable<PathValue<T, P>>);
            }),
        );
    }

    // -------------------------------------------------------------------------
    // Internal
    // -------------------------------------------------------------------------

    #attachBinding(fullPath: string, signal: Signal<unknown>): void {
        // Release any existing binding at this path
        const existing = this.#holder.bindings.get(fullPath);
        if (existing) {
            existing();
            this.#holder.bindings.delete(fullPath);
            this.#holder.boundSignals.delete(fullPath);
        }

        // Write the current value immediately
        const current = signal.get();
        this.#setRaw(fullPath, current);

        // Subscribe for future changes
        const unsub = signal.subscribe((value) => {
            if (value === null) {
                // Source signal disposed — push undefined and release binding
                this.#setRaw(fullPath, undefined);
                this.#holder.bindings.delete(fullPath);
                this.#holder.boundSignals.delete(fullPath);
            } else {
                this.#setRaw(fullPath, value);
            }
        });

        this.#holder.bindings.set(fullPath, unsub);
        this.#holder.boundSignals.set(fullPath, signal);
    }

    /** Write a value directly to the state + notify related signals, without unbinding. */
    #setRaw(fullPath: string, value: unknown): void {
        this.#holder.state = this.#holder.unset
            ? setAtPath(null, fullPath, value)
            : setAtPath(this.#holder.state, fullPath, value);
        this.#holder.unset = false;
        this.#notifyRelated(fullPath);
    }

    #deleteAtPath(obj: unknown, parts: string[]): unknown {
        if (parts.length === 0 || obj == null) return obj;
        const [head, ...tail] = parts;
        if (tail.length === 0) {
            if (Array.isArray(obj)) {
                const arr = [...obj];
                arr.splice(Number(head), 1);
                return arr;
            }
            const record = { ...(obj as Record<string, unknown>) };
            delete record[head];
            return record;
        }
        if (Array.isArray(obj)) {
            const arr = [...obj];
            arr[Number(head)] = this.#deleteAtPath(arr[Number(head)], tail);
            return arr;
        }
        const record = { ...(obj as Record<string, unknown>) };
        record[head] = this.#deleteAtPath(record[head], tail);
        return record;
    }

    #notifyRelated(changedPath: string): void {
        for (const [key, sig] of this.#holder.signals) {
            if (isRelated(key, changedPath)) {
                sig.set(getAtPath(this.#holder.state, key));
            }
        }
    }
}
