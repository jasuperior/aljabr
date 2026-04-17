# Working with External Data

aljabr's core is exceptional for modeling the internal world of your application — typed state machines, domain variants, exhaustive matching. But applications always have a boundary: untyped API responses come in, form inputs arrive as raw strings, local storage hands you `JSON.parse` output with no guarantees.

The `aljabr/schema` module is that boundary. It gives you a schema DSL built on aljabr's own union system, a decoder that accumulates all errors simultaneously, a total encoder for the reverse direction, and an adapter protocol for wrapping whatever external validator you already use.

---

## Decoding an API response

Start by describing the shape you expect:

```ts
import { Schema, decode } from "aljabr/schema"

const UserSchema = Schema.object({
  id:    Schema.number(),
  name:  Schema.string(),
  email: Schema.string(),
  age:   Schema.optional(Schema.number()),
})
```

Then decode the unknown payload:

```ts
const raw = await fetch("/api/user/1").then(r => r.json())
const result = decode(UserSchema, raw)
```

`decode` always returns a `Validation<T, DecodeError>` — never throws. Use `match` to branch on it:

```ts
import { match } from "aljabr"

match(result, {
  Valid:   ({ value }) => renderUser(value),
  Invalid: ({ errors }) => errors.forEach(e => console.error(formatError(e))),
  Unvalidated: () => {},
})
```

What you get from `decode` over a plain `if`/`try`:

- Every field error is reported at once — not just the first one you hit.
- Each error carries a `path` array tracing exactly where in the input it came from.
- The output type is `T`, not `unknown` — no casts needed after a `Valid` check.

---

## Understanding the error path

When a decode fails deep inside a nested structure, the error's `path` tells you exactly where:

```ts
const s = Schema.object({
  user: Schema.object({
    address: Schema.object({ zip: Schema.string() }),
  }),
})

decode(s, { user: { address: { zip: 10001 } } })
// Invalid([TypeMismatch(["user", "address", "zip"], "string", "number")])
```

This makes it trivial to map errors to form fields, display them inline, or ship them in an error response.

---

## Accumulating multiple errors

`decode` on an object schema collects errors from all fields in a single pass — it does not stop at the first failure. This matters when the user filled out a form and you want to highlight every problem at once:

```ts
const ContactForm = Schema.object({
  name:  Schema.string(),
  email: Schema.string(),
  age:   Schema.number(),
})

const result = decode(ContactForm, { name: 123, email: null, age: "old" })
// Invalid([
//   TypeMismatch(["name"],  "string", "number"),
//   TypeMismatch(["email"], "string", "null"),
//   TypeMismatch(["age"],   "number", "string"),
// ])
```

The same accumulation applies to arrays — every failing element is reported:

```ts
const Scores = Schema.array(Schema.number())
decode(Scores, [1, "bad", 3, "worse"])
// Invalid([
//   TypeMismatch([1], "number", "string"),
//   TypeMismatch([3], "number", "string"),
// ])
```

---

## Decoding directly into aljabr variants

`Schema.variant` is the bridge between the external world and the internal world. It reads a discriminant field from the raw input, resolves the variant name (optionally remapping it), and constructs an aljabr variant ready for pattern matching.

```ts
import { union, match, Union } from "aljabr"
import { Schema, decode } from "aljabr/schema"

const ApiResult = union({
  Success: (data: { items: string[] }) => ({ ...data }),
  Failure: (error: { code: number; message: string }) => ({ ...error }),
})
type ApiResult = Union<typeof ApiResult>

const ApiResultSchema = Schema.variant(ApiResult, {
  Success: Schema.object({ items: Schema.array(Schema.string()) }),
  Failure: Schema.object({
    code:    Schema.number(),
    message: Schema.string(),
  }),
})

// Wire: { type: "Success", items: ["a", "b"] }
const result = decode(ApiResultSchema, rawPayload)

match(result, {
  Valid:   ({ value }) =>
    match(value, {
      Success: ({ items }) => renderList(items),
      Failure: ({ code, message }) => showError(code, message),
    }),
  Invalid: ({ errors }) => handleDecodeErrors(errors),
  Unvalidated: () => {},
})
```

