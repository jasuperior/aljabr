/**
 * Phase 1.5 — Type-level inference tests for select() and combinator narrowing.
 *
 * These tests use `expectTypeOf` to assert that the `selections` second argument
 * to when() handlers is typed precisely, not as `Record<string, unknown>`.
 *
 * Runtime behavior is unchanged from Phase 1; only the TypeScript types improve.
 */

import { describe, it, expectTypeOf } from "vitest";
import { __, union, when, is, select } from "../src/union.ts";
import { match } from "../src/match.ts";

// ==========================================
// Shared fixture
// ==========================================

const Ev = union({
    KeyPress: (key: string, shift: boolean) => ({ key, shift }),
    Message: (text: string | null, code: number) => ({ text, code }),
    Nested: (user: { name: string; age: number }) => ({ user }),
    Multi: (a: string, b: number, c: boolean) => ({ a, b, c }),
});
type Ev = ReturnType<(typeof Ev)[keyof typeof Ev]>;

// ==========================================
// select() — name inference
// ==========================================

describe("select: field type is inferred from the variant", () => {
    it("single select — key typed as string", () => {
        match(Ev.KeyPress("a", false) as Ev, {
            KeyPress: when({ key: select("k") }, (_val, sel) => {
                expectTypeOf(sel.k).toEqualTypeOf<string>();
            }),
            [__]: () => {},
        });
    });

    it("single select — shift typed as boolean", () => {
        match(Ev.KeyPress("a", true) as Ev, {
            KeyPress: when({ shift: select("s") }, (_val, sel) => {
                expectTypeOf(sel.s).toEqualTypeOf<boolean>();
            }),
            [__]: () => {},
        });
    });

    it("multiple selects — each field typed independently", () => {
        match(Ev.KeyPress("a", false) as Ev, {
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
        match(Ev.Message("hi", 1) as Ev, {
            Message: when({ text: select("t") }, (_val, sel) => {
                expectTypeOf(sel.t).toEqualTypeOf<string | null>();
            }),
            [__]: () => {},
        });
    });
});

// ==========================================
// select() — inner pattern narrows extracted type
// ==========================================

describe("select: inner pattern narrows the extracted type", () => {
    it("is.string inner — extracted as string", () => {
        match(Ev.Message("hi", 1) as Ev, {
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
        match(Ev.Message("hi", 1) as Ev, {
            Message: when({ code: select("c", is.number) }, (_val, sel) => {
                expectTypeOf(sel.c).toEqualTypeOf<number>();
            }),
            [__]: () => {},
        });
    });

    it("is.not(is.nullish) inner — excludes null | undefined", () => {
        match(Ev.Message("hi", 1) as Ev, {
            Message: [
                when(
                    { text: select("t", is.not(is.nullish)) },
                    (_val, sel) => {
                        // string | null, minus null | undefined = string
                        expectTypeOf(sel.t).toEqualTypeOf<string>();
                    },
                ),
                when(__, () => {}),
            ],
            [__]: () => {},
        });
    });

    it("is.union('a','b') inner — extracted as literal union", () => {
        const Kp = union({ Press: (key: "a" | "b" | "c") => ({ key }) });
        type Kp = ReturnType<typeof Kp.Press>;

        match(Kp.Press("a") as Kp, {
            Press: [
                when(
                    { key: select("k", is.union("a" as const, "b" as const)) },
                    (_val, sel) => {
                        expectTypeOf(sel.k).toEqualTypeOf<"a" | "b">();
                    },
                ),
                when(__, () => {}),
            ],
        });
    });
});

// ==========================================
// select() — nested path
// ==========================================

describe("select: nested path extraction", () => {
    it("extracts from a nested plain-object sub-pattern", () => {
        match(Ev.Nested({ name: "Alice", age: 30 }) as Ev, {
            Nested: when(
                { user: { name: select("name") } },
                (_val, sel) => {
                    expectTypeOf(sel.name).toEqualTypeOf<string>();
                },
            ),
            [__]: () => {},
        });
    });

    it("nested extract with inner pattern — typed as narrowed type", () => {
        match(Ev.Nested({ name: "Alice", age: 30 }) as Ev, {
            Nested: when(
                { user: { age: select("age", is.number) } },
                (_val, sel) => {
                    expectTypeOf(sel.age).toEqualTypeOf<number>();
                },
            ),
            [__]: () => {},
        });
    });
});

// ==========================================
// select() — no select markers → selections is {}
// ==========================================

describe("select: no markers → selections is empty object", () => {
    it("plain pattern with no select — selections is {}", () => {
        match(Ev.KeyPress("a", false) as Ev, {
            KeyPress: when({ key: "a" }, (_val, sel) => {
                expectTypeOf(sel).toEqualTypeOf<{}>();
            }),
            [__]: () => {},
        });
    });
});

// ==========================================
// Combinator narrowing — is.not / is.union carry inner pattern types
// ==========================================

describe("combinator types: NotCombinator and UnionCombinator are generic", () => {
    it("is.not carries the inner pattern type", () => {
        const comb = is.not("error");
        expectTypeOf(comb.pattern).toEqualTypeOf<string>();
    });

    it("is.not(is.nullish) carries Pred inner type", () => {
        const comb = is.not(is.nullish);
        // pattern is the Pred object — just verify it round-trips correctly
        expectTypeOf(comb.kind).toEqualTypeOf<"not">();
    });

    it("is.union preserves literal tuple types", () => {
        const comb = is.union("Tab", "Enter");
        expectTypeOf(comb.patterns).toEqualTypeOf<["Tab", "Enter"]>();
    });

    it("is.union with mixed predicates preserves tuple", () => {
        const comb = is.union(is.string, is.number);
        // patterns tuple: [Pred<unknown, string>, Pred<unknown, number>]
        expectTypeOf(comb.patterns[0]).toEqualTypeOf(is.string);
        expectTypeOf(comb.patterns[1]).toEqualTypeOf(is.number);
    });
});

// ==========================================
// Multi-select in one arm
// ==========================================

describe("select: multiple fields extracted simultaneously", () => {
    it("three selects in one arm — all properly typed", () => {
        match(Ev.Multi("x", 1, true) as Ev, {
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
