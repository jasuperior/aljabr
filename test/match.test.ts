import { describe, it, expect, expectTypeOf } from "vitest";
import { __, union, pred, when, is, select, type Union } from "../src/union.ts";
import { match } from "../src/match.ts";

const Ev = union({
    KeyPress: (key: string) => ({ key }),
    Click: (x: number, y: number) => ({ x, y }),
    PageLoad: { path: "/" },
});
type Ev = ReturnType<(typeof Ev)[keyof typeof Ev]>;

// ==========================================
// Function matchers
// ==========================================

describe("match() — function matchers", () => {
    it("dispatches to the correct variant's handler", () => {
        const e = Ev.KeyPress("a") as Ev;
        const result = match(e, {
            KeyPress: (v) => `key:${v.key}`,
            Click: () => "click",
            PageLoad: () => "load",
        });
        expect(result).toBe("key:a");
    });

    it("falls through to [__] for unhandled variants", () => {
        const e = Ev.PageLoad() as Ev;
        const result = match(e, {
            KeyPress: () => "key",
            [__]: () => "fallback",
        });
        expect(result).toBe("fallback");
    });

    it("throws if no handler and no [__]", () => {
        const e = Ev.Click(1, 2) as Ev;
        expect(() =>
            match(e, {
                KeyPress: () => "key",
                [__]: () => "fallback",
            } as any),
        ).not.toThrow(); // covered by __

        // Force missing handler without __
        expect(() => match(e, { KeyPress: () => "key" } as any)).toThrow(
            /Unhandled variant/,
        );
    });
});

// ==========================================
// Single when() arm as variant value
// ==========================================

describe("match() — single when() arm", () => {
    it("matches and calls handler when pattern passes", () => {
        const e = Ev.KeyPress("Enter") as Ev;
        const result = match(e, {
            KeyPress: when({ key: "Enter" }, () => "enter"),
            [__]: () => "other",
        });
        expect(result).toBe("enter");
    });

    it("falls through to [__] when pattern doesn't match", () => {
        const e = Ev.KeyPress("Escape") as Ev;
        const result = match(e, {
            KeyPress: when({ key: "Enter" }, () => "enter"),
            [__]: () => "other",
        });
        expect(result).toBe("other");
    });

    it("falls through to [__] when guard fails", () => {
        const e = Ev.KeyPress("a") as Ev;
        const result = match(e, {
            KeyPress: when(
                {},
                (v) => v.key === "Enter",
                () => "enter",
            ),
            [__]: () => "other",
        });
        expect(result).toBe("other");
    });

    it("throws if no match and no [__] fallback", () => {
        const e = Ev.KeyPress("Escape") as Ev;
        expect(() =>
            match(e, {
                KeyPress: when({ key: "Enter" }, () => "enter"),
            } as any),
        ).toThrow();
    });

    it("when(__, handler) as single arm always matches", () => {
        const e = Ev.KeyPress("anything") as Ev;
        const result = match(e, {
            KeyPress: when(__, () => "always"),
            [__]: () => "other",
        });
        expect(result).toBe("always");
    });
});

// ==========================================
// Array of when() arms
// ==========================================

