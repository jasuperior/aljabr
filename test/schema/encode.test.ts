import { describe, expect, it, expectTypeOf } from "vitest";
import {
    Schema,
    DecodeError,
    encode,
    decode,
    defineDecoder,
    defineCodec,
    roundtrip,
    type Codec,
    type Decoder,
    type Schema as SchemaType,
} from "../../src/schema/index.ts";
import { getTag } from "../../src/union.ts";
import { union } from "../../src/union.ts";
import { type Validation } from "../../src/prelude/validation.ts";

// ===== Primitives =====

describe("encode: string", () => {
    it("encodes a string as itself", () => {
        expect(encode(Schema.string(), "hello")).toBe("hello");
    });
    it("round-trips a string", () => {
        expect(roundtrip(Schema.string(), "hello")).toBe(true);
    });
});

describe("encode: number", () => {
    it("encodes a number as itself", () => {
        expect(encode(Schema.number(), 42)).toBe(42);
    });
    it("round-trips a number", () => {
        expect(roundtrip(Schema.number(), 42)).toBe(true);
    });
});

describe("encode: boolean", () => {
    it("encodes true as itself", () => {
        expect(encode(Schema.boolean(), true)).toBe(true);
    });
    it("encodes false as itself", () => {
        expect(encode(Schema.boolean(), false)).toBe(false);
    });
    it("round-trips a boolean", () => {
        expect(roundtrip(Schema.boolean(), false)).toBe(true);
    });
});

describe("encode: literal", () => {
    it("encodes a string literal as itself", () => {
        expect(encode(Schema.literal("ok"), "ok")).toBe("ok");
    });
    it("encodes a number literal as itself", () => {
        expect(encode(Schema.literal(42), 42)).toBe(42);
    });
    it("encodes null literal as itself", () => {
        expect(encode(Schema.literal(null), null)).toBeNull();
    });
    it("round-trips a literal", () => {
        expect(roundtrip(Schema.literal("ok"), "ok")).toBe(true);
    });
});

// ===== Modifier schemas =====

describe("encode: optional", () => {
    const s = Schema.optional(Schema.string());
    it("encodes a string value", () => {
        expect(encode(s, "hi")).toBe("hi");
    });
    it("encodes undefined as undefined", () => {
        expect(encode(s, undefined)).toBeUndefined();
    });
    it("round-trips a defined value", () => {
        expect(roundtrip(s, "hi")).toBe(true);
    });
    it("round-trips undefined", () => {
        expect(roundtrip(s, undefined)).toBe(true);
    });
});

describe("encode: nullable", () => {
    const s = Schema.nullable(Schema.string());
    it("encodes a string value", () => {
        expect(encode(s, "hi")).toBe("hi");
    });
    it("encodes null as null", () => {
        expect(encode(s, null)).toBeNull();
    });
    it("round-trips null", () => {
        expect(roundtrip(s, null)).toBe(true);
    });
});

describe("encode: nullish", () => {
    const s = Schema.nullish(Schema.string());
    it("encodes a string value", () => {
        expect(encode(s, "hi")).toBe("hi");
    });
    it("encodes null as null", () => {
        expect(encode(s, null)).toBeNull();
    });
    it("encodes undefined as undefined", () => {
        expect(encode(s, undefined)).toBeUndefined();
    });
    it("round-trips null", () => {
        expect(roundtrip(s, null)).toBe(true);
    });
});

// ===== Array =====

describe("encode: array", () => {
    const s = Schema.array(Schema.number());
    it("encodes each element", () => {
        expect(encode(s, [1, 2, 3])).toEqual([1, 2, 3]);
    });
    it("encodes an empty array", () => {
        expect(encode(s, [])).toEqual([]);
    });
    it("round-trips an array of numbers", () => {
        expect(roundtrip(s, [1, 2, 3])).toBe(true);
    });
    it("encodes nested values recursively", () => {
        const s2 = Schema.array(Schema.array(Schema.string()));
        expect(encode(s2, [["a", "b"], ["c"]])).toEqual([["a", "b"], ["c"]]);
    });
});

// ===== Object =====

