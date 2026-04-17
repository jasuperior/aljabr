import { union, getTag, tag, type Union } from "../union.ts";
import { match } from "../match.ts";
import { Validation } from "../prelude/validation.ts";

// ===== Internal types =====

type ObjectMode = "strip" | "strict" | "passthrough"
type Path = (string | number)[]

// ===== DecodeError =====

export const DecodeError = union({
    TypeMismatch: (path: Path, expected: string, received: string) =>
        ({ path, expected, received }),
    MissingField: (path: Path, field: string) =>
        ({ path, field }),
    InvalidLiteral: (path: Path, expected: unknown, received: unknown) =>
        ({ path, expected, received }),
    UnrecognizedVariant: (path: Path, discriminant: string, received: string) =>
        ({ path, discriminant, received }),
    Custom: (path: Path, message: string) =>
        ({ path, message }),
})
export type DecodeError = Union<typeof DecodeError>

// ===== Schema variant union (internal) =====

const _Schema = union({
    StringSchema:   () => ({} as Record<never, never>),
    NumberSchema:   () => ({} as Record<never, never>),
    BooleanSchema:  () => ({} as Record<never, never>),
    LiteralSchema:  (value: unknown) => ({ value }),
    OptionalSchema: (inner: unknown) => ({ inner }),
    NullableSchema: (inner: unknown) => ({ inner }),
    NullishSchema:  (inner: unknown) => ({ inner }),
    ArraySchema:    (element: unknown) => ({ element }),
    ObjectSchema:   (shape: Record<string, unknown>, mode: ObjectMode) => ({ shape, mode }),
    UnionSchema:    (options: unknown[]) => ({ options }),
    VariantSchema:  (
        factory: Record<string, (...args: unknown[]) => unknown>,
        shapeMap: Record<string, unknown>,
        discriminant: string,
        map: Record<string, string> | undefined,
    ) => ({ factory, shapeMap, discriminant, map }),
})

// ===== Public schema types =====

declare const _schemaOutput: unique symbol
export type AnySchema = Union<typeof _Schema>
export type Schema<T> = AnySchema & { readonly [_schemaOutput]?: T }

export type StringSchema   = Union<typeof _Schema, "StringSchema">
export type NumberSchema   = Union<typeof _Schema, "NumberSchema">
export type BooleanSchema  = Union<typeof _Schema, "BooleanSchema">
export type LiteralSchema  = Union<typeof _Schema, "LiteralSchema">
export type OptionalSchema = Union<typeof _Schema, "OptionalSchema">
export type NullableSchema = Union<typeof _Schema, "NullableSchema">
export type NullishSchema  = Union<typeof _Schema, "NullishSchema">
export type ArraySchema    = Union<typeof _Schema, "ArraySchema">
export type ObjectSchema   = Union<typeof _Schema, "ObjectSchema">
export type UnionSchema    = Union<typeof _Schema, "UnionSchema">
export type VariantSchema  = Union<typeof _Schema, "VariantSchema">

// ===== Schema factory (public API) =====

export const Schema = {
    string: (): Schema<string> =>
        _Schema.StringSchema() as Schema<string>,

    number: (): Schema<number> =>
        _Schema.NumberSchema() as Schema<number>,

    boolean: (): Schema<boolean> =>
        _Schema.BooleanSchema() as Schema<boolean>,

    literal: <V extends string | number | boolean | null | undefined>(value: V): Schema<V> =>
        _Schema.LiteralSchema(value) as Schema<V>,

    optional: <T>(inner: Schema<T>): Schema<T | undefined> =>
        _Schema.OptionalSchema(inner) as Schema<T | undefined>,

    nullable: <T>(inner: Schema<T>): Schema<T | null> =>
        _Schema.NullableSchema(inner) as Schema<T | null>,

    nullish: <T>(inner: Schema<T>): Schema<T | null | undefined> =>
        _Schema.NullishSchema(inner) as Schema<T | null | undefined>,

    array: <T>(element: Schema<T>): Schema<T[]> =>
        _Schema.ArraySchema(element) as Schema<T[]>,

    object: <T extends Record<string, unknown>>(
        shape: { [K in keyof T]: Schema<T[K]> },
        options?: { mode?: ObjectMode },
    ): Schema<T> =>
        _Schema.ObjectSchema(
            shape as Record<string, unknown>,
            options?.mode ?? "strip",
        ) as Schema<T>,

    union: <Ts extends unknown[]>(
        ...schemas: { [K in keyof Ts]: Schema<Ts[K]> }
    ): Schema<Ts[number]> =>
        _Schema.UnionSchema(schemas as unknown[]) as Schema<Ts[number]>,

    variant: <F extends Record<string, (...args: any[]) => any>>(
        factory: F,
        shapeMap: Record<string, AnySchema>,
        options?: { discriminant?: string; map?: Record<string, string> },
    ): Schema<Union<F>> =>
        _Schema.VariantSchema(
            factory as Record<string, (...args: unknown[]) => unknown>,
            shapeMap as Record<string, unknown>,
            options?.discriminant ?? "type",
            options?.map,
        ) as Schema<Union<F>>,

    transform<O, P>(
        base: Schema<O>,
        decodeFn: (value: O) => P,
        encodeFn: (value: P) => unknown,
    ): Codec<unknown, P> {
        return {
            decode(input: unknown) {
                return (_decode(base as AnySchema, input, []) as Validation<O, DecodeError>).map(decodeFn)
            },
            encode: encodeFn as (value: P) => unknown,
        }
    },
}