describe("match() — array of when() arms", () => {
    it("first matching arm wins", () => {
        const e = Ev.KeyPress("Enter") as Ev;
        const result = match(e, {
            KeyPress: [
                when({ key: "Enter" }, () => "first"),
                when({ key: "Enter" }, () => "second"),
                when(__, () => "catch"),
            ],
            [__]: () => "nil",
        });
        expect(result).toBe("first");
    });

    it("when(__, handler) catch-all fires when no earlier arm matches", () => {
        const e = Ev.KeyPress("Tab") as Ev;
        const result = match(e, {
            KeyPress: [
                when({ key: "Enter" }, () => "enter"),
                when({ key: "Escape" }, () => "escape"),
                when(__, () => "other"),
            ],
            [__]: () => "nil",
        });
        expect(result).toBe("other");
    });

    it("exact pattern match only fires for matching value", () => {
        const enter = Ev.KeyPress("Enter") as Ev;
        const tab = Ev.KeyPress("Tab") as Ev;

        const run = (e: Ev) =>
            match(e, {
                KeyPress: [
                    when({ key: "Enter" }, () => "enter"),
                    when(__, () => "other"),
                ],
                [__]: () => "nil",
            });

        expect(run(enter)).toBe("enter");
        expect(run(tab)).toBe("other");
    });

    it("pred() in pattern: runs predicate and matches correctly", () => {
        const e = Ev.KeyPress("Enter") as Ev;
        const result = match(e, {
            KeyPress: [
                when(
                    { key: pred((k): k is "Enter" => k === "Enter") },
                    () => "matched",
                ),
                when(__, () => "other"),
            ],
            [__]: () => "nil",
        });
        expect(result).toBe("matched");
    });

    it("pred() in pattern: rejects when predicate returns false", () => {
        const e = Ev.KeyPress("Tab") as Ev;
        const result = match(e, {
            KeyPress: [
                when({ key: pred((k) => k === "Enter") }, () => "matched"),
                when(__, () => "other"),
            ],
            [__]: () => "nil",
        });
        expect(result).toBe("other");
    });

    it("arm-level guard: pattern matches but guard fails → next arm", () => {
        const e = Ev.Click(5, 5) as Ev;
        const result = match(e, {
            Click: [
                when(
                    { x: 5 },
                    (v) => v.y > 10,
                    () => "high",
                ),
                when(__, () => "low"),
            ],
            [__]: () => "nil",
        });
        expect(result).toBe("low");
    });

    it("arm-level guard: fires when both pattern and guard pass", () => {
        const e = Ev.Click(5, 20) as Ev;
        const result = match(e, {
            Click: [
                when(
                    { x: 5 },
                    (v) => v.y > 10,
                    () => "high",
                ),
                when(__, () => "low"),
            ],
            [__]: () => "nil",
        });
        expect(result).toBe("high");
    });

    it("when(guard, handler) shorthand matches when guard passes", () => {
        const e = Ev.Click(5, 20) as Ev;
        const result = match(e, {
            Click: [
                when(
                    (v) => v.x + v.y > 20,
                    () => "big",
                ),
                when(__, () => "small"),
            ],
            [__]: () => "nil",
        });
        expect(result).toBe("big");
    });

    it("when(guard, handler) shorthand rejects when guard fails", () => {
        const e = Ev.Click(1, 1) as Ev;
        const result = match(e, {
            Click: [
                when(
                    (v) => v.x + v.y > 20,
                    () => "big",
                ),
                when(__, () => "small"),
            ],
            [__]: () => "nil",
        });
        expect(result).toBe("small");
    });

    it("pattern + pred + guard: all three must pass", () => {
        const e = Ev.KeyPress("Enter") as Ev;

        // All pass
        expect(
            match(e, {
                KeyPress: [
                    when(
                        { key: pred((k) => k.length > 0) },
                        (v) => v.key === "Enter",
                        () => "all pass",
                    ),
                    when(__, () => "fail"),
                ],
                [__]: () => "nil",
            }),
        ).toBe("all pass");

        // Pred fails
        const tab = Ev.KeyPress("") as Ev;
        expect(
            match(tab, {
                KeyPress: [
                    when(
                        { key: pred((k) => k.length > 0) },
                        (v) => v.key === "Enter",
                        () => "all pass",
                    ),
                    when(__, () => "fail"),
                ],
                [__]: () => "nil",
            }),
        ).toBe("fail");
    });

    describe("exhaustiveness errors", () => {
        it("throws plain message when no arms match and no guards used", () => {
            const e = Ev.KeyPress("Tab") as Ev;
            expect(() =>
                match(e, {
                    KeyPress: [when({ key: "Enter" }, () => "enter")],
                    [__]: () => "nil",
                } as any),
            ).toThrow(/Non-exhaustive matcher/);
        });

        it("throws with catch-all hint when guarded arms present and no when(__) catch-all", () => {
            const e = Ev.KeyPress("Tab") as Ev;
            expect(() =>
                match(e, {
                    KeyPress: [
                        when(
                            (v) => v.key === "Enter",
                            () => "enter",
                        ),
                    ],
                    [__]: () => "nil",
                } as any),
            ).toThrow(/catch-all/);
        });

        it("throws with catch-all hint when pred arms present and no when(__) catch-all", () => {
            const e = Ev.KeyPress("Tab") as Ev;
            expect(() =>
                match(e, {
                    KeyPress: [
                        when(
                            { key: pred((k) => k === "Enter") },
                            () => "enter",
                        ),
                    ],
                    [__]: () => "nil",
                } as any),
            ).toThrow(/catch-all/);
        });
    });
});

