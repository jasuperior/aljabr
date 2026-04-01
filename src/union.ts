// ==========================================
// 1. CORE TYPES & UTILITIES
// ==========================================

/**
 * Catch-all pattern symbol. Use as a pattern in {@link when} to match any value,
 * or as a key in {@link match} matchers to handle variants not explicitly listed.
 *
 * @example
 * // As a match arm catch-all:
 * when(__, (v) => `unhandled: ${getTag(v)}`)
 *
 * // As a top-level fallback key:
 * match(ev, { Click: handler, [__]: () => "ignored" })
 */
export const __ = Symbol("default");

/**
 * Symbol used as the discriminant key on every variant instance.
 * Lives on the prototype (non-enumerable), so it won't appear in
 * `Object.keys()` or `JSON.stringify()` output.
 *
 * You rarely need to access this directly — prefer {@link getTag} or just
 * let {@link match} handle dispatch.
 *
 * @example
 * const circle = Shape.Circle(5)
 * circle[tag] // "Circle"
 * Object.keys(circle).includes(tag.toString()) // false
 */
export const tag = Symbol("aljabr.tag");

/** @internal */
export const predTag = Symbol("aljabr.pred");

/** @internal */
export const whenTag = Symbol("aljabr.when");
const requirements: unique symbol = Symbol("aljabr.requirements");

/**
 * Extract the variant name string from a tagged variant instance.
 *
 * @param variant - A variant instance created by {@link union}
 * @returns The variant's name as a string literal type
 *
 * @example
 * const Shape = union({ Circle: (r: number) => ({ r }), Dot: { x: 0 } })
 * getTag(Shape.Circle(5)) // "Circle"
 * getTag(Shape.Dot())     // "Dot"
 */
export function getTag<E extends { [tag]: string }>(variant: E): E[typeof tag] {
    return variant[tag];
}

type AbstractConstructor<T = {}> = abstract new (...args: any[]) => T;

// Helper to merge multiple classes together (A | B becomes A & B)
type UnionToIntersection<U> = (U extends any ? (k: U) => void : never) extends (
    k: infer I,
) => void
    ? I
    : never;

// Extracts the required payload properties encoded by Trait<R>()
type RequiredFromImpl<T> = T extends { [requirements]: infer R } ? R : {};

// Intersects requirements across all impl classes
type AllRequired<Impl extends AbstractConstructor[]> =
    UnionToIntersection<RequiredFromImpl<Impl[number]>>;

// Computes the mixin type contributed by impl classes
type ImplMixinFromImpl<Impl extends AbstractConstructor[]> =
    UnionToIntersection<InstanceType<Impl[number]>>;

/**
 * Extracts the union type from a set of variant factories, or a single variant's
 * instance type when `VariantName` is provided.
 *
 * @typeParam T - The factory object returned by {@link union}
 * @typeParam VariantName - Optional: a specific variant key to extract
 *
 * @example
 * const Shape = union({ Circle: (r: number) => ({ r }), Dot: { x: 0 } })
 * type Shape  = Union<typeof Shape>            // Circle instance | Dot instance
 * type Circle = Union<typeof Shape, "Circle">  // Circle instance only
 */
export type Union<
    T extends Record<string, (...args: any[]) => any>,
    VariantName extends keyof T | never = never,
> = [VariantName] extends [never]
    ? { [K in keyof T]: ReturnType<T[K]> }[keyof T]
    : ReturnType<T[VariantName]>;

/**
 * Derives the plain payload shape from an impl class or Trait instance,
 * stripping methods, the {@link tag} symbol, and any keys in `Ignore`.
 *
 * Useful for typing factory functions without repeating annotations.
 *
 * @typeParam Trait - An impl class instance type (typically `InstanceType<typeof MyClass>`)
 * @typeParam Ignore - Optional keys to omit from the result
 *
 * @example
 * abstract class Node extends Trait<{ id: string; value: number }>() {}
 * type NodePayload = FactoryPayload<InstanceType<typeof Node>>
 * // { id: string; value: number }
 *
 * type WithoutId = FactoryPayload<InstanceType<typeof Node>, "id">
 * // { value: number }
 */
export type FactoryPayload<Trait, Ignore extends keyof any = never> = Omit<
    { [K in keyof Trait as Trait[K] extends Function ? never : K]: Trait[K] },
    typeof tag | Ignore
>;

// A valid variant is a factory function whose return type extends Req, or a plain object
type ValidVariant<Req> = ((...args: any[]) => Req) | Req;

