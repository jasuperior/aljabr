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

/** @internal — marks a combinator pattern object (is.not, is.union) */
export const patternTag = Symbol("aljabr.pattern");

/** @internal — marks a select() extraction binding */
export const selectTag = Symbol("aljabr.select");

/** @internal */
export const requirements: unique symbol = Symbol("aljabr.requirements");

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

// Extracts the required payload properties encoded by Trait<R>
type RequiredFromImpl<T> = T extends abstract new (...args: any[]) => {
    readonly [requirements]: infer R;
}
    ? R
    : {};

// Intersects requirements across all impl classes
type AllRequired<Impl extends AbstractConstructor[]> = UnionToIntersection<
    RequiredFromImpl<Impl[number]>
>;

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
 * abstract class Node extends Trait<{ id: string; value: number }> {}
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

/**
 * Convenience type for a tagged variant instance.
 * Use as the cast target in factory bodies to encode tag, payload, and impl mixin generically.
 *
 * @typeParam Tag     - The string literal variant name (must match the factory key)
 * @typeParam Payload - The plain data shape this variant carries
 * @typeParam Impl    - Optional: an impl class instance type (e.g. `Thenable<T, Result<T,E>>`)
 *
 * @example
 * type Accepted<T> = Variant<"Accept", { value: T }, Thenable<T, Result<T>>>
 * const Result = union([Thenable]).typed({
 *   Accept: <T>(value: T) => ({ value } as Accepted<T>),
 * })
 */
export type Variant<
    Tag extends string,
    Payload extends object,
    Impl = unknown,
> = Payload & { [tag]: Tag } & (unknown extends Impl ? {} : Impl);

// ==========================================
// 2. TRAIT FACTORY
// ==========================================

/**
 * Abstract base class that encodes required payload properties `R` at the type level.
 *
 * Impl classes extending `Trait<R>` declare to the type system that every
 * variant factory in the union must return an object satisfying `R`. If a variant
 * doesn't conform, you get a compile error on that specific factory — not on the
 * whole `union()` call.
 *
 * Classes that don't extend `Trait<R>` are treated as `Trait<{}>` — they mix in
 * behavior but impose no payload requirements.
 *
 * @typeParam R - The shape that every variant payload must extend
 *
 * @example
 * abstract class Trackable extends Trait<{ id: string }> {
 *   tracked = true
 *   label() { return `[${(this as any).id}]` }
 * }
 *
 * const Ev = union([Trackable])({
 *   Created: (id: string) => ({ id }),   // ✓ satisfies { id: string }
 *   // Broken: (n: number) => ({ n }),   // ✗ compile error: missing `id`
 * })
 */
export abstract class Trait<R extends object = {}> {
    /** @internal */
    declare readonly [requirements]: R;
}

// ==========================================
// 3. PRED
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

// ==========================================
// 4. COMBINATORS & SELECT
// ==========================================

/**
 * A negation combinator produced by {@link is.not}.
 * Matches any value that does **not** match the inner pattern `P`.
 *
 * @typeParam P - The inner pattern type being negated
 */
export type NotCombinator<P = unknown> = {
    readonly [patternTag]: true;
    readonly kind: "not";
    readonly pattern: P;
};

/**
 * A union combinator produced by {@link is.union}.
 * Matches if the value satisfies **any** of the inner patterns.
 *
 * @typeParam Ps - Tuple of the inner pattern types
 */
export type UnionCombinator<
    Ps extends readonly unknown[] = readonly unknown[],
> = {
    readonly [patternTag]: true;
    readonly kind: "union";
    readonly patterns: Ps;
};

/**
 * Convenience alias for any combinator value.
 * Use {@link NotCombinator} or {@link UnionCombinator} directly when you need
 * the specific generic form.
 */
export type Combinator = NotCombinator | UnionCombinator;

/**
 * Extracts the narrowed type that a pattern value produces at the type level.
 *
 * - `Pred<T, S>` → `S`
 * - `UnionCombinator<Ps>` → union of each element's narrowed type
 * - `NotCombinator<P>` → `never` (Exclude is applied at the call site against the field type)
 * - Anything else (literals, structural objects) → `P` itself
 *
 * @internal
 */
