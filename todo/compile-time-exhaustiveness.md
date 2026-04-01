# TODO: Compile-Time Exhaustiveness Enforcement for Guarded Arms

## Context

When a `when()` arm array contains a guarded arm (3-argument `when()`) or a `pred()`-based
pattern, exhaustiveness cannot be statically guaranteed. Currently, this is enforced at
runtime only — the matcher throws with a clear error message if no arm matches.

## Goal

Make it a **compile-time type error** to define an arm array with guards or predicates
that does not end with a catch-all `when(__, handler)`.

## Approach (sketched)

The arm array type would need to be a typed tuple where TypeScript can inspect whether
any element is a `GuardedArm` or `PredArm`, and if so, require the last element to be
`CatchAllArm`.

This likely requires:
- Discriminated union types for `Arm` variants: `ExactArm`, `GuardedArm`, `CatchAllArm`
- A type-level predicate like `HasGuard<Arms extends Arm[]>` using recursive conditional types
- A constraint on the arm array parameter of `match()` that enforces a terminal catch-all
  when `HasGuard<Arms>` is true

## Difficulty

Moderate-to-high. Requires recursive conditional types over tuples, which can be verbose
and may hit TypeScript's instantiation depth limits for long arm arrays. Consider capping
the recursion depth or using a simpler heuristic (e.g., last arm must be catch-all whenever
array length > 1).

## Status

Deferred. Runtime enforcement with a descriptive error message is in place as a stopgap.
