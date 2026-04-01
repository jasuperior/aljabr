import { describe, it, expect } from "vitest";
import { __, union, pred, when } from "../src/union.ts";
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