export type ExtractNarrowType<P> =
    P extends Pred<any, infer S>
        ? S
        : P extends UnionCombinator<infer Ps extends readonly unknown[]>
          ? ExtractUnionNarrow<Ps>
          : P extends NotCombinator<any>
            ? never
            : P;

/** @internal */
export type ExtractUnionNarrow<Ps extends readonly unknown[]> =
    Ps extends readonly [infer H, ...infer T]
        ? ExtractNarrowType<H> | ExtractUnionNarrow<T>
        : never;

/**
 * Resolves the concrete TypeScript type that a `select()` extraction will
 * produce for a given field, given the inner pattern constraint (if any) and
 * the field's type in the variant `V`.
 *
 * - No inner pattern (`void`) → `FieldType` verbatim
 * - `Pred<T, S>` inner → `S`
 * - `NotCombinator<P>` inner → `Exclude<FieldType, ExtractNarrowType<P>>`
 * - `UnionCombinator<Ps>` inner → `ExtractUnionNarrow<Ps>`
 * - Literal inner → the literal itself
 *
 * @internal
 */
export type ResolveSelectType<InnerPat, FieldType> = [InnerPat] extends [void]
    ? FieldType
    : InnerPat extends Pred<any, infer S>
      ? S
      : InnerPat extends NotCombinator<infer Inner>
        ? Exclude<FieldType, ExtractNarrowType<Inner>>
        : InnerPat extends UnionCombinator<infer Ps extends readonly unknown[]>
          ? ExtractUnionNarrow<Ps>
          : InnerPat;

/**
 * Recursively collects all `select()` markers from a pattern type `P`,
 * mapping each `select(name)` to its resolved field type from `V`.
 *
 * Returns a union of `{ name: Type }` objects — pass through
 * {@link UnionToIntersection} to produce the final `selections` shape.
 *
 * @internal
 */
type CollectSelectionItems<P extends object, V> = {
    [K in keyof P & string]: K extends keyof V
        ? P[K] extends SelectMarker<infer Name, infer InnerPat>
            ? { [_ in Name]: ResolveSelectType<InnerPat, V[K]> }
            : P[K] extends object
              ? CollectSelectionItems<
                    Extract<P[K], object>,
                    Extract<V[K], object>
                >
              : never
        : never;
}[keyof P & string];

/**
 * Computes the typed `selections` map for a `when()` arm.
 *
 * Given the pattern type `P` and the variant type `V`:
 * - Traverses `P` to find all {@link SelectMarker} values
 * - Maps each to its resolved type against the corresponding field in `V`
 * - Returns an intersection of all `{ name: Type }` records
 *
 * If no `select()` markers are present, returns `{}`.
 *
 * @typeParam P - The pattern type (from the `when()` call)
 * @typeParam V - The variant type being matched
 */
export type SelectionsFor<P, V> = [P] extends [typeof __]
    ? {}
    : P extends object
      ? UnionToIntersection<{} | CollectSelectionItems<P, V>>
      : {};

/**
 * An extraction binding produced by {@link select}.
 * When placed as a field value inside a {@link when} pattern, the matched
 * field value is collected into the `selections` map passed as the second
 * argument to the handler.
 *
 * @typeParam Name - The literal key name under which the value is injected
 * @typeParam InnerPat - The inner pattern type used to constrain and narrow
 *   the extracted value (`void` means no constraint — use the field's type)
 */
export type SelectMarker<Name extends string = string, InnerPat = void> = {
    readonly [selectTag]: true;
    readonly name: Name;
    readonly pattern?: unknown;
    /** @internal Phantom: carries inner pattern type for type-level inference */
    readonly _inner?: InnerPat;
};

/**
 * A namespace of pattern primitives for use inside {@link when} pattern objects.
 *
 * **Type wildcards** — match a value by its runtime type:
 * ```ts
 * when({ age: is.number }, ({ age }) => age * 2)
 * when({ name: is.string }, ({ name }) => name.toUpperCase())
 * ```
 *
 * **Combinators** — logical composition of patterns:
 * ```ts
 * when({ status: is.not("error") }, handler)
 * when({ code: is.union(is.string, is.number) }, handler)
 * ```
 */
