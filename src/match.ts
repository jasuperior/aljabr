// ==========================================
// 3. THE MATCH ENGINE
// ==========================================

import {
    __,
    tag,
    predTag,
    patternTag,
    selectTag,
    whenTag,
    type Pred,
    type NotCombinator,
    type UnionCombinator,
    type SelectMarker,
    type WhenArm,
} from "./union";

type VariantMatcher<V, R> =
    | ((val: V) => R)
    | WhenArm<V, R, any>
    | Array<WhenArm<V, R, any>>;

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

// ==========================================
// Pattern evaluation helpers
// ==========================================

/**
 * Evaluate a single pattern value against a target value.
 *
 * Returns `false` if the pattern does not match, or a (possibly empty)
 * `Record<string, unknown>` of named selections if it does.
 */
function evaluatePatternValue(
    p: unknown,
    v: unknown,
): false | Record<string, unknown> {
    // select() binding — optionally constrained by an inner pattern
    if (p !== null && typeof p === "object" && selectTag in p) {
        const sel = p as SelectMarker;
        if (sel.pattern !== undefined) {
            const inner = evaluatePatternValue(sel.pattern, v);
            if (inner === false) return false;
            return { ...inner, [sel.name]: v };
        }
        return { [sel.name]: v };
    }

    // Combinator — is.not / is.union
    if (p !== null && typeof p === "object" && patternTag in p) {
        if ((p as any).kind === "not") {
            const comb = p as NotCombinator;
            return evaluatePatternValue(comb.pattern, v) === false ? {} : false;
        }
        const comb = p as UnionCombinator;
        return comb.patterns.some((pat) => evaluatePatternValue(pat, v) !== false)
            ? {}
            : false;
    }

    // Pred — pred() or is.string / is.number / etc.
    if (p !== null && typeof p === "object" && predTag in p) {
        return (p as Pred<any>).fn(v) ? {} : false;
    }

    // Plain object (not an Aljabr variant) — recurse structurally
    if (p !== null && typeof p === "object" && !(tag in p)) {
        return matchesPattern(p, v);
    }

    // Literal / variant reference — strict equality
    return p === v ? {} : false;
}

/**
 * Match a structural pattern object against a value.
 *
 * Returns `false` if any field fails to match, or a merged selections map
 * (possibly empty) if all fields match.
 *
 * Recurses into plain object sub-patterns. Stops recursing when the target
 * value is an Aljabr variant (has a `[tag]` on its prototype).
 */
function matchesPattern(
    pattern: object,
    value: unknown,
): false | Record<string, unknown> {
    const selections: Record<string, unknown> = {};

    for (const key of Object.keys(pattern)) {
        const p = (pattern as any)[key];
        const v = (value as any)?.[key];

        const result = evaluatePatternValue(p, v);
        if (result === false) return false;
        Object.assign(selections, result);
    }

    return selections;
}

/**
 * Returns true if a pattern object contains any conditional element
 * (pred, combinator, or select) at the top level — used to hint about
 * the need for a `when(__, handler)` catch-all.
 */
function hasConditionalPattern(pattern: object): boolean {
    return Object.values(pattern).some(
        (v) =>
            v !== null &&
            typeof v === "object" &&
            (predTag in v || patternTag in v || selectTag in v),
    );
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
        const { pattern, guard, handler } = matcher as WhenArm<any, R, any>;

        if (pattern === __) return handler(value, {} as any);

        const result = matchesPattern(pattern as object, value);
        if (result !== false && (!guard || guard(value))) {
            return handler(value, result as any);
        }

        if (matchers[__]) return matchers[__](value);
        throw new Error(
            `No matching arm and no fallback for variant "${value[tag]}".`,
        );
    }

    // Array of when() arms
    if (Array.isArray(matcher)) {
        let hasConditionalArm = false;

        for (const arm of matcher as Array<WhenArm<any, R, any>>) {
            const { pattern, guard, handler } = arm;

            if (pattern === __) return handler(value, {} as any);

            if (guard || hasConditionalPattern(pattern as object))
                hasConditionalArm = true;

            const result = matchesPattern(pattern as object, value);
            if (result !== false && (!guard || guard(value))) {
                return handler(value, result as any);
            }
        }

        const suffix = hasConditionalArm
            ? ` Guarded/pred arms require a catch-all when(__, handler) as the last arm.`
            : "";
        throw new Error(
            `Non-exhaustive matcher for variant "${value[tag]}".${suffix}`,
        );
    }

    throw new Error(`Invalid matcher for variant: ${value[tag]}`);
}
