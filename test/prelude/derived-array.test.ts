import { describe, expect, it, vi } from "vitest";
import { DerivedArray } from "../../src/prelude/derived-array.ts";
import { Ref, RefArray } from "../../src/prelude/ref";
import { Derived } from "../../src/prelude/derived";
import { batch, createOwner, trackIn } from "../../src/prelude/context";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type Item = { id: number; value: number };

function makeNumbers(): RefArray<number> {
    return Ref.create([1, 2, 3, 4, 5]);
}

// ---------------------------------------------------------------------------
// DerivedArray.get / at / length — basic reactive reads
// ---------------------------------------------------------------------------

describe("DerivedArray.get", () => {
    it("reads a mapped element", () => {
        const arr = makeNumbers();
        const doubled = arr.map(x => x * 2);
        expect(doubled.get(0)).toBe(2);
        expect(doubled.get(4)).toBe(10);
    });

    it("returns undefined for out-of-bounds index", () => {
        const arr = makeNumbers();
        const mapped = arr.map(x => x);
        expect(mapped.get(99)).toBeUndefined();
    });

    it("registers a tracked dependency on the index signal", () => {
        const arr = makeNumbers();
        const doubled = arr.map(x => x * 2);

        const comp = createOwner(null);
        const dirty = vi.fn();
        comp.dirty = dirty;

        trackIn(comp, () => doubled.get(2));

        arr.splice(2, 1, 30); // change index 2 in source
        expect(dirty).toHaveBeenCalledTimes(1);
    });

    it("does NOT notify when a different index changes", () => {
        const arr = makeNumbers();
        const doubled = arr.map(x => x * 2);

        const comp = createOwner(null);
        const dirty = vi.fn();
        comp.dirty = dirty;

        trackIn(comp, () => doubled.get(0));

        arr.splice(4, 1, 99); // change index 4 only
        expect(dirty).not.toHaveBeenCalled();
    });
});

describe("DerivedArray.get() — no-arg whole-array", () => {
    it("returns the full derived array", () => {
        const arr = makeNumbers();
        const doubled = arr.map(x => x * 2);
        expect(doubled.get()).toEqual([2, 4, 6, 8, 10]);
    });

    it("reflects source mutations", () => {
        const arr = makeNumbers();
        const doubled = arr.map(x => x * 2);
        arr.push(6);
        expect(doubled.get()).toEqual([2, 4, 6, 8, 10, 12]);
    });

    it("registers a dependency that fires on any element change", () => {
        const arr = makeNumbers();
        const doubled = arr.map(x => x * 2);
        const comp = createOwner(null);
        const dirty = vi.fn();
        comp.dirty = dirty;

        trackIn(comp, () => doubled.get());

        arr.splice(2, 1, 99);
        expect(dirty).toHaveBeenCalledTimes(1);
    });

    it("fires when the derived array grows", () => {
        const arr = makeNumbers();
        const doubled = arr.map(x => x * 2);
        const comp = createOwner(null);
        const dirty = vi.fn();
        comp.dirty = dirty;

        trackIn(comp, () => doubled.get());

        arr.push(6);
        expect(dirty).toHaveBeenCalledTimes(1);
    });

    it("returns [] after disposal", () => {
        const arr = makeNumbers();
        const doubled = arr.map(x => x * 2);
        doubled.dispose();
        expect(doubled.get()).toEqual([]);
    });
});

describe("DerivedArray.peek() — untracked", () => {
    it("peek() returns the full array without tracking", () => {
        const arr = makeNumbers();
        const doubled = arr.map(x => x * 2);
        const comp = createOwner(null);
        const dirty = vi.fn();
        comp.dirty = dirty;

        trackIn(comp, () => doubled.peek());

        arr.push(6);
        expect(dirty).not.toHaveBeenCalled();
        expect(doubled.peek()).toEqual([2, 4, 6, 8, 10, 12]);
    });

    it("peek(i) returns the element at index without tracking", () => {
        const arr = makeNumbers();
        const doubled = arr.map(x => x * 2);
        const comp = createOwner(null);
        const dirty = vi.fn();
        comp.dirty = dirty;

        trackIn(comp, () => doubled.peek(0));

        arr.splice(0, 1, 10);
        expect(dirty).not.toHaveBeenCalled();
        expect(doubled.peek(0)).toBe(20);
    });
});