export const is: {
    /** Matches any `string` value. */
    readonly string: Pred<unknown, string>;
    /** Matches any `number` value. */
    readonly number: Pred<unknown, number>;
    /** Matches any `boolean` value. */
    readonly boolean: Pred<unknown, boolean>;
    /** Matches `null` or `undefined`. */
    readonly nullish: Pred<unknown, null | undefined>;
    /** Matches any value that is not `undefined`. */
    readonly defined: Pred<unknown>;
    /** Matches any array (`Array.isArray`). */
    readonly array: Pred<unknown, unknown[]>;
    /** Matches a non-null, non-array object. */
    readonly object: Pred<unknown, object>;
    /**
     * Matches any value that does **not** match the given pattern.
     *
     * The pattern may be a literal, a {@link Pred}, another combinator, or a
     * structural object.
     *
     * @example
     * when({ status: is.not("error") }, handler)
     * when({ code: is.not(is.string) }, handler)
     */
    not<P>(pattern: P): NotCombinator<P>;
    /**
     * Matches if the value satisfies **any** of the given patterns (logical OR).
     *
     * @example
     * when({ code: is.union(is.string, is.number) }, handler)
     * when({ status: is.union("pending", "active") }, handler)
     */
    union<const Ps extends unknown[]>(...patterns: Ps): UnionCombinator<Ps>;
} = {
    string: {
        [predTag]: true,
        fn: (v: unknown) => typeof v === "string",
    } as Pred<unknown, string>,
    number: {
        [predTag]: true,
        fn: (v: unknown) => typeof v === "number",
    } as Pred<unknown, number>,
    boolean: {
        [predTag]: true,
        fn: (v: unknown) => typeof v === "boolean",
    } as Pred<unknown, boolean>,
    nullish: { [predTag]: true, fn: (v: unknown) => v == null } as Pred<
        unknown,
        null | undefined
    >,
    defined: {
        [predTag]: true,
        fn: (v: unknown) => v !== undefined,
    } as Pred<unknown>,
    array: { [predTag]: true, fn: (v: unknown) => Array.isArray(v) } as Pred<
        unknown,
        unknown[]
    >,
    object: {
        [predTag]: true,
        fn: (v: unknown) =>
            typeof v === "object" && v !== null && !Array.isArray(v),
    } as Pred<unknown, object>,
    not(pattern: any) {
        return {
            [patternTag]: true,
            kind: "not",
            pattern,
        } as NotCombinator<any>;
    },
    union(...patterns: any[]) {
        return {
            [patternTag]: true,
            kind: "union",
            patterns,
        } as UnionCombinator<any>;
    },
};

/**
 * Mark a field in a {@link when} pattern for extraction into the handler's
 * `selections` argument.
 *
 * The matched field value is injected as a named property of the `selections`
 * object passed as the second argument to the handler. Its type is inferred
 * from the corresponding field type in the variant, optionally narrowed by an
 * inner pattern constraint.
 *
 * @param name - The key under which the extracted value appears in `selections`
 * @param pattern - Optional pattern the field must satisfy for the arm to match;
 *   also narrows the extracted value's type
 *
 * @example
 * // Extract without constraint — typed as the field's own type
 * when({ user: { name: select("name") } }, (val, { name }) => `Hello, ${name}`)
 *
 * // Extract with type narrowing
 * when({ age: select("age", is.number) }, (val, { age }) => age * 2)
 *
 * // Extract and exclude nullish — sel.t is Exclude<string | null, null | undefined>
 * when({ text: select("t", is.not(is.nullish)) }, (val, { t }) => t.toUpperCase())
 */
export function select<N extends string>(name: N): SelectMarker<N, void>;
export function select<N extends string, P>(
    name: N,
    pattern: P,
): SelectMarker<N, P>;
export function select(
    name: string,
    pattern?: unknown,
): SelectMarker<any, any> {
    return { [selectTag]: true, name, pattern };
}

// ==========================================
// 5. WHEN
// ==========================================

