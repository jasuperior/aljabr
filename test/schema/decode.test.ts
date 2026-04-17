import { describe, expect, it, expectTypeOf } from "vitest";
import {
    Schema,
    DecodeError,
    decode,
    type AnySchema,
    type Schema as SchemaType,
} from "../../src/schema/index.ts";
import { getTag } from "../../src/union.ts";
import { union } from "../../src/union.ts";
import { Validation, type Valid, type Invalid } from "../../src/prelude/validation.ts";

// ===== Helpers =====

function valid<T>(result: Validation<T, DecodeError>): T {
    if (getTag(result) !== "Valid") throw new Error(`Expected Valid, got ${getTag(result)}`)
    return (result as Valid<T, DecodeError>).value
}

function errors(result: Validation<unknown, DecodeError>): DecodeError[] {
    if (getTag(result) !== "Invalid") throw new Error(`Expected Invalid, got ${getTag(result)}`)
    return (result as Invalid<unknown, DecodeError>).errors
}

// ===== Schema factory smoke tests =====

describe("Schema factory", () => {
    it("Schema.string() creates a StringSchema variant", () => {
        expect(getTag(Schema.string())).toBe("StringSchema")
    })
    it("Schema.number() creates a NumberSchema variant", () => {
        expect(getTag(Schema.number())).toBe("NumberSchema")
    })
    it("Schema.boolean() creates a BooleanSchema variant", () => {
        expect(getTag(Schema.boolean())).toBe("BooleanSchema")
    })
    it("Schema.literal() creates a LiteralSchema variant", () => {
        expect(getTag(Schema.literal("ok"))).toBe("LiteralSchema")
    })
    it("Schema.optional() creates an OptionalSchema variant", () => {
        expect(getTag(Schema.optional(Schema.string()))).toBe("OptionalSchema")
    })
    it("Schema.nullable() creates a NullableSchema variant", () => {
        expect(getTag(Schema.nullable(Schema.string()))).toBe("NullableSchema")
    })
    it("Schema.nullish() creates a NullishSchema variant", () => {
        expect(getTag(Schema.nullish(Schema.string()))).toBe("NullishSchema")
    })
    it("Schema.array() creates an ArraySchema variant", () => {
        expect(getTag(Schema.array(Schema.number()))).toBe("ArraySchema")
    })
    it("Schema.object() creates an ObjectSchema variant", () => {
        expect(getTag(Schema.object({ name: Schema.string() }))).toBe("ObjectSchema")
    })
    it("Schema.union() creates a UnionSchema variant", () => {
        expect(getTag(Schema.union(Schema.string(), Schema.number()))).toBe("UnionSchema")
    })
    it("Schema.variant() creates a VariantSchema variant", () => {
        const F = union({ A: () => ({}) })
        expect(getTag(Schema.variant(F, { A: Schema.object({}) }))).toBe("VariantSchema")
    })
    it("schemas are matchable as AnySchema", () => {
        const s: AnySchema = Schema.string()
        expect(getTag(s)).toBe("StringSchema")
    })
})

// ===== DecodeError factory =====

describe("DecodeError factory", () => {
    it("TypeMismatch carries path, expected, received", () => {
        const e = DecodeError.TypeMismatch(["a", 0], "string", "number")
        expect(getTag(e)).toBe("TypeMismatch")
        expect(e.path).toEqual(["a", 0])
        expect(e.expected).toBe("string")
        expect(e.received).toBe("number")
    })
    it("MissingField carries path and field", () => {
        const e = DecodeError.MissingField(["user"], "name")
        expect(getTag(e)).toBe("MissingField")
        expect(e.field).toBe("name")
    })
    it("InvalidLiteral carries expected and received", () => {
        const e = DecodeError.InvalidLiteral([], "ok", "error")
        expect(getTag(e)).toBe("InvalidLiteral")
        expect(e.expected).toBe("ok")
        expect(e.received).toBe("error")
    })
    it("UnrecognizedVariant carries discriminant and received", () => {
        const e = DecodeError.UnrecognizedVariant([], "type", "Unknown")
        expect(getTag(e)).toBe("UnrecognizedVariant")
        expect(e.discriminant).toBe("type")
        expect(e.received).toBe("Unknown")
    })
    it("Custom carries path and message", () => {
        const e = DecodeError.Custom(["x"], "unexpected key")
        expect(getTag(e)).toBe("Custom")
        expect(e.message).toBe("unexpected key")
    })
})