// ===== Decode helpers =====

function typeOf(value: unknown): string {
    if (value === null) return "null"
    if (Array.isArray(value)) return "array"
    return typeof value
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    if (typeof value !== "object" || value === null) return false
    const proto = Object.getPrototypeOf(value) as unknown
    return proto === Object.prototype || proto === null
}

function isOptionalLike(schema: AnySchema): boolean {
    const tag = getTag(schema)
    return tag === "OptionalSchema" || tag === "NullishSchema"
}

// ===== Core decoder =====

function _decode(
    schema: AnySchema,
    input: unknown,
    path: Path,
): Validation<unknown, DecodeError> {
    return match(schema, {
        StringSchema: () =>
            typeof input === "string"
                ? Validation.Valid(input)
                : Validation.Invalid([DecodeError.TypeMismatch(path, "string", typeOf(input))]),

        NumberSchema: () =>
            typeof input === "number"
                ? Validation.Valid(input)
                : Validation.Invalid([DecodeError.TypeMismatch(path, "number", typeOf(input))]),

        BooleanSchema: () =>
            typeof input === "boolean"
                ? Validation.Valid(input)
                : Validation.Invalid([DecodeError.TypeMismatch(path, "boolean", typeOf(input))]),

        LiteralSchema: ({ value }) =>
            input === value
                ? Validation.Valid(input)
                : Validation.Invalid([DecodeError.InvalidLiteral(path, value, input)]),

        OptionalSchema: ({ inner }) =>
            input === undefined
                ? Validation.Valid(undefined)
                : _decode(inner as AnySchema, input, path),

        NullableSchema: ({ inner }) =>
            input === null
                ? Validation.Valid(null)
                : _decode(inner as AnySchema, input, path),

        NullishSchema: ({ inner }) =>
            input == null
                ? Validation.Valid(input)
                : _decode(inner as AnySchema, input, path),

        ArraySchema: ({ element }) => {
            if (!Array.isArray(input))
                return Validation.Invalid([DecodeError.TypeMismatch(path, "array", typeOf(input))])
            const errors: DecodeError[] = []
            const values: unknown[] = []
            for (let i = 0; i < input.length; i++) {
                match(_decode(element as AnySchema, input[i], [...path, i]), {
                    Valid: ({ value }) => { values.push(value) },
                    Invalid: ({ errors: es }) => { errors.push(...es) },
                    Unvalidated: () => {},
                })
            }
            return errors.length > 0
                ? Validation.Invalid(errors)
                : Validation.Valid(values)
        },

        ObjectSchema: ({ shape, mode }) => {
            if (!isPlainObject(input))
                return Validation.Invalid([DecodeError.TypeMismatch(path, "object", typeOf(input))])
            const shapeMap = shape as Record<string, AnySchema>
            const errors: DecodeError[] = []
            const output: Record<string, unknown> = {}

            for (const key of Object.keys(shapeMap)) {
                const fieldPath = [...path, key]
                if (!(key in input) && !isOptionalLike(shapeMap[key])) {
                    errors.push(DecodeError.MissingField(fieldPath, key))
                    continue
                }
                match(_decode(shapeMap[key], input[key], fieldPath), {
                    Valid: ({ value }) => { output[key] = value },
                    Invalid: ({ errors: es }) => { errors.push(...es) },
                    Unvalidated: () => {},
                })
            }

            if (mode === "strict") {
                for (const key of Object.keys(input)) {
                    if (!(key in shapeMap))
                        errors.push(DecodeError.Custom([...path, key], `unexpected key "${key}"`))
                }
            } else if (mode === "passthrough") {
                for (const key of Object.keys(input)) {
                    if (!(key in output)) output[key] = input[key]
                }
            }

            return errors.length > 0
                ? Validation.Invalid(errors)
                : Validation.Valid(output)
        },

        UnionSchema: ({ options }) => {
            for (const option of (options as AnySchema[])) {
                const result = _decode(option, input, path)
                if (getTag(result) === "Valid") return result
            }
            return Validation.Invalid([
                DecodeError.TypeMismatch(path, "one of union members", typeOf(input)),
            ])
        },

        VariantSchema: ({ factory, shapeMap, discriminant, map }) => {
            if (!isPlainObject(input))
                return Validation.Invalid([DecodeError.TypeMismatch(path, "object", typeOf(input))])

            const disc = input[discriminant]
            if (typeof disc !== "string")
                return Validation.Invalid([
                    DecodeError.TypeMismatch([...path, discriminant], "string", typeOf(disc)),
                ])

            const variantName = (map as Record<string, string> | undefined)?.[disc] ?? disc
            const variantShapeMap = shapeMap as Record<string, AnySchema>

            if (!(variantName in variantShapeMap))
                return Validation.Invalid([
                    DecodeError.UnrecognizedVariant(path, discriminant, disc),
                ])

            const payload: Record<string, unknown> = {}
            for (const key of Object.keys(input)) {
                if (key !== discriminant) payload[key] = input[key]
            }

            return match(_decode(variantShapeMap[variantName], payload, path), {
                Valid: ({ value }) =>
                    Validation.Valid(factory[variantName](value)),
                Invalid: (v) => v as Validation<unknown, DecodeError>,
                Unvalidated: (v) => v as Validation<unknown, DecodeError>,
            })
        },
    }) as Validation<unknown, DecodeError>
}

