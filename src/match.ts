// ==========================================
// 3. THE MATCH ENGINE
// ==========================================

import { __ } from "./union";

type Arm<Variant, ReturnType> =
    | [pattern: Partial<Variant>, handler: (val: Variant) => ReturnType]
    | [pattern: typeof __, handler: (val: Variant) => ReturnType];

type VariantMatcher<Variant, ReturnType> =
    | ((val: Variant) => ReturnType)
    | Array<Arm<Variant, ReturnType>>;

type ExactMatchers<Enum extends { type: string }, ReturnType> = {
    [Variant in Enum["type"]]: VariantMatcher<
        Extract<Enum, { type: Variant }>,
        ReturnType
    >;
};

type FallbackMatchers<Enum extends { type: string }, ReturnType> = {
    [Variant in Enum["type"]]?: VariantMatcher<
        Extract<Enum, { type: Variant }>,
        ReturnType
    >;
} & {
    [__]: (val: Enum) => ReturnType;
};

export function match<E extends { type: string }, R>(
    value: E,
    matchers: ExactMatchers<E, R>,
): R;
export function match<E extends { type: string }, R>(
    value: E,
    matchers: FallbackMatchers<E, R>,
): R;
export function match<E extends { type: string }, R>(
    value: E,
    matchers: any,
): R {
    const matcher = matchers[value.type];

    if (!matcher) {
        if (matchers[__]) return matchers[__](value);
        throw new Error(`Unhandled variant: ${value.type}`);
    }

    if (typeof matcher === "function") {
        return matcher(value);
    }

    if (Array.isArray(matcher)) {
        for (const [pattern, handler] of matcher) {
            if (pattern === __) return handler(value);

            const isMatch = Object.keys(pattern).every(
                (key) => (pattern as any)[key] === (value as any)[key],
            );

            if (isMatch) return handler(value);
        }
        throw new Error(
            `Non-exhaustive array matcher for variant: ${value.type}`,
        );
    }

    throw new Error(`Invalid matcher for variant: ${value.type}`);
}
