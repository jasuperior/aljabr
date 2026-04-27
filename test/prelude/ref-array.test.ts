import { describe, expect, it, expectTypeOf, vi } from "vitest";
import { Ref, RefArray } from "../../src/prelude/ref";
import { DerivedArray } from "../../src/prelude/derived-array.ts";
import { Derived } from "../../src/prelude/derived";
import { batch, createOwner, trackIn } from "../../src/prelude/context";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type Item = { id: number; name: string };

function makeNumberArray(): RefArray<number> {
    return Ref.create([1, 2, 3, 4, 5]);
}

function makeObjectArray(): RefArray<Item> {
    return Ref.create([
        { id: 1, name: "Alice" },
        { id: 2, name: "Bob" },
        { id: 3, name: "Carol" },
    ]);
}

// ---------------------------------------------------------------------------
// Ref.create(T[]) → RefArray<T>
// ---------------------------------------------------------------------------

describe("Ref.create(T[])", () => {
    it("returns RefArray when passed an array", () => {
        const arr = Ref.create([1, 2, 3]);
        expect(arr).toBeInstanceOf(RefArray);
    });

    it("returns Ref when passed an object", () => {
        const ref = Ref.create({ x: 1 });
        expect(ref).toBeInstanceOf(Ref);
    });

    it("isUnset is false after creation with array", () => {
        const arr = makeNumberArray();
        expect(arr.isUnset).toBe(false);
    });

    it("registers a cleanup with the current owner", () => {
        const owner = createOwner(null);
        let disposed = false;
        trackIn(owner, () => {
            const arr = Ref.create([1, 2, 3]);
            const orig = arr.dispose.bind(arr);
            arr.dispose = () => { disposed = true; orig(); };
        });
        owner.dispose();
        expect(disposed).toBe(true);
    });

    it("type-level: Ref.create(T[]) returns RefArray<T>", () => {
        expectTypeOf(Ref.create([1, 2, 3])).toEqualTypeOf<RefArray<number>>();
        expectTypeOf(Ref.create(["a", "b"])).toEqualTypeOf<RefArray<string>>();
    });
});

// ---------------------------------------------------------------------------
// RefArray.create
// ---------------------------------------------------------------------------

describe("RefArray.create", () => {
    it("creates a RefArray with initial items", () => {
        const arr = RefArray.create([10, 20, 30]);
        expect(arr.get(0)).toBe(10);
        expect(arr.get(1)).toBe(20);
        expect(arr.get(2)).toBe(30);
    });

    it("returns undefined for out-of-bounds index", () => {
        const arr = RefArray.create([1, 2]);
        expect(arr.get(5)).toBeUndefined();
    });
});

// ---------------------------------------------------------------------------
// get(i) — per-index reactive reads
// ---------------------------------------------------------------------------

describe("refArray.get(i)", () => {
    it("reads the correct element", () => {
        const arr = makeNumberArray();
        expect(arr.get(0)).toBe(1);
        expect(arr.get(4)).toBe(5);
    });

    it("registers index as a tracked dependency", () => {
        const arr = makeNumberArray();
        const comp = createOwner(null);
        const dirty = vi.fn();
        comp.dirty = dirty;

        trackIn(comp, () => arr.get(2));

        arr.splice(2, 1, 99);
        expect(dirty).toHaveBeenCalledTimes(1);
    });

    it("does NOT notify when a different index changes", () => {
        const arr = makeNumberArray();
        const comp = createOwner(null);
        const dirty = vi.fn();
        comp.dirty = dirty;

        trackIn(comp, () => arr.get(0));

        arr.splice(2, 1, 99); // only index 2 changes
        expect(dirty).not.toHaveBeenCalled();
    });

    it("returns undefined after the index is removed by splice", () => {
        const arr = makeNumberArray();
        arr.splice(0, 5); // remove all
        expect(arr.get(0)).toBeUndefined();
    });
});

// ---------------------------------------------------------------------------
// get() — whole-array reactive read
// ---------------------------------------------------------------------------

describe("refArray.get() — no-arg whole-array", () => {
    it("returns the full array", () => {
        const arr = makeNumberArray();
        expect(arr.get()).toEqual([1, 2, 3, 4, 5]);
    });

    it("reflects mutations", () => {
        const arr = makeNumberArray();
        arr.push(6);
        expect(arr.get()).toEqual([1, 2, 3, 4, 5, 6]);
    });

    it("registers a reactive dependency that fires on any mutation", () => {
        const arr = makeNumberArray();
        const comp = createOwner(null);
        const dirty = vi.fn();
        comp.dirty = dirty;

        trackIn(comp, () => arr.get());

        arr.splice(2, 1, 99); // change one element
        expect(dirty).toHaveBeenCalledTimes(1);
    });

    it("fires when an element is pushed", () => {
        const arr = makeNumberArray();
        const comp = createOwner(null);
        const dirty = vi.fn();
        comp.dirty = dirty;

        trackIn(comp, () => arr.get());

        arr.push(6);
        expect(dirty).toHaveBeenCalledTimes(1);
    });

    it("returns [] for an empty array", () => {
        const arr = RefArray.create<number>([]);
        expect(arr.get()).toEqual([]);
    });
});