// ==========================================
// FallbackMatchers — [__] top-level
// ==========================================

describe("match() — FallbackMatchers", () => {
    it("handles unspecified variants via top-level [__]", () => {
        const e = Ev.PageLoad() as Ev;
        const result = match(e, {
            KeyPress: () => "key",
            [__]: () => "default",
        });
        expect(result).toBe("default");
    });

    it("[__] receives the full variant value", () => {
        const e = Ev.PageLoad() as Ev;
        const result = match(e, {
            [__]: (v) => (v as any).path,
        });
        expect(result).toBe("/");
    });
});

// ==========================================
// ExactMatchers — exhaustive coverage
// ==========================================

describe("match() — ExactMatchers", () => {
    it("handles all variants without [__]", () => {
        const run = (e: Ev) =>
            match(e, {
                KeyPress: (v) => `key:${v.key}`,
                Click: (v) => `click:${v.x},${v.y}`,
                PageLoad: (v) => `load:${v.path}`,
            });

        expect(run(Ev.KeyPress("a") as Ev)).toBe("key:a");
        expect(run(Ev.Click(1, 2) as Ev)).toBe("click:1,2");
        expect(run(Ev.PageLoad() as Ev)).toBe("load:/");
    });
});

// ==========================================
// Fixtures for is.* / select / structural tests
// ==========================================

const E = union({
    KeyPress: (key: string, shift: boolean) => ({ key, shift }),
    Click: (x: number, y: number, meta: { button: string }) => ({ x, y, meta }),
    Message: (text: string | null, code: number) => ({ text, code }),
    Nested: (user: { name: string; age: number }) => ({ user }),
    Multi: (a: string, b: number, c: boolean) => ({ a, b, c }),
});
type E = Union<typeof E>;

// second factory with identical shape — used to verify identity isolation
const F = union({
    KeyPress: (key: string, shift: boolean) => ({ key, shift }),
    Click: (x: number, y: number, meta: { button: string }) => ({ x, y, meta }),
    Message: (text: string | null, code: number) => ({ text, code }),
    Nested: (user: { name: string; age: number }) => ({ user }),
});
type F = Union<typeof F>;

// ==========================================
// is.* — type predicates
// ==========================================

describe("is.string", () => {
    it("matches a string field", () => {
        const e = E.KeyPress("a", false) as E;
        expect(match(e, {
            KeyPress: when({ key: is.string }, ({ key }) => `string:${key}`),
            [__]: () => "other",
        })).toBe("string:a");
    });

    it("does not match a non-string field", () => {
        const e = E.Message("hello", 42) as E;
        expect(match(e, {
            Message: [
                when({ code: is.string }, () => "string"),
                when(__, () => "not string"),
            ],
            [__]: () => "other",
        })).toBe("not string");
    });
});

describe("is.number", () => {
    it("matches a number field", () => {
        const e = E.Message("hi", 99) as E;
        expect(match(e, {
            Message: when({ code: is.number }, ({ code }) => `num:${code}`),
            [__]: () => "other",
        })).toBe("num:99");
    });
});

describe("is.boolean", () => {
    it("matches a boolean field", () => {
        const e = E.KeyPress("x", true) as E;
        expect(match(e, {
            KeyPress: when({ shift: is.boolean }, () => "has boolean"),
            [__]: () => "other",
        })).toBe("has boolean");
    });
});

describe("is.nullish", () => {
    it("matches a null field", () => {
        const e = E.Message(null, 0) as E;
        expect(match(e, {
            Message: [
                when({ text: is.nullish }, () => "null or undefined"),
                when(__, () => "has text"),
            ],
            [__]: () => "other",
        })).toBe("null or undefined");
    });

    it("does not match a non-null value", () => {
        const e = E.Message("hello", 0) as E;
        expect(match(e, {
            Message: [
                when({ text: is.nullish }, () => "null or undefined"),
                when(__, () => "has text"),
            ],
            [__]: () => "other",
        })).toBe("has text");
    });
});

describe("is.defined", () => {
    it("matches a defined (non-undefined) value", () => {
        const e = E.Message("hi", 1) as E;
        expect(match(e, {
            Message: when({ text: is.defined }, () => "defined"),
            [__]: () => "other",
        })).toBe("defined");
    });
});

