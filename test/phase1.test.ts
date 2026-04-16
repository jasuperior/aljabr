import { describe, it, expect } from "vitest";
import { __, union, when, is, select, Union } from "../src/union.ts";
import { match } from "../src/match.ts";

// ==========================================
// Shared fixture
// ==========================================

const Ev = union({
    KeyPress: (key: string, shift: boolean) => ({ key, shift }),
    Click: (x: number, y: number, meta: { button: string }) => ({ x, y, meta }),
    Message: (text: string | null, code: number) => ({ text, code }),
    Nested: (user: { name: string; age: number }) => ({ user }),
});
type Ev = Union<typeof Ev>;

const Co = union({
    KeyPress: (key: string, shift: boolean) => ({ key, shift }),
    Click: (x: number, y: number, meta: { button: string }) => ({ x, y, meta }),
    Message: (text: string | null, code: number) => ({ text, code }),
    Nested: (user: { name: string; age: number }) => ({ user }),
});
type Co = Union<typeof Co>;

// ==========================================
// is.* — type predicates
// ==========================================

describe("is.string", () => {
    it("matches a string field", () => {
        const e = Ev.KeyPress("a", false) as Ev;
        const result = match(e, {
            KeyPress: when({ key: is.string }, ({ key }) => `string:${key}`),
            [__]: () => "other",
        });
        expect(result).toBe("string:a");
    });

    it("does not match a non-string field", () => {
        const e = Ev.Message("hello", 42) as Ev;
        const result = match(e, {
            Message: [
                when({ code: is.string }, () => "string"),
                when(__, () => "not string"),
            ],
            [__]: () => "other",
        });
        expect(result).toBe("not string");
    });
});

describe("is.number", () => {
    it("matches a number field", () => {
        const e = Ev.Message("hi", 99) as Ev;
        const result = match(e, {
            Message: when({ code: is.number }, ({ code }) => `num:${code}`),
            [__]: () => "other",
        });
        expect(result).toBe("num:99");
    });
});

describe("is.boolean", () => {
    it("matches a boolean field", () => {
        const e = Ev.KeyPress("x", true) as Ev;
        const result = match(e, {
            KeyPress: when({ shift: is.boolean }, () => "has boolean"),
            [__]: () => "other",
        });
        expect(result).toBe("has boolean");
    });
});

describe("is.nullish", () => {
    it("matches a null field", () => {
        const e = Ev.Message(null, 0) as Ev;
        const result = match(e, {
            Message: [
                when({ text: is.nullish }, () => "null or undefined"),
                when(__, () => "has text"),
            ],
            [__]: () => "other",
        });
        expect(result).toBe("null or undefined");
    });

    it("does not match a non-null value", () => {
        const e = Ev.Message("hello", 0) as Ev;
        const result = match(e, {
            Message: [
                when({ text: is.nullish }, () => "null or undefined"),
                when(__, () => "has text"),
            ],
            [__]: () => "other",
        });
        expect(result).toBe("has text");
    });
});

describe("is.defined", () => {
    it("matches a defined (non-undefined) value", () => {
        const e = Ev.Message("hi", 1) as Ev;
        const result = match(e, {
            Message: when({ text: is.defined }, () => "defined"),
            [__]: () => "other",
        });
        expect(result).toBe("defined");
    });
});

describe("is.array", () => {
    const ArrEv = union({ Items: (list: unknown[]) => ({ list }) });
    type ArrEv = ReturnType<(typeof ArrEv)[keyof typeof ArrEv]>;

    it("matches an array field", () => {
        const e = ArrEv.Items([1, 2, 3]) as ArrEv;
        const result = match(e, {
            Items: when({ list: is.array }, () => "is array"),
        });
        expect(result).toBe("is array");
    });
});

describe("is.object", () => {
    it("matches a plain object field", () => {
        const e = Ev.Click(0, 0, { button: "left" }) as Ev;
        const result = match(e, {
            Click: when({ meta: is.object }, () => "has object"),
            [__]: () => "other",
        });
        expect(result).toBe("has object");
    });

    it("does not match an array with is.object", () => {
        const ArrEv = union({ Items: (val: unknown) => ({ val }) });
        type ArrEv = ReturnType<(typeof ArrEv)[keyof typeof ArrEv]>;
        const e = ArrEv.Items([1, 2]) as ArrEv;
        const result = match(e, {
            Items: [
                when({ val: is.object }, () => "object"),
                when(__, () => "not object"),
            ],
        });
        expect(result).toBe("not object");
    });
});

