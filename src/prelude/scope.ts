import { union, Trait, type Variant, getTag } from "../union.ts";
import { createOwner } from "./context.ts";

// ---------------------------------------------------------------------------
// ScopeState — lifecycle union for a Scope
// ---------------------------------------------------------------------------

abstract class ScopeStateBase extends Trait {}

type Active   = Variant<"Active",   Record<never, never>, ScopeStateBase>;
type Disposed = Variant<"Disposed", Record<never, never>, ScopeStateBase>;

export type ScopeState = Active | Disposed;

export const ScopeState = union([ScopeStateBase]).typed({
    Active:   () => ({}) as Active,
    Disposed: () => ({}) as Disposed,
});

// ---------------------------------------------------------------------------
// Resource — acquire/release pairing
// ---------------------------------------------------------------------------

export interface ResourceHandle<T> {
    readonly acquire: () => Promise<T>;
    readonly release: (value: T) => Promise<void> | void;
}

/**
 * Pair an async acquisition function with a release function.
 * Resources are inert until consumed via `scope.acquire()` or the implicit `acquire()`.
 *
 * @example
 * const DbResource = Resource(
 *   () => connectToDb(url),
 *   (db) => db.disconnect(),
 * );
 */
export function Resource<T>(
    acquire: () => Promise<T>,
    release: (value: T) => Promise<void> | void,
): ResourceHandle<T> {
    return { acquire, release };
}

// ---------------------------------------------------------------------------
// Scope — structured resource lifetime
// ---------------------------------------------------------------------------

export interface ScopeHandle {
    /** Non-reactive lifecycle snapshot. Match against `Active` or `Disposed`. */
    readonly state: ScopeState;
    /**
     * Register a finalizer to run when this scope disposes.
     * Finalizers run in LIFO order. If the finalizer returns a Promise,
     * disposal awaits it before proceeding.
     */
    defer(fn: () => Promise<void> | void): void;
    /**
     * Acquire a resource. Calls `resource.acquire()` and automatically
     * registers `resource.release()` as a `defer` finalizer.
     */
    acquire<T>(resource: ResourceHandle<T>): Promise<T>;
    /** Run all finalizers in LIFO order, then dispose the scope. */
    dispose(): Promise<void>;
    /** TC39 Explicit Resource Management — alias for `dispose()`. */
    [Symbol.asyncDispose](): Promise<void>;
}

// ---------------------------------------------------------------------------
// Implicit scope stack (parallel to the computation stack in context.ts)
// ---------------------------------------------------------------------------

const scopeStack: ScopeHandle[] = [];

export function getCurrentScope(): ScopeHandle | null {
    return scopeStack.length > 0 ? scopeStack[scopeStack.length - 1] : null;
}

/**
 * Run `fn` with `scope` as the active scope context.
 * Implicit `defer()` and `acquire()` calls inside `fn` resolve to this scope.
 *
 * Only covers the synchronous execution frame — after an `await` boundary,
 * use the explicit `scope` argument passed to the thunk.
 */
export function runInScope<T>(scope: ScopeHandle, fn: () => T): T {
    scopeStack.push(scope);
    try {
        return fn();
    } finally {
        scopeStack.pop();
    }
}

// ---------------------------------------------------------------------------
// Implicit hooks
// ---------------------------------------------------------------------------

/**
 * Register a finalizer on the current scope.
 * Equivalent to `scope.defer(fn)` using the implicit ambient scope.
 *
 * @throws If called outside an active Scope context.
 */
export function defer(fn: () => Promise<void> | void): void {
    const scope = getCurrentScope();
    if (scope === null) {
        throw new Error("[aljabr] defer() called outside an active Scope");
    }
    scope.defer(fn);
}

/**
 * Acquire a resource via the current scope.
 * Equivalent to `scope.acquire(resource)` using the implicit ambient scope.
 *
 * Note: only resolves the current scope during the synchronous execution
 * frame of a thunk. After an `await`, use the explicit `scope` argument.
 *
 * @throws If called outside an active Scope context.
 */
export function acquire<T>(resource: ResourceHandle<T>): Promise<T> {
    const scope = getCurrentScope();
    if (scope === null) {
        throw new Error("[aljabr] acquire() called outside an active Scope");
    }
    return scope.acquire(resource);
}

// ---------------------------------------------------------------------------
// Scope factory
// ---------------------------------------------------------------------------

/**
 * Create a new Scope for structured resource management.
 *
 * Auto-parents to `getCurrentComputation()` when called inside a reactive
 * context — the scope disposes automatically when the owning computation
 * disposes. Pass a root scope when managing lifetime manually.
 *
 * Finalizers registered via `scope.defer()` run in LIFO order on disposal.
 * A rejected finalizer logs a warning and the chain continues.
 * Phase 5 will harden this boundary with defect tracking.
 *
 * @example Explicit lifecycle
 * const scope = Scope();
 * const db = await scope.acquire(DbResource);
 * await doWork(db);
 * await scope.dispose();
 *
 * @example TC39 explicit resource management
 * await using scope = Scope();
 * const db = await scope.acquire(DbResource);
 * // scope[Symbol.asyncDispose]() called automatically on block exit
 */
export function Scope(): ScopeHandle {
    const finalizers: Array<() => Promise<void> | void> = [];
    let scopeState: ScopeState = ScopeState.Active();

    const computation = createOwner();

    const runFinalizers = async (): Promise<void> => {
        for (let i = finalizers.length - 1; i >= 0; i--) {
            try {
                await finalizers[i]!();
            } catch (e) {
                // Phase 5 will harden this with defect tracking.
                console.warn("[aljabr] Scope finalizer threw:", e);
            }
        }
        finalizers.length = 0;
    };

    const handle: ScopeHandle = {
        get state() { return scopeState; },

        defer(fn) {
            finalizers.push(fn);
        },

        async acquire<T>(resource: ResourceHandle<T>): Promise<T> {
            const value = await resource.acquire();
            this.defer(() => resource.release(value));
            return value;
        },

        async dispose() {
            if (getTag(scopeState) === "Disposed") return;
            scopeState = ScopeState.Disposed();
            await runFinalizers();
            computation.dispose();
        },

        [Symbol.asyncDispose]() {
            return this.dispose();
        },
    };

    // Hook into parent cascade. When the owning computation disposes (e.g. a
    // parent watchEffect stops), fire-and-forget scope.dispose(). The async
    // finalizers will eventually run. Phase 5 will surface any errors here.
    computation.cleanups.add(() => {
        void handle.dispose();
    });

    return handle;
}