describe("is.array", () => {
    const ArrEv = union({ Items: (list: unknown[]) => ({ list }) });
    type ArrEv = ReturnType<(typeof ArrEv)[keyof typeof ArrEv]>;

    it("matches an array field", () => {
        const e = ArrEv.Items([1, 2, 3]) as ArrEv;
        expect(match(e, {
            Items: when({ list: is.array }, () => "is array"),
        })).toBe("is array");
    });
});

describe("is.object", () => {
    it("matches a plain object field", () => {
        const e = E.Click(0, 0, { button: "left" }) as E;
        expect(match(e, {
            Click: when({ meta: is.object }, () => "has object"),
            [__]: () => "other",
        })).toBe("has object");
    });

    it("does not match an array with is.object", () => {
        const ArrEv = union({ Items: (val: unknown) => ({ val }) });
        type ArrEv = ReturnType<(typeof ArrEv)[keyof typeof ArrEv]>;
        const e = ArrEv.Items([1, 2]) as ArrEv;
        expect(match(e, {
            Items: [
                when({ val: is.object }, () => "object"),
                when(__, () => "not object"),
            ],
        })).toBe("not object");
    });
});

// ==========================================
// is.not — negation combinator
// ==========================================

describe("is.not", () => {
    it("matches when the inner pattern does not match", () => {
        const e = E.KeyPress("a", false) as E;
        expect(match(e, {
            KeyPress: [
                when({ key: is.not("Enter") }, () => "not enter"),
                when(__, () => "enter"),
            ],
            [__]: () => "other",
        })).toBe("not enter");
    });

    it("does not match when the inner pattern matches", () => {
        const e = E.KeyPress("Enter", false) as E;
        expect(match(e, {
            KeyPress: [
                when({ key: is.not("Enter") }, () => "not enter"),
                when(__, () => "enter"),
            ],
            [__]: () => "other",
        })).toBe("enter");
    });

    it("composes with is.* predicates", () => {
        const e = E.Message(null, 1) as E;
        expect(match(e, {
            Message: [
                when({ text: is.not(is.nullish) }, () => "has text"),
                when(__, () => "no text"),
            ],
            [__]: () => "other",
        })).toBe("no text");
    });

    it("matches a non-null value when negating is.nullish", () => {
        const e = E.Message("hello", 1) as E;
        expect(match(e, {
            Message: [
                when({ text: is.not(is.nullish) }, () => "has text"),
                when(__, () => "no text"),
            ],
            [__]: () => "other",
        })).toBe("has text");
    });
});

// ==========================================
// is.union — OR combinator
// ==========================================

describe("is.union", () => {
    it("matches if any sub-pattern matches", () => {
        const e = E.KeyPress("Tab", false) as E;
        expect(match(e, {
            KeyPress: [
                when({ key: is.union("Tab", "Enter") }, () => "control key"),
                when(__, () => "other key"),
            ],
            [__]: () => "other",
        })).toBe("control key");
    });

    it("does not match if no sub-pattern matches", () => {
        const e = E.KeyPress("a", false) as E;
        expect(match(e, {
            KeyPress: [
                when({ key: is.union("Tab", "Enter") }, () => "control key"),
                when(__, () => "other key"),
            ],
            [__]: () => "other",
        })).toBe("other key");
    });

    it("composes is.* predicates as sub-patterns", () => {
        const e = E.Message("hello", 5) as E;
        expect(match(e, {
            Message: [
                when({ text: is.union(is.string, is.nullish) }, () => "string or null"),
                when(__, () => "other"),
            ],
            [__]: () => "other",
        })).toBe("string or null");
    });
});

// ==========================================
// Deep structural matching (recursive)
// ==========================================