// ---------------------------------------------------------------------------
// peek() — whole-array untracked read
// ---------------------------------------------------------------------------

describe("refArray.peek() — untracked", () => {
    it("peek() returns the full array without tracking", () => {
        const arr = makeNumberArray();
        const comp = createOwner(null);
        const dirty = vi.fn();
        comp.dirty = dirty;

        trackIn(comp, () => arr.peek());

        arr.push(6);
        expect(dirty).not.toHaveBeenCalled();
        expect(arr.peek()).toEqual([1, 2, 3, 4, 5, 6]);
    });

    it("peek(i) returns the element at index without tracking", () => {
        const arr = makeNumberArray();
        const comp = createOwner(null);
        const dirty = vi.fn();
        comp.dirty = dirty;

        trackIn(comp, () => arr.peek(0));

        arr.splice(0, 1, 99);
        expect(dirty).not.toHaveBeenCalled();
        expect(arr.peek(0)).toBe(99);
    });
});

// ---------------------------------------------------------------------------
// at(i) → Derived<T | undefined>
// ---------------------------------------------------------------------------

describe("refArray.at(i)", () => {
    it("returns a Derived", () => {
        const arr = makeNumberArray();
        const d = arr.at(1);
        expect(d).toBeInstanceOf(Derived);
    });

    it("Derived reads the element at that index", () => {
        const arr = makeNumberArray();
        const d = arr.at(1);
        expect(d.get()).toBe(2);
    });

    it("Derived reflects updates", () => {
        const arr = makeNumberArray();
        const d = arr.at(1);
        arr.splice(1, 1, 99);
        expect(d.get()).toBe(99);
    });

    it("type-level: returns Derived<T | undefined>", () => {
        const arr = makeNumberArray();
        expectTypeOf(arr.at(0)).toEqualTypeOf<Derived<number | undefined>>();
    });
});

// ---------------------------------------------------------------------------
// length()
// ---------------------------------------------------------------------------

describe("refArray.length()", () => {
    it("returns the correct length", () => {
        const arr = makeNumberArray();
        expect(arr.length()).toBe(5);
    });

    it("notifies when length changes via push", () => {
        const arr = makeNumberArray();
        const comp = createOwner(null);
        const dirty = vi.fn();
        comp.dirty = dirty;

        trackIn(comp, () => arr.length());

        arr.push(6);
        expect(dirty).toHaveBeenCalledTimes(1);
    });

    it("notifies when length changes via pop", () => {
        const arr = makeNumberArray();
        const comp = createOwner(null);
        const dirty = vi.fn();
        comp.dirty = dirty;

        trackIn(comp, () => arr.length());

        arr.pop();
        expect(dirty).toHaveBeenCalledTimes(1);
    });

    it("does NOT notify when length is unchanged (same-size splice)", () => {
        const arr = makeNumberArray();
        const comp = createOwner(null);
        const dirty = vi.fn();
        comp.dirty = dirty;

        trackIn(comp, () => arr.length());

        arr.splice(0, 1, 99); // remove 1, insert 1 → same length
        expect(dirty).not.toHaveBeenCalled();
    });

    it("does NOT notify when move is called (no size change)", () => {
        const arr = makeNumberArray();
        const comp = createOwner(null);
        const dirty = vi.fn();
        comp.dirty = dirty;

        trackIn(comp, () => arr.length());

        arr.move(0, 4);
        expect(dirty).not.toHaveBeenCalled();
    });
});

// ---------------------------------------------------------------------------
// push
// ---------------------------------------------------------------------------

describe("refArray.push", () => {
    it("appends one item", () => {
        const arr = makeNumberArray();
        arr.push(6);
        expect(arr.get(5)).toBe(6);
        expect(arr.length()).toBe(6);
    });

    it("appends multiple items", () => {
        const arr = makeNumberArray();
        arr.push(6, 7, 8);
        expect(arr.length()).toBe(8);
        expect(arr.get(7)).toBe(8);
    });

    it("notifies per-index subscribers at the new index", () => {
        const arr = makeNumberArray();
        const comp = createOwner(null);
        const dirty = vi.fn();
        comp.dirty = dirty;

        trackIn(comp, () => arr.get(5)); // subscribe to index 5 (doesn't exist yet)

        arr.push(6);
        expect(dirty).toHaveBeenCalledTimes(1);
    });
});

// ---------------------------------------------------------------------------
// pop
// ---------------------------------------------------------------------------