The default discriminant key is `"type"`. When your API uses different naming — `"status"`, `"kind"`, `"__typename"` — configure it with the `discriminant` option. When the values differ from your variant names, supply a `map`:

```ts
// Wire: { status: "success", code: 200 }
//        ^^^^^^   ^^^^^^^^^
//        custom discriminant key
//                 external value mapped to internal variant name
const s = Schema.variant(
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
```

---

## Encoding back to wire format

Every native schema is bidirectional. Use `encode` to convert a typed value back to its raw form — for outgoing API calls, storage, or serialization:

```ts
import { encode } from "aljabr/schema"

const user = { name: "Alice", age: 30 }  // decoded value
const raw  = encode(UserSchema, user)     // { name: "Alice", age: 30 }

await fetch("/api/user", {
  method: "PUT",
  body: JSON.stringify(raw),
})
```

`encode` is total — it never fails. If a value decoded successfully, encoding it back is unconditional.

For `Schema.variant`, `encode` reconstructs the discriminant field from the variant's tag. If a `map` was configured, it is inverted automatically — `Ok → "success"`, `Err → "failure"`:

```ts
const okVariant = Status.Ok({ code: 200 })
encode(StatusSchema, okVariant)
// { status: "success", code: 200 }
```

---

## Type coercions with `Schema.transform`

Sometimes the wire type and the application type are different. Dates are a canonical example: APIs speak ISO strings, but your code wants `Date` objects. `Schema.transform` creates a `Codec<unknown, P>` that handles the conversion in both directions:

```ts
import { Schema } from "aljabr/schema"

const DateSchema = Schema.transform(
  Schema.string(),              // decode: unknown → string
  (s) => new Date(s),           // refine:  string → Date
  (d) => d.toISOString(),       // encode:  Date → string (wire form)
)

DateSchema.decode("2021-06-15T00:00:00.000Z")
// Valid(Date)

DateSchema.encode(new Date("2021-06-15T00:00:00.000Z"))
// "2021-06-15T00:00:00.000Z"
```

If the base schema fails (e.g., the input is not a string), the error propagates and the refinement function is never called.

Transforms compose naturally with object schemas via `decode` + manual restructuring. Here's a form schema that coerces a numeric string field:

```ts
// Wire: { name: "Alice", birthYear: "1990" }
const FormSchema = Schema.object({
  name:      Schema.string(),
  birthYear: Schema.string(),
})

// After decode, map to your domain type:
const result = decode(FormSchema, raw).map(({ name, birthYear }) => ({
  name,
  birthYear: parseInt(birthYear, 10),
}))
```

---

## Writing a custom adapter

aljabr ships zero runtime dependencies and no official adapter packages. The adapter story is a two-file copy-paste into your own codebase using `defineDecoder` and `defineCodec`.

### Wrapping Zod

```ts
import { defineDecoder, defineCodec, DecodeError } from "aljabr/schema"
import { Validation } from "aljabr/prelude"
import { z } from "zod"

function fromZod<T>(zodSchema: z.ZodType<T>) {
  return defineDecoder<unknown, T>({
    decode(input: unknown) {
      const result = zodSchema.safeParse(input)
      if (result.success) {
        return Validation.Valid(result.data)
      }
      return Validation.Invalid(
        result.error.issues.map(issue =>
          DecodeError.Custom(issue.path as (string | number)[], issue.message)
        )
      )
    }
  })
}

// Usage
const UserDecoder = fromZod(z.object({ name: z.string(), age: z.number() }))
UserDecoder.decode({ name: "Alice", age: 30 }) // Valid(...)
```

`defineDecoder` is a zero-cost identity function — no runtime overhead. Its value is the type inference it provides: any mismatch between the `decode` signature and the `Decoder<I, O>` contract is caught at the definition site rather than scattered across all call sites.

