import { describe, it, expect } from "vitest";
import { context, effect, scope } from "../../src/signals/index.ts";

describe("context() — default value", () => {
    it("use() returns default when no provider is active", () => {
        const Theme = context("light");
        expect(Theme.use()).toBe("light");
    });
});

describe("context() — provide/use", () => {
    it("use() returns provided value inside thunk", () => {
        const Theme = context("light");
        let seen: string | null = null;
        Theme.provide("dark", () => {
            seen = Theme.use();
        });
        expect(seen).toBe("dark");
    });
    it("use() returns default outside provider thunk", () => {
        const Theme = context("light");
        Theme.provide("dark", () => {});
        expect(Theme.use()).toBe("light");
    });
});

describe("context() — nested providers", () => {
    it("inner provider overrides outer", () => {
        const Theme = context("light");
        const seen: string[] = [];
        Theme.provide("dark", () => {
            seen.push(Theme.use()); // "dark"
            Theme.provide("contrast", () => {
                seen.push(Theme.use()); // "contrast"
            });
            seen.push(Theme.use()); // "dark" again
        });
        expect(seen).toEqual(["dark", "contrast", "dark"]);
    });
});

describe("context() — multiple independent contexts", () => {
    it("separate context tokens do not interfere", () => {
        const Theme = context("light");
        const Lang = context("en");
        let theme: string | null = null;
        let lang: string | null = null;
        Theme.provide("dark", () => {
            Lang.provide("fr", () => {
                theme = Theme.use();
                lang = Lang.use();
            });
        });
        expect(theme).toBe("dark");
        expect(lang).toBe("fr");
    });
});

describe("context() — use() inside effect", () => {
    it("effect inside provide() sees the provided value", () => {
        const Theme = context("light");
        const seen: string[] = [];
        Theme.provide("dark", () => {
            effect(() => {
                seen.push(Theme.use());
            });
        });
        expect(seen).toEqual(["dark"]);
    });
});
