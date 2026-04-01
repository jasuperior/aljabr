// ==========================================
// 1. CORE TYPES & UTILITIES
// ==========================================

export const __ = Symbol("default");

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

// Automatically strips methods, the 'type' key, and user-ignored keys from the Trait
export type FactoryPayload<Trait, Ignore extends keyof any = never> = Omit<
    { [K in keyof Trait as Trait[K] extends Function ? never : K]: Trait[K] },
    "type" | Ignore
>;

// Derives the required payload fields from an impl array
type ImplConstraint<Def> = Def extends { impl: infer Impl extends Constructor[] }
    ? FactoryPayload<UnionToIntersection<InstanceType<Impl[number]>>>
    : Record<string, any>;

// Validates a variant: for functions checks return type; for objects checks directly
type ValidateVariant<V, Constraint> =
    V extends (...args: any[]) => infer R
        ? R extends Constraint ? V : never
        : V extends Constraint ? V : never;

// ==========================================
// 2. THE `union` FACTORY
// ==========================================

export function union<
    Def extends { impl?: Constructor[] }
>(
    definition: Def & {
        [K in keyof Def]: K extends "impl"
            ? Def["impl"]
            : ValidateVariant<Def[K], ImplConstraint<Def>>;
    },
): {
    [K in Exclude<keyof Def, "impl">]: Def[K] extends (
        ...args: any[]
    ) => any
        ? // Function Variant
          (
              ...args: Parameters<Def[K]>
          ) => ReturnType<Def[K]> & {
              type: K;
          } & (Def["impl"] extends Constructor[]
                  ? UnionToIntersection<InstanceType<Def["impl"][number]>>
                  : {})
        : // Constant Variant
          () => Def[K] & { type: K } & (Def["impl"] extends Constructor[]
                  ? UnionToIntersection<InstanceType<Def["impl"][number]>>
                  : {});
} {
    const { impl, ...factories } = definition as any;
    const result: any = {};

    for (const key in factories) {
        const item = factories[key];
        result[key] = (...args: any[]) => {
            const payload =
                typeof item === "function" ? item(...args) : item;
            const variant = { ...payload, type: key };

            if (impl && Array.isArray(impl)) {
                const instances = impl.map((ImplCls: any) => new ImplCls());
                return Object.assign({}, ...instances, variant);
            }

            return variant;
        };
    }

    return result;
}