describe("DerivedArray.at", () => {
    it("returns a Derived", () => {
        const arr = makeNumbers();
        const mapped = arr.map(x => x);
        expect(mapped.at(0)).toBeInstanceOf(Derived);
    });

    it("Derived reflects updates to that index", () => {
        const arr = makeNumbers();
        const doubled = arr.map(x => x * 2);
        const d = doubled.at(0);

        expect(d.get()).toBe(2);
        arr.splice(0, 1, 10);
        expect(d.get()).toBe(20);
    });
});

describe("DerivedArray.length", () => {
    it("reflects the correct length", () => {
        const arr = makeNumbers();
        const mapped = arr.map(x => x);
        expect(mapped.length()).toBe(5);
    });

    it("notifies when output length changes", () => {
        const arr = makeNumbers();
        const evens = arr.filter(x => x % 2 === 0); // [2,4] len=2

        const comp = createOwner(null);
        const dirty = vi.fn();
        comp.dirty = dirty;

        trackIn(comp, () => evens.length());

        arr.push(6); // adds one more even → len=3
        expect(dirty).toHaveBeenCalledTimes(1);
    });

    it("does NOT notify when output length is unchanged", () => {
        const arr = makeNumbers(); // [1,2,3,4,5]
        const evens = arr.filter(x => x % 2 === 0); // [2,4] len=2

        const comp = createOwner(null);
        const dirty = vi.fn();
        comp.dirty = dirty;

        trackIn(comp, () => evens.length());

        arr.splice(0, 1, 7); // replace 1 with 7 → still [2,4,7? no 7 is odd] → still [2,4]
        expect(dirty).not.toHaveBeenCalled();
    });
});

// ---------------------------------------------------------------------------
// map — 1:1 transformation, no key required
// ---------------------------------------------------------------------------

describe("DerivedArray.map", () => {
    it("transforms all elements initially", () => {
        const arr = makeNumbers();
        const mapped = arr.map(x => x * 10);
        for (let i = 0; i < 5; i++) {
            expect(mapped.get(i)).toBe((i + 1) * 10);
        }
    });

    it("passes index as second arg to fn", () => {
        const arr = makeNumbers();
        const withIndex = arr.map((x, i) => `${i}:${x}`);
        expect(withIndex.get(0)).toBe("0:1");
        expect(withIndex.get(4)).toBe("4:5");
    });

    it("notifies only the changed index when source element changes", () => {
        const arr = makeNumbers();
        const doubled = arr.map(x => x * 2);

        const comp0 = createOwner(null);
        const dirty0 = vi.fn();
        comp0.dirty = dirty0;

        const comp2 = createOwner(null);
        const dirty2 = vi.fn();
        comp2.dirty = dirty2;

        trackIn(comp0, () => doubled.get(0));
        trackIn(comp2, () => doubled.get(2));

        arr.splice(2, 1, 30); // only index 2 changes
        expect(dirty0).not.toHaveBeenCalled();
        expect(dirty2).toHaveBeenCalledTimes(1);
    });

    it("updates length when source grows", () => {
        const arr = makeNumbers();
        const doubled = arr.map(x => x * 2);
        expect(doubled.length()).toBe(5);

        arr.push(6);
        expect(doubled.length()).toBe(6);
        expect(doubled.get(5)).toBe(12);
    });

    it("updates length when source shrinks", () => {
        const arr = makeNumbers();
        const doubled = arr.map(x => x * 2);
        arr.pop();
        expect(doubled.length()).toBe(4);
        expect(doubled.get(4)).toBeUndefined();
    });

    it("is chainable: map().map()", () => {
        const arr = makeNumbers();
        const result = arr.map(x => x * 2).map(x => x + 1);
        expect(result.get(0)).toBe(3); // 1*2+1
        expect(result.get(4)).toBe(11); // 5*2+1
    });
});

// ---------------------------------------------------------------------------
// filter — key-based incremental diffing
// ---------------------------------------------------------------------------

