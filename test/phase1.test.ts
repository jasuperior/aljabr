import { describe, it, expect } from "vitest";
import { __, union, when, is, select, variantOf, Union } from "../src/union.ts";
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
// Phase 1.6a — Union Identity
// ==========================================

describe("variantOf()", () => {
    it("direct form: returns true for a variant of the given union", () => {
        expect(variantOf(Ev, Ev.KeyPress("a", false))).toBe(true);
        expect(variantOf(Ev, Ev.Click(0, 0, { button: "left" }))).toBe(true);
    });

    it("direct form: returns false for a variant of a different union with identical shape", () => {
        expect(variantOf(Ev, Co.KeyPress("a", false))).toBe(false);
    });

    it("direct form: returns false for non-variant primitives", () => {
        expect(variantOf(Ev, "hello")).toBe(false);
        expect(variantOf(Ev, 42)).toBe(false);
        expect(variantOf(Ev, null)).toBe(false);
        expect(variantOf(Ev, undefined)).toBe(false);
    });

    it("curried form: returns true for variants of the given union", () => {
        const isEv = variantOf(Ev);
        expect(isEv(Ev.Message("hi", 1))).toBe(true);
    });

    it("curried form: returns false for variants of a different union", () => {
        const isEv = variantOf(Ev);
        expect(isEv(Co.Message("hi", 1))).toBe(false);
    });
});

describe("is.variant()", () => {
    const Wrapper = union({ Wrap: (val: unknown) => ({ val }) });

    it("matches a field value that is a variant of the specified union", () => {
        const w = Wrapper.Wrap(Ev.KeyPress("a", false));
        const result = match(w, {
            Wrap: [
                when({ val: is.variant(Ev) }, () => "is Ev"),
                when(__, () => "other"),
            ],
        });
        expect(result).toBe("is Ev");
    });

    it("does not match when the field is a variant of a different union", () => {
        const w = Wrapper.Wrap(Co.KeyPress("a", false));
        const result = match(w, {
            Wrap: [
                when({ val: is.variant(Ev) }, () => "is Ev"),
                when(__, () => "other"),
            ],
        });
        expect(result).toBe("other");
    });

    it("does not match a non-variant value", () => {
        const w = Wrapper.Wrap("plain string");
        const result = match(w, {
            Wrap: [
                when({ val: is.variant(Ev) }, () => "is Ev"),
                when(__, () => "other"),
            ],
        });
        expect(result).toBe("other");
    });
});

describe("is.union() with union factories", () => {
    const Wrapper = union({ Wrap: (val: unknown) => ({ val }) });

    it("matches a variant of the first factory", () => {
        const w = Wrapper.Wrap(Ev.KeyPress("a", false));
        const result = match(w, {
            Wrap: [
                when({ val: is.union(Ev, Co) }, () => "Ev or Co"),
                when(__, () => "other"),
            ],
        });
        expect(result).toBe("Ev or Co");
    });

    it("matches a variant of the second factory", () => {
        const w = Wrapper.Wrap(Co.Click(1, 2, { button: "right" }));
        const result = match(w, {
            Wrap: [
                when({ val: is.union(Ev, Co) }, () => "Ev or Co"),
                when(__, () => "other"),
            ],
        });
        expect(result).toBe("Ev or Co");
    });

    it("does not match a non-variant value", () => {
        const w = Wrapper.Wrap("hello");
        const result = match(w, {
            Wrap: [
                when({ val: is.union(Ev, Co) }, () => "Ev or Co"),
                when(__, () => "other"),
            ],
        });
        expect(result).toBe("other");
    });

    it("single factory: matches variants of that union only", () => {
        const wEv = Wrapper.Wrap(Ev.KeyPress("a", false));
        const wCo = Wrapper.Wrap(Co.KeyPress("a", false));
        const run = (w: ReturnType<typeof Wrapper.Wrap>) =>
            match(w, {
                Wrap: [
                    when({ val: is.union(Ev) }, () => "Ev only"),
                    when(__, () => "other"),
                ],
            });
        expect(run(wEv)).toBe("Ev only");
        expect(run(wCo)).toBe("other");
    });

    it("mixes factories and pred patterns in the same combinator", () => {
        const wEv = Wrapper.Wrap(Ev.KeyPress("a", false));
        const wStr = Wrapper.Wrap("hello");
        const run = (w: ReturnType<typeof Wrapper.Wrap>) =>
            match(w, {
                Wrap: [
                    when({ val: is.union(Ev, is.string) }, () => "Ev or string"),
                    when(__, () => "other"),
                ],
            });
        expect(run(wEv)).toBe("Ev or string");
        expect(run(wStr)).toBe("Ev or string");
        expect(run(Wrapper.Wrap(42))).toBe("other");
    });
});

