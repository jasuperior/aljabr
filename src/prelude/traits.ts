import { Trait } from "../union.ts";

// ---------------------------------------------------------------------------
// Canonical reusable traits
// ---------------------------------------------------------------------------
//
// These abstract trait classes are the single source of truth for the
// fundamental operations on algebraic data types in aljabr. ADT-specific
// trait classes (e.g. Option's Mappable, Effect's Computable) extend the
// appropriate canonical trait here and provide concrete implementations.
//
// TypeScript has no higher-kinded types, so the abstract method declarations
// here cannot enforce a precise `Self<U>` return type. Each concrete subclass
// re-declares the precise return type for its monad. The win is documentation
// and discoverability: searching for `extends Bindable` finds every monadic
// type, and the trait hierarchy expresses the layered relationships
// (Mappable → Bindable, etc.).
//
// Canonical traits all extend `Trait` with no payload requirement; ADT-specific
// classes layer their own payload constraints if they need them.

/**
 * The base trait for any type that supports the `map` operation:
 * given a function `T → U`, produce a `Self<U>`.
 *
 * Subclasses declare their concrete `map` return type. Use this trait as the
 * superclass for any ADT that supports a covariant transform.
 */
export abstract class Mappable<T> extends Trait {
    abstract map<U>(fn: (value: T) => U): unknown;
}

/**
 * Extends `Mappable<T>` with the `flatMap` operation: given a function
 * `T → Self<U>`, produce a `Self<U>`. Together, `map` and `flatMap` form a
 * monadic chain.
 *
 * Use this trait as the superclass for any ADT that sequences computations.
 */
export abstract class Bindable<T> extends Mappable<T> {
    abstract flatMap<U>(fn: (value: T) => unknown): unknown;
}

/**
 * The trait for any type that can collapse to its success value, optionally
 * supplying a default if no value is present.
 *
 * Use this trait as the superclass for any ADT whose primary use is
 * "extract the value or fall back to a default."
 */
export abstract class Reducible<T> extends Trait {
    abstract getOr(defaultValue: T): T;
}

/**
 * The trait for any structure that can be reduced via a left fold.
 *
 * Distinct from `Bindable` — folding is a catamorphism over an arbitrary
 * structure, not a monadic chain. Use this trait for tree-shaped or list-
 * shaped types where fold is the primary traversal.
 */
export abstract class Foldable<T> extends Trait {
    abstract fold<U>(fn: (acc: U, value: T) => U, initial: U): U;
}
