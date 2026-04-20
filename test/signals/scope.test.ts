import { describe, it, expect } from "vitest";
import { signal, effect, scope } from "../../src/signals/index.ts";

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

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
    it("stops reactive effects when dispose() is called", async () => {
        let runs = 0;

        const [innerCount, dispose] = scope(() => {
            const [c, setC] = signal(0);
            effect(() => {
                c();
                runs++;
            });
            return [c, setC] as const;
        });

        const [c, setC] = innerCount;
        expect(runs).toBe(1);
        setC(1);
        expect(runs).toBe(2);

        await dispose();

        setC(2); // signal still settable, but no effects are tracking it
        expect(runs).toBe(2);
    });
});

describe("scope() — early termination from within", () => {
    it("an effect calling the injected dispose() terminates the scope", async () => {
        let runs = 0;
        const [count, setCount] = signal(0);

        scope((dispose) => {
            effect(() => {
                const c = count() ?? 0;
                runs++;
                if (c >= 1) dispose();
            });
        });

        expect(runs).toBe(1);
        setCount(1); // effect fires, detects condition, calls dispose() internally
        expect(runs).toBe(2); // one final run that triggered the shutdown
        await tick();
        setCount(2);
        expect(runs).toBe(2);
    });
});

describe("scope() — defer finalizers", async () => {
    it("runs defer() finalizers on dispose()", async () => {
        const log: string[] = [];
        const { defer } = await import("../../src/prelude/scope.ts");

        const [, dispose] = scope(() => {
            defer(() => {
                log.push("cleanup");
            });
        });

        await dispose();
        expect(log).toEqual(["cleanup"]);
    });
});