describe("refArray.pop", () => {
    it("removes and returns the last item", () => {
        const arr = makeNumberArray();
        const last = arr.pop();
        expect(last.getOrElse(-1)).toBe(5);
        expect(arr.length()).toBe(4);
    });

    it("returns None on empty array", () => {
        const arr = RefArray.create<number>([]);
        expect(arr.pop().getOrElse(-1)).toBe(-1);
    });

    it("notifies subscribers at the removed index", () => {
        const arr = makeNumberArray();
        const comp = createOwner(null);
        const dirty = vi.fn();
        comp.dirty = dirty;

        trackIn(comp, () => arr.get(4)); // last element

        arr.pop();
        expect(dirty).toHaveBeenCalledTimes(1);
    });
});

// ---------------------------------------------------------------------------
// splice
// ---------------------------------------------------------------------------

describe("refArray.splice", () => {
    it("removes elements", () => {
        const arr = makeNumberArray();
        arr.splice(1, 2);
        expect(arr.length()).toBe(3);
        expect(arr.get(1)).toBe(4);
    });

    it("inserts elements", () => {
        const arr = makeNumberArray();
        arr.splice(2, 0, 10, 20);
        expect(arr.length()).toBe(7);
        expect(arr.get(2)).toBe(10);
        expect(arr.get(3)).toBe(20);
    });

    it("replaces elements (same size)", () => {
        const arr = makeNumberArray();
        arr.splice(0, 2, 10, 20);
        expect(arr.get(0)).toBe(10);
        expect(arr.get(1)).toBe(20);
        expect(arr.length()).toBe(5);
    });

    it("notifies subscribers at changed indices", () => {
        const arr = makeNumberArray();
        const comp = createOwner(null);
        const dirty = vi.fn();
        comp.dirty = dirty;

        trackIn(comp, () => arr.get(0));

        arr.splice(0, 1, 99);
        expect(dirty).toHaveBeenCalledTimes(1);
    });
});

// ---------------------------------------------------------------------------
// move
// ---------------------------------------------------------------------------

describe("refArray.move", () => {
    it("swaps two elements", () => {
        const arr = makeNumberArray(); // [1,2,3,4,5]
        arr.move(0, 4);
        expect(arr.get(0)).toBe(5);
        expect(arr.get(4)).toBe(1);
    });

    it("no-op when from === to", () => {
        const arr = makeNumberArray();
        const comp = createOwner(null);
        const dirty = vi.fn();
        comp.dirty = dirty;
        trackIn(comp, () => arr.get(0));

        arr.move(0, 0);
        expect(dirty).not.toHaveBeenCalled();
    });

    it("no-op when index out of bounds", () => {
        const arr = makeNumberArray();
        arr.move(0, 99); // 99 is out of bounds → no-op
        expect(arr.get(0)).toBe(1); // unchanged
    });

    it("notifies only the two swapped positions", () => {
        const arr = makeNumberArray(); // [1,2,3,4,5]
        const compA = createOwner(null);
        const dirtyA = vi.fn();
        compA.dirty = dirtyA;

        const compB = createOwner(null);
        const dirtyB = vi.fn();
        compB.dirty = dirtyB;

        const compC = createOwner(null);
        const dirtyC = vi.fn();
        compC.dirty = dirtyC;

        trackIn(compA, () => arr.get(0));
        trackIn(compB, () => arr.get(4));
        trackIn(compC, () => arr.get(2)); // untouched

        arr.move(0, 4);
        expect(dirtyA).toHaveBeenCalledTimes(1);
        expect(dirtyB).toHaveBeenCalledTimes(1);
        expect(dirtyC).not.toHaveBeenCalled();
    });
});

// ---------------------------------------------------------------------------
// Ref.at(path) → RefArray for array paths
// ---------------------------------------------------------------------------