describe("encode: object", () => {
    const s = Schema.object({ name: Schema.string(), age: Schema.number() });
    it("encodes each schema field", () => {
        expect(encode(s, { name: "Alice", age: 30 })).toEqual({
            name: "Alice",
            age: 30,
        });
    });
    it("omits fields not in the schema shape", () => {
        const extra = { name: "Alice", age: 30, extra: true } as { name: string; age: number };
        expect(encode(s, extra)).toEqual({ name: "Alice", age: 30 });
        expect(encode(s, extra)).not.toHaveProperty("extra");
    });
    it("round-trips a canonical object", () => {
        expect(roundtrip(s, { name: "Alice", age: 30 })).toBe(true);
    });
    it("encodes optional fields when present", () => {
        const s2 = Schema.object({
            name: Schema.string(),
            age: Schema.optional(Schema.number()),
        });
        expect(encode(s2, { name: "Alice", age: 30 })).toEqual({
            name: "Alice",
            age: 30,
        });
    });
    it("omits optional fields when absent", () => {
        const s2 = Schema.object({
            name: Schema.string(),
            age: Schema.optional(Schema.number()),
        });
        expect(encode(s2, { name: "Alice" })).toEqual({ name: "Alice" });
    });
    it("round-trips nested objects", () => {
        const s2 = Schema.object({
            user: Schema.object({ name: Schema.string() }),
        });
        expect(roundtrip(s2, { user: { name: "Alice" } })).toBe(true);
    });
});

// ===== Union =====

describe("encode: union", () => {
    const s = Schema.union(Schema.string(), Schema.number());
    it("encodes a string member", () => {
        expect(encode(s, "hello")).toBe("hello");
    });
    it("encodes a number member", () => {
        expect(encode(s, 42)).toBe(42);
    });
    it("round-trips a string member", () => {
        expect(roundtrip(s, "hello")).toBe(true);
    });
    it("round-trips a number member", () => {
        expect(roundtrip(s, 42)).toBe(true);
    });
});

// ===== Variant =====

describe("encode: variant", () => {
    const Box = union({
        Full: (payload: Record<string, unknown>) => ({ ...payload }),
        Empty: (payload: Record<string, unknown>) => ({ ...payload }),
    });

    const s = Schema.variant(Box, {
        Full: Schema.object({ value: Schema.number() }),
        Empty: Schema.object({}),
    });

    it("encodes a Full variant to its external form", () => {
        const variant = Box.Full({ value: 42 });
        expect(encode(s, variant)).toEqual({ type: "Full", value: 42 });
    });

    it("encodes an Empty variant to its external form", () => {
        const variant = Box.Empty({});
        expect(encode(s, variant)).toEqual({ type: "Empty" });
    });

    it("round-trips a Full variant", () => {
        expect(roundtrip(s, { type: "Full", value: 42 })).toBe(true);
    });

    it("round-trips an Empty variant", () => {
        expect(roundtrip(s, { type: "Empty" })).toBe(true);
    });
});

describe("encode: variant with map", () => {
    const Status = union({
        Ok: (payload: Record<string, unknown>) => ({ ...payload }),
        Err: (payload: Record<string, unknown>) => ({ ...payload }),
    });

    const s = Schema.variant(
        Status,
        {
            Ok: Schema.object({ code: Schema.number() }),
            Err: Schema.object({ message: Schema.string() }),
        },
        {
            discriminant: "status",
            map: { success: "Ok", failure: "Err" },
        },
    );

    it("inverts the map when encoding Ok", () => {
        const variant = Status.Ok({ code: 200 });
        expect(encode(s, variant)).toEqual({ status: "success", code: 200 });
    });

    it("inverts the map when encoding Err", () => {
        const variant = Status.Err({ message: "not found" });
        expect(encode(s, variant)).toEqual({
            status: "failure",
            message: "not found",
        });
    });

    it("round-trips Ok with mapped discriminant", () => {
        expect(roundtrip(s, { status: "success", code: 200 })).toBe(true);
    });

    it("round-trips Err with mapped discriminant", () => {
        expect(
            roundtrip(s, { status: "failure", message: "not found" }),
        ).toBe(true);
    });
});

