# API Reference: match

```ts
import { match } from "aljabr"
```

---

## `match()`

```ts
function match<E extends { [tag]: string }, R>(
  value: E,
  matchers: ExactMatchers<E, R>
): R

function match<E extends { [tag]: string }, R>(
  value: E,
  matchers: FallbackMatchers<E, R>
): R
```

Dispatch on a tagged variant and return a result. The overloads enforce exhaustiveness at compile time: you either handle every variant, or provide a `[__]` catch-all.

---

## Exhaustiveness modes

### ExactMatchers

Every variant must have a matcher. No `[__]` key allowed or needed.

```ts
const Shape = union({
  Circle: (radius: number) => ({ radius }),
  Rect:   (w: number, h: number) => ({ w, h }),
})
type Shape = Union<typeof Shape>

match(shape, {
  Circle: ({ radius }) => Math.PI * radius ** 2,
  Rect:   ({ w, h }) => w * h,
})
```

Miss a variant? Compile error. Add a variant and forget to update `match`? Compile error.

### FallbackMatchers

Partial variant coverage, with a required `[__]` catch-all for everything else.

```ts
import { __ } from "aljabr"

match(event, {
  Click:     ({ x, y }) => `clicked at ${x},${y}`,
  [__]:      (v) => `unhandled: ${getTag(v)}`,
})
```

The `[__]` handler receives the full variant value, typed as the union, so you can still inspect it.

---

## Matcher types per variant

Each key in the matchers object may be one of three forms:

### 1. Function matcher

The simplest form. Called directly with the variant value.

```ts
match(result, {
  Ok:  ({ value })   => `got ${value}`,
  Err: ({ message }) => `error: ${message}`,
})
```

### 2. Single `when()` arm

A single [`when()`](union.md#when) arm as the matcher value. If the arm's pattern or guard doesn't match, the engine falls through to the top-level `[__]` catch-all (if present), or throws.

```ts
match(event, {
  KeyPress: when({ key: "Enter" }, () => "submit"),
  [__]: () => "other",
})
```

### 3. Array of `when()` arms

An array of arms, evaluated left to right. The first arm whose pattern and guard both pass wins. If no arm matches, the engine throws with a message indicating the variant name — and a hint to add `when(__, handler)` as the last arm if any guarded or predicate arms are present.

```ts
match(event, {
  KeyPress: [
    when({ key: "Enter" },                         () => "submit"),
    when({ key: pred((k) => k.startsWith("F")) },  () => "function key"),
    when((v) => v.key.length > 1,                  () => "special"),
    when(__,                                        () => "character"),
  ],
  [__]: () => "not a key event",
})
```

The `when(__, handler)` at the end of the array is the arm-level catch-all. It's distinct from the top-level `[__]` in the matchers object: the arm-level one handles "no arm matched this variant", while the top-level one handles "no matcher defined for this variant at all."

---

## Error behavior

| Situation | Error message |
|---|---|
| No matcher for variant, no `[__]` | `Unhandled variant: <name>` |
| Single `when()` arm didn't match, no `[__]` | `No matching arm and no fallback for variant "<name>".` |
| Array of arms exhausted with no match | `Non-exhaustive matcher for variant "<name>".` |
| Array exhausted, guarded/pred arms present | `Non-exhaustive matcher for variant "<name>". Guarded/pred arms require a catch-all when(__, handler) as the last arm.` |

The last message is the most useful: if you have guards or predicates in your arm list and forget `when(__, ...)`, the runtime tells you exactly what to add.

---

## Full example

```ts
import { union, match, when, pred, __, Union, getTag } from "aljabr"

const Msg = union({
  Text:    (body: string) => ({ body }),
  Image:   (url: string, alt: string) => ({ url, alt }),
  Deleted: { at: 0 },
})
type Msg = Union<typeof Msg>

function render(msg: Msg): string {
  return match(msg, {
    Text: [
      when({ body: pred((b) => b.length > 280) }, () => "<long post>"),
      when(__, ({ body }) => body),
    ],
    Image:   ({ url, alt }) => `<img src="${url}" alt="${alt}">`,
    Deleted: ({ at }) => `<deleted at ${at}>`,
  })
}
```

---

## Type definitions

```ts
type ExactMatchers<E extends { [tag]: string }, R> = {
  [Variant in E[typeof tag]]: VariantMatcher<Extract<E, { [tag]: Variant }>, R>
}

type FallbackMatchers<E extends { [tag]: string }, R> = {
  [Variant in E[typeof tag]]?: VariantMatcher<Extract<E, { [tag]: Variant }>, R>
} & {
  [__]: (val: E) => R
}

type VariantMatcher<V, R> =
  | ((val: V) => R)
  | WhenArm<V, R>
  | Array<WhenArm<V, R>>
```