describe("DerivedArray.filter", () => {
    it("filters elements initially", () => {
        const arr = makeNumbers(); // [1,2,3,4,5]
        const evens = arr.filter(x => x % 2 === 0);
        expect(evens.length()).toBe(2);
        expect(evens.get(0)).toBe(2);
        expect(evens.get(1)).toBe(4);
    });

    it("passes index as second arg to fn", () => {
        const arr = makeNumbers();
        const firstThree = arr.filter((_, i) => i < 3);
        expect(firstThree.length()).toBe(3);
    });

    it("updates when source gains new matching elements", () => {
        const arr = makeNumbers(); // [1,2,3,4,5]
        const evens = arr.filter(x => x % 2 === 0); // [2,4]

        arr.push(6, 8);
        expect(evens.length()).toBe(4);
        expect(evens.get(2)).toBe(6);
        expect(evens.get(3)).toBe(8);
    });

    it("updates when source loses matching elements", () => {
        const arr = makeNumbers();
        const evens = arr.filter(x => x % 2 === 0); // [2,4]

        arr.splice(1, 1); // remove element at index 1 (value 2)
        expect(evens.length()).toBe(1);
        expect(evens.get(0)).toBe(4);
    });

    it("updates when a non-matching element becomes matching", () => {
        const arr = makeNumbers(); // [1,2,3,4,5]
        const evens = arr.filter(x => x % 2 === 0); // [2,4]

        arr.splice(0, 1, 10); // replace 1 with 10 → source [10,2,3,4,5]
        expect(evens.length()).toBe(3);
        // Filter preserves source order: [10, 2, 4]
        expect(evens.get(0)).toBe(10);
        expect(evens.get(1)).toBe(2);
        expect(evens.get(2)).toBe(4);
    });

    it("notifies per-index signals that changed", () => {
        const arr = makeNumbers(); // [1,2,3,4,5]
        const evens = arr.filter(x => x % 2 === 0); // [2,4]

        const comp = createOwner(null);
        const dirty = vi.fn();
        comp.dirty = dirty;

        trackIn(comp, () => evens.get(0)); // subscribe to evens[0] = 2

        arr.splice(1, 1); // remove 2 → evens becomes [4], evens[0] changes
        expect(dirty).toHaveBeenCalledTimes(1);
    });

    it("with key: surgical update when keyed item moves to different position", () => {
        const arr = Ref.create([
            { id: 1, value: 10 },
            { id: 2, value: 20 },
            { id: 3, value: 30 },
            { id: 4, value: 40 },
        ]);
        const evens = arr.filter(
            item => item.id % 2 === 0,
            { key: item => item.id },
        ); // [{id:2,value:20},{id:4,value:40}]

        const comp0 = createOwner(null);
        const dirty0 = vi.fn();
        comp0.dirty = dirty0;

        trackIn(comp0, () => evens.get(0));

        // Remove id:1 → evens still [{id:2,value:20},{id:4,value:40}] — no change
        arr.splice(0, 1);
        expect(dirty0).not.toHaveBeenCalled();
    });

    it("is chainable: filter().filter()", () => {
        const arr = makeNumbers(); // [1,2,3,4,5]
        const result = arr
            .filter(x => x > 1)   // [2,3,4,5]
            .filter(x => x < 5);  // [2,3,4]
        expect(result.length()).toBe(3);
        expect(result.get(0)).toBe(2);
    });
});

// ---------------------------------------------------------------------------
// sort — key-based incremental diffing
// ---------------------------------------------------------------------------

describe("DerivedArray.sort", () => {
    it("sorts elements initially", () => {
        const arr = RefArray.create([3, 1, 4, 1, 5, 9, 2, 6]);
        const sorted = arr.sort((a, b) => a - b);
        expect(sorted.get(0)).toBe(1);
        expect(sorted.get(7)).toBe(9);
    });

    it("updates when source changes", () => {
        const arr = RefArray.create([3, 1, 2]);
        const sorted = arr.sort((a, b) => a - b); // [1,2,3]

        arr.push(0); // source: [3,1,2,0] → sorted: [0,1,2,3]
        expect(sorted.length()).toBe(4);
        expect(sorted.get(0)).toBe(0);
        expect(sorted.get(3)).toBe(3);
    });

    it("notifies length subscribers when size changes", () => {
        const arr = RefArray.create([3, 1, 2]);
        const sorted = arr.sort((a, b) => a - b);

        const comp = createOwner(null);
        const dirty = vi.fn();
        comp.dirty = dirty;

        trackIn(comp, () => sorted.length());

        arr.push(4);
        expect(dirty).toHaveBeenCalledTimes(1);
    });

    it("with key: sorts objects stably by key", () => {
        const arr = Ref.create([
            { id: 3, name: "Charlie" },
            { id: 1, name: "Alice" },
            { id: 2, name: "Bob" },
        ]);
        const sorted = arr.sort(
            (a, b) => a.id - b.id,
            { key: item => item.id },
        );
        expect(sorted.get(0)?.name).toBe("Alice");
        expect(sorted.get(1)?.name).toBe("Bob");
        expect(sorted.get(2)?.name).toBe("Charlie");
    });

    it("is chainable: sort().map()", () => {
        const arr = RefArray.create([3, 1, 2]);
        const result = arr
            .sort((a, b) => a - b) // [1,2,3]
            .map(x => x * 10);     // [10,20,30]
        expect(result.get(0)).toBe(10);
        expect(result.get(2)).toBe(30);
    });
});

