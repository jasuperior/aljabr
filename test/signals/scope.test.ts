import { describe, it, expect } from "vitest";
import { signal, effect, scope } from "../../src/signals/index.ts";

describe("scope() — basic", () => {
    it("returns the value produced by fn", () => {
        const [value] = scope(() => 42);
        expect(value).toBe(42);
    });
    it("returns a dispose function", async () => {
        const [, dispose] = scope(() => {});
        const defects = await dispose();
        expect(defects).toEqual([]);
    });
});

describe("scope() — reactive ownership", () => {
    it("disposes signals created inside when dispose() is called", async () => {
        let runs = 0;
        const [count, setCount] = signal(0);

        const [innerCount, dispose] = scope(() => {
            const [c, setC] = signal(0);
            effect(() => { c(); runs++; });
            return [c, setC] as const;
        });

        const [c, setC] = innerCount;
        expect(runs).toBe(1);
        setC(1);
        expect(runs).toBe(2);

        await dispose();

        setC(2); // no-op: signal disposed
        expect(runs).toBe(2);
    });
});

describe("scope() — early termination from within", () => {
    it("passes a dispose function into fn", async () => {
        let disposed = false;
        const [, disposer] = scope((dispose) => {
            effect(() => {
                // effect body — just checking dispose is callable
            });
            return dispose;
        });
        const defects = await disposer();
        expect(defects).toEqual([]);
    });
});

describe("scope() — defer finalizers", async () => {
    it("runs defer() finalizers on dispose()", async () => {
        const log: string[] = [];
        const { defer } = await import("../../src/prelude/scope.ts");

        const [, dispose] = scope(() => {
            defer(() => { log.push("cleanup"); });
        });

        await dispose();
        expect(log).toEqual(["cleanup"]);
    });
});
