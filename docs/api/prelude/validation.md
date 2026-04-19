# API Reference: Validation

```ts
import { Validation, type Unvalidated, type Valid, type Invalid } from "aljabr/prelude"
```

---

## Overview

`Validation<T, E>` is a three-variant union for validating data that may fail in multiple ways simultaneously. Unlike [`Result`](./result.md), which short-circuits on the first error, `Validation` accumulates errors across independent checks via `combine()`. All variants share `map`, `combine`, and `toResult` via the `Combinable<T, E>` impl mixin.

---

## Variants

### `Validation.Unvalidated<T, E>`

The initial, not-yet-validated state. Carries no value or errors.

```ts
Validation.Unvalidated<T, E>(): Unvalidated<T, E>
```

| Property | Type | Description |
|---|---|---|
| `value` | `null` | Always null |

`Unvalidated` passes through `map` and `combine` unchanged — any combination involving an `Unvalidated` side yields `Unvalidated`.

### `Validation.Valid<T, E>`

A successful validation result holding the validated value.

```ts
Validation.Valid<T, E>(value: T): Valid<T, E>
```

| Property | Type | Description |
|---|---|---|
| `value` | `T` | The validated value |

### `Validation.Invalid<T, E>`

A failed validation result holding an array of errors.

```ts
Validation.Invalid<T, E>(errors: E[]): Invalid<T, E>
```

| Property | Type | Description |
|---|---|---|
| `errors` | `E[]` | All accumulated error values |
| `value` | `null` | Always null |

---

## Type definitions

```ts
type Unvalidated<T, E> = Variant<"Unvalidated", { value: null },              Combinable<T, E>>
type Valid<T, E>       = Variant<"Valid",        { value: T },                 Combinable<T, E>>
type Invalid<T, E>     = Variant<"Invalid",      { errors: E[]; value: null }, Combinable<T, E>>
type Validation<T, E>  = Unvalidated<T, E> | Valid<T, E> | Invalid<T, E>
```

---

## `Combinable<T, E>` — shared behavior

### `.map<U>(fn)`

```ts
.map<U>(fn: (value: T) => U): Validation<U, E>
```

Transform the valid value. `Invalid` and `Unvalidated` pass through unchanged.

```ts
Validation.Valid<number, string>(42).map(n => n * 2)
// Valid { value: 84 }

Validation.Invalid<number, string>(["too small"]).map(n => n * 2)
// Invalid { errors: ["too small"] }

Validation.Unvalidated<number, string>().map(n => n * 2)
// Unvalidated
```

### `.combine<U>(other)`

```ts
.combine<U>(other: Validation<U, E>): Validation<CombineValues<T, U>, E>
// where CombineValues<A, B> = A extends readonly unknown[] ? [...A, B] : [A, B]
```

Combine two validations. Errors from both are accumulated. `Unvalidated` on either side propagates:

| `this` | `other` | Result |
|---|---|---|
| `Unvalidated` | _any_ | `Unvalidated` |
| `Valid(a)` | `Unvalidated` | `Unvalidated` |
| `Invalid(_)` | `Unvalidated` | `Unvalidated` |
| `Valid(a)` | `Valid(b)` | `Valid([a, b])` |
| `Valid(_)` | `Invalid(errs)` | `Invalid(errs)` |
| `Invalid(errs)` | `Valid(_)` | `Invalid(errs)` |
| `Invalid(ae)` | `Invalid(be)` | `Invalid([...ae, ...be])` |

**Chaining flattens the tuple.** When `this` is already a `Valid` holding a tuple (as produced by a prior `.combine()`), the new value is appended rather than nested:

```ts
Valid(a).combine(Valid(b))           // Valid([a, b])
Valid([a, b]).combine(Valid(c))      // Valid([a, b, c]) — flat, not [[a, b], c]
Valid([a, b, c]).combine(Valid(d))   // Valid([a, b, c, d])
```

This means multi-field chains produce **flat tuples**, not trees of nested pairs:

```ts
const age  = Validation.Valid<number, string>(25)
const name = Validation.Valid<string, string>("Alice")

age.combine(name)
// Valid { value: [25, "Alice"] }

const badAge  = Validation.Invalid<number, string>(["Age must be positive"])
const badName = Validation.Invalid<string, string>(["Name is required"])

badAge.combine(badName)
// Invalid { errors: ["Age must be positive", "Name is required"] }
```

### `.toResult()`

```ts
.toResult(): Result<T, E[]>
```

Convert to a `Result`: `Valid` → `Accept`, `Invalid` → `Reject` with the full errors array, `Unvalidated` → `Reject` with an empty errors array.

