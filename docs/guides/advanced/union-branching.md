# Union Branching

`Result`, `Option`, and `Validation` are three of the most useful types in `aljabr/prelude`. Each models a different relationship with failure: `Result` threads a value or error through a sequential chain, `Option` replaces nullable checks with an explicit absent state, and `Validation` accumulates errors across independent checks without short-circuiting.

Used individually they're convenient containers. Used together — and alongside custom domain unions — they become a shared vocabulary for modeling state cleanly throughout a codebase.

---

## Result chaining

`Result<T, E>` has three variants: `Accept` for a successful synchronous value, `Reject` for a failure, and `Expect` for a value that's still in flight as a `Promise`. All three implement `.then()`, which means you can chain transformations without unwrapping, and `await` any `Result` directly.

```ts
import { Result } from "aljabr/prelude"

// Accept: a synchronous success
const r1 = Result.Accept(42)
    .then(n => n * 2)       // Accept { value: 84 }
    .then(n => n.toString()) // Accept { value: "84" }

// Reject: a failure that passes through chains
const r2 = Result.Reject("not found")
    .then(n => n * 2)  // Reject { error: "not found" } — fn never called
```

The key rule: `.then(onAccepted, onRejected)` follows the `Promise` contract exactly. Pass `onRejected` to recover from failure:

```ts
const recovered = Result.Reject("oops")
    .then(null, (e) => `handled: ${e}`)
// Accept { value: "handled: oops" }
```

`Expect` wraps an async value. The chain stays a `Result` throughout — it doesn't collapse into a raw `Promise`:

```ts
const r3 = Result.Expect(fetchUser(1))
    .then(user => user.name)  // Expected<string> — chain stays in Result
    .then(name => name.toUpperCase())

const name = await r3  // awaits the pending chain, resolves to string
```

This matters when you have functions that return `Result` from different async sources — they compose without escaping into `Promise` chains that lose the error type.

### Wrapping async work

The typical pattern is to wrap a `fetch` or database call in a `try/catch` and return `Accept`/`Reject`:

```ts
async function loadProduct(id: string): Promise<Result<Product, string>> {
  try {
    const product = await db.products.findById(id)
    return product
      ? Result.Accept(product)
      : Result.Reject(`Product ${id} not found`)
  } catch (e) {
    return Result.Reject(`Database error: ${e}`)
  }
}
```

Now callers get a typed error channel — no more `try/catch` at every call site, no more `null` checks, no more swallowed errors.

```ts
const product = await loadProduct("p-123")

match(product, {
  Accept: ({ value }) => renderProduct(value),
  Reject: ({ error }) => showError(error),
  Expect: () => null,  // exhaustive — compiler enforces all three
})
```

---

## Option as a null discipline

`Option<T>` is a two-variant union: `Some` for a present value, `None` for absence. It's not about error handling — it's about making the "this might not be here" case explicit in your types, so the compiler can help you handle it.

```ts
import { Option } from "aljabr/prelude"

function findUser(id: string): Option<User> {
  const user = users.get(id)
  return user ? Option.Some(user) : Option.None()
}
```

The advantage over `User | null` isn't ergonomics alone — it's that `Option<User>` composes. You can chain operations without checking at every step:

```ts
const displayName = findUser("u-1")
  .flatMap(user => user.profile ? Option.Some(user.profile) : Option.None())
  .map(profile => profile.displayName.toUpperCase())
  .getOrElse("ANONYMOUS")
```

Each `.flatMap` returns an `Option`, so the chain short-circuits to `None` at the first absent step — no null pointer exceptions, no nested conditionals.

### When to reach for Option vs null

Use `Option` when:
- A function has a meaningful "not found" case that callers should explicitly handle
- You want to chain optional lookups without cascading null checks
- You're building a type that another function will `.flatMap` over

Use plain `null` or `undefined` when:
- The value is an internal implementation detail, not part of a public contract
- You're dealing with DOM APIs or third-party libraries that return null
- The caller won't chain — they just check once and move on

### Converting between Option and Result

`Option.toResult(error)` converts to a `Result` when absence means failure — useful when you're working in a context that uses `Result` for its error channel:

```ts
function requireConfig(key: string): Result<string, string> {
  return Option.Some(config.get(key) ?? null)
    .flatMap(v => v !== null ? Option.Some(v) : Option.None())
    .toResult(`Missing required config: ${key}`)
}

// Now composes naturally with other Result-returning functions
const result = await loadProduct("p-1")
  .then(product => requireConfig("stripe_key").then(key => charge(product, key)))
```

---

## Validation accumulation

`Validation<T, E>` has three variants: `Unvalidated` (not yet checked), `Valid` (passed), and `Invalid` (failed with accumulated errors). The key behavioral difference from `Result`: `.combine()` never short-circuits. If both sides have errors, both sets are collected.

