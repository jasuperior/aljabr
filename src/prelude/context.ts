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

// ---------------------------------------------------------------------------
// Batch scheduler
// ---------------------------------------------------------------------------

let batchDepth = 0;
const pendingComputations = new Set<Computation>();

/**
 * Schedule a dirty notification for `comp`. If a batch is active the
 * notification is deferred; otherwise it fires immediately.
 *
 * Use this instead of calling `comp.dirty()` directly so that all
 * notification paths respect the current batch state.
 */
export function scheduleNotification(comp: Computation): void {
    if (batchDepth > 0) {
        pendingComputations.add(comp);
    } else {
        comp.dirty();
    }
}

function flushPending(): void {
    // Keep batchDepth elevated so that any dirty() calls made during the
    // flush (e.g. cascading Derived → subscriber propagation) are queued
    // rather than fired immediately, and picked up by the next while-iteration.
    batchDepth++;
    try {
        while (pendingComputations.size > 0) {
            const pending = [...pendingComputations];
            pendingComputations.clear();
            for (const comp of pending) comp.dirty();
        }
    } finally {
        batchDepth--;
    }
}

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
 * Run a function inside a specific owner context, re-establishing it as the
 * active computation so that:
 * - Signal reads inside `fn` register `owner` as a subscriber
 * - `Signal.create()` / `Derived.create()` calls inside `fn` are owned by `owner`
 *   and disposed when `owner` is disposed
 *
 * This is the primary tool for preserving reactive ownership across async
 * boundaries (e.g. after `await`, inside a `setTimeout`, or in a Worker).
 * Capture the owner before crossing the boundary, then call `runInContext`
 * on the other side to restore it.
 *
 * @example Async boundary
 * const owner = createOwner(null);
 * const result = await someAsyncWork();
 * // Re-enter the owner after the await to keep ownership intact
 * runInContext(owner, () => {
 *   const s = Signal.create(result); // owned by `owner`
 * });
 *
 * @example Worker boundary (conceptual)
 * // In main thread: capture the owner reference
 * const owner = createOwner(null);
 * // Pass owner.id or a serialized token to the worker, then on receipt:
 * runInContext(owner, () => processWorkerResult(data));
 */
export function runInContext<T>(owner: Computation, fn: () => T): T {
    return trackIn(owner, fn);
}

/**
 * Run `fn` outside any reactive tracking context.
 * Signal reads inside `fn` will not register dependencies, and
 * `Signal.create()` calls will not be auto-registered with any owner.
 *
 * Use this when you need to read a signal's current value without
 * subscribing, or when creating reactive nodes that should be owned
 * by a longer-lived context rather than the current computation.
 */
export function untrack<T>(fn: () => T): T {
    const saved = stack.splice(0);
    try {
        return fn();
    } finally {
        stack.push(...saved);
    }
}

/**
 * Batch multiple signal writes into a single notification pass.
 *
 * All `Signal.set()` calls inside `fn` are collected; dependents are
 * notified exactly once after `fn` returns, regardless of how many of
 * their dependencies changed. Nested `batch()` calls are safe — the
 * flush only runs when the outermost batch exits.
 *
 * @example
 * batch(() => {
 *   x.set(1);
 *   y.set(2); // dependents of x and y are notified once, not twice
 * });
 */
export function batch(fn: () => void): void {
    batchDepth++;
    try {
        fn();
    } finally {
        batchDepth--;
        if (batchDepth === 0) flushPending();
    }
}
