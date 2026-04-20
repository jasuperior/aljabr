import { describe, it, expect, vi } from "vitest";
import { signal, query, effect } from "../../src/signals/index.ts";
import { getTag } from "../../src/union.ts";

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

describe("query() — initial state", () => {
    it("getter returns null before evaluation", () => {
        const [data] = query(async () => 42);
        expect(data()).toBeNull();
    });
    it("state() returns Uncomputed initially", () => {
        const [data] = query(async () => 42);
        expect(getTag(data.state())).toBe("Uncomputed");
    });
});

describe("query() — async evaluation", () => {
    it("resolves to Ready after evaluation", async () => {
        const [data] = query(async () => 99);
        data(); // trigger evaluation via getter
        await tick();
        expect(data()).toBe(99);
        expect(getTag(data.state())).toBe("Ready");
    });
});

describe("query() — refetch", () => {
    it("re-runs the fetch function on refetch()", async () => {
        let callCount = 0;
        const [data, { refetch }] = query(async () => {
            callCount++;
            return callCount;
        });
        data(); // initial trigger
        await tick();
        expect(data()).toBe(1);
        refetch();
        await tick();
        expect(data()).toBe(2);
        expect(callCount).toBe(2);
    });
});

describe("query() — reactive source", () => {
    it("re-runs when a signal dependency changes", async () => {
        const [userId, setUserId] = signal(1);
        const [user] = query(async () => `user-${userId()}`);
        user(); // trigger evaluation
        await tick();
        expect(user()).toBe("user-1");
        setUserId(2);
        await tick();
        expect(user()).toBe("user-2");
    });
});

describe("query() — control object shape", () => {
    it("returns [getter, { refetch }] tuple", () => {
        const result = query(async () => 1);
        expect(result).toHaveLength(2);
        expect(typeof result[0]).toBe("function");
        expect(typeof result[0].state).toBe("function");
        expect(typeof result[1].refetch).toBe("function");
    });
});