describe("deep structural matching", () => {
    it("matches a nested plain-object sub-pattern", () => {
        const e = E.Nested({ name: "Alice", age: 30 }) as E;
        expect(match(e, {
            Nested: when({ user: { name: "Alice" } }, () => "found alice"),
            [__]: () => "other",
        })).toBe("found alice");
    });

    it("does not match when a nested field differs", () => {
        const e = E.Nested({ name: "Bob", age: 30 }) as E;
        expect(match(e, {
            Nested: [
                when({ user: { name: "Alice" } }, () => "found alice"),
                when(__, () => "other"),
            ],
            [__]: () => "other",
        })).toBe("other");
    });

    it("supports is.* predicates inside nested sub-patterns", () => {
        const e = E.Nested({ name: "Carol", age: 25 }) as E;
        expect(match(e, {
            Nested: when({ user: { age: is.number } }, () => "age is number"),
            [__]: () => "other",
        })).toBe("age is number");
    });

    it("supports combinators inside nested sub-patterns", () => {
        const e = E.Nested({ name: "Dave", age: 17 }) as E;
        expect(match(e, {
            Nested: [
                when({ user: { age: is.not(is.number) } }, () => "not number"),
                when(__, () => "is number"),
            ],
            [__]: () => "other",
        })).toBe("is number");
    });

    it("does not recurse into an Aljabr variant payload", () => {
        const Inner = union({ X: (v: number) => ({ v }) });
        const Outer = union({ Wrap: (inner: ReturnType<typeof Inner.X>) => ({ inner }) });
        type Outer = ReturnType<(typeof Outer)[keyof typeof Outer]>;
        const e = Outer.Wrap(Inner.X(42)) as Outer;
        expect(match(e, {
            Wrap: when({ inner: is.object }, () => "has object inner"),
        })).toBe("has object inner");
    });
});

// ==========================================
// select — extraction bindings
// ==========================================

describe("select()", () => {
    it("injects selected field into handler's second argument", () => {
        const e = E.KeyPress("Enter", false) as E;
        expect(match(e, {
            KeyPress: when({ key: select("k") }, (_val, sel) => `key=${sel?.k}`),
            [__]: () => "other",
        })).toBe("key=Enter");
    });

    it("supports multiple selections from different fields", () => {
        const e = E.KeyPress("Tab", true) as E;
        expect(match(e, {
            KeyPress: when(
                { key: select("k"), shift: select("s") },
                (_val, sel) => `${sel?.k}:${sel?.s}`,
            ),
            [__]: () => "other",
        })).toBe("Tab:true");
    });

    it("extracts from a nested path", () => {
        const e = E.Nested({ name: "Alice", age: 30 }) as E;
        expect(match(e, {
            Nested: when(
                { user: { name: select("name") } },
                (_val, sel) => `Hello, ${sel?.name}`,
            ),
            [__]: () => "other",
        })).toBe("Hello, Alice");
    });

    it("does not match when the optional inner pattern fails", () => {
        const e = E.Message("hello", 5) as E;
        expect(match(e, {
            Message: [
                when({ text: select("t", is.nullish) }, (_val, sel) => `null:${sel?.t}`),
                when(__, () => "has text"),
            ],
            [__]: () => "other",
        })).toBe("has text");
    });

    it("matches and extracts when the optional inner pattern passes", () => {
        const e = E.Message(null, 5) as E;
        expect(match(e, {
            Message: [
                when({ text: select("t", is.nullish) }, (_val, sel) => `null:${sel?.t}`),
                when(__, () => "has text"),
            ],
            [__]: () => "other",
        })).toBe("null:null");
    });

    it("selections are empty object (not undefined) for arms without select()", () => {
        const e = E.KeyPress("a", false) as E;
        let captured: Record<string, unknown> | undefined;
        match(e, {
            KeyPress: when({ key: "a" }, (_val, sel) => { captured = sel; return "ok"; }),
            [__]: () => "other",
        });
        expect(captured).toEqual({});
    });
});

// ==========================================
// is.variant()
// ==========================================

describe("is.variant()", () => {
    const Wrapper = union({ Wrap: (val: unknown) => ({ val }) });

    it("matches a field value that is a variant of the specified union", () => {
        const w = Wrapper.Wrap(E.KeyPress("a", false));
        expect(match(w, {
            Wrap: [
                when({ val: is.variant(E) }, () => "is E"),
                when(__, () => "other"),
            ],
        })).toBe("is E");
    });

    it("does not match when the field is a variant of a different union", () => {
        const w = Wrapper.Wrap(F.KeyPress("a", false));
        expect(match(w, {
            Wrap: [
                when({ val: is.variant(E) }, () => "is E"),
                when(__, () => "other"),
            ],
        })).toBe("other");
    });

    it("does not match a non-variant value", () => {
        const w = Wrapper.Wrap("plain string");
        expect(match(w, {
            Wrap: [
                when({ val: is.variant(E) }, () => "is E"),
                when(__, () => "other"),
            ],
        })).toBe("other");
    });
});

