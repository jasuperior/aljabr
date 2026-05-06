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
- [Working with External Data](./schema.md) — decoding API payloads, encoding, transforms, and custom adapters
- [API Reference: union](../api/union.md) — full `union()`, `Trait`, `pred`, `when`, `getTag` docs
- [API Reference: match](../api/match.md) — full `match()` docs with error behavior
- [API Reference: aljabr/schema](../api/schema.md) — full schema module reference

---

## Migrating from v0.3.x to v0.3.10

v0.3.10 batches eleven breaking sub-steps into a single tagged release so downstream consumers migrate exactly once. The changelog ([`docs/roadmap/CHANGELOG.md`](../roadmap/CHANGELOG.md)) describes what changed and why; this section is the find-and-replace cheat-sheet.

### Mechanical renames

| Before | After |
|---|---|
| `Ref<T>` / `Ref.create` | `Store<T>` / `Store.create` |
| `RefArray<T>` / `RefArray.create` | `List<T>` / `List.create` |
| `watchEffect(fn, onChange)` | `watch(fn, onChange)` |
| `Option.getOrElse(default)` | `Option.getOr(default)` |
| `WatchHandle.stop()` | `WatchHandle.dispose()` (or `using` blocks) |
| `persistedSignal(initial, options)` | `Signal.persisted(initial, options)` |
| `Scope(opts)` | `Scope.create(opts)` |
| `Resource(acquire, release)` | `Resource.create(acquire, release)` |

A non-letter-prefixed regex is the safest bulk pattern — it leaves `getCurrentScope`, `runInScope`, `ResourceHandle`, and similar suffix collisions alone:

```bash
sed -i '' -E \
    -e 's/[[:<:]]Ref[[:>:]]/Store/g' \
    -e 's/RefArray/List/g' \
    -e 's/watchEffect/watch/g' \
    -e 's/getOrElse/getOr/g' \
    -e 's/[[:<:]]Scope\(/Scope.create(/g' \
    -e 's/[[:<:]]Resource\(/Resource.create(/g' \
    -e 's/persistedSignal\(/Signal.persisted(/g' \
    src/**/*.ts test/**/*.ts
```

### Semantic changes that need real edits

These changes affect call-site shape and can't be handled by find-and-replace:

- **`Store` array methods removed.** `store.push("path", item)` becomes `store.at("path").push(item)`. The `List<T>` returned by `.at()` is fully typed; the old `ArrayPath<T>` and `ArrayItem<T, P>` helper types are gone.
- **`List.set(index, value)` returns `void`.** Replace `const prev = list.set(i, v)` with `const prev = list.peek(i); list.set(i, v)`.
- **`AsyncDerived.get()` is now synchronous** — it returns the last-known `T | null` like a `Signal`. For an awaitable form, use `asyncDerived.run(): Promise<Done | Failed>` (mirrors `Effect.run()`) or `asyncDerived.runOr(default): Promise<T>`.
- **`Derived.create({ get, set })` is removed.** Use `Derived.writable({ get, set })`, which returns `WritableDerived<T> extends Derived<T>`. Read-only deriveds (`Derived.create(fn)`) are unchanged.
- **`syncToStore(signal, options)` is now `signal.persist(options)`** and returns a `WatchHandle` instead of a stop function. Call `handle.dispose()` (or use `using`) to stop syncing.

### What you get for the migration

The post-migration surface gains coverage that previously varied per type:

- `getOr(default)` on every reactive container and bucket-2 ADT.
- `subscribe(callback): () => void` on every reactive container.
- `[Symbol.dispose]` on every disposable container — works with TC39 explicit resource management (`using sig = Signal.create(...)` auto-disposes at block exit).
- Static aggregators: `Option.all`, `Result.all`, `Effect.all` / `allSettled`, `Effect.runOr`.
- New primitives: `Dispatcher` (validated transactional writes) and `CommandError` (extensible failure union).

For the full set of rules the library will not compromise on regardless of how the API is shaped, see [`docs/guides/principles.md`](./principles.md).
