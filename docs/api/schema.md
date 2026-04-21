# API Reference: `aljabr/schema`

The schema module bridges untyped external data (API responses, form inputs, raw JSON) and aljabr's strictly typed internal world. It ships as a separate entry point so applications that only use the core union and match engine pay no bundle cost for the schema machinery.

```ts
import {
  Schema, DecodeError,
  decode, encode,
  defineDecoder, defineCodec,
  roundtrip,
  type AnySchema, type Decoder, type Codec,
} from "aljabr/schema"
```

---

## `Schema<T>`

A `Schema<T>` is an introspectable aljabr variant that describes how to decode an unknown value into `T` (and encode `T` back to `unknown`). Because schemas are first-class variants you can `match()` over them, traverse their structure, or derive other artifacts (JSON Schema, OpenAPI) from the same value you use at runtime.

### Factory methods

All factory methods return `Schema<T>` where `T` is the output type.

---

#### `Schema.string()`

```ts
Schema.string(): Schema<string>
```

Accepts any `string`. Rejects anything else with a `TypeMismatch` error.

```ts
decode(Schema.string(), "hello") // Valid("hello")
decode(Schema.string(), 42)      // Invalid([TypeMismatch([], "string", "number")])
```

---

#### `Schema.number()`

```ts
Schema.number(): Schema<number>
```

Accepts any `number`.

---

#### `Schema.boolean()`

```ts
Schema.boolean(): Schema<boolean>
```

Accepts `true` or `false`.

---

#### `Schema.literal(value)`

```ts
Schema.literal<V extends string | number | boolean | null | undefined>(value: V): Schema<V>
```

Accepts only the exact value provided. Uses strict equality (`===`).

```ts
decode(Schema.literal("ok"), "ok")    // Valid("ok")
decode(Schema.literal("ok"), "error") // Invalid([InvalidLiteral([], "ok", "error")])
decode(Schema.literal(null), null)    // Valid(null)
```

---

#### `Schema.optional(inner)`

```ts
Schema.optional<T>(inner: Schema<T>): Schema<T | undefined>
```

Accepts `undefined` (passing it through immediately) or any value accepted by `inner`.

```ts
const s = Schema.optional(Schema.string())
decode(s, "hi")        // Valid("hi")
decode(s, undefined)   // Valid(undefined)
decode(s, null)        // Invalid([TypeMismatch([], "string", "null")])
```

---

#### `Schema.nullable(inner)`

```ts
Schema.nullable<T>(inner: Schema<T>): Schema<T | null>
```

Accepts `null` (passing it through immediately) or any value accepted by `inner`.

---

#### `Schema.nullish(inner)`

```ts
Schema.nullish<T>(inner: Schema<T>): Schema<T | null | undefined>
```

Accepts `null` **or** `undefined` (passing them through) or any value accepted by `inner`.

---

#### `Schema.array(element)`

```ts
Schema.array<T>(element: Schema<T>): Schema<T[]>
```

Accepts an array whose elements all satisfy `element`. Errors accumulate — every failing element is reported, not just the first.

```ts
const s = Schema.array(Schema.number())
decode(s, [1, 2, 3])         // Valid([1, 2, 3])
decode(s, [1, "bad", 3, "x"]) // Invalid([TypeMismatch([1], ...), TypeMismatch([3], ...)])
```

---

#### `Schema.object(shape, options?)`

```ts
Schema.object<T extends Record<string, unknown>>(
  shape: { [K in keyof T]: Schema<T[K]> },
  options?: { mode?: "strip" | "strict" | "passthrough" }
): Schema<T>
```

Decodes a plain object against the shape. All errors from all fields are accumulated simultaneously.

**`mode`** (default: `"strip"`):

| Mode | Behaviour |
|---|---|
| `"strip"` | Extra keys in the input are silently dropped from the decoded output. |
| `"strict"` | Extra keys produce a `Custom` error. The input must match the shape exactly. |
| `"passthrough"` | Extra keys are copied into the decoded output unchanged. |

Missing required fields produce `MissingField` errors. Fields wrapped in `Schema.optional` (or `Schema.nullish`) are not required.

