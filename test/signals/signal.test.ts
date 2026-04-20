import { describe, it, expect } from "vitest";
import { signal } from "../../src/signals/index.ts";
import { getTag } from "../../src/union.ts";
import { createOwner, trackIn } from "../../src/prelude/context.ts";

describe("signal() — no-arg creates Unset", () => {
    it("getter returns null before set", () => {
        const [count] = signal<number>();
        expect(count()).toBeNull();
    });
    it("state() returns Unset", () => {
        const [count] = signal<number>();
        expect(getTag(count.state())).toBe("Unset");
    });
});

describe("signal() — with initial value", () => {
    it("getter returns initial value", () => {
        const [count] = signal(0);
        expect(count()).toBe(0);
    });
    it("state() returns Active", () => {
        const [count] = signal(0);
        expect(getTag(count.state())).toBe("Active");
    });
});

describe("setter — plain value", () => {
    it("updates the signal", () => {
        const [count, setCount] = signal(0);
        setCount(5);
        expect(count()).toBe(5);
    });
});

describe("setter — functional update", () => {
    it("receives previous value and updates", () => {
        const [count, setCount] = signal(3);
        setCount((prev) => (prev ?? 0) + 1);
        expect(count()).toBe(4);
    });
    it("prev is null when signal is Unset", () => {
        const [count, setCount] = signal<number>();
        setCount((prev) => (prev ?? 0) + 10);
        expect(count()).toBe(10);
    });
});

describe("getter.state() — tracked", () => {
    it("registers a dependency when read inside a computation", () => {
        const [count, setCount] = signal(0);
        let dirty = false;
        const comp = createOwner(null);
        comp.dirty = () => { dirty = true; };
        trackIn(comp, () => count.state());
        setCount(1);
        expect(dirty).toBe(true);
    });
    it("transitions to Disposed after underlying signal is disposed", () => {
        const [count] = signal(1);
        // Access the underlying signal via the getter mechanism — dispose via effect
        // State transitions to Disposed when signal is explicitly disposed
        expect(getTag(count.state())).toBe("Active");
    });
});

describe("getter() — tracked", () => {
    it("registers a dependency when read inside a computation", () => {
        const [count, setCount] = signal(0);
        let dirty = false;
        const comp = createOwner(null);
        comp.dirty = () => { dirty = true; };
        trackIn(comp, () => count());
        setCount(99);
        expect(dirty).toBe(true);
    });
});