describe("is.not() with union factories", () => {
    const Wrapper = union({ Wrap: (val: unknown) => ({ val }) });

    it("matches values that are NOT variants of the union", () => {
        const w = Wrapper.Wrap("not a variant");
        const result = match(w, {
            Wrap: [
                when({ val: is.not(Ev) }, () => "not Ev"),
                when(__, () => "is Ev"),
            ],
        });
        expect(result).toBe("not Ev");
    });

    it("does not match when the value IS a variant of the union", () => {
        const w = Wrapper.Wrap(Ev.KeyPress("a", false));
        const result = match(w, {
            Wrap: [
                when({ val: is.not(Ev) }, () => "not Ev"),
                when(__, () => "is Ev"),
            ],
        });
        expect(result).toBe("is Ev");
    });
});

// ==========================================
// Phase 1.6c — is.not.* namespace
// ==========================================

describe("is.not.* — pre-computed wildcards", () => {
    const Wrapper = union({ Wrap: (val: unknown) => ({ val }) });
    const run = (
        val: unknown,
        pat: unknown,
    ) =>
        match(Wrapper.Wrap(val), {
            Wrap: [
                when({ val: pat }, () => "match"),
                when(__, () => "no match"),
            ],
        });

    it("is.not.string matches a non-string", () => {
        expect(run(42, is.not.string)).toBe("match");
    });

    it("is.not.string does not match a string", () => {
        expect(run("hello", is.not.string)).toBe("no match");
    });

    it("is.not.number matches a non-number", () => {
        expect(run("hi", is.not.number)).toBe("match");
    });

    it("is.not.number does not match a number", () => {
        expect(run(0, is.not.number)).toBe("no match");
    });

    it("is.not.boolean matches a non-boolean", () => {
        expect(run("yes", is.not.boolean)).toBe("match");
    });

    it("is.not.boolean does not match a boolean", () => {
        expect(run(false, is.not.boolean)).toBe("no match");
    });

    it("is.not.nullish matches a defined non-null value", () => {
        expect(run("hello", is.not.nullish)).toBe("match");
    });

    it("is.not.nullish does not match null", () => {
        expect(run(null, is.not.nullish)).toBe("no match");
    });

    it("is.not.defined matches undefined", () => {
        expect(run(undefined, is.not.defined)).toBe("match");
    });

    it("is.not.defined does not match a defined value", () => {
        expect(run(0, is.not.defined)).toBe("no match");
    });

    it("is.not.array matches a non-array", () => {
        expect(run({}, is.not.array)).toBe("match");
    });

    it("is.not.array does not match an array", () => {
        expect(run([], is.not.array)).toBe("no match");
    });

    it("is.not.object matches a non-object", () => {
        expect(run("str", is.not.object)).toBe("match");
    });

    it("is.not.object does not match a plain object", () => {
        expect(run({}, is.not.object)).toBe("no match");
    });
});

describe("is.not.union()", () => {
    const Wrapper = union({ Wrap: (val: unknown) => ({ val }) });

    it("matches when the value satisfies none of the sub-patterns", () => {
        const w = Wrapper.Wrap(42);
        const result = match(w, {
            Wrap: [
                when({ val: is.not.union(is.string, is.boolean) }, () => "neither"),
                when(__, () => "one of them"),
            ],
        });
        expect(result).toBe("neither");
    });

    it("does not match when the value satisfies a sub-pattern", () => {
        const w = Wrapper.Wrap("hello");
        const result = match(w, {
            Wrap: [
                when({ val: is.not.union(is.string, is.boolean) }, () => "neither"),
                when(__, () => "one of them"),
            ],
        });
        expect(result).toBe("one of them");
    });
});

describe("is.not.variant()", () => {
    const Wrapper = union({ Wrap: (val: unknown) => ({ val }) });

    it("matches when the value is not a variant of the given union", () => {
        const w = Wrapper.Wrap("plain");
        const result = match(w, {
            Wrap: [
                when({ val: is.not.variant(Ev) }, () => "not Ev"),
                when(__, () => "is Ev"),
            ],
        });
        expect(result).toBe("not Ev");
    });

    it("does not match when the value is a variant of the given union", () => {
        const w = Wrapper.Wrap(Ev.KeyPress("a", false));
        const result = match(w, {
            Wrap: [
                when({ val: is.not.variant(Ev) }, () => "not Ev"),
                when(__, () => "is Ev"),
            ],
        });
        expect(result).toBe("is Ev");
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