```ts
import { Validation } from "aljabr/prelude"

function validateName(name: string): Validation<string, string> {
  if (name.trim().length === 0) return Validation.Invalid(["Name is required"])
  if (name.length > 100)        return Validation.Invalid(["Name is too long"])
  return Validation.Valid(name.trim())
}

function validateAge(age: number): Validation<number, string> {
  if (age < 0)   return Validation.Invalid(["Age cannot be negative"])
  if (age > 150) return Validation.Invalid(["Age is not realistic"])
  return Validation.Valid(age)
}

function validateEmail(email: string): Validation<string, string> {
  return email.includes("@")
    ? Validation.Valid(email)
    : Validation.Invalid(["Email must contain @"])
}
```

Combining them collects all errors in one pass:

```ts
const result = validateName(input.name)
  .combine(validateAge(input.age))
  .combine(validateEmail(input.email))

match(result, {
  Valid:       ({ value: [name, age, email] }) => createUser({ name, age, email }),
  Invalid:     ({ errors }) => errors.forEach(showFieldError),
  Unvalidated: () => {},  // field hasn't been touched yet
})
```

Notice the tuple in the `Valid` arm. `.combine()` flattens the accumulation — `Valid([a, b]).combine(Valid(c))` produces `Valid([a, b, c])`, not `Valid([[a, b], c])`. The `.map()` at the end can reshape the tuple into a named object.

### `Validation.all` for array validation

When your validations are already in an array, `Validation.all()` is cleaner than chaining `.combine()`:

```ts
const fields = [
  validateName(input.name),
  validateAge(input.age),
  validateEmail(input.email),
] as const

const result = Validation.all(fields)

match(result, {
  Valid:       ({ value: [name, age, email] }) => createUser({ name, age, email }),
  Invalid:     ({ errors }) => errors.forEach(showFieldError),
  Unvalidated: () => {},
})
```

### Unvalidated is not Invalid

`Unvalidated` represents a field that hasn't been touched — distinct from `Invalid` (the user entered something wrong) and `Valid` (the field passes). This distinction matters in UIs where you don't want to show validation errors before the user has interacted with a field:

```ts
let field: Validation<string, string> = Validation.Unvalidated()

// User focuses and blurs without typing — now it's Invalid
field = Validation.Invalid(["Name is required"])

// User types a valid name
field = Validation.Valid("Alice")

match(field, {
  Unvalidated: () => renderEmpty(),      // pristine
  Valid:       () => renderCheckmark(),  // passed
  Invalid:     ({ errors }) => renderErrors(errors),  // show what's wrong
})
```

### Converting to Result for downstream use

`Validation` is for collecting errors. Once you're done collecting, convert to `Result` to pass the value downstream:

```ts
const validated = validateForm(input).toResult()
// Valid → Accept, Invalid → Reject with errors[]

await validated.then(
  (user)   => saveUser(user),
  (errors) => logValidationFailure(errors),
)
```

---

## Cross-container composition

Real code mixes these types. A function might return `Result<Option<T>, E>` — a computation that can fail (`Result`) and, if it succeeds, might not have found a value (`Option`). Or `Result<Validation<T, E>, NetworkError>` — validate locally, fail on network error.

The question is when to chain and when to reach for `match`.

### Flattening Result<Option<T>, E>

The common case is wanting the inner value or a sensible default without dealing with both layers at once:

```ts
async function findSetting(key: string): Promise<Result<Option<string>, DbError>> {
  try {
    const row = await db.settings.findOne({ key })
    return Result.Accept(row ? Option.Some(row.value) : Option.None())
  } catch (e) {
    return Result.Reject(e as DbError)
  }
}

// Chain: treat None as a fallback, not an error
const setting = await findSetting("theme")
  .then(option => option.getOrElse("light"))

// → string: "dark" or "light"
```

`.then()` on the outer `Result` gets the `Option`, and `.getOrElse()` unwraps it. Two layers, composed without a nested `match`.

### When nesting is load-bearing

Sometimes the two layers have independent meaning and you need to branch on both. That's when `match` is the right tool — not a limitation, but a deliberate choice:

```ts
const result = await findSetting("payment_method")

match(result, {
  Accept: ({ value: option }) =>
    match(option, {
      Some: ({ value }) => activatePaymentMethod(value),
      None: ()          => showPaymentSetup(),
    }),
  Reject: ({ error }) => showDatabaseError(error),
})
```

Two `match` calls, each handling exactly one layer. This is clearer than trying to flatten everything into a single chain.

### Sequencing with Result

When multiple `Result`-returning operations depend on each other — each step uses the previous step's value — chain with `.then()`:

```ts
const outcome = await loadUser(userId)
  .then(user => loadSubscription(user.subscriptionId))
  .then(subscription => validateSubscription(subscription))
  .then(null, (e) => Result.Reject(`Pipeline failed: ${e}`))
```

Each `.then()` step only runs if the previous step succeeded. The first `Reject` short-circuits the rest. This is sequential composition — exactly what `Result` is designed for.

---

## match as the composition boundary

Chaining is elegant until it isn't. When a computation needs to branch into fundamentally different paths — not just transform a value, but choose between different operations based on the variant — `match` is the right tool.

The heuristic: **chain when transforming, match when branching**.