// ===== Primitive schemas =====

describe("decode: string", () => {
    it("accepts a string", () => {
        expect(valid(decode(Schema.string(), "hello"))).toBe("hello")
    })
    it("rejects a number with TypeMismatch", () => {
        const errs = errors(decode(Schema.string(), 42))
        expect(getTag(errs[0])).toBe("TypeMismatch")
    })
    it("rejects null", () => {
        const errs = errors(decode(Schema.string(), null))
        expect(getTag(errs[0])).toBe("TypeMismatch")
    })
    it("infers string output type", () => {
        const result = decode(Schema.string(), "hi")
        expectTypeOf(result).toExtend<Validation<string, DecodeError>>()
    })
})

describe("decode: number", () => {
    it("accepts a number", () => {
        expect(valid(decode(Schema.number(), 42))).toBe(42)
    })
    it("rejects a string", () => {
        expect(getTag(errors(decode(Schema.number(), "42"))[0])).toBe("TypeMismatch")
    })
    it("infers number output type", () => {
        expectTypeOf(decode(Schema.number(), 1)).toExtend<Validation<number, DecodeError>>()
    })
})

describe("decode: boolean", () => {
    it("accepts true", () => expect(valid(decode(Schema.boolean(), true))).toBe(true))
    it("accepts false", () => expect(valid(decode(Schema.boolean(), false))).toBe(false))
    it("rejects a string", () => {
        expect(getTag(errors(decode(Schema.boolean(), "true"))[0])).toBe("TypeMismatch")
    })
})

describe("decode: literal", () => {
    it("accepts exact string literal", () => {
        expect(valid(decode(Schema.literal("ok"), "ok"))).toBe("ok")
    })
    it("accepts exact number literal", () => {
        expect(valid(decode(Schema.literal(42), 42))).toBe(42)
    })
    it("accepts null literal", () => {
        expect(valid(decode(Schema.literal(null), null))).toBeNull()
    })
    it("rejects wrong value with InvalidLiteral", () => {
        const errs = errors(decode(Schema.literal("ok"), "error"))
        expect(getTag(errs[0])).toBe("InvalidLiteral")
    })
    it("infers literal output type", () => {
        expectTypeOf(decode(Schema.literal("ok"), "ok")).toExtend<Validation<"ok", DecodeError>>()
    })
})

// ===== Modifier schemas =====

describe("decode: optional", () => {
    const s = Schema.optional(Schema.string())
    it("accepts a string", () => expect(valid(decode(s, "hi"))).toBe("hi"))
    it("accepts undefined", () => expect(valid(decode(s, undefined))).toBeUndefined())
    it("rejects null", () => {
        expect(getTag(errors(decode(s, null))[0])).toBe("TypeMismatch")
    })
    it("infers T | undefined type", () => {
        expectTypeOf(decode(s, "x")).toExtend<Validation<string | undefined, DecodeError>>()
    })
})

describe("decode: nullable", () => {
    const s = Schema.nullable(Schema.string())
    it("accepts a string", () => expect(valid(decode(s, "hi"))).toBe("hi"))
    it("accepts null", () => expect(valid(decode(s, null))).toBeNull())
    it("rejects undefined", () => {
        expect(getTag(errors(decode(s, undefined))[0])).toBe("TypeMismatch")
    })
    it("infers T | null type", () => {
        expectTypeOf(decode(s, null)).toExtend<Validation<string | null, DecodeError>>()
    })
})

