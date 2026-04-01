// ==========================================
// 1. CORE TYPES & UTILITIES
// ==========================================

export const __ = Symbol("default");
export const tag = Symbol("aljabr.tag");
export const predTag = Symbol("aljabr.pred");
export const whenTag = Symbol("aljabr.when");

export function getTag<E extends { [tag]: string }>(variant: E): E[typeof tag] {
    return variant[tag];
}

// Helper to extract constructor types
type Constructor = new (...args: any[]) => any;

// Helper to merge multiple classes together (A | B becomes A & B)
type UnionToIntersection<U> = (U extends any ? (k: U) => void : never) extends (
    k: infer I,
) => void
    ? I
    : never;

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

// Computes the mixin type contributed by impl classes
type ImplMixin<Def> = Def extends { impl: infer Impl extends Constructor[] }
    ? UnionToIntersection<InstanceType<Impl[number]>>
    : {};

// ==========================================
// 2. PRED & WHEN
// ==========================================

/** A wrapped predicate for use in pattern objects. Distinguishes predicates from literal values. */
export type Pred<T, S extends T = T> = {
    readonly [predTag]: true;
    readonly fn: (val: T) => boolean;
    /** Phantom type capturing the narrowed type from a type predicate. */
    readonly _narrow?: S;
};

/** Wrap a predicate function for use in a `when()` pattern object. */
export function pred<T = any, S extends T = T>(fn: (val: T) => val is S): Pred<T, S>;
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
export function when<V = any, R = any>(pattern: typeof __, handler: (val: V) => R): WhenArm<V, R>;
export function when<V = any, R = any>(guard: (val: V) => boolean, handler: (val: V) => R): WhenArm<V, R>;
export function when<V = any, R = any>(pattern: object, handler: (val: V) => R): WhenArm<V, R>;
export function when<V = any, R = any>(
    pattern: object,
    guard: (val: V) => boolean,
    handler: (val: V) => R,
): WhenArm<V, R>;
export function when(patternOrGuard: any, guardOrHandler: any, handler?: any): any {
    if (handler !== undefined) {
        return { [whenTag]: true, pattern: patternOrGuard, guard: guardOrHandler, handler };
    }
    if (typeof patternOrGuard === "function") {
        return { [whenTag]: true, pattern: {}, guard: patternOrGuard, handler: guardOrHandler };
    }
    return { [whenTag]: true, pattern: patternOrGuard, guard: undefined, handler: guardOrHandler };
}

// ==========================================
// 3. THE `union` FACTORY
// ==========================================

export function union<Def extends Record<string, any>>(
    definition: Def,
): {
    [K in Exclude<keyof Def, "impl"> & string]: Def[K] extends (...args: any[]) => any
        ? (...args: Parameters<Def[K]>) => ReturnType<Def[K]> & { [tag]: K } & ImplMixin<Def>
        : () => Def[K] & { [tag]: K } & ImplMixin<Def>;
} {
    const { impl, ...factories } = definition as any;
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

            if (impl && Array.isArray(impl)) {
                const instances = impl.map((ImplCls: any) => new ImplCls());
                return Object.assign(Object.create(proto), ...instances, payload);
            }

            return Object.assign(Object.create(proto), payload);
        };
    }

    return result;
}
