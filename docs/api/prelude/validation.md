# API Reference: Validation

```ts
import { Validation, type Valid, type Invalid } from "aljabr/prelude"
```

---

## Overview

`Validation<T, E>` is a two-variant union for validating data that may fail in multiple ways simultaneously. Unlike [`Result`](./result.md), which short-circuits on the first error, `Validation` accumulates errors across independent checks via `combine()`. All variants share `map`, `combine`, and `toResult` via the `Combinable<T, E>` impl mixin.

---

## Variants

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
type Valid<T, E>      = Variant<"Valid",   { value: T },              Combinable<T, E>>
type Invalid<T, E>    = Variant<"Invalid", { errors: E[]; value: null }, Combinable<T, E>>
type Validation<T, E> = Valid<T, E> | Invalid<T, E>
```

---

## `Combinable<T, E>` — shared behavior

### `.map<U>(fn)`

```ts
.map<U>(fn: (value: T) => U): Validation<U, E>
```

Transform the valid value. Errors pass through unchanged.

```ts
Validation.Valid<number, string>(42).map(n => n * 2)
// Valid { value: 84 }

Validation.Invalid<number, string>(["too small"]).map(n => n * 2)
// Invalid { errors: ["too small"] }
```

### `.combine<U>(other)`

```ts
.combine<U>(other: Validation<U, E>): Validation<[T, U], E>
```

Combine two validations. Errors from both are accumulated:

| `this` | `other` | Result |
|---|---|---|
| `Valid(a)` | `Valid(b)` | `Valid([a, b])` |
| `Valid(_)` | `Invalid(errs)` | `Invalid(errs)` |
| `Invalid(errs)` | `Valid(_)` | `Invalid(errs)` |
| `Invalid(ae)` | `Invalid(be)` | `Invalid([...ae, ...be])` |

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

Convert to a `Result`: `Valid` → `Accept`, `Invalid` → `Reject` with the full errors array.

```ts
Validation.Valid<number, string>(42).toResult()
// Accepted<number> { value: 42 }

Validation.Invalid<number, string>(["bad"]).toResult()
// Rejected<string[]> { error: ["bad"] }
```

---

## Pattern matching

```ts
import { match } from "aljabr"

match(validation, {
    Valid:   ({ value })  => `ok: ${value}`,
    Invalid: ({ errors }) => `errors: ${errors.join(", ")}`,
})
```

---

## Examples

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
    Valid:   ({ value: [[age, email], username] }) =>
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
        .map(([[name, age], email]) => ({ name, age, email }))
}
```

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
