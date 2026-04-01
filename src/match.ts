// ==========================================
// 3. THE MATCH ENGINE
// ==========================================

import { __, tag, predTag, whenTag, type Pred, type WhenArm } from "./union";

type VariantMatcher<V, R> =
    | ((val: V) => R)
    | WhenArm<V, R>
    | Array<WhenArm<V, R>>;

type ExactMatchers<Enum extends { [tag]: string }, R> = {
    [Variant in Enum[typeof tag]]: VariantMatcher<
        Extract<Enum, { [tag]: Variant }>,
        R
    >;
};

type FallbackMatchers<Enum extends { [tag]: string }, R> = {
    [Variant in Enum[typeof tag]]?: VariantMatcher<
        Extract<Enum, { [tag]: Variant }>,
        R
    >;
} & {
    [__]: (val: Enum) => R;
};

function matchesPattern(pattern: object, value: any): boolean {
    return Object.keys(pattern).every((key) => {
        const p = (pattern as any)[key];
        const v = value[key];
        if (p !== null && typeof p === "object" && predTag in p) {
            return (p as Pred<any>).fn(v);
        }
        return p === v;
    });
}

/**
 * Dispatch on a tagged variant and return a result.
 *
 * Two exhaustiveness modes:
 *
 * **ExactMatchers** — every variant must be handled; no `[__]` needed or allowed:
 * ```ts
 * match(shape, {
 *   Circle: ({ radius }) => Math.PI * radius ** 2,
 *   Rect:   ({ w, h }) => w * h,
 * })
 * ```
 *
 * **FallbackMatchers** — partial variant coverage with a required `[__]` catch-all:
 * ```ts
 * match(event, {
 *   Click: ({ x, y }) => `${x},${y}`,
 *   [__]:  () => "ignored",
 * })
 * ```
 *
 * Each variant's matcher may be:
 * - A function `(val) => result`
 * - A single {@link when} arm
 * - An array of {@link when} arms (first match wins)
 *
 * @param value - A variant instance produced by {@link union}
 * @param matchers - An object mapping variant names to their handlers
 * @returns The result produced by the matching handler
 *
 * @throws {Error} If no handler is defined for the variant and no `[__]` fallback exists
 * @throws {Error} If a single `when()` arm doesn't match and no `[__]` fallback exists
 * @throws {Error} If an array of `when()` arms exhausts with no match (with a hint to add
 *   `when(__, handler)` as the last arm when guarded or pred arms are present)
 *
 * @see {@link when} for constructing pattern arms
 * @see {@link __} for the catch-all symbol
 */
export function match<E extends { [tag]: string }, R>(
    value: E,
    matchers: ExactMatchers<E, R>,
): R;
export function match<E extends { [tag]: string }, R>(
    value: E,
    matchers: FallbackMatchers<E, R>,
): R;
export function match<E extends { [tag]: string }, R>(
    value: E,
    matchers: any,
): R {
    const matcher = matchers[value[tag]];

    if (!matcher) {
        if (matchers[__]) return matchers[__](value);
        throw new Error(`Unhandled variant: ${value[tag]}`);
    }

    if (typeof matcher === "function") {
        return matcher(value);
    }

    // Single when() arm
    if (typeof matcher === "object" && whenTag in matcher) {
        const { pattern, guard, handler } = matcher as WhenArm<any, R>;

        if (pattern === __) return handler(value);

        if (
            matchesPattern(pattern as object, value) &&
            (!guard || guard(value))
        ) {
            return handler(value);
        }

        if (matchers[__]) return matchers[__](value);
        throw new Error(`No matching arm and no fallback for variant "${value[tag]}".`);
    }

    // Array of when() arms
    if (Array.isArray(matcher)) {
        let hasGuardedArm = false;

        for (const arm of matcher as Array<WhenArm<any, R>>) {
            const { pattern, guard, handler } = arm;

            if (pattern === __) return handler(value);

            const hasPred = Object.values(pattern as object).some(
                (v) => v !== null && typeof v === "object" && predTag in v,
            );
            if (guard || hasPred) hasGuardedArm = true;

            if (
                matchesPattern(pattern as object, value) &&
                (!guard || guard(value))
            ) {
                return handler(value);
            }
        }

        const suffix = hasGuardedArm
            ? ` Guarded/pred arms require a catch-all when(__, handler) as the last arm.`
            : "";
        throw new Error(
            `Non-exhaustive matcher for variant "${value[tag]}".${suffix}`,
        );
    }

    throw new Error(`Invalid matcher for variant: ${value[tag]}`);
}