If your Zod schema also supports a reverse transform (via `.transform()` + `.input`), you can wrap it as a full codec:

```ts
function fromZodCodec<I, O>(schema: z.ZodType<O> & { _input: I }) {
  return defineCodec<I, O>({
    decode: (input: unknown) => { /* as above */ },
    encode: (output: O) => schema.parse(output) as I,
  })
}
```

### Wrapping ArkType

```ts
import { defineDecoder, DecodeError } from "aljabr/schema"
import { Validation } from "aljabr/prelude"
import { type } from "arktype"

function fromArkType<T>(arkSchema: ReturnType<typeof type>) {
  return defineDecoder<unknown, T>({
    decode(input: unknown) {
      const [value, errors] = arkSchema(input)
      if (!errors) return Validation.Valid(value as T)
      return Validation.Invalid(
        errors.map(e =>
          DecodeError.Custom(e.path as (string | number)[], e.message)
        )
      )
    }
  })
}
```

Both patterns follow the same shape: wrap the external validator's result in `Validation.Valid` or `Validation.Invalid([DecodeError.Custom(...)])`, then pass to `defineDecoder`. The rest of the aljabr ecosystem — `match`, `Validation.all`, error accumulation — works without change.

---

## Testing with `roundtrip`

`roundtrip` is a test utility that verifies the codec contract: `encode(decode(input))` must deep-equal the original input. Use it in your test suite whenever you define a new schema or codec:

```ts
import { roundtrip, Schema } from "aljabr/schema"
import { expect, it } from "vitest"

const UserSchema = Schema.object({
  name: Schema.string(),
  scores: Schema.array(Schema.number()),
})

it("round-trips a user object", () => {
  expect(roundtrip(UserSchema, { name: "Alice", scores: [10, 20] })).toBe(true)
})
```

`roundtrip` also accepts any `Codec<unknown, T>` — including the result of `Schema.transform`:

```ts
const DateSchema = Schema.transform(
  Schema.string(),
  (s) => new Date(s),
  (d) => d.toISOString(),
)

it("round-trips an ISO date", () => {
  expect(roundtrip(DateSchema, "2021-01-01T00:00:00.000Z")).toBe(true)
})
```

Call `roundtrip` with canonical inputs — data that has already been normalized to the schema's output form. It uses structural deep equality, so inputs with extra keys that would be stripped by an `ObjectSchema` won't round-trip.

---

## Schema variants are matchable

Because schemas are first-class aljabr variants, you can `match` over them to traverse or transform the schema structure. This is the foundation for deriving other artifacts from your schema:

```ts
import { match } from "aljabr"
import { type AnySchema } from "aljabr/schema"

function toJsonSchemaType(schema: AnySchema): string {
  return match(schema, {
    StringSchema:   () => "string",
    NumberSchema:   () => "number",
    BooleanSchema:  () => "boolean",
    LiteralSchema:  ({ value }) => typeof value === "string" ? "string" : "number",
    OptionalSchema: ({ inner }) => toJsonSchemaType(inner as AnySchema),
    NullableSchema: ({ inner }) => `${toJsonSchemaType(inner as AnySchema)} | null`,
    NullishSchema:  ({ inner }) => `${toJsonSchemaType(inner as AnySchema)} | null | undefined`,
    ArraySchema:    ({ element }) => `${toJsonSchemaType(element as AnySchema)}[]`,
    ObjectSchema:   () => "object",
    UnionSchema:    () => "union",
    VariantSchema:  () => "variant",
  })
}
```

---

## See also

- [API Reference: `aljabr/schema`](../api/schema.md) — full reference for every export
- [API Reference: Validation](../api/prelude/validation.md) — `Validation<T, E>` — the container returned by `decode`
- [Getting Started](./getting-started.md) — core union and match engine
- [Advanced Patterns](./advanced-patterns.md) — generic variants, Trait constraints, `Variant<>` type
