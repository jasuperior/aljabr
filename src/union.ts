// ==========================================
// 1. CORE TYPES & UTILITIES
// ==========================================

export const __ = Symbol("default");
export const tag = Symbol("aljabr.tag");
export const predTag = Symbol("aljabr.pred");
export const whenTag = Symbol("aljabr.when");
const requirements: unique symbol = Symbol("aljabr.requirements");

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

// Extracts the structural types from your generated factories
export type Union<
    T extends Record<string, (...args: any[]) => any>,
    VariantName extends keyof T | never = never,
> = [VariantName] extends [never]
    ? { [K in keyof T]: ReturnType<T[K]> }[keyof T]
    : ReturnType<T[VariantName]>;

// Automatically strips methods, the tag symbol, and user-ignored keys from the Trait
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
 * Create an abstract base class that encodes required payload properties R.
 * Impl classes extending Trait<R>() declare to the type system that each
 * variant factory must return an object satisfying R.
 *
 * @example
 * abstract class Trackable extends Trait<{ size: number }>() {
 *     tracked = true
 * }
 */
export function Trait<R extends object>() {
    abstract class T {}
    return T as AbstractConstructor<R> & { readonly [requirements]: R };
}

// ==========================================
// 3. PRED & WHEN
// ==========================================

/** A wrapped predicate for use in pattern objects. Distinguishes predicates from literal values. */
export type Pred<T, S extends T = T> = {
    readonly [predTag]: true;
    readonly fn: (val: T) => boolean;
    /** Phantom type capturing the narrowed type from a type predicate. */
    readonly _narrow?: S;
};

/** Wrap a predicate function for use in a `when()` pattern object. */
export function pred<T = any, S extends T = T>(
    fn: (val: T) => val is S,
): Pred<T, S>;
export function pred<T = any>(fn: (val: T) => boolean): Pred<T>;
export function pred(fn: (val: any) => any): any {
    return { [predTag]: true, fn };
}

/** A typed arm object produced by `when()`. */
export type WhenArm<V, R> = {
    readonly [whenTag]: true;
    readonly pattern: { [K in keyof V]?: V[K] | Pred<V[K], any> } | typeof __;
    readonly guard?: (val: V) => boolean;
    readonly handler: (val: V) => R;
};

/** Define a match arm, optionally with a guard predicate. */
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
 * With-impl form: union(impls)(factories)
 * Each variant factory's return type must satisfy AllRequired<Impl>.
 * Type errors surface on the specific non-conforming variant.
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