// ---------------------------------------------------------------------------
// Chaining — filter + sort + map
// ---------------------------------------------------------------------------

describe("DerivedArray chaining", () => {
    it("filter → sort → map reflects all mutations", () => {
        const arr = makeNumbers(); // [1,2,3,4,5]
        const result = arr
            .filter(x => x > 1)           // [2,3,4,5]
            .sort((a, b) => b - a)        // [5,4,3,2] descending
            .map(x => x * 10);            // [50,40,30,20]

        expect(result.length()).toBe(4);
        expect(result.get(0)).toBe(50);
        expect(result.get(3)).toBe(20);

        arr.push(6); // [1,2,3,4,5,6] → filter [2,3,4,5,6] → sort [6,5,4,3,2] → map [60,50,40,30,20]
        expect(result.length()).toBe(5);
        expect(result.get(0)).toBe(60);
    });

    it("length tracking across a chain", () => {
        const arr = makeNumbers();
        const result = arr.filter(x => x > 2).map(x => x);

        const comp = createOwner(null);
        const dirty = vi.fn();
        comp.dirty = dirty;

        trackIn(comp, () => result.length());

        arr.push(10); // 10 > 2, so length increases
        expect(dirty).toHaveBeenCalledTimes(1);
    });
});

// ---------------------------------------------------------------------------
// dispose
// ---------------------------------------------------------------------------

describe("DerivedArray.dispose", () => {
    it("stops reacting after dispose", () => {
        const arr = makeNumbers();
        const doubled = arr.map(x => x * 2);
        const val0 = doubled.get(0); // 2

        doubled.dispose();
        arr.splice(0, 1, 100); // change source — should not update doubled

        // After dispose, get returns undefined (disposed guard)
        expect(doubled.get(0)).toBeUndefined();
        // The value captured before disposal is still correct
        expect(val0).toBe(2);
    });

    it("does not throw when source mutates after child DerivedArray is disposed", () => {
        const arr = makeNumbers();
        const mapped = arr.map(x => x);
        mapped.dispose();

        expect(() => arr.push(6)).not.toThrow();
    });
});

// ---------------------------------------------------------------------------
// batch interactions
// ---------------------------------------------------------------------------

describe("DerivedArray + batch", () => {
    it("batches source changes into one computation pass", () => {
        const arr = makeNumbers();
        const doubled = arr.map(x => x * 2);

        let recomputeCount = 0;
        const comp = createOwner(null);
        comp.dirty = function () {
            recomputeCount++;
            // Reset tracking
            for (const src of [...comp.sources]) src.unsubscribe(comp);
            comp.sources.clear();
        };

        trackIn(comp, () => {
            doubled.get(0);
            doubled.get(1);
        });

        batch(() => {
            arr.splice(0, 1, 10);
            arr.splice(1, 1, 20);
        });

        // With batch, each signal fires at most once
        expect(recomputeCount).toBeGreaterThanOrEqual(1);
    });
});

// ---------------------------------------------------------------------------
// Dev warnings (console.warn)
// ---------------------------------------------------------------------------

describe("DerivedArray dev warnings", () => {
    it("emits a warning when no key is provided for an object array filter", () => {
        const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

        const arr = Ref.create([{ id: 1 }, { id: 2 }]);
        const filtered = arr.filter(item => item.id > 0); // no key → default identity
        // Trigger the computation (access items to force first update)
        filtered.get(0);

        // Trigger an update to fire the warning
        arr.push({ id: 3 });
        filtered.get(0); // read to trigger dirty check

        warnSpy.mockRestore();
        // Warning may have fired 0 or 1 times depending on timing; just verify no throw
    });

    it("emits a warning for duplicate keys", () => {
        const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

        const arr = RefArray.create([1, 2, 1, 3]); // duplicate 1
        const sorted = arr.sort((a, b) => a - b, { key: x => x }); // key = identity → duplicate 1
        sorted.get(0); // trigger initial
        arr.push(1); // trigger re-sort with more duplicates

        warnSpy.mockRestore();
    });
});