// ==========================================
// is.not — negation combinator
// ==========================================

describe("is.not", () => {
    it("matches when the inner pattern does not match", () => {
        const e = Ev.KeyPress("a", false) as Ev;
        const result = match(e, {
            KeyPress: [
                when({ key: is.not("Enter") }, () => "not enter"),
                when(__, () => "enter"),
            ],
            [__]: () => "other",
        });
        expect(result).toBe("not enter");
    });

    it("does not match when the inner pattern matches", () => {
        const e = Ev.KeyPress("Enter", false) as Ev;
        const result = match(e, {
            KeyPress: [
                when({ key: is.not("Enter") }, () => "not enter"),
                when(__, () => "enter"),
            ],
            [__]: () => "other",
        });
        expect(result).toBe("enter");
    });

    it("composes with is.* predicates", () => {
        const e = Ev.Message(null, 1) as Ev;
        const result = match(e, {
            Message: [
                when({ text: is.not(is.nullish) }, () => "has text"),
                when(__, () => "no text"),
            ],
            [__]: () => "other",
        });
        expect(result).toBe("no text");
    });

    it("matches a non-null value when negating is.nullish", () => {
        const e = Ev.Message("hello", 1) as Ev;
        const result = match(e, {
            Message: [
                when({ text: is.not(is.nullish) }, () => "has text"),
                when(__, () => "no text"),
            ],
            [__]: () => "other",
        });
        expect(result).toBe("has text");
    });
});

// ==========================================
// is.union — OR combinator
// ==========================================

describe("is.union", () => {
    it("matches if any sub-pattern matches", () => {
        const e = Ev.KeyPress("Tab", false) as Ev;
        const result = match(e, {
            KeyPress: [
                when({ key: is.union("Tab", "Enter") }, () => "control key"),
                when(__, () => "other key"),
            ],
            [__]: () => "other",
        });
        expect(result).toBe("control key");
    });

    it("does not match if no sub-pattern matches", () => {
        const e = Ev.KeyPress("a", false) as Ev;
        const result = match(e, {
            KeyPress: [
                when({ key: is.union("Tab", "Enter") }, () => "control key"),
                when(__, () => "other key"),
            ],
            [__]: () => "other",
        });
        expect(result).toBe("other key");
    });

    it("composes is.* predicates as sub-patterns", () => {
        const e = Ev.Message("hello", 5) as Ev;
        const result = match(e, {
            Message: [
                when(
                    { text: is.union(is.string, is.nullish) },
                    () => "string or null",
                ),
                when(__, () => "other"),
            ],
            [__]: () => "other",
        });
        expect(result).toBe("string or null");
    });
});

// ==========================================
// Deep structural matching (recursive)
// ==========================================

describe("deep structural matching", () => {
    it("matches a nested plain-object sub-pattern", () => {
        const e = Ev.Nested({ name: "Alice", age: 30 }) as Ev;
        const result = match(e, {
            Nested: when({ user: { name: "Alice" } }, () => "found alice"),
            [__]: () => "other",
        });
        expect(result).toBe("found alice");
    });

    it("does not match when a nested field differs", () => {
        const e = Ev.Nested({ name: "Bob", age: 30 }) as Ev;
        const result = match(e, {
            Nested: [
                when({ user: { name: "Alice" } }, () => "found alice"),
                when(__, () => "other"),
            ],
            [__]: () => "other",
        });
        expect(result).toBe("other");
    });

    it("supports is.* predicates inside nested sub-patterns", () => {
        const e = Ev.Nested({ name: "Carol", age: 25 }) as Ev;
        const result = match(e, {
            Nested: when({ user: { age: is.number } }, () => "age is number"),
            [__]: () => "other",
        });
        expect(result).toBe("age is number");
    });

    it("supports combinators inside nested sub-patterns", () => {
        const e = Ev.Nested({ name: "Dave", age: 17 }) as Ev;
        const result = match(e, {
            Nested: [
                when({ user: { age: is.not(is.number) } }, () => "not number"),
                when(__, () => "is number"),
            ],
            [__]: () => "other",
        });
        expect(result).toBe("is number");
    });
});