describe("decode: nullish", () => {
    const s = Schema.nullish(Schema.string())
    it("accepts a string", () => expect(valid(decode(s, "hi"))).toBe("hi"))
    it("accepts null", () => expect(valid(decode(s, null))).toBeNull())
    it("accepts undefined", () => expect(valid(decode(s, undefined))).toBeUndefined())
    it("infers T | null | undefined type", () => {
        expectTypeOf(decode(s, null)).toExtend<Validation<string | null | undefined, DecodeError>>()
    })
})

// ===== Array =====

describe("decode: array", () => {
    const s = Schema.array(Schema.number())
    it("accepts an array of numbers", () => {
        expect(valid(decode(s, [1, 2, 3]))).toEqual([1, 2, 3])
    })
    it("accepts an empty array", () => {
        expect(valid(decode(s, []))).toEqual([])
    })
    it("rejects non-array with TypeMismatch", () => {
        expect(getTag(errors(decode(s, "not array"))[0])).toBe("TypeMismatch")
    })
    it("accumulates errors at each index", () => {
        const errs = errors(decode(s, [1, "bad", 3, "worse"]))
        expect(errs).toHaveLength(2)
        expect(errs[0].path).toEqual([1])
        expect(errs[1].path).toEqual([3])
    })
    it("infers T[] output type", () => {
        expectTypeOf(decode(s, [])).toExtend<Validation<number[], DecodeError>>()
    })
})

// ===== Object =====

describe("decode: object (strip mode)", () => {
    const s = Schema.object({ name: Schema.string(), age: Schema.number() })

    it("decodes a matching object", () => {
        expect(valid(decode(s, { name: "Alice", age: 30 }))).toEqual({ name: "Alice", age: 30 })
    })
    it("strips extra keys by default", () => {
        const result = valid(decode(s, { name: "Alice", age: 30, extra: true }))
        expect(result).not.toHaveProperty("extra")
        expect(result).toEqual({ name: "Alice", age: 30 })
    })
    it("emits MissingField for absent required fields", () => {
        const errs = errors(decode(s, { name: "Alice" }))
        expect(errs).toHaveLength(1)
        expect(getTag(errs[0])).toBe("MissingField")
        expect((errs[0] as any).field).toBe("age")
    })
    it("accumulates multiple field errors", () => {
        const errs = errors(decode(s, {}))
        expect(errs).toHaveLength(2)
    })
    it("reports path on nested errors", () => {
        const errs = errors(decode(s, { name: 123, age: "bad" }))
        expect(errs[0].path).toEqual(["name"])
        expect(errs[1].path).toEqual(["age"])
    })
    it("infers the object shape type", () => {
        expectTypeOf(decode(s, {})).toExtend<Validation<{ name: string; age: number }, DecodeError>>()
    })
})

describe("decode: object (strict mode)", () => {
    const s = Schema.object({ name: Schema.string() }, { mode: "strict" })
    it("rejects extra keys", () => {
        const errs = errors(decode(s, { name: "Alice", extra: 1 }))
        expect(errs).toHaveLength(1)
        expect(getTag(errs[0])).toBe("Custom")
        expect(errs[0].path).toEqual(["extra"])
    })
    it("accepts exact shape", () => {
        expect(valid(decode(s, { name: "Alice" }))).toEqual({ name: "Alice" })
    })
})

describe("decode: object (passthrough mode)", () => {
    const s = Schema.object({ name: Schema.string() }, { mode: "passthrough" })
    it("preserves extra keys", () => {
        const result = valid(decode(s, { name: "Alice", extra: 42 }))
        expect(result).toEqual({ name: "Alice", extra: 42 })
    })
})

describe("decode: object (optional fields)", () => {
    const s = Schema.object({
        name: Schema.string(),
        age: Schema.optional(Schema.number()),
    })
    it("succeeds when optional field is absent", () => {
        expect(valid(decode(s, { name: "Alice" }))).toEqual({ name: "Alice", age: undefined })
    })
    it("succeeds when optional field is present", () => {
        expect(valid(decode(s, { name: "Alice", age: 30 }))).toEqual({ name: "Alice", age: 30 })
    })
})

// ===== Union =====

