// ---------------------------------------------------------------------------
// Canonical reusable traits (interfaces — type-only)
// ---------------------------------------------------------------------------
//
// These are *type-only* canonical trait declarations. ADT-specific concrete
// trait classes (e.g. Option's Mappable, Validation's Combinable) declare
// `implements Bindable<T>` to advertise conformance, while continuing to
// extend `Trait<{value: ...}>` directly — which preserves the variant
// payload constraint enforced at the union builder level.
//
// **Why interfaces instead of abstract classes:**
//
// An earlier draft made the canonical traits abstract classes with abstract
// method declarations. Two problems surfaced:
//
//   1. Each concrete subclass had to widen its method signatures to satisfy
//      the abstract `(value: T) => unknown` shape (no higher-kinded types
//      means the abstract can't say `Self<U>`). This leaked `unknown` into
//      the variant types.
//
//   2. To inherit a non-trivial `[requirements]` from a parameterised parent
//      class, the parent itself had to take an extra parameter — making the
//      canonical trait hierarchy awkward and asymmetric.
//
// Switching to interfaces lets ADT trait classes:
//   - Continue to `extends Trait<{ value: T }>` (or whatever payload they
//     require), preserving the union builder's payload enforcement.
//   - Declare `implements Mappable<T>, Reducible<T>` to advertise canonical
//     conformance — searchable, documented, type-checked.
//
// TypeScript still cannot enforce the `Self<U>` return type at the
// canonical level (no HKT), so the interfaces declare each method with its
// abstract shape and concrete classes refine.

/**
 * A type that supports the `map` operation: given a function `T → U`,
 * produce a `Self<U>`. Concrete implementers refine the return type.
 *
 * Search for `implements Mappable` to find every monadic-shaped ADT.
 */
export interface Mappable<T> {
    map<U>(fn: (value: T) => U): unknown;
}

/**
 * A type that supports `flatMap` (monadic chaining) on top of `map`.
 * Implementers must satisfy both `map` and `flatMap`. Concrete classes
 * refine return types.
 */
export interface Bindable<T> extends Mappable<T> {
    flatMap(fn: (value: T) => unknown): unknown;
}

/**
 * A type that can collapse to its success value with a supplied default.
 * Concrete implementers declare `getOr(defaultValue: T): T`.
 */
export interface Reducible<T> {
    getOr(defaultValue: T): T;
}

/**
 * A structure reducible via a left fold (a catamorphism). Distinct from
 * `Bindable` — fold traverses a structure rather than chaining computations.
 */
export interface Foldable<T> {
    fold<U>(fn: (acc: U, value: T) => U, initial: U): U;
}