```ts
Validation.Valid<number, string>(42).toResult()
// Accepted<number> { value: 42 }

Validation.Invalid<number, string>(["bad"]).toResult()
// Rejected<string[]> { error: ["bad"] }

Validation.Unvalidated<number, string>().toResult()
// Rejected<string[]> { error: [] }
```

---

## Pattern matching

```ts
import { match } from "aljabr"

match(validation, {
    Unvalidated: ()           => "not yet validated",
    Valid:       ({ value })  => `ok: ${value}`,
    Invalid:     ({ errors }) => `errors: ${errors.join(", ")}`,
})
```

---

## Examples

### Using `Unvalidated` as initial state

`Unvalidated` is the natural starting point for a field that hasn't been touched yet — distinct from `Invalid` (which implies the user submitted something wrong) and `Valid` (which implies a passing value exists).

```ts
let field: Validation<string, string> = Validation.Unvalidated()

// User types something — validate on change
field = input.length >= 3
    ? Validation.Valid(input)
    : Validation.Invalid(["Must be at least 3 characters"])

match(field, {
    Unvalidated: () => renderPlaceholder(),
    Valid:       ({ value })  => renderSuccess(value),
    Invalid:     ({ errors }) => renderErrors(errors),
})
```

### Form validation

```ts
type FormError = string

const validateAge = (age: number): Validation<number, FormError> =>
    age >= 0 && age <= 120
        ? Validation.Valid(age)
        : Validation.Invalid(["Age must be between 0 and 120"])

const validateEmail = (email: string): Validation<string, FormError> =>
    email.includes("@")
        ? Validation.Valid(email)
        : Validation.Invalid(["Email must contain @"])

const validateUsername = (username: string): Validation<string, FormError> => {
    const errors: FormError[] = []
    if (username.length < 3) errors.push("Username must be at least 3 characters")
    if (!/^[a-z]/.test(username)) errors.push("Username must start with a letter")
    return errors.length ? Validation.Invalid(errors) : Validation.Valid(username)
}

// Combine all three — all errors collected, not just the first
const result = validateAge(25)
    .combine(validateEmail("alice@example.com"))
    .combine(validateUsername("al"))

match(result, {
    Valid:   ({ value: [age, email, username] }) =>  // flat tuple — not [[age, email], username]
        createUser({ age, email, username }),
    Invalid: ({ errors }) =>
        errors.forEach(e => showError(e)),
})
// → Invalid { errors: ["Username must be at least 3 characters"] }
```

### Parallel field validation

```ts
function validateForm(input: {
    name: string
    age: number
    email: string
}): Validation<{ name: string; age: number; email: string }, string> {
    return validateUsername(input.name)
        .combine(validateAge(input.age))
        .combine(validateEmail(input.email))
        .map(([name, age, email]) => ({ name, age, email }))  // flat tuple
}
```

### `Validation.all(validations)`

```ts
Validation.all<Vs extends readonly Validation<unknown, unknown>[]>(
    validations: readonly [...Vs],
): Validation<AllValues<Vs>, AllError<Vs>>
```

Validate a fixed-length tuple of independent values in one call. Returns a `Valid` tuple of all values when every input is `Valid`, accumulates all errors from any `Invalid` inputs, and short-circuits to `Unvalidated` if any input is `Unvalidated`.

This is the idiomatic alternative to chaining `.combine()` when all fields are already computed as an array:

```ts
const results = Validation.all([
    validateAge(25),
    validateEmail("alice@example.com"),
    validateUsername("alice"),
])

match(results, {
    Valid:   ({ value: [age, email, username] }) => createUser({ age, email, username }),
    Invalid: ({ errors }) => errors.forEach(showError),
    Unvalidated: () => {},
})
```

The result type is a typed tuple matching the input array:

```ts
// Validation.all([Valid<number>, Valid<string>, Valid<boolean>])
// → Validation<[number, string, boolean], E>
```

Behavior:
- If **any** input is `Unvalidated` → result is `Unvalidated` (field not yet touched)
- If **any** input is `Invalid` → result is `Invalid` with all errors accumulated
- If **all** inputs are `Valid` → result is `Valid` with a flat tuple of all values

### Converting to Result for error propagation

```ts
const validated = validateForm(formData)

// Convert once, use Result<T, string[]> everywhere downstream
const result = validated.toResult()

result.then(
    (user)   => saveUser(user),
    (errors) => errors.forEach(showError),
)
```

---

## Comparison with Result

| | `Result<T, E>` | `Validation<T, E>` |
|---|---|---|
| On first failure | Short-circuits (Reject) | Continues accumulating |
| Error container | Single `error: E` | Array `errors: E[]` |
| Async support | Yes (Expect + then()) | No |
| Best for | Sequential operations | Parallel independent checks |

---

## See also

- [`Result`](./result.md) — short-circuiting success/failure with async support
- [`Option`](./option.md) — nullable values without explicit errors
