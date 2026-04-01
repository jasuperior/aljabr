# Advanced Patterns

This guide covers the parts of aljabr you reach for once the basics aren't enough: impl classes, Trait constraints, constant variants, and techniques for composing `when()` arms in real-world scenarios.

---

## Impl classes and mixins

Impl classes let you attach shared behavior to every variant without inheritance. They're ordinary TypeScript classes — aljabr constructs an instance of each and merges the properties and methods onto every variant it produces.

```ts
import { union, Union, getTag } from "aljabr"

class Auditable {
  readonly createdAt = Date.now()
  audit() {
    return `[${getTag(this as any)} @ ${this.createdAt}]`
  }
}

const Command = union([Auditable])({
  Create: (name: string) => ({ name }),
  Delete: (id: string) => ({ id }),
  Rename: (id: string, name: string) => ({ id, name }),
})
type Command = Union<typeof Command>

const cmd = Command.Create("widget")
cmd.name      // "widget"
cmd.createdAt // number
cmd.audit()   // "[Create @ 1712345678901]"
```

Every variant produced by this factory carries `createdAt` and `audit`. The impl class is instantiated fresh per `union()` definition — not per variant call. Properties that come from the impl default values (like `createdAt = Date.now()`) are set at definition time; if you need per-call initialization, use the payload factory function.

### Multiple impl classes

Pass as many impl classes as you need. Their properties and methods are merged left to right, with payload values winning over any impl defaults of the same name.

```ts
class Versioned {
  version = 1
}

class Tagged {
  tags: string[] = []
}

const Doc = union([Versioned, Tagged])({
  Draft:     (title: string) => ({ title }),
  Published: (title: string, url: string) => ({ title, url }),
})

const d = Doc.Draft("Hello")
d.version // 1
d.tags    // []
```

---

## Trait constraints

Plain classes mix in behavior without imposing any requirements. `Trait<R>()` adds a type-level contract: every variant factory must return an object that satisfies `R`.

```ts
import { union, Trait, Union } from "aljabr"

abstract class Identifiable extends Trait<{ id: string }>() {
  describe() { return `[${(this as any).id}]` }
}

const Entity = union([Identifiable])({
  User:    (id: string, name: string) => ({ id, name }),
  Product: (id: string, price: number) => ({ id, price }),
  // Broken: (n: number) => ({ n }),  // ✗ compile error: missing `id`
})
```

The error surfaces on the specific variant that doesn't conform — not a cryptic error on the `union()` call site.

### Combining Trait requirements

When multiple impl classes each extend `Trait<R>()`, the requirements are intersected. Every variant must satisfy all of them:

```ts
abstract class HasId    extends Trait<{ id: string }>() {}
abstract class HasLabel extends Trait<{ label: string }>() {}

const Node = union([HasId, HasLabel])({
  Leaf:   (id: string, label: string) => ({ id, label }),
  Branch: (id: string, label: string, children: string[]) => ({ id, label, children }),
})
```

### `FactoryPayload<T>`

When writing factory functions for impl-based unions, typing the return can get repetitive. `FactoryPayload<T>` derives the plain payload type from your trait:

```ts
import { FactoryPayload } from "aljabr"

abstract class HasId extends Trait<{ id: string; active: boolean }>() {}
type Payload = FactoryPayload<InstanceType<typeof HasId>>
// { id: string; active: boolean }

// Use it to type a helper:
function makeId(id: string): Payload {
  return { id, active: true }
}
```

---

## Constant variants

Variants defined with a plain object (instead of a factory function) become no-arg constructors. Each call returns a fresh copy — no shared reference:

```ts
const Token = union({
  EOF:     { pos: -1 },
  Newline: { char: "\n" },
  Tab:     { char: "\t" },
})

const a = Token.EOF()
const b = Token.EOF()
a === b // false — fresh objects
a.pos   // -1
```

This matters: mutating one won't affect another, and you can safely attach additional properties to a specific instance.

---

## Payload shadows impl defaults

When a variant's payload contains a key that an impl class also defines, the payload wins:

```ts
abstract class Stateful extends Trait<{ active: boolean }>() {
  active = true  // default
}

const Widget = union([Stateful])({
  Toggle: (active: boolean) => ({ active }),
})

Widget.Toggle(true).active  // true
Widget.Toggle(false).active // false — payload shadowed the impl default
```

This is intentional and expected. Impl defaults are starting values; the factory is the authoritative source.

---

## Composing `when()` arms

### Pattern + pred + guard

All three can be combined in a single arm. They're evaluated in order: pattern first, then pred fields within the pattern, then the guard function. All must pass for the arm to fire:

```ts
const Form = union({
  Submit: (value: string, retries: number) => ({ value, retries }),
})
type Form = Union<typeof Form>

const handle = (f: Form): string =>
  match(f, {
    Submit: [
      when(
        { value: pred((v) => v.length > 0) }, // pred: non-empty
        (f) => f.retries === 0,                // guard: first attempt
        () => "fresh submit",
      ),
      when(
        { value: pred((v) => v.length > 0) }, // pred: non-empty
        (f) => f.retries > 0,                  // guard: retry
        () => "retry submit",
      ),
      when(__, () => "empty or invalid"),
    ],
  })
```

### Guard-only arms

When you don't have a structural pattern — just a runtime condition on the full value — use the guard-only form:

```ts
match(event, {
  Click: [
    when((v) => v.x < 0 || v.y < 0, () => "out of bounds"),
    when((v) => v.x === v.y,         () => "diagonal"),
    when(__,                          () => "normal click"),
  ],
})
```

### Type-narrowing with pred

If a field can hold a union of types and you need to narrow it, use a type predicate:

```ts
type Payload = { value: string | number }

const Field = union({
  Input: (value: string | number) => ({ value }),
})
type Field = Union<typeof Field>

const format = (f: Field): string =>
  match(f, {
    Input: [
      when(
        { value: pred((v): v is string => typeof v === "string") },
        ({ value }) => value.toUpperCase(),  // value is string here
      ),
      when(
        { value: pred((v): v is number => typeof v === "number") },
        ({ value }) => value.toFixed(2),     // value is number here
      ),
      when(__, () => "unknown"),
    ],
  })
```

---

## Modeling state machines

aljabr pairs naturally with state machine patterns. Each state is a variant; transitions are functions that return new variants:

```ts
import { union, match, Union } from "aljabr"

const State = union({
  Idle:    { count: 0 },
  Loading: (requestId: string) => ({ requestId }),
  Success: (data: string[]) => ({ data }),
  Error:   (message: string, retries: number) => ({ message, retries }),
})
type State = Union<typeof State>

function transition(state: State, event: string): State {
  return match(state, {
    Idle:    () => State.Loading(crypto.randomUUID()),
    Loading: ({ requestId }) =>
      event === "ok"
        ? State.Success(["item1", "item2"])
        : State.Error("fetch failed", 0),
    Error:   ({ message, retries }) =>
      retries < 3
        ? State.Loading(crypto.randomUUID())
        : State.Error(message, retries),
    Success: (s) => s,
  })
}
```

Each call to a `State.*` constructor produces a new, immutable-by-convention value. `match()` guarantees every state is handled — add a new state and every unhandled transition becomes a compile error.

---

## See also

- [Getting Started](./getting-started.md)
- [API Reference: union](../api/union.md)
- [API Reference: match](../api/match.md)