```ts
const User = Schema.object({ name: Schema.string(), age: Schema.number() })

decode(User, { name: "Alice", age: 30 })             // Valid({ name: "Alice", age: 30 })
decode(User, { name: "Alice", age: 30, extra: true }) // Valid (extra stripped)
decode(User, { name: "Alice" })                       // Invalid([MissingField(["age"], "age")])
decode(User, {})                                      // Invalid([MissingField x2])
```

---

#### `Schema.union(...schemas)`

```ts
Schema.union<Ts extends unknown[]>(
  ...schemas: { [K in keyof Ts]: Schema<Ts[K]> }
): Schema<Ts[number]>
```

Tries each schema left-to-right at decode time. Returns the first `Valid` result. If no schema matches, produces a `TypeMismatch` error.

For discriminated external shapes, prefer `Schema.variant` — `Schema.union` is intended for plain type-level unions like `string | number`.

```ts
const s = Schema.union(Schema.string(), Schema.number())
decode(s, "hello") // Valid("hello")
decode(s, 42)      // Valid(42)
decode(s, true)    // Invalid([TypeMismatch([], "one of union members", "boolean")])
```

---

#### `Schema.variant(factory, shapeMap, options?)`

```ts
Schema.variant<F extends Record<string, (...args: any[]) => any>>(
  factory: F,
  shapeMap: Record<string, AnySchema>,
  options?: { discriminant?: string; map?: Record<string, string> }
): Schema<Union<typeof F>>
```

The bridge primitive for decoding external data directly into an aljabr union variant. It reads a discriminant field from the raw input, resolves the variant name, decodes the remaining payload against the corresponding shape schema, and constructs the variant by calling `factory[variantName](payload)`.

**Options:**

| Option | Default | Description |
|---|---|---|
| `discriminant` | `"type"` | The key on the raw input that identifies which variant to produce. |
| `map` | _(none)_ | Maps external discriminant values to aljabr variant names. E.g. `{ ok: "Accept", err: "Reject" }`. Without a map, the discriminant value must match the variant name exactly. |

```ts
const Box = union({
  Full:  (payload: Record<string, unknown>) => ({ ...payload }),
  Empty: (payload: Record<string, unknown>) => ({ ...payload }),
})

const BoxSchema = Schema.variant(Box, {
  Full:  Schema.object({ value: Schema.number() }),
  Empty: Schema.object({}),
})

const r = decode(BoxSchema, { type: "Full", value: 42 })
// Valid — getTag(r.value) === "Full", r.value.value === 42

decode(BoxSchema, { type: "Unknown" })
// Invalid([UnrecognizedVariant([], "type", "Unknown")])
```

**With a discriminant map:**

```ts
const StatusSchema = Schema.variant(
  Status,
  {
    Ok:  Schema.object({ code: Schema.number() }),
    Err: Schema.object({ message: Schema.string() }),
  },
  {
    discriminant: "status",
    map: { success: "Ok", failure: "Err" },
  }
)

decode(StatusSchema, { status: "success", code: 200 }) // Valid — getTag === "Ok"
decode(StatusSchema, { status: "failure", message: "not found" }) // Valid — getTag === "Err"
```

---

#### `Schema.transform(base, decodeFn, encodeFn)`

```ts
Schema.transform<O, P>(
  base: Schema<O>,
  decodeFn: (value: O) => P,
  encodeFn: (value: P) => unknown,
): Codec<unknown, P>
```