describe("decode: union", () => {
    const s = Schema.union(Schema.string(), Schema.number())
    it("accepts the first matching type", () => {
        expect(valid(decode(s, "hello"))).toBe("hello")
    })
    it("accepts the second matching type", () => {
        expect(valid(decode(s, 42))).toBe(42)
    })
    it("rejects a non-matching type", () => {
        expect(getTag(errors(decode(s, true))[0])).toBe("TypeMismatch")
    })
    it("infers union output type", () => {
        expectTypeOf(decode(s, "x")).toExtend<Validation<string | number, DecodeError>>()
    })
})

// ===== Variant =====

describe("decode: variant", () => {
    const Box = union({
        Full: (payload: Record<string, unknown>) => ({ ...payload }),
        Empty: (payload: Record<string, unknown>) => ({ ...payload }),
    })

    const s = Schema.variant(Box, {
        Full: Schema.object({ value: Schema.number() }),
        Empty: Schema.object({}),
    })

    it("decodes into the correct variant by discriminant", () => {
        const result = valid(decode(s, { type: "Full", value: 42 }))
        expect(getTag(result)).toBe("Full")
        expect((result as any).value).toBe(42)
    })

    it("decodes Empty variant", () => {
        const result = valid(decode(s, { type: "Empty" }))
        expect(getTag(result)).toBe("Empty")
    })

    it("emits UnrecognizedVariant for unknown discriminant values", () => {
        const errs = errors(decode(s, { type: "Unknown" }))
        expect(getTag(errs[0])).toBe("UnrecognizedVariant")
    })

    it("emits TypeMismatch when discriminant field is missing", () => {
        const errs = errors(decode(s, { value: 42 }))
        expect(getTag(errs[0])).toBe("TypeMismatch")
    })

    it("emits TypeMismatch for non-object input", () => {
        const errs = errors(decode(s, "not an object"))
        expect(getTag(errs[0])).toBe("TypeMismatch")
    })
})

describe("decode: variant with map", () => {
    const Status = union({
        Ok: (payload: Record<string, unknown>) => ({ ...payload }),
        Err: (payload: Record<string, unknown>) => ({ ...payload }),
    })

    const s = Schema.variant(Status, {
        Ok:  Schema.object({ code: Schema.number() }),
        Err: Schema.object({ message: Schema.string() }),
    }, {
        discriminant: "status",
        map: { success: "Ok", failure: "Err" },
    })

    it("maps external discriminant values to variant names", () => {
        const result = valid(decode(s, { status: "success", code: 200 }))
        expect(getTag(result)).toBe("Ok")
    })

    it("maps failure to Err", () => {
        const result = valid(decode(s, { status: "failure", message: "not found" }))
        expect(getTag(result)).toBe("Err")
    })

    it("rejects unmapped discriminant values", () => {
        const errs = errors(decode(s, { status: "unknown" }))
        expect(getTag(errs[0])).toBe("UnrecognizedVariant")
    })
})

// ===== Nested schemas =====

describe("decode: nested object", () => {
    const s = Schema.object({
        user: Schema.object({
            name: Schema.string(),
            address: Schema.object({ zip: Schema.string() }),
        }),
    })

    it("decodes deeply nested structures", () => {
        const result = valid(decode(s, { user: { name: "Alice", address: { zip: "10001" } } }))
        expect(result.user.address.zip).toBe("10001")
    })

    it("reports deeply nested path in errors", () => {
        const errs = errors(decode(s, { user: { name: "Alice", address: { zip: 10001 } } }))
        expect(errs[0].path).toEqual(["user", "address", "zip"])
    })
})

describe("decode: array of objects", () => {
    const s = Schema.array(Schema.object({ id: Schema.number() }))
    it("decodes an array of objects", () => {
        expect(valid(decode(s, [{ id: 1 }, { id: 2 }]))).toEqual([{ id: 1 }, { id: 2 }])
    })
    it("accumulates errors from multiple elements", () => {
        const errs = errors(decode(s, [{ id: 1 }, { id: "bad" }]))
        expect(errs[0].path).toEqual([1, "id"])
    })
})