// ===== Schema.transform =====

describe("Schema.transform", () => {
    const DateSchema = Schema.transform(
        Schema.string(),
        (s) => new Date(s),
        (d) => d.toISOString(),
    );

    it("decode transforms string → Date", () => {
        const r = DateSchema.decode("2021-01-01T00:00:00.000Z");
        expect(getTag(r)).toBe("Valid");
        expect(r.value).toBeInstanceOf(Date);
    });

    it("decode propagates decode errors from the base schema", () => {
        const r = DateSchema.decode(42);
        expect(getTag(r)).toBe("Invalid");
    });

    it("encode transforms Date → ISO string", () => {
        const d = new Date("2021-01-01T00:00:00.000Z");
        expect(DateSchema.encode(d)).toBe("2021-01-01T00:00:00.000Z");
    });

    it("round-trips an ISO date string", () => {
        expect(roundtrip(DateSchema, "2021-01-01T00:00:00.000Z")).toBe(true);
    });

    it("infers Codec<unknown, Date> type", () => {
        expectTypeOf(DateSchema).toExtend<Codec<unknown, Date>>();
    });

    it("works with an object base schema", () => {
        const TaggedString = Schema.transform(
            Schema.object({ raw: Schema.string() }),
            ({ raw }) => raw.trim(),
            (s) => ({ raw: s }),
        );
        const r = TaggedString.decode({ raw: "  hello  " });
        expect(r.value).toBe("hello");
        expect(TaggedString.encode("hello")).toEqual({ raw: "hello" });
    });
});

// ===== defineDecoder =====

describe("defineDecoder", () => {
    it("returns the same decoder object", () => {
        const d = defineDecoder({
            decode: (input: unknown) => decode(Schema.string(), input),
        });
        expect(getTag(d.decode("hi"))).toBe("Valid");
    });

    it("infers the Decoder<I, O> type", () => {
        const d = defineDecoder({
            decode: (input: unknown) => decode(Schema.number(), input),
        });
        expectTypeOf(d).toExtend<Decoder<unknown, number>>();
    });

    it("type errors are caught at definition time", () => {
        const d = defineDecoder({
            decode: (input: string) =>
                decode(Schema.string(), input) as Validation<string, DecodeError>,
        });
        expectTypeOf(d).toExtend<Decoder<string, string>>();
    });
});

// ===== defineCodec =====

describe("defineCodec", () => {
    it("returns the same codec object", () => {
        const c = defineCodec({
            decode: (input: unknown) => decode(Schema.string(), input),
            encode: (s: string) => s,
        });
        expect(getTag(c.decode("hi"))).toBe("Valid");
        expect(c.encode("hi")).toBe("hi");
    });

    it("infers the Codec<I, O> type", () => {
        const c = defineCodec({
            decode: (input: unknown) => decode(Schema.number(), input),
            encode: (n: number) => n,
        });
        expectTypeOf(c).toExtend<Codec<unknown, number>>();
    });
});

// ===== roundtrip =====

describe("roundtrip", () => {
    it("returns true when encode(decode(input)) equals input", () => {
        expect(roundtrip(Schema.string(), "hello")).toBe(true);
    });

    it("returns false when decode fails", () => {
        expect(roundtrip(Schema.string(), 42)).toBe(false);
    });

    it("returns true for a complex object schema", () => {
        const s = Schema.object({
            name: Schema.string(),
            scores: Schema.array(Schema.number()),
        });
        expect(roundtrip(s, { name: "Alice", scores: [10, 20] })).toBe(true);
    });

    it("returns true for a Codec produced by Schema.transform", () => {
        const TrimmedString = Schema.transform(
            Schema.string(),
            (s) => s.trim(),
            (s) => s,
        );
        expect(roundtrip(TrimmedString, "hello")).toBe(true);
    });

    it("returns false when encode(decode(input)) does not equal input", () => {
        const TrimmedString = Schema.transform(
            Schema.string(),
            (s) => s.trim(),
            (s) => s,
        );
        expect(roundtrip(TrimmedString, "  spaced  ")).toBe(false);
    });
});
