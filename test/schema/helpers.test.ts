import { describe, expect, it } from "vitest";
import {
    Schema,
    decode,
    encode,
    defineDecoder,
    defineCodec,
    roundtrip,
    type Decoder,
    type Codec,
} from "../../src/schema/index.ts";
import { getTag } from "../../src/union.ts";

// ---------------------------------------------------------------------------
// defineDecoder — identity helper
// ---------------------------------------------------------------------------

describe("defineDecoder", () => {
    it("returns the same decoder object", () => {
        const decoder: Decoder<unknown, number> = {
            decode: (v) => {
                const n = typeof v === "number" ? v : NaN;
                return isNaN(n)
                    ? decode(Schema.number(), v) as ReturnType<typeof decoder.decode>
                    : decode(Schema.number(), v) as ReturnType<typeof decoder.decode>;
            },
        };
        expect(defineDecoder(decoder)).toBe(decoder);
    });

    it("does not wrap or transform the decoder", () => {
        const myDecode = (v: unknown) => decode(Schema.string(), v);
        const decoder: Decoder<unknown, string> = { decode: myDecode };
        const defined = defineDecoder(decoder);
        expect(defined.decode).toBe(myDecode);
    });
});

// ---------------------------------------------------------------------------
// defineCodec — identity helper
// ---------------------------------------------------------------------------

describe("defineCodec", () => {
    it("returns the same codec object", () => {
        const codec: Codec<unknown, string> = {
            decode: (v) => decode(Schema.string(), v),
            encode: (v) => v,
        };
        expect(defineCodec(codec)).toBe(codec);
    });

    it("does not wrap encode or decode", () => {
        const decodeFn = (v: unknown) => decode(Schema.number(), v);
        const encodeFn = (v: number) => v;
        const codec: Codec<unknown, number> = { decode: decodeFn, encode: encodeFn };
        const defined = defineCodec(codec);
        expect(defined.decode).toBe(decodeFn);
        expect(defined.encode).toBe(encodeFn);
    });
});

// ---------------------------------------------------------------------------
// roundtrip
// ---------------------------------------------------------------------------

describe("roundtrip — Schema path", () => {
    it("returns true for a valid string value", () => {
        expect(roundtrip(Schema.string(), "hello")).toBe(true);
    });

    it("returns true for a valid number value", () => {
        expect(roundtrip(Schema.number(), 42)).toBe(true);
    });

    it("returns true for a valid boolean value", () => {
        expect(roundtrip(Schema.boolean(), true)).toBe(true);
    });

    it("returns true for a valid object value", () => {
        const schema = Schema.object({ name: Schema.string(), age: Schema.number() });
        expect(roundtrip(schema, { name: "Ada", age: 36 })).toBe(true);
    });

    it("returns true for a valid array value", () => {
        const schema = Schema.array(Schema.number());
        expect(roundtrip(schema, [1, 2, 3])).toBe(true);
    });

    it("returns false for an invalid input (decode fails)", () => {
        expect(roundtrip(Schema.number(), "not a number")).toBe(false);
    });

    it("returns true for a literal schema", () => {
        expect(roundtrip(Schema.literal("dark"), "dark")).toBe(true);
    });
});

describe("roundtrip — Codec path", () => {
    it("returns true when encode(decode(input)) deep-equals input", () => {
        const codec: Codec<unknown, string> = {
            decode: (v) => decode(Schema.string(), v),
            encode: (v: string) => v,
        };
        expect(roundtrip(codec, "test")).toBe(true);
    });

    it("returns false when decode fails for codec", () => {
        const codec: Codec<unknown, number> = {
            decode: (v) => decode(Schema.number(), v),
            encode: (v: number) => v,
        };
        expect(roundtrip(codec, "not-a-number")).toBe(false);
    });
});