/**
 * A typed arm object produced by {@link when}.
 * Used as a variant matcher in {@link match} — either as a single value or in an array.
 *
 * @typeParam V - The variant type this arm operates on
 * @typeParam R - The result type produced by the handler
 * @typeParam P - The pattern type; used to compute the precise `selections` type
 */
export type WhenArm<V, R, P = {}> = {
    readonly [whenTag]: true;
    readonly pattern: P | typeof __;
    readonly guard?: (val: V) => boolean;
    readonly handler: (val: V, selections: SelectionsFor<P, V>) => R;
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
 * Pattern field values may be:
 * - Literals — strict equality
 * - {@link pred} wrappers — predicate evaluation
 * - {@link is}`.*` wildcards — type checks (`is.string`, `is.number`, …)
 * - {@link is.not} / {@link is.union} combinators — logical composition
 * - {@link select} markers — extract the field into the handler's `selections` argument
 * - Plain objects — recursive structural sub-patterns
 *
 * Arms in an array are evaluated left to right; the first match wins.
 * Always end an arm array with `when(__, ...)` when pattern or guard arms might not
 * cover every possible value.
 *
 * The `selections` second argument is typed precisely: each `select("name")` in the
 * pattern produces a corresponding `{ name: FieldType }` entry, narrowed by any
 * inner pattern constraint.
 *
 * @example
 * match(event, {
 *   KeyPress: [
 *     when({ key: "Enter" },                              () => "submit"),
 *     when({ key: is.union("Tab", "Escape") },            () => "navigation"),
 *     when({ key: select("k") }, (_, { k }) => `char: ${k}`),
 *     when(__,                                            () => "other"),
 *   ],
 * })
 */
export function when<V = any, R = any>(
    pattern: typeof __,
    handler: (val: V) => R,
): WhenArm<V, R, typeof __>;
export function when<V = any, R = any>(
    guard: (val: V) => boolean,
    handler: (val: V) => R,
): WhenArm<V, R, {}>;
export function when<V = any, R = any, P extends object = {}>(
    pattern: P,
    handler: (val: V, selections: SelectionsFor<P, V>) => R,
): WhenArm<V, R, P>;
export function when<V = any, R = any, P extends object = {}>(
    pattern: P,
    guard: (val: V) => boolean,
    handler: (val: V, selections: SelectionsFor<P, V>) => R,
): WhenArm<V, R, P>;
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
// 6. THE `union` FACTORY
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
 * abstract class Identifiable extends Trait<{ id: string }> {
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
interface UnionBuilder<Impl extends AbstractConstructor[]> {
    /** Existing inferred path — generics erased, impl mixin auto-applied. */
    <Factories extends Record<string, ValidVariant<AllRequired<Impl>>>>(
        factories: Factories,
    ): {
        [K in keyof Factories & string]: Factories[K] extends (
            ...args: any[]
        ) => any
            ? (...args: Parameters<Factories[K]>) => ReturnType<
                  Factories[K]
              > & {
                  [tag]: K;
              } & ImplMixinFromImpl<Impl>
            : () => Factories[K] & { [tag]: K } & ImplMixinFromImpl<Impl>;
    };

    /**
     * Identity passthrough: factory types flow through unchanged.
     * Use when factories carry explicit generic signatures (via {@link Variant} casts).
     * The impl mixin must be included manually in each `Variant<>` cast.
     *
     * Property — call directly: `union([Impl]).typed({ ... })`
     */
    readonly typed: <
        Factories extends Record<string, (...args: any[]) => AllRequired<Impl>>,
    >(
        factories: Factories,
    ) => Factories;
}

export function union<Impl extends AbstractConstructor[]>(
    impls: Impl,
): UnionBuilder<Impl>;

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
        const builder = (factories: any) =>
            buildUnion(factories, factoriesOrImpls);
        builder.typed = (factories: any) =>
            buildUnion(factories, factoriesOrImpls);
        return builder;
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
                return createVariant(proto, ...instances, payload);
            }

            return createVariant(proto, payload);
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

const createVariant = (proto: any, ...impl: any[]) => {
    return Object.assign(Object.create(proto), ...impl);
};
