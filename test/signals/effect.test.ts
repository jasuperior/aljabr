import { describe, it, expect } from "vitest";
import { signal, effect } from "../../src/signals/index.ts";

describe("effect() — initial run", () => {
    it("runs immediately on creation", () => {
        const [count] = signal(0);
        let runs = 0;
        effect(() => { count(); runs++; });
        expect(runs).toBe(1);
    });
});

describe("effect() — reactivity", () => {
    it("re-runs when a dependency changes", () => {
        const [count, setCount] = signal(0);
        let seen: (number | null)[] = [];
        effect(() => { seen.push(count()); });
        setCount(1);
        setCount(2);
        expect(seen).toEqual([0, 1, 2]);
    });
    it("does not re-run when an unread signal changes", () => {
        const [a] = signal(0);
        const [b, setB] = signal(0);
        let runs = 0;
        effect(() => { a(); runs++; });
        setB(1);
        expect(runs).toBe(1);
    });
});

describe("effect() — disposer", () => {
    it("stops re-running after stop() is called", () => {
        const [count, setCount] = signal(0);
        let runs = 0;
        const stop = effect(() => { count(); runs++; });
        stop();
        setCount(1);
        expect(runs).toBe(1); // only the initial run
    });
});

describe("effect() — conditional dependencies", () => {
    it("tracks only the currently-active branch", () => {
        const [toggle, setToggle] = signal(true);
        const [a, setA] = signal("a");
        const [b, setB] = signal("b");
        const seen: (string | null)[] = [];
        effect(() => {
            seen.push(toggle() ? a() : b());
        });
        setA("a2"); // toggle is true, so a is tracked
        setToggle(false); // switches branch
        setB("b2"); // now b is tracked
        setA("a3"); // a is no longer tracked
        expect(seen).toEqual(["a", "a2", "b", "b2"]);
    });
});
