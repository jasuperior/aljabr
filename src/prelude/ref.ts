import { Signal } from "./signal.ts";
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
export type PathValue<
    T,
    P extends string,
> = P extends `${infer K}.${infer Rest}`
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
// Internal helpers
// ---------------------------------------------------------------------------

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

// Returns true if `signalPath` should be notified when `changedPath` mutates.
// A signal is affected if it is the changed path itself, a descendant of it,
// or an ancestor of it (e.g. "user" is affected when "user.name" changes).
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
 * Internally, a lazy `Signal` is created for each accessed path. State is
 * updated immutably so ancestor path signals always receive fresh references
 * on mutation.
 *
 * **`set(path, value)`** — replaces the subtree at `path` and notifies all
 * signals at related paths (the exact path, descendants, and ancestors).
 * No structural diffing is performed.
 *
 * **`patch(path, value)`** — deep-diffs the new value against the current
 * value and notifies only the signals whose values actually changed.
 * Reference equality is checked at each node before recursing.
 *
 * @example
 * const state = Ref.create({ user: { name: "Alice", age: 30 }, score: 0 });
 *
 * watchEffect(async () => {
 *   console.log(state.get("user.name")); // only reruns when user.name changes
 * }, onChange);
 *
 * state.set("score", 10);                        // notifies "score" subscribers
 * state.patch("user", { name: "Bob", age: 30 }); // only notifies "user.name" subscribers
 */
export class Ref<T extends object> {
    #state: T;
    #signals = new Map<string, Signal<unknown>>();
    #disposed = false;

    private constructor(initial: T) {
        this.#state = initial;
    }

    /**
     * Create a Ref with an initial value.
     * If called inside a reactive context, the Ref is automatically disposed
     * when that context is disposed.
     */
    static create<T extends object>(initial: T): Ref<T> {
        const owner = getCurrentComputation();
        const ref = new Ref(initial);
        if (owner) owner.cleanups.add(() => ref.dispose());
        return ref;
    }

    /**
     * Read the value at `path` and register it as a dependency in the active
     * tracking context. Only this exact path is subscribed — changes to sibling
     * or unrelated paths will not re-run the computation.
     */
    get<P extends Path<T>>(path: P): PathValue<T, P> {
        const sig = this.#getOrCreateSignal(path as string);
        sig.get(); // tracked — registers dependency in current computation
        return getAtPath(this.#state, path as string) as PathValue<T, P>;
    }

    /**
     * Replace the subtree at `path` with `value` and notify all reactive
     * subscribers at related paths.
     *
     * Equality guard: if `value === current`, no update occurs.
     * No structural diffing — all existing signals under `path` are notified.
     * Use `patch` when only some fields of a sub-object changed.
     */
    set<P extends Path<T>>(path: P, value: PathValue<T, P>): void {
        if (this.#disposed) return;
        if (getAtPath(this.#state, path as string) === value) return;
        this.#state = setAtPath(this.#state, path as string, value) as T;
        this.#notifyRelated(path as string);
    }

    /**
     * Deep-diff `value` against the current value at `path` and notify only
     * the signals at paths whose values actually changed.
     *
     * Reference equality is applied at each node before recursing — if a
     * subtree reference is unchanged, it is skipped entirely.
     *
     * Equality guard: if `value === current` at the root, no update occurs.
     */
    patch<P extends Path<T>>(path: P, value: PathValue<T, P>): void {
        if (this.#disposed) return;
        const current = getAtPath(this.#state, path as string);
        if (current === value) return;

        const changes: Array<[string, unknown]> = [];
        collectLeafChanges(path as string, current, value, changes);
        if (changes.length === 0) return;

        // Apply all leaf changes, building a new root via immutable updates.
        let next: unknown = this.#state;
        for (const [p, v] of changes) {
            next = setAtPath(next, p, v);
        }
        this.#state = next as T;

        // Collect all paths to notify: each changed leaf plus all their ancestors.
        const toNotify = new Set<string>();
        toNotify.add(path as string);
        for (const [p] of changes) {
            toNotify.add(p);
            const parts = p.split(".");
            for (let i = parts.length - 1; i > 0; i--) {
                toNotify.add(parts.slice(0, i).join("."));
            }
        }

        for (const p of toNotify) {
            const sig = this.#signals.get(p);
            if (sig) sig.set(getAtPath(this.#state, p));
        }
    }

    /**
     * Dispose this Ref and all internal reactive nodes.
     * After disposal, `get`, `set`, and `patch` are no-ops.
     */
    dispose(): void {
        if (this.#disposed) return;
        this.#disposed = true;
        for (const sig of this.#signals.values()) sig.dispose();
        this.#signals.clear();
    }

    #getOrCreateSignal(path: string): Signal<unknown> {
        let sig = this.#signals.get(path);
        if (!sig) {
            const value = getAtPath(this.#state, path);
            // Create the signal outside the current tracking context so it is
            // owned by the Ref's lifecycle, not by the computation that first
            // accesses this path.
            sig = untrack(() => Signal.create<unknown>(value));
            this.#signals.set(path, sig);
        }
        return sig;
    }

    #notifyRelated(changedPath: string): void {
        for (const [key, sig] of this.#signals) {
            if (isRelated(key, changedPath)) {
                sig.set(getAtPath(this.#state, key));
            }
        }
    }
}
