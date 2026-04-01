# Getting Started

This guide walks you from zero to a working union type with pattern matching. By the end you'll have covered the full core API: `union()`, `match()`, `when()`, `pred()`, and `Trait`.

---

## Step 1: Define your first union

A union in aljabr is a set of named variants. You define them as factory functions — or plain objects for variants with no parameters:

```ts
import { union, Union } from "aljabr"

const Result = union({
  Ok:  (value: number) => ({ value }),
  Err: (message: string) => ({ message }),
})

// Extract the union type from the factories
type Result = Union<typeof Result>
```

`Union<typeof Result>` gives you the TypeScript union of all variant instance types. You'll use this type annotation everywhere that accepts a `Result`.

Now construct some variants:

```ts
const ok  = Result.Ok(42)        // { value: 42 }
const err = Result.Err("oops")   // { message: "oops" }
```

Both are plain objects. The tag — the thing that tells `match()` which variant this is — lives on the prototype as a non-enumerable symbol. It's invisible to `JSON.stringify`, `Object.keys`, and spread operators. Your objects are clean.

---

## Step 2: Match over them

```ts
import { match } from "aljabr"

function display(r: Result): string {
  return match(r, {
    Ok:  ({ value })   => `Value: ${value}`,
    Err: ({ message }) => `Error: ${message}`,
  })
}

display(Result.Ok(42))         // "Value: 42"
display(Result.Err("timeout")) // "Error: timeout"
```

This is **ExactMatchers** mode: every variant must have a handler, and the compiler enforces it. Add a variant to `Result` without updating `match`? Compile error.

---

## Step 3: Use a fallback for partial matching

When you don't want to handle every variant explicitly, provide a `[__]` catch-all:

```ts
import { match, __, getTag } from "aljabr"

const Ev = union({
  Click:    (x: number, y: number) => ({ x, y }),
  KeyPress: (key: string) => ({ key }),
  Resize:   (w: number, h: number) => ({ w, h }),
})
type Ev = Union<typeof Ev>

function logClicks(ev: Ev): void {
  match(ev, {
    Click: ({ x, y }) => console.log(`click at ${x},${y}`),
    [__]:  () => { /* ignore */ },
  })
}
```

The `[__]` handler receives the full variant value, so you can still inspect it — e.g. `getTag(v)` to log its name.

---

## Step 4: Sub-matching with `when()`

Sometimes a single handler per variant isn't enough. A `KeyPress` might behave differently depending on which key it is. That's what `when()` arms are for:

```ts
import { when, __ } from "aljabr"

const Key = union({
  Press: (key: string) => ({ key }),
})
type Key = Union<typeof Key>

const handle = (k: Key): string =>
  match(k, {
    Press: [
      when({ key: "Enter" },  () => "submit"),
      when({ key: "Escape" }, () => "cancel"),
      when(__,                () => "other"),
    ],
  })

handle(Key.Press("Enter"))  // "submit"
handle(Key.Press("Escape")) // "cancel"
handle(Key.Press("Tab"))    // "other"
```

Arms are evaluated left to right. The first arm whose pattern matches wins. `when(__, ...)` at the end is the arm-level catch-all — always add it when you have pattern arms that might not cover every value.

---

## Step 5: Dynamic matching with `pred()`

Literal values only get you so far. `pred()` wraps a function for use as a field matcher, letting you match on conditions rather than exact values:

```ts
import { pred } from "aljabr"

const Sensor = union({
  Reading: (value: number, unit: string) => ({ value, unit }),
})
type Sensor = Union<typeof Sensor>

const classify = (s: Sensor): string =>
  match(s, {
    Reading: [
      when({ value: pred((n) => n > 100) }, () => "high"),
      when({ value: pred((n) => n > 50)  }, () => "medium"),
      when(__,                               () => "low"),
    ],
  })

classify(Sensor.Reading(120, "°C")) // "high"
classify(Sensor.Reading(75, "°C"))  // "medium"
classify(Sensor.Reading(30, "°C"))  // "low"
```

`pred()` also supports type-narrowing predicates (`val is S`), which carry the narrowed type through to the handler — useful when a field can hold multiple types.

---

## Step 6: Guard functions

A guard is a second condition on top of the pattern — an extra boolean check that runs after the pattern passes:

```ts
const Pointer = union({
  Move: (x: number, y: number) => ({ x, y }),
})
type Pointer = Union<typeof Pointer>

const quadrant = (p: Pointer): string =>
  match(p, {
    Move: [
      when({ x: pred((n) => n > 0) }, (v) => v.y > 0, () => "Q1"),
      when({ x: pred((n) => n > 0) }, (v) => v.y < 0, () => "Q4"),
      when({ x: pred((n) => n < 0) }, (v) => v.y > 0, () => "Q2"),
      when({ x: pred((n) => n < 0) }, (v) => v.y < 0, () => "Q3"),
      when(__,                                           () => "axis"),
    ],
  })
```

The full `when(pattern, guard, handler)` form: pattern fields are checked first, then the guard, then the handler runs.

---

## What's next

- [Advanced Patterns](./advanced-patterns.md) — impl classes, Trait constraints, complex compositions
- [API Reference: union](../api/union.md) — full `union()`, `Trait`, `pred`, `when`, `getTag` docs
- [API Reference: match](../api/match.md) — full `match()` docs with error behavior