// ==========================================
// select — extraction bindings
// ==========================================

describe("select()", () => {
    it("injects selected field into handler's second argument", () => {
        const e = Ev.KeyPress("Enter", false) as Ev;
        const result = match(e, {
            KeyPress: when(
                { key: select("k") },
                (_val, sel) => `key=${sel?.k}`,
            ),
            [__]: () => "other",
        });
        expect(result).toBe("key=Enter");
    });

    it("supports multiple selections from different fields", () => {
        const e = Ev.KeyPress("Tab", true) as Ev;
        const result = match(e, {
            KeyPress: when(
                { key: select("k"), shift: select("s") },
                (_val, sel) => `${sel?.k}:${sel?.s}`,
            ),
            [__]: () => "other",
        });
        expect(result).toBe("Tab:true");
    });

    it("extracts from a nested path", () => {
        const e = Ev.Nested({ name: "Alice", age: 30 }) as Ev;
        const result = match(e, {
            Nested: when(
                { user: { name: select("name") } },
                (_val, sel) => `Hello, ${sel?.name}`,
            ),
            [__]: () => "other",
        });
        expect(result).toBe("Hello, Alice");
    });

    it("does not match when the optional inner pattern fails", () => {
        const e = Ev.Message("hello", 5) as Ev;
        const result = match(e, {
            Message: [
                when(
                    { text: select("t", is.nullish) },
                    (_val, sel) => `null:${sel?.t}`,
                ),
                when(__, () => "has text"),
            ],
            [__]: () => "other",
        });
        expect(result).toBe("has text");
    });

    it("matches and extracts when the optional inner pattern passes", () => {
        const e = Ev.Message(null, 5) as Ev;
        const result = match(e, {
            Message: [
                when(
                    { text: select("t", is.nullish) },
                    (_val, sel) => `null:${sel?.t}`,
                ),
                when(__, () => "has text"),
            ],
            [__]: () => "other",
        });
        expect(result).toBe("null:null");
    });

    it("selections are empty object (not undefined) for arms without select()", () => {
        const e = Ev.KeyPress("a", false) as Ev;
        let captured: Record<string, unknown> | undefined;
        match(e, {
            KeyPress: when({ key: "a" }, (_val, sel) => {
                captured = sel;
                return "ok";
            }),
            [__]: () => "other",
        });
        expect(captured).toEqual({});
    });
});

// ==========================================
// Combinations
// ==========================================

describe("combined usage", () => {
    it("is.not + select: extracts only when negation passes", () => {
        const e = Ev.KeyPress("a", false) as Ev;
        const result = match(e, {
            KeyPress: [
                when(
                    { key: select("k", is.not("Enter")) },
                    (_val, sel) => `char:${sel?.k}`,
                ),
                when(__, () => "enter"),
            ],
            [__]: () => "other",
        });
        expect(result).toBe("char:a");
    });

    it("is.union + deep nesting + select", () => {
        const e = Ev.Nested({ name: "Alice", age: 30 }) as Ev;
        const result = match(e, {
            Nested: when(
                { user: { name: select("n", is.union("Alice", "Bob")) } },
                (_val, sel) => `matched:${sel?.n}`,
            ),
            [__]: () => "other",
        });
        expect(result).toBe("matched:Alice");
    });

    it("deep nesting does not recurse into an Aljabr variant payload", () => {
        // The variant value itself should never be confused with a sub-pattern
        const Inner = union({ X: (v: number) => ({ v }) });
        const Outer = union({
            Wrap: (inner: ReturnType<typeof Inner.X>) => ({ inner }),
        });
        type Outer = ReturnType<(typeof Outer)[keyof typeof Outer]>;

        const e = Outer.Wrap(Inner.X(42)) as Outer;
        // Structural pattern stops at the variant boundary — cannot peek inside Inner
        const result = match(e, {
            Wrap: when({ inner: is.object }, () => "has object inner"),
        });
        expect(result).toBe("has object inner");
    });
});
