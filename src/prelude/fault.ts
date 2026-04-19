import { union, Trait, type Variant } from "../union.ts";

// ---------------------------------------------------------------------------
// Fault<E> — flat error union for async reactive pipelines
// ---------------------------------------------------------------------------
//
// Three variants cover every failure mode in AsyncDerived and watchEffect:
//
//   Fail<E>      — expected domain error; user threw Fault.Fail(myError)
//   Defect       — unexpected runtime panic; any unrecognised throw
//   Interrupted  — AbortSignal fired before the thunk completed
//
// Detection order in catch blocks:
//   1. instanceOf(Fault.Fail, e)  → Fail<E>
//   2. signal.aborted             → Interrupted(signal.reason)
//   3. otherwise                  → Defect(e)

abstract class FaultBase extends Trait {}

/**
 * An expected, domain-level error explicitly thrown by the thunk via
 * `throw Fault.Fail(myError)`. Retried by default when a `schedule` is
 * configured.
 *
 * @example throw Fault.Fail(new ApiError(response.status))
 */
export type Fail<E>      = Variant<"Fail",        { error: E },           FaultBase>;

/**
 * An unexpected thrown value — a runtime panic, null dereference, or any
 * value not explicitly wrapped with `Fault.Fail`. Not retried by default.
 *
 * Created automatically by the internal classification logic; rarely
 * constructed directly.
 */
export type Defect       = Variant<"Defect",       { thrown: unknown },    FaultBase>;

/**
 * The `AbortSignal` fired before the thunk completed. Occurs when a reactive
 * dependency changed, `.dispose()` was called, or a timeout fired. Not
 * retried by default.
 *
 * `reason` contains whatever was passed to `controller.abort(reason)`, or
 * `undefined` if no reason was provided.
 */
export type Interrupted  = Variant<"Interrupted",  { reason?: unknown },   FaultBase>;

/**
 * A three-variant union classifying every failure in an async reactive
 * pipeline.
 *
 * - `Fault.Fail<E>` — expected domain error; throw `Fault.Fail(e)` to signal it
 * - `Fault.Defect` — unexpected panic; any thrown value not wrapped in `Fault.Fail`
 * - `Fault.Interrupted` — `AbortSignal` fired before the thunk completed
 *
 * Only `Fault.Fail` is retried by default. Override `AsyncOptions.shouldRetry`
 * to change this behaviour.
 *
 * @example
 * import { match } from "aljabr"
 *
 * match(fault, {
 *   Fail:        ({ error })  => handleDomainError(error),
 *   Defect:      ({ thrown }) => reportBug(thrown),
 *   Interrupted: ()           => {},  // aborted — usually safe to ignore
 * })
 */
export type Fault<E> = Fail<E> | Defect | Interrupted;

export const Fault = union([FaultBase]).typed({
    /**
     * Wrap a domain error as an expected, retryable failure.
     * @example throw Fault.Fail(new ApiError(res.status))
     */
    Fail:        <E>(error: E)          => ({ error })   as Fail<E>,
    /**
     * Wrap an unexpected thrown value as a non-retryable panic.
     * Typically created by the internal `classifyError` helper.
     */
    Defect:      (thrown: unknown)      => ({ thrown })  as Defect,
    /**
     * Signal that the `AbortSignal` fired before the thunk completed.
     * Typically created by the internal `classifyError` helper.
     */
    Interrupted: (reason?: unknown)     => ({ reason })  as Interrupted,
});