// ==========================================
// 2. TRAIT FACTORY
// ==========================================

/**
 * Creates an abstract base class that encodes required payload properties `R`.
 *
 * Impl classes extending `Trait<R>()` declare to the type system that every
 * variant factory in the union must return an object satisfying `R`. If a variant
 * doesn't conform, you get a compile error on that specific factory — not on the
 * whole `union()` call.
 *
 * Classes that don't extend `Trait<R>()` are treated as `Trait<{}>` — they mix in
 * behavior but impose no payload requirements.
 *
 * @typeParam R - The shape that every variant payload must extend
 * @returns An abstract class to extend in your impl class declaration
 *
 * @example
 * abstract class Trackable extends Trait<{ id: string }>() {
 *   tracked = true
 *   label() { return `[${(this as any).id}]` }
 * }
 *
 * const Ev = union([Trackable])({
 *   Created: (id: string) => ({ id }),   // ✓ satisfies { id: string }
 *   // Broken: (n: number) => ({ n }),   // ✗ compile error: missing `id`
 * })
 */
export function Trait<R extends object>() {
    abstract class T {}
    return T as AbstractConstructor<R> & { readonly [requirements]: R };
}

// ==========================================
// 3. PRED & WHEN
// ==========================================

/**
 * A wrapped predicate for use in {@link when} pattern objects.
 * Distinguishes runtime predicates from literal value comparisons.
 *
 * Created by {@link pred}. The type parameter `S` captures the narrowed type
 * from a type predicate (`val is S`), which flows through to the handler.
 *
 * @typeParam T - The input type of the predicate
 * @typeParam S - The narrowed output type (defaults to `T`)
 *
 * @see {@link pred} to create a `Pred` value
 */
export type Pred<T, S extends T = T> = {
    readonly [predTag]: true;
    readonly fn: (val: T) => boolean;
    /** Phantom type capturing the narrowed type from a type predicate. */
    readonly _narrow?: S;
};

/**
 * Wrap a predicate function for use inside a {@link when} pattern object.
 *
 * Use `pred()` when you need to match a field by a condition rather than a literal value.
 * Supports both boolean predicates and type-narrowing predicates (`val is S`).
 *
 * @param fn - A boolean predicate or a type predicate `(val: T) => val is S`
 * @returns A {@link Pred} wrapper recognized by the match engine
 *
 * @example
 * // Boolean predicate
 * when({ score: pred((n) => n > 100) }, () => "high score")
 *
 * // Type-narrowing predicate
 * when({ key: pred((k): k is "Enter" => k === "Enter") }, () => "submit")
 */
export function pred<T = any, S extends T = T>(
    fn: (val: T) => val is S,
): Pred<T, S>;
export function pred<T = any>(fn: (val: T) => boolean): Pred<T>;
export function pred(fn: (val: any) => any): any {
    return { [predTag]: true, fn };
}

/**
 * A typed arm object produced by {@link when}.
 * Used as a variant matcher in {@link match} — either as a single value or in an array.
 *
 * @typeParam V - The variant type this arm operates on
 * @typeParam R - The result type produced by the handler
 */
export type WhenArm<V, R> = {
    readonly [whenTag]: true;
    readonly pattern: { [K in keyof V]?: V[K] | Pred<V[K], any> } | typeof __;
    readonly guard?: (val: V) => boolean;
    readonly handler: (val: V) => R;
};

/**
 * Define a pattern match arm for use inside {@link match}.
 *
 * Four calling forms:
 * - `when(__, handler)` — catch-all, always matches
 * - `when(guard, handler)` — matches when `guard(val)` returns `true`
 * - `when(pattern, handler)` — matches when all pattern fields equal the variant's fields
 * - `when(pattern, guard, handler)` — structural pattern and guard must both pass
 *
 * Pattern field values may be literals (strict equality) or {@link Pred} wrappers
 * (predicate evaluation). An empty pattern `{}` matches any value.
 *
 * Arms in an array are evaluated left to right; the first match wins.
 * Always end an arm array with `when(__, ...)` when pattern or guard arms might not
 * cover every possible value.
 *
 * @example
 * match(event, {
 *   KeyPress: [
 *     when({ key: "Enter" },                         () => "submit"),
 *     when({ key: pred((k) => k.startsWith("F")) },  () => "function key"),
 *     when((v) => v.key.length > 1,                  () => "special"),
 *     when(__,                                        () => "character"),
 *   ],
 * })
 */