Produces a [`Codec<unknown, P>`](#codeci-o) by composing a base schema's decode with a refinement function, and pairing it with a total encode function. The canonical use case is type coercion at the data boundary:

```ts
const DateSchema = Schema.transform(
  Schema.string(),
  (s) => new Date(s),       // decode: string → Date
  (d) => d.toISOString(),   // encode: Date → string
)
// → Codec<unknown, Date>

DateSchema.decode("2021-01-01T00:00:00.000Z")
// Valid(Date)

DateSchema.encode(new Date("2021-01-01T00:00:00.000Z"))
// "2021-01-01T00:00:00.000Z"
```

If the base schema's decode fails (e.g., input is not a string), the decode error propagates and `decodeFn` is never called.

The result is a `Codec` object — not a `Schema<P>` variant — so it cannot be composed further into other schema factories (`Schema.array(DateSchema)` is not supported). For composable coercions, handle the transformation in application code after decoding.

---

## `decode(schema, input)`

```ts
decode<T>(schema: Schema<T>, input: unknown): Validation<T, DecodeError>
```

Decodes an unknown value against a schema, returning a `Validation<T, DecodeError>`. All errors from all fields are accumulated simultaneously — a single `decode` call on a complex object reports every failing field at once, not just the first.

```ts
import { decode, Schema } from "aljabr/schema"
import { match } from "aljabr"

const UserSchema = Schema.object({
  name: Schema.string(),
  age:  Schema.number(),
})

const result = decode(UserSchema, rawApiPayload)

match(result, {
  Valid:       ({ value }) => renderUser(value),
  Invalid:     ({ errors }) => showErrors(errors),
  Unvalidated: () => { /* not yet decoded */ },
})
```

---

## `encode(schema, value)`

```ts
encode<T>(schema: Schema<T>, value: T): unknown
```

Encodes a typed value back to its raw (wire) form. Every native schema variant is a full codec — `encode` is always total and never fails.

`encode` is the mirror of `decode`: if `decode(schema, raw)` produces `Valid(value)`, then `encode(schema, value)` produces a value that, when decoded again, produces the same `value`.

```ts
import { encode, Schema } from "aljabr/schema"

const UserSchema = Schema.object({
  name: Schema.string(),
  age:  Schema.number(),
})

encode(UserSchema, { name: "Alice", age: 30 })
// { name: "Alice", age: 30 }
```

**`ObjectSchema`**: only fields present in the shape are encoded. Extra properties on the value object are not included in the encoded output.

**`UnionSchema`**: the first schema whose `decode` accepts the value is used to encode it. This is reliable for non-overlapping members.

**`VariantSchema`**: reconstructs the discriminant field from the variant's tag. If a `map` was configured during schema construction, encode inverts it — `{ success: "Ok" }` becomes `Ok → "success"` at encode time.

---

## `Decoder<I, O>`

```ts
interface Decoder<I, O> {
  decode(input: I): Validation<O, DecodeError>
}
```

A value that can decode inputs of type `I` into validated outputs of type `O`. Use `Decoder<I, O>` as a function parameter type when a caller only needs to decode, not encode.

```ts
function loadConfig<T>(decoder: Decoder<unknown, T>, raw: unknown): T {
  const result = decoder.decode(raw)
  if (getTag(result) !== "Valid") throw new Error("invalid config")
  return result.value as T
}
```

---

## `Codec<I, O>`

```ts
interface Codec<I, O> extends Decoder<I, O> {
  encode(output: O): I
}
```

A value that can both decode and encode between `I` and `O`. `encode` is total — it never fails. Use `Codec<I, O>` when a caller needs the round-trip guarantee.

```ts
function syncStorage<T>(codec: Codec<unknown, T>, raw: unknown): {
  value: T
  write: () => unknown
} {
  const result = codec.decode(raw)
  if (getTag(result) !== "Valid") throw new Error("invalid")
  const value = result.value as T
  return { value, write: () => codec.encode(value) }
}
```

---

## `defineDecoder(decoder)`

```ts
defineDecoder<I, O>(decoder: Decoder<I, O>): Decoder<I, O>
```

A zero-cost identity helper that types and validates a custom decoder object at its definition site rather than at each call site. Use this when writing adapters for external validators (Zod, ArkType, etc.):

```ts
import { defineDecoder } from "aljabr/schema"
import { z } from "zod"

const UserDecoder = defineDecoder({
  decode(input: unknown) {
    const result = UserZodSchema.safeParse(input)
    return result.success
      ? Validation.Valid(result.data)
      : Validation.Invalid(result.error.issues.map(i =>
          DecodeError.Custom(i.path as string[], i.message)
        ))
  }
})
```

Any type mismatch between the `decode` signature and the `Decoder<I, O>` contract is reported at the definition site.

---

## `defineCodec(codec)`

```ts
defineCodec<I, O>(codec: Codec<I, O>): Codec<I, O>
```

Identical to `defineDecoder` but for codecs that also implement `encode`. Type errors in either `decode` or `encode` are caught at the definition site.

```ts
const NumberStringCodec = defineCodec({
  decode: (input: unknown) => decode(Schema.string(), input)
    .map(s => Number(s))
    .map(n => isNaN(n) ? ... : n),  // see note on map chaining
  encode: (n: number) => String(n),
})
```

---

## `roundtrip(schemaOrCodec, input)`

```ts
roundtrip<T>(
  schemaOrCodec: Schema<T> | Codec<unknown, T>,
  input: unknown,
): boolean
```

A dev/test utility that verifies the round-trip property: `encode(decode(input))` deep-equals `input`. Use it in test suites to confirm that a codec or schema faithfully reconstructs the wire form:

```ts
import { roundtrip, Schema } from "aljabr/schema"

const UserSchema = Schema.object({
  name: Schema.string(),
  scores: Schema.array(Schema.number()),
})

expect(roundtrip(UserSchema, { name: "Alice", scores: [10, 20] })).toBe(true)
```

**Returns `false` when:**
- The decode fails (input is invalid) — no encode is attempted.
- `encode(decode(input))` does not deep-equal the original input.

`roundtrip` is intended for canonical inputs — data that has already been normalized to the schema's output form. It uses structural deep equality; `undefined` fields and non-JSON-serializable values may produce unexpected results in edge cases.

---

## `DecodeError`

A tagged union of all possible decode failure variants. Every variant carries a `path: (string | number)[]` that traces where in the input the error occurred.

```ts
import { DecodeError } from "aljabr/schema"
import { match } from "aljabr"

function formatError(e: DecodeError): string {
  const at = e.path.length ? ` at ${e.path.join(".")}` : ""
  return match(e, {
    TypeMismatch:         ({ expected, received }) => `expected ${expected}, got ${received}${at}`,
    MissingField:         ({ field }) => `missing required field "${field}"${at}`,
    InvalidLiteral:       ({ expected, received }) => `expected ${JSON.stringify(expected)}, got ${JSON.stringify(received)}${at}`,
    UnrecognizedVariant:  ({ discriminant, received }) => `unrecognized variant "${received}" for discriminant "${discriminant}"${at}`,
    Custom:               ({ message }) => `${message}${at}`,
  })
}
```

### Variants

| Variant | Additional payload | When produced |
|---|---|---|
| `TypeMismatch` | `expected: string`, `received: string` | The runtime type of the input doesn't match the schema. |
| `MissingField` | `field: string` | A required key is absent from an object. |
| `InvalidLiteral` | `expected: unknown`, `received: unknown` | A literal schema received a value that isn't strictly equal to its expected value. |
| `UnrecognizedVariant` | `discriminant: string`, `received: string` | A variant schema received a discriminant value not present in the shape map. |
| `Custom` | `message: string` | Produced by `Schema.object` in strict mode for unexpected keys, or available as an escape hatch for future `.refine()` use. |

---

## Type aliases

### `AnySchema`

```ts
type AnySchema = Union<typeof _Schema>
```

The union of all schema variant instance types, without the `Schema<T>` output phantom. Use this as a parameter type when you accept any schema regardless of its output type.

### `Schema<T>`

```ts
type Schema<T> = AnySchema & { readonly [_schemaOutput]?: T }
```

A `Schema<T>` is an `AnySchema` branded with a phantom output type `T`. Most call sites use `Schema<T>` directly; use `AnySchema` only when the output type is not needed (e.g., inside the schema traversal engine).

---

## See also

- [Guide: Working with External Data](../guides/schema.md) — narrative walkthrough of the full decode → encode → transform pipeline
- [API Reference: Validation](./prelude/validation.md) — the `Validation<T, E>` type returned by `decode`
- [API Reference: union](./union.md) — `Union<F>` and variant factory patterns used by `Schema.variant`
