/**
 * Tracking context and owner tree for the reactive signal system.
 *
 * Signals and derived values use an implicit global computation stack to
 * auto-track dependencies when read inside a reactive context. The owner
 * tree provides structured cleanup — disposing a context recursively
 * disposes all signals, derived values, and effects it owns.
 */

export type Computation = {
    /** Called by a dependency when its value changes. */
    dirty(): void;
    /** Dispose this computation and all its children and cleanups. */
    dispose(): void;
    /** Signals or derived nodes this computation currently reads. */
    sources: Set<{ unsubscribe(c: Computation): void }>;
    /** Parent in the owner tree, or null for root contexts. */
    owner: Computation | null;
    /** Child computations owned by this one. */
    children: Set<Computation>;
    /** Arbitrary cleanup callbacks registered by owned resources. */
    cleanups: Set<() => void>;
};

const stack: Computation[] = [];

/** Returns the currently-executing computation, or null if outside any context. */
export function getCurrentComputation(): Computation | null {
    return stack.length > 0 ? stack[stack.length - 1] : null;
}

/**
 * Run `fn` with `computation` as the active tracking context.
 * Any signal reads inside `fn` will register `computation` as a subscriber.
 */
export function trackIn<T>(computation: Computation, fn: () => T): T {
    stack.push(computation);
    try {
        return fn();
    } finally {
        stack.pop();
    }
}

/**
 * Create a new owner node in the computation tree.
 * If `parent` is not provided, the current computation is used as the parent.
 * Pass `null` explicitly to create a root owner with no parent.
 */
export function createOwner(parent?: Computation | null): Computation {
    const p = parent !== undefined ? parent : getCurrentComputation();

    const owner: Computation = {
        dirty() {},
        dispose() {
            for (const cleanup of [...owner.cleanups]) cleanup();
            owner.cleanups.clear();
            for (const child of [...owner.children]) child.dispose();
            owner.children.clear();
            for (const source of [...owner.sources]) source.unsubscribe(owner);
            owner.sources.clear();
            if (owner.owner) owner.owner.children.delete(owner);
        },
        sources: new Set(),
        owner: p,
        children: new Set(),
        cleanups: new Set(),
    };

    if (p) p.children.add(owner);
    return owner;
}

/**
 * Run a function inside a specific owner context.
 * Useful for associating reactivity across async or worker boundaries.
 *
 * @todo Implement full cross-boundary context passing (worker/SSR support).
 * Currently equivalent to `trackIn(owner, fn)`.
 */
export function runInContext<T>(owner: Computation, fn: () => T): T {
    return trackIn(owner, fn);
}

/**
 * Batch multiple signal writes into a single notification pass,
 * preventing intermediate re-evaluations.
 *
 * @todo Not yet implemented — currently executes `fn` immediately without batching.
 * The API surface is intentionally locked here so future batching is non-breaking.
 */
export function batch(fn: () => void): void {
    fn();
}