export function when<V = any, R = any>(
    pattern: typeof __,
    handler: (val: V) => R,
): WhenArm<V, R>;
export function when<V = any, R = any>(
    guard: (val: V) => boolean,
    handler: (val: V) => R,
): WhenArm<V, R>;
export function when<V = any, R = any>(
    pattern: object,
    handler: (val: V) => R,
): WhenArm<V, R>;
export function when<V = any, R = any>(
    pattern: object,
    guard: (val: V) => boolean,
    handler: (val: V) => R,
): WhenArm<V, R>;
export function when(
    patternOrGuard: any,
    guardOrHandler: any,
    handler?: any,
): any {
    if (handler !== undefined) {
        return {
            [whenTag]: true,
            pattern: patternOrGuard,
            guard: guardOrHandler,
            handler,
        };
    }
    if (typeof patternOrGuard === "function") {
        return {
            [whenTag]: true,
            pattern: {},
            guard: patternOrGuard,
            handler: guardOrHandler,
        };
    }
    return {
        [whenTag]: true,
        pattern: patternOrGuard,
        guard: undefined,
        handler: guardOrHandler,
    };
}

// ==========================================
// 4. THE `union` FACTORY
// ==========================================

/**
 * Create a set of tagged variant factories.
 *
 * **Direct form** — no shared behavior:
 * ```ts
 * const Shape = union({
 *   Circle: (r: number) => ({ r }),
 *   Dot: { x: 0, y: 0 },
 * })
 * ```
 *
 * **With-impl form** — attach mixin classes to all variants:
 * ```ts
 * abstract class Identifiable extends Trait<{ id: string }>() {
 *   label() { return `[${(this as any).id}]` }
 * }
 *
 * const Event = union([Identifiable])({
 *   Created: (id: string) => ({ id }),
 *   Deleted: (id: string) => ({ id }),
 * })
 * ```
 *
 * Each factory key becomes a callable that returns a variant instance with:
 * - All payload properties spread as own enumerable properties
 * - All impl class instance properties and methods mixed in (payload shadows impl defaults)
 * - A non-enumerable `[tag]` symbol on the prototype encoding the variant name
 *
 * Constant variants (plain object values) produce a no-arg factory; each call returns a fresh copy.
 *
 * @see {@link Trait} for declaring required payload properties on impl classes
 * @see {@link match} for consuming variants
 * @see {@link Union} for extracting the TypeScript union type from the factory object
 */
export function union<Impl extends AbstractConstructor[]>(
    impls: Impl,
): <Factories extends Record<string, ValidVariant<AllRequired<Impl>>>>(
    factories: Factories,
) => {
    [K in keyof Factories & string]: Factories[K] extends (...args: any[]) => any
        ? (
              ...args: Parameters<Factories[K]>
          ) => ReturnType<Factories[K]> & { [tag]: K } & ImplMixinFromImpl<Impl>
        : () => Factories[K] & { [tag]: K } & ImplMixinFromImpl<Impl>;
};

/** No-impl form: union(factories) */
export function union<Def extends Record<string, any>>(
    factories: Def,
): {
    [K in keyof Def & string]: Def[K] extends (...args: any[]) => any
        ? (...args: Parameters<Def[K]>) => ReturnType<Def[K]> & { [tag]: K }
        : () => Def[K] & { [tag]: K };
};

export function union(factoriesOrImpls: any): any {
    if (Array.isArray(factoriesOrImpls)) {
        return (factories: any) => buildUnion(factories, factoriesOrImpls);
    }
    return buildUnion(factoriesOrImpls, []);
}

function buildUnion(factories: Record<string, any>, impl: any[]): any {
    const result: any = {};

    for (const key in factories) {
        const item = factories[key];
        result[key] = (...args: any[]) => {
            const payload =
                typeof item === "function" ? item(...args) : { ...item };

            const proto = Object.create(null);
            Object.defineProperty(proto, tag, {
                value: key,
                enumerable: false,
                writable: false,
                configurable: false,
            });

            if (impl.length > 0) {
                const instances = impl.flatMap((ImplCls: any) => {
                    const inst = new ImplCls();
                    return [inst, expandProto(inst)];
                });
                return Object.assign(Object.create(proto), ...instances, payload);
            }

            return Object.assign(Object.create(proto), payload);
        };
    }

    return result;
}

const expandProto = (obj: any) => {
    return Object.getOwnPropertyNames(Object.getPrototypeOf(obj)).reduce(
        (acc, curr) =>
            curr == "constructor" ? acc : { ...acc, [curr]: obj[curr] },
        {},
    );
};