// ==========================================
// is.union() with union factories
// ==========================================

describe("is.union() with union factories", () => {
    const Wrapper = union({ Wrap: (val: unknown) => ({ val }) });

    it("matches a variant of the first factory", () => {
        const w = Wrapper.Wrap(E.KeyPress("a", false));
        expect(match(w, {
            Wrap: [
                when({ val: is.union(E, F) }, () => "E or F"),
                when(__, () => "other"),
            ],
        })).toBe("E or F");
    });

    it("matches a variant of the second factory", () => {
        const w = Wrapper.Wrap(F.Click(1, 2, { button: "right" }));
        expect(match(w, {
            Wrap: [
                when({ val: is.union(E, F) }, () => "E or F"),
                when(__, () => "other"),
            ],
        })).toBe("E or F");
    });

    it("does not match a non-variant value", () => {
        const w = Wrapper.Wrap("hello");
        expect(match(w, {
            Wrap: [
                when({ val: is.union(E, F) }, () => "E or F"),
                when(__, () => "other"),
            ],
        })).toBe("other");
    });

    it("single factory: matches variants of that union only", () => {
        const wE = Wrapper.Wrap(E.KeyPress("a", false));
        const wF = Wrapper.Wrap(F.KeyPress("a", false));
        const run = (w: ReturnType<typeof Wrapper.Wrap>) =>
            match(w, {
                Wrap: [
                    when({ val: is.union(E) }, () => "E only"),
                    when(__, () => "other"),
                ],
            });
        expect(run(wE)).toBe("E only");
        expect(run(wF)).toBe("other");
    });

    it("mixes factories and pred patterns in the same combinator", () => {
        const run = (w: ReturnType<typeof Wrapper.Wrap>) =>
            match(w, {
                Wrap: [
                    when({ val: is.union(E, is.string) }, () => "E or string"),
                    when(__, () => "other"),
                ],
            });
        expect(run(Wrapper.Wrap(E.KeyPress("a", false)))).toBe("E or string");
        expect(run(Wrapper.Wrap("hello"))).toBe("E or string");
        expect(run(Wrapper.Wrap(42))).toBe("other");
    });
});

// ==========================================
// is.not() with union factories
// ==========================================

describe("is.not() with union factories", () => {
    const Wrapper = union({ Wrap: (val: unknown) => ({ val }) });

    it("matches values that are NOT variants of the union", () => {
        const w = Wrapper.Wrap("not a variant");
        expect(match(w, {
            Wrap: [
                when({ val: is.not(E) }, () => "not E"),
                when(__, () => "is E"),
            ],
        })).toBe("not E");
    });

    it("does not match when the value IS a variant of the union", () => {
        const w = Wrapper.Wrap(E.KeyPress("a", false));
        expect(match(w, {
            Wrap: [
                when({ val: is.not(E) }, () => "not E"),
                when(__, () => "is E"),
            ],
        })).toBe("is E");
    });
});

// ==========================================
// is.not.* — pre-computed wildcards
// ==========================================

describe("is.not.* — pre-computed wildcards", () => {
    const Wrapper = union({ Wrap: (val: unknown) => ({ val }) });
    const run = (val: unknown, pat: unknown) =>
        match(Wrapper.Wrap(val), {
            Wrap: [
                when({ val: pat }, () => "match"),
                when(__, () => "no match"),
            ],
        });

    it("is.not.string matches a non-string", () => expect(run(42, is.not.string)).toBe("match"));
    it("is.not.string does not match a string", () => expect(run("hi", is.not.string)).toBe("no match"));
    it("is.not.number matches a non-number", () => expect(run("hi", is.not.number)).toBe("match"));
    it("is.not.number does not match a number", () => expect(run(0, is.not.number)).toBe("no match"));
    it("is.not.boolean matches a non-boolean", () => expect(run("yes", is.not.boolean)).toBe("match"));
    it("is.not.boolean does not match a boolean", () => expect(run(false, is.not.boolean)).toBe("no match"));
    it("is.not.nullish matches a defined non-null value", () => expect(run("hi", is.not.nullish)).toBe("match"));
    it("is.not.nullish does not match null", () => expect(run(null, is.not.nullish)).toBe("no match"));
    it("is.not.defined matches undefined", () => expect(run(undefined, is.not.defined)).toBe("match"));
    it("is.not.defined does not match a defined value", () => expect(run(0, is.not.defined)).toBe("no match"));
    it("is.not.array matches a non-array", () => expect(run({}, is.not.array)).toBe("match"));
    it("is.not.array does not match an array", () => expect(run([], is.not.array)).toBe("no match"));
    it("is.not.object matches a non-object", () => expect(run("str", is.not.object)).toBe("match"));
    it("is.not.object does not match a plain object", () => expect(run({}, is.not.object)).toBe("no match"));
});

