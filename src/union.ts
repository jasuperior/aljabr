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

// ==========================================
// 2. THE `union` FACTORY
// ==========================================

export function union<Trait = any, Ignore extends keyof any = never>() {
    type Base = FactoryPayload<Trait, Ignore>;

    return function <Def extends { impl?: Constructor[]; [key: string]: any }>(
        // Enforce the Base Trait, but allow variants to return their own extra properties
        definition: Def & {
            [K in keyof Def]: K extends "impl"
                ? Def["impl"]
                :
                      | ((...args: any[]) => Base & Record<string, any>)
                      | (Base & Record<string, any>);
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
    };
}
