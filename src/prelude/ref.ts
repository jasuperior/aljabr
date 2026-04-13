import { Signal } from "./signal.ts";
import { Derived } from "./derived.ts";
import { getCurrentComputation, untrack } from "./context.ts";

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
    handles: Map<string, Ref<any> | Derived<unknown>>;
    disposed: boolean;
};

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function resolveFullPath(prefix: string, path: string): string {
    return prefix ? `${prefix}.${path}` : path;
}

function getAtPath(obj: unknown, path: string): unknown {
    const parts = path.split(".");
    let current = obj;
    for (const part of parts) {
        if (current == null) return undefined;
        current = (current as Record<string, unknown>)[part];
    }
    return current;
}

function setAtPath(obj: unknown, path: string, value: unknown): unknown {
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
                collectLeafChanges(`${path}.${i}`, oldVal[i], newVal[i], out);
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
                collectLeafChanges(
                    `${path}.${key}`,
                    oldObj[key],
                    newObj[key],
                    out,
                );
            }
            return;
        }
    }

    // Leaf: primitives differ, or type mismatch (object ↔ primitive, array ↔ object, etc.)
    out.push([path, newVal]);
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
 * - Object or array path → `Ref<V>`, a scoped view that forwards mutations
 *   to the root's signal map.
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
 * const userRef = state.at("user");               // Ref<{ name: string; age: number }>
 * const nameHandle = state.at("user.name");       // Derived<string>
 */
export class Ref<T extends object> {
    readonly #holder: RefHolder;
    readonly #prefix: string;

    private constructor(holder: RefHolder, prefix: string) {
        this.#holder = holder;
        this.#prefix = prefix;
    }

    /** Create a Ref with an initial value (active state). */
    static create<T extends object>(initial: T): Ref<T>;
    /**
     * Create a Ref in `Unset` state — no initial value.
     * `get(path)` returns `undefined` until the first `set(path, value)` call.
     * Check `ref.isUnset` before reading.
     */
    static create<T extends object>(): Ref<T>;
    static create<T extends object>(initial?: T): Ref<T> {
        const owner = getCurrentComputation();
        const holder: RefHolder = {
            state: initial ?? null,
            unset: initial === undefined,
            signals: new Map(),
            handles: new Map(),
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
     * Read the value at `path` and register it as a dependency in the active
     * tracking context. Returns `undefined` if the Ref is in Unset state or
     * if the path does not resolve to a value.
     */
    get<P extends Path<T>>(path: P): PathValue<T, P> | undefined {
        const fullPath = resolveFullPath(this.#prefix, path as string);
        this.#getOrCreateSignal(fullPath).get(); // tracked — registers dependency
        if (this.#holder.unset) return undefined;
        return getAtPath(this.#holder.state, fullPath) as PathValue<T, P>;
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
     * - **Object or array path** → `Ref<V>`, a scoped view into this Ref's
     *   internal state. Its mutations forward to the root's signal map. Repeated
     *   calls with the same `path` return the identical `Ref<V>` instance.
     * - **Primitive (leaf) path** → `Derived<V>`, a writable reactive handle.
     *   Reads track through this Ref's signal for `path`. Writes route back
     *   through `set(path, value)`. Repeated calls return the same `Derived<V>`.
     *
     * @example
     * const userRef  = state.at("user");       // Ref<{ name: string; age: number }>
     * const nameD    = state.at("user.name");  // Derived<string>
     * nameD.get();                             // tracked read
     * nameD.set("Bob");                        // forwards to state.set("user.name", "Bob")
     */
    at<P extends Path<T>>(
        path: P,
    ): PathValue<T, P> extends object
        ? Ref<PathValue<T, P> & object>
        : Derived<PathValue<T, P> | undefined> {
        const fullPath = resolveFullPath(this.#prefix, path as string);
        const cached = this.#holder.handles.get(fullPath);
        if (cached) return cached as any;

        const currentValue = this.#holder.unset
            ? undefined
            : getAtPath(this.#holder.state, fullPath);

        let handle: Ref<any> | Derived<unknown>;
        if (isObjectLike(currentValue)) {
            // Object or array — scoped sub-Ref sharing the same holder
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
        this.#applyArrayMutation(fullPath, arr, [...arr, ...items]);
    }

    /**
     * Remove and return the last element of the array at `path`.
     * Notifies signals at the removed index and ancestor paths.
     * Returns `undefined` if the array is empty.
     */
    pop<P extends ArrayPath<T>>(path: P): ArrayItem<T, P> | undefined {
        if (this.#holder.disposed) return undefined;
        const fullPath = resolveFullPath(this.#prefix, path as string);
        const arr = (getAtPath(this.#holder.state, fullPath) as unknown[]) ?? [];
        if (arr.length === 0) return undefined;
        this.#applyArrayMutation(fullPath, arr, arr.slice(0, -1));
        return arr[arr.length - 1] as ArrayItem<T, P>;
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
        this.#applyArrayMutation(fullPath, arr, newArr);
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
        this.#applyArrayMutation(fullPath, arr, newArr);
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
        for (const sig of this.#holder.signals.values()) sig.dispose();
        this.#holder.signals.clear();
        this.#holder.handles.clear();
    }

    // -------------------------------------------------------------------------
    // Internal
    // -------------------------------------------------------------------------

    #getOrCreateSignal(fullPath: string): Signal<unknown> {
        let sig = this.#holder.signals.get(fullPath);
        if (!sig) {
            const value =
                this.#holder.unset
                    ? undefined
                    : getAtPath(this.#holder.state, fullPath);
            sig = untrack(() => Signal.create<unknown>(value as unknown));
            this.#holder.signals.set(fullPath, sig);
        }
        return sig;
    }

    #notifyRelated(changedPath: string): void {
        for (const [key, sig] of this.#holder.signals) {
            if (isRelated(key, changedPath)) {
                sig.set(getAtPath(this.#holder.state, key));
            }
        }
    }

    #applyArrayMutation(
        fullPath: string,
        oldArr: unknown[],
        newArr: unknown[],
    ): void {
        this.#holder.state = setAtPath(this.#holder.state, fullPath, newArr);
        this.#holder.unset = false;

        // Collect changed leaves and build the notify set
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
            const sig = this.#holder.signals.get(p);
            if (sig) sig.set(getAtPath(this.#holder.state, p));
        }

        // Dispose signals for indices that no longer exist after a shrink
        if (newArr.length < oldArr.length) {
            this.#cleanupOutOfRangeSignals(fullPath, newArr.length);
        }
    }

    #cleanupOutOfRangeSignals(arrayPath: string, newLength: number): void {
        const prefix = arrayPath + ".";
        for (const [key, sig] of [...this.#holder.signals]) {
            if (!key.startsWith(prefix)) continue;
            const rest = key.slice(prefix.length);
            const index = Number(rest.split(".")[0]);
            if (!isNaN(index) && index >= newLength) {
                sig.dispose();
                this.#holder.signals.delete(key);
                this.#holder.handles.delete(key);
            }
        }
    }
}