describe("is.not.union()", () => {
    const Wrapper = union({ Wrap: (val: unknown) => ({ val }) });

    it("matches when the value satisfies none of the sub-patterns", () => {
        const w = Wrapper.Wrap(42);
        expect(match(w, {
            Wrap: [
                when({ val: is.not.union(is.string, is.boolean) }, () => "neither"),
                when(__, () => "one of them"),
            ],
        })).toBe("neither");
    });

    it("does not match when the value satisfies a sub-pattern", () => {
        const w = Wrapper.Wrap("hello");
        expect(match(w, {
            Wrap: [
                when({ val: is.not.union(is.string, is.boolean) }, () => "neither"),
                when(__, () => "one of them"),
            ],
        })).toBe("one of them");
    });
});

describe("is.not.variant()", () => {
    const Wrapper = union({ Wrap: (val: unknown) => ({ val }) });

    it("matches when the value is not a variant of the given union", () => {
        const w = Wrapper.Wrap("plain");
        expect(match(w, {
            Wrap: [
                when({ val: is.not.variant(E) }, () => "not E"),
                when(__, () => "is E"),
            ],
        })).toBe("not E");
    });

    it("does not match when the value is a variant of the given union", () => {
        const w = Wrapper.Wrap(E.KeyPress("a", false));
        expect(match(w, {
            Wrap: [
                when({ val: is.not.variant(E) }, () => "not E"),
                when(__, () => "is E"),
            ],
        })).toBe("is E");
    });
});

// ==========================================
// Combined usage
// ==========================================

describe("combined usage", () => {
    it("is.not + select: extracts only when negation passes", () => {
        const e = E.KeyPress("a", false) as E;
        expect(match(e, {
            KeyPress: [
                when({ key: select("k", is.not("Enter")) }, (_val, sel) => `char:${sel?.k}`),
                when(__, () => "enter"),
            ],
            [__]: () => "other",
        })).toBe("char:a");
    });

    it("is.union + deep nesting + select", () => {
        const e = E.Nested({ name: "Alice", age: 30 }) as E;
        expect(match(e, {
            Nested: when(
                { user: { name: select("n", is.union("Alice", "Bob")) } },
                (_val, sel) => `matched:${sel?.n}`,
            ),
            [__]: () => "other",
        })).toBe("matched:Alice");
    });
});

// ==========================================
// Type-level inference — select() and combinators
// ==========================================

describe("select: field type is inferred from the variant", () => {
    it("single select — key typed as string", () => {
        match(E.KeyPress("a", false) as E, {
            KeyPress: when({ key: select("k") }, (_val, sel) => {
                expectTypeOf(sel.k).toEqualTypeOf<string>();
            }),
            [__]: () => {},
        });
    });

    it("single select — shift typed as boolean", () => {
        match(E.KeyPress("a", true) as E, {
            KeyPress: when({ shift: select("s") }, (_val, sel) => {
                expectTypeOf(sel.s).toEqualTypeOf<boolean>();
            }),
            [__]: () => {},
        });
    });

    it("multiple selects — each field typed independently", () => {
        match(E.KeyPress("a", false) as E, {
            KeyPress: when(
                { key: select("k"), shift: select("s") },
                (_val, sel) => {
                    expectTypeOf(sel.k).toEqualTypeOf<string>();
                    expectTypeOf(sel.s).toEqualTypeOf<boolean>();
                },
            ),
            [__]: () => {},
        });
    });

    it("nullable field — typed as string | null without constraint", () => {
        match(E.Message("hi", 1) as E, {
            Message: when({ text: select("t") }, (_val, sel) => {
                expectTypeOf(sel.t).toEqualTypeOf<string | null>();
            }),
            [__]: () => {},
        });
    });
});