export function decode<T>(schema: Schema<T>, input: unknown): Validation<T, DecodeError> {
    return _decode(schema as AnySchema, input, []) as Validation<T, DecodeError>
}

// ===== Decoder / Codec interfaces =====

export interface Decoder<I, O> {
    decode(input: I): Validation<O, DecodeError>
}

export interface Codec<I, O> extends Decoder<I, O> {
    encode(output: O): I
}

// ===== Encode helpers =====

function deepEqual(a: unknown, b: unknown): boolean {
    if (a === b) return true
    if (a == null || b == null || typeof a !== "object" || typeof b !== "object") return false
    if (Array.isArray(a) !== Array.isArray(b)) return false
    if (Array.isArray(a)) {
        const aa = a as unknown[], ab = b as unknown[]
        return aa.length === ab.length && aa.every((v, i) => deepEqual(v, ab[i]))
    }
    const ao = a as Record<string, unknown>, bo = b as Record<string, unknown>
    const aKeys = Object.keys(ao), bKeys = Object.keys(bo)
    return aKeys.length === bKeys.length && aKeys.every(k => k in bo && deepEqual(ao[k], bo[k]))
}

function _encode(schema: AnySchema, value: unknown): unknown {
    return match(schema, {
        StringSchema:  () => value,
        NumberSchema:  () => value,
        BooleanSchema: () => value,
        LiteralSchema: () => value,

        OptionalSchema: ({ inner }) =>
            value === undefined ? undefined : _encode(inner as AnySchema, value),

        NullableSchema: ({ inner }) =>
            value === null ? null : _encode(inner as AnySchema, value),

        NullishSchema: ({ inner }) =>
            value == null ? value : _encode(inner as AnySchema, value),

        ArraySchema: ({ element }) =>
            (value as unknown[]).map(v => _encode(element as AnySchema, v)),

        ObjectSchema: ({ shape }) => {
            const shapeMap = shape as Record<string, AnySchema>
            const obj = value as Record<string, unknown>
            const output: Record<string, unknown> = {}
            for (const key of Object.keys(shapeMap)) {
                if (key in obj) output[key] = _encode(shapeMap[key], obj[key])
            }
            return output
        },

        UnionSchema: ({ options }) => {
            for (const opt of options as AnySchema[]) {
                if (getTag(_decode(opt, value, [])) === "Valid") return _encode(opt, value)
            }
            return value
        },

        VariantSchema: ({ shapeMap, discriminant, map }) => {
            const disc = discriminant as string
            const variantShapeMap = shapeMap as Record<string, AnySchema>
            const variantName = getTag(value as { [tag]: string })

            const inverseMap: Record<string, string> = {}
            if (map) {
                for (const [ext, int] of Object.entries(map as Record<string, string>)) {
                    inverseMap[int] = ext
                }
            }
            const discValue = inverseMap[variantName] ?? variantName

            const payload: Record<string, unknown> = {}
            for (const key of Object.keys(value as object)) {
                payload[key] = (value as Record<string, unknown>)[key]
            }

            const encodedPayload = _encode(variantShapeMap[variantName], payload) as Record<string, unknown>
            return { [disc]: discValue, ...encodedPayload }
        },
    })
}

export function encode<T>(schema: Schema<T>, value: T): unknown {
    return _encode(schema as AnySchema, value)
}

// ===== Adapter helpers =====

export function defineDecoder<I, O>(decoder: Decoder<I, O>): Decoder<I, O> {
    return decoder
}

export function defineCodec<I, O>(codec: Codec<I, O>): Codec<I, O> {
    return codec
}

// ===== roundtrip test utility =====

export function roundtrip<T>(
    schemaOrCodec: Schema<T> | Codec<unknown, T>,
    input: unknown,
): boolean {
    if (typeof (schemaOrCodec as Codec<unknown, T>).decode === "function") {
        const c = schemaOrCodec as Codec<unknown, T>
        const decoded = c.decode(input)
        if (getTag(decoded) !== "Valid") return false
        return deepEqual(c.encode(decoded.value as T), input)
    }
    const decoded = _decode(schemaOrCodec as AnySchema, input, [])
    if (getTag(decoded) !== "Valid") return false
    return deepEqual(_encode(schemaOrCodec as AnySchema, decoded.value as T), input)
}