```ts
// Transforming — chain
const name = findUser(id)
  .map(user => user.name)
  .map(name => name.toUpperCase())
  .getOrElse("UNKNOWN")

// Branching — match
match(findUser(id), {
  Some: ({ value: user }) =>
    user.role === "admin" ? adminDashboard(user) : userDashboard(user),
  None: () => redirect("/login"),
})
```

The chain in the first example has a single shape — always a name string. The `match` in the second handles two structurally different outcomes. When the handlers are too different to express as transformations, match is cleaner.

---

## Building a domain union

`Result`, `Option`, and `Validation` cover generic concerns. Your domain has richer semantics.

An order isn't just `Ok | Err`. It moves through states — placed, confirmed, shipped, delivered, returned — and each state has specific data attached to it. Modeling this as a `Result<string, string>` throws away the information that makes the domain understandable.

```ts
import { union, match, Union, Trait, Variant } from "aljabr"
import { Result, Validation } from "aljabr/prelude"

// Each state carries exactly the data it needs
const OrderLifecycle = union({
  Pending:   (orderId: string, items: LineItem[]) => ({ orderId, items }),
  Confirmed: (orderId: string, items: LineItem[], confirmedAt: number) =>
    ({ orderId, items, confirmedAt }),
  Shipped:   (orderId: string, trackingCode: string, shippedAt: number) =>
    ({ orderId, trackingCode, shippedAt }),
  Delivered: (orderId: string, deliveredAt: number) => ({ orderId, deliveredAt }),
  Cancelled: (orderId: string, reason: string) => ({ orderId, reason }),
})
type OrderLifecycle = Union<typeof OrderLifecycle>
```

Transitions are plain functions. `match` enforces that every current state is handled, and the return type makes valid transitions explicit:

```ts
function confirm(order: OrderLifecycle): Result<OrderLifecycle, string> {
  return match(order, {
    Pending:   ({ orderId, items }) =>
      Result.Accept(OrderLifecycle.Confirmed(orderId, items, Date.now())),
    Confirmed: () => Result.Reject("Order is already confirmed"),
    Shipped:   () => Result.Reject("Cannot confirm a shipped order"),
    Delivered: () => Result.Reject("Cannot confirm a delivered order"),
    Cancelled: () => Result.Reject("Cannot confirm a cancelled order"),
  })
}

function ship(order: OrderLifecycle, trackingCode: string): Result<OrderLifecycle, string> {
  return match(order, {
    Confirmed: ({ orderId }) =>
      Result.Accept(OrderLifecycle.Shipped(orderId, trackingCode, Date.now())),
    Pending:   () => Result.Reject("Order must be confirmed before shipping"),
    Shipped:   () => Result.Reject("Order is already shipped"),
    Delivered: () => Result.Reject("Order has already been delivered"),
    Cancelled: () => Result.Reject("Cannot ship a cancelled order"),
  })
}
```

`Result` carries the transition outcome — `Accept` for a successful state change, `Reject` for an invalid transition. The domain union carries the state itself.

### Using Validation for construction

When creating a domain value requires multiple independent checks, use `Validation` to collect all problems before constructing:

```ts
type OrderError = string

function validateLineItem(item: { sku: string; qty: number }): Validation<LineItem, OrderError> {
  const skuV = item.sku.length > 0
    ? Validation.Valid(item.sku)
    : Validation.Invalid(["SKU cannot be empty"])

  const qtyV = item.qty > 0
    ? Validation.Valid(item.qty)
    : Validation.Invalid(["Quantity must be positive"])

  return skuV
    .combine(qtyV)
    .map(([sku, qty]) => ({ sku, qty }))
}

function createOrder(
  raw: { orderId: string; items: { sku: string; qty: number }[] }
): Validation<OrderLifecycle, OrderError> {
  if (raw.items.length === 0) {
    return Validation.Invalid(["Order must have at least one item"])
  }

  const itemValidations = Validation.all(raw.items.map(validateLineItem))

  return itemValidations.map(items =>
    OrderLifecycle.Pending(raw.orderId, items)
  )
}
```

`createOrder` returns `Validation<OrderLifecycle, string>` — every problem is collected before a `Pending` order is constructed. The caller gets either a fully-valid starting state or the complete list of what's wrong.

### Composing domain and generic containers

The domain union and the generic containers aren't competing — they compose:

```ts
async function placeOrder(raw: RawOrderInput): Promise<Result<OrderLifecycle, string[]>> {
  const validated = createOrder(raw)

  // Validation → Result for async propagation
  const initial = validated.toResult()

  return initial.then(async (order) => {
    try {
      await db.orders.insert(order)
      return Result.Accept(order)
    } catch (e) {
      return Result.Reject([`Database error: ${e}`])
    }
  })
}
```

`Validation` handles local constraints. `Result` handles async fallibility. `OrderLifecycle` carries the domain semantics. Each type does exactly one job.

---

## See also

- [Parser Construction](./parser-construction.md) — using these containers with schema decode pipelines
- [Reactive UI](./reactive-ui.md) — flowing domain unions through Ref and Derived
- [API Reference: Result](../../api/prelude/result.md)
- [API Reference: Option](../../api/prelude/option.md)
- [API Reference: Validation](../../api/prelude/validation.md)