describe("select: inner pattern narrows the extracted type", () => {
    it("is.string inner — extracted as string", () => {
        match(E.Message("hi", 1) as E, {
            Message: [
                when({ text: select("t", is.string) }, (_val, sel) => {
                    expectTypeOf(sel.t).toEqualTypeOf<string>();
                }),
                when(__, () => {}),
            ],
            [__]: () => {},
        });
    });

    it("is.number inner — extracted as number", () => {
        match(E.Message("hi", 1) as E, {
            Message: when({ code: select("c", is.number) }, (_val, sel) => {
                expectTypeOf(sel.c).toEqualTypeOf<number>();
            }),
            [__]: () => {},
        });
    });

    it("is.not(is.nullish) inner — excludes null | undefined", () => {
        match(E.Message("hi", 1) as E, {
            Message: [
                when({ text: select("t", is.not(is.nullish)) }, (_val, sel) => {
                    expectTypeOf(sel.t).toEqualTypeOf<string>();
                }),
                when(__, () => {}),
            ],
            [__]: () => {},
        });
    });

    it("is.union literal inner — extracted as literal union", () => {
        const Kp = union({ Press: (key: "a" | "b" | "c") => ({ key }) });
        type Kp = ReturnType<typeof Kp.Press>;
        match(Kp.Press("a") as Kp, {
            Press: [
                when(
                    { key: select("k", is.union("a" as const, "b" as const)) },
                    (_val, sel) => { expectTypeOf(sel.k).toEqualTypeOf<"a" | "b">(); },
                ),
                when(__, () => {}),
            ],
        });
    });
});

describe("select: nested path extraction types", () => {
    it("extracts from a nested plain-object sub-pattern", () => {
        match(E.Nested({ name: "Alice", age: 30 }) as E, {
            Nested: when({ user: { name: select("name") } }, (_val, sel) => {
                expectTypeOf(sel.name).toEqualTypeOf<string>();
            }),
            [__]: () => {},
        });
    });

    it("nested extract with inner pattern — typed as narrowed type", () => {
        match(E.Nested({ name: "Alice", age: 30 }) as E, {
            Nested: when({ user: { age: select("age", is.number) } }, (_val, sel) => {
                expectTypeOf(sel.age).toEqualTypeOf<number>();
            }),
            [__]: () => {},
        });
    });
});

describe("select: no markers → selections is empty object", () => {
    it("plain pattern with no select — selections is {}", () => {
        match(E.KeyPress("a", false) as E, {
            KeyPress: when({ key: "a" }, (_val, sel) => {
                expectTypeOf(sel).toEqualTypeOf<{}>();
            }),
            [__]: () => {},
        });
    });
});

describe("combinator types: NotCombinator and UnionCombinator are generic", () => {
    it("is.not carries the inner pattern type", () => {
        const comb = is.not("error");
        expectTypeOf(comb.pattern).toEqualTypeOf<string>();
    });

    it("is.not(is.nullish) carries Pred inner type", () => {
        const comb = is.not(is.nullish);
        expectTypeOf(comb.kind).toEqualTypeOf<"not">();
    });

    it("is.union preserves literal tuple types", () => {
        const comb = is.union("Tab", "Enter");
        expectTypeOf(comb.patterns).toEqualTypeOf<["Tab", "Enter"]>();
    });

    it("is.union with mixed predicates preserves tuple", () => {
        const comb = is.union(is.string, is.number);
        expectTypeOf(comb.patterns[0]).toEqualTypeOf(is.string);
        expectTypeOf(comb.patterns[1]).toEqualTypeOf(is.number);
    });
});

describe("select: multiple fields extracted simultaneously", () => {
    it("three selects in one arm — all properly typed", () => {
        match(E.Multi("x", 1, true) as E, {
            Multi: when(
                { a: select("a"), b: select("b"), c: select("c") },
                (_val, sel) => {
                    expectTypeOf(sel.a).toEqualTypeOf<string>();
                    expectTypeOf(sel.b).toEqualTypeOf<number>();
                    expectTypeOf(sel.c).toEqualTypeOf<boolean>();
                },
            ),
            [__]: () => {},
        });
    });
});