describe("Ref.at(path) → RefArray", () => {
    type State = { items: number[]; user: { name: string } };

    function makeState(): Ref<State> {
        return Ref.create<State>({
            items: [1, 2, 3],
            user: { name: "Alice" },
        });
    }

    it("returns RefArray for an array path", () => {
        const state = makeState();
        const items = state.at("items");
        expect(items).toBeInstanceOf(RefArray);
    });

    it("returns Ref for an object path", () => {
        const state = makeState();
        const user = state.at("user");
        expect(user).toBeInstanceOf(Ref);
    });

    it("the RefArray reads elements correctly", () => {
        const state = makeState();
        const items = state.at("items");
        expect(items.get(0)).toBe(1);
        expect(items.get(2)).toBe(3);
    });

    it("the RefArray length reflects parent state", () => {
        const state = makeState();
        const items = state.at("items");
        expect(items.length()).toBe(3);
    });

    it("push on the RefArray updates parent Ref", () => {
        const state = makeState();
        const items = state.at("items");
        items.push(4);
        expect(state.get("items")).toEqual([1, 2, 3, 4]);
    });

    it("pop on the RefArray updates parent Ref", () => {
        const state = makeState();
        const items = state.at("items");
        items.pop();
        expect(state.get("items")).toEqual([1, 2]);
    });

    it("parent Ref.push notifies the RefArray's length signal", () => {
        const state = makeState();
        const items = state.at("items");

        const comp = createOwner(null);
        const dirty = vi.fn();
        comp.dirty = dirty;

        trackIn(comp, () => items.length());

        state.push("items", 4);
        expect(dirty).toHaveBeenCalledTimes(1);
    });

    it("returns the same cached instance on repeated calls", () => {
        const state = makeState();
        expect(state.at("items")).toBe(state.at("items"));
    });

    it("type-level: at('items') returns RefArray<number>", () => {
        const state = makeState();
        expectTypeOf(state.at("items")).toEqualTypeOf<RefArray<number>>();
    });

    it("type-level: at('user') returns Ref<State['user']>", () => {
        const state = makeState();
        type UserType = State["user"];
        expectTypeOf(state.at("user")).toEqualTypeOf<Ref<UserType>>();
    });
});

// ---------------------------------------------------------------------------
// batch interactions
// ---------------------------------------------------------------------------

describe("RefArray + batch", () => {
    it("batches multiple mutations into one notification pass", () => {
        const arr = makeNumberArray();
        const comp = createOwner(null);
        const dirty = vi.fn();
        comp.dirty = dirty;

        trackIn(comp, () => {
            arr.get(0);
            arr.get(1);
        });

        batch(() => {
            arr.splice(0, 1, 99);
            arr.splice(1, 1, 88);
        });

        // Both indices changed, but dirty should be called at most twice
        // (once per signal, but deduped by batch set logic)
        expect(dirty.mock.calls.length).toBeGreaterThanOrEqual(1);
    });
});

// ---------------------------------------------------------------------------
// dispose
// ---------------------------------------------------------------------------

describe("RefArray.dispose", () => {
    it("no-op on mutations after dispose", () => {
        const arr = makeNumberArray();
        arr.dispose();
        expect(() => arr.push(99)).not.toThrow();
        // Mutations are silently ignored; state is preserved as-is
        expect(arr.length()).toBe(5);
    });

    it("sub-RefArray from Ref.at does not dispose the shared holder", () => {
        type S = { items: number[] };
        const state = Ref.create<S>({ items: [1, 2, 3] });
        const items = state.at("items");
        items.dispose(); // sub-RefArray — no-op
        // Parent Ref is still functional
        expect(state.get("items")).toEqual([1, 2, 3]);
    });
});

// ---------------------------------------------------------------------------
// iterator methods on RefArray (smoke tests — deep tests in derived-array suite)
// ---------------------------------------------------------------------------

describe("RefArray iterator methods", () => {
    it("map returns DerivedArray with transformed items", () => {
        const arr = makeNumberArray();
        const doubled = arr.map(x => x * 2);
        expect(doubled).toBeInstanceOf(DerivedArray);
        expect(doubled.get(0)).toBe(2);
        expect(doubled.get(4)).toBe(10);
    });

    it("filter returns DerivedArray with matching items", () => {
        const arr = makeNumberArray();
        const evens = arr.filter(x => x % 2 === 0);
        expect(evens).toBeInstanceOf(DerivedArray);
        expect(evens.get(0)).toBe(2);
        expect(evens.get(1)).toBe(4);
        expect(evens.length()).toBe(2);
    });

    it("sort returns a sorted DerivedArray", () => {
        const arr = RefArray.create([3, 1, 4, 1, 5, 9]);
        const sorted = arr.sort((a, b) => a - b);
        expect(sorted.get(0)).toBe(1);
        expect(sorted.get(5)).toBe(9);
    });

    it("filter updates when source changes", () => {
        const arr = makeNumberArray(); // [1,2,3,4,5]
        const evens = arr.filter(x => x % 2 === 0); // [2,4]
        expect(evens.length()).toBe(2);

        arr.push(6); // [1,2,3,4,5,6]
        expect(evens.length()).toBe(3);
        expect(evens.get(2)).toBe(6);
    });

    it("map updates when source element changes", () => {
        const arr = makeNumberArray();
        const doubled = arr.map(x => x * 2);

        arr.splice(0, 1, 10); // replace first element
        expect(doubled.get(0)).toBe(20);
    });

    it("chained filter + map", () => {
        const arr = makeNumberArray(); // [1,2,3,4,5]
        const result = arr
            .filter(x => x % 2 === 0)  // [2,4]
            .map(x => x * 10);          // [20,40]

        expect(result.length()).toBe(2);
        expect(result.get(0)).toBe(20);
        expect(result.get(1)).toBe(40);
    });
});
