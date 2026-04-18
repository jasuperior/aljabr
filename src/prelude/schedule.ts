import { union, Trait, type Variant } from "../union.ts";
import { match } from "../match.ts";

// ---------------------------------------------------------------------------
// Schedule — retry-delay policy union
// ---------------------------------------------------------------------------

abstract class ScheduleBase extends Trait {}

type Fixed       = Variant<"Fixed",       { delay: number },                                                                ScheduleBase>;
type Linear      = Variant<"Linear",      { delayPerAttempt: number; jitter: boolean },                                    ScheduleBase>;
type Exponential = Variant<"Exponential", { initialDelay: number; maxDelay: number; multiplier: number; jitter: boolean }, ScheduleBase>;
type Custom      = Variant<"Custom",      { fn: (attempt: number, error: unknown) => number | null },                      ScheduleBase>;

export type Schedule = Fixed | Linear | Exponential | Custom;

export const Schedule = union([ScheduleBase]).typed({
    Fixed: (delay: number) =>
        ({ delay }) as Fixed,
    Linear: (opts: { delayPerAttempt: number; jitter?: boolean }) =>
        ({ delayPerAttempt: opts.delayPerAttempt, jitter: opts.jitter ?? false }) as Linear,
    Exponential: (opts: { initialDelay: number; maxDelay: number; multiplier?: number; jitter?: boolean }) =>
        ({
            initialDelay: opts.initialDelay,
            maxDelay:     opts.maxDelay,
            multiplier:   opts.multiplier ?? 2,
            jitter:       opts.jitter ?? false,
        }) as Exponential,
    Custom: (fn: (attempt: number, error: unknown) => number | null) =>
        ({ fn }) as Custom,
});

// ---------------------------------------------------------------------------
// ScheduleError — errors produced by the scheduler itself
// ---------------------------------------------------------------------------

abstract class ScheduleErrorBase extends Trait {}

type TimedOut           = Variant<"TimedOut",           { elapsed: number; timeout: number },         ScheduleErrorBase>;
type MaxRetriesExceeded = Variant<"MaxRetriesExceeded", { attempts: number; lastError: unknown },     ScheduleErrorBase>;

export type ScheduleError = TimedOut | MaxRetriesExceeded;

export const ScheduleError = union([ScheduleErrorBase]).typed({
    TimedOut:           (elapsed: number, timeout: number)     => ({ elapsed, timeout })     as TimedOut,
    MaxRetriesExceeded: (attempts: number, lastError: unknown) => ({ attempts, lastError }) as MaxRetriesExceeded,
});

// ---------------------------------------------------------------------------
// AsyncOptions<E> — shared options bag for AsyncDerived and watchEffect
// ---------------------------------------------------------------------------

export type AsyncOptions<E = unknown> = {
    /** Retry-delay policy. Required to enable automatic retries. */
    schedule?:    Schedule;
    /** Maximum number of retry attempts. Undefined means retry indefinitely. */
    maxRetries?:  number;
    /** Return false to stop retrying immediately. Defaults to always true. */
    shouldRetry?: (error: E) => boolean;
    /** Abort the computation after this many milliseconds, emitting ScheduleError.TimedOut. */
    timeout?:     number;
    /** Called just before each retry attempt fires. */
    onRetry?:     (attempt: number, error: E, nextDelay: number) => void;
};

// ---------------------------------------------------------------------------
// computeDelay — internal helper used by AsyncDerived and watchEffect
// ---------------------------------------------------------------------------

function applyJitter(delay: number, jitter: boolean): number {
    return jitter ? delay * (0.5 + Math.random() * 0.5) : delay;
}

/**
 * Returns the number of milliseconds to wait before the next attempt,
 * or `null` to signal unconditional termination (Custom policy only).
 *
 * `attempt` is 1-indexed: 1 = first retry, 2 = second retry, etc.
 */
export function computeDelay(
    schedule: Schedule,
    attempt: number,
    error: unknown,
): number | null {
    return match(schedule, {
        Fixed:       ({ delay }) =>
            delay,
        Linear:      ({ delayPerAttempt, jitter }) =>
            applyJitter(delayPerAttempt * attempt, jitter),
        Exponential: ({ initialDelay, maxDelay, multiplier, jitter }) =>
            applyJitter(Math.min(initialDelay * Math.pow(multiplier, attempt - 1), maxDelay), jitter),
        Custom:      ({ fn }) =>
            fn(attempt, error),
    });
}
