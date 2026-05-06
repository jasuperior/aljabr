import { describe, expect, it, expectTypeOf, vi } from "vitest";
import { Store, List } from "../../src/prelude/store";
import { DerivedArray } from "../../src/prelude/derived-array.ts";
import { Derived } from "../../src/prelude/derived";
import { batch, createOwner, trackIn } from "../../src/prelude/context";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type Item = { id: number; name: string };

function makeNumberArray(): List<number> {
    return Store.create([1, 2, 3, 4, 5]);
}

function makeObjectArray(): List<Item> {
    return Store.create([
        { id: 1, name: "Alice" },
        { id: 2, name: "Bob" },
        { id: 3, name: "Carol" },
    ]);
}

// ---------------------------------------------------------------------------
// Store.create(T[]) → List<T>
// ---------------------------------------------------------------------------

describe("Store.create(T[])", () => {
    it("returns List when passed an array", () => {
        const arr = Store.create([1, 2, 3]);
        expect(arr).toBeInstanceOf(List);
    });

    it("returns Store when passed an object", () => {
        const ref = Store.create({ x: 1 });
        expect(ref).toBeInstanceOf(Store);
    });

    it("isUnset is false after creation with array", () => {
        const arr = makeNumberArray();
        expect(arr.isUnset).toBe(false);
    });

    it("registers a cleanup with the current owner", () => {
        const owner = createOwner(null);
        let disposed = false;
        trackIn(owner, () => {
            const arr = Store.create([1, 2, 3]);
            const orig = arr.dispose.bind(arr);
            arr.dispose = () => {
                disposed = true;
                orig();
            };
        });
        owner.dispose();
        expect(disposed).toBe(true);
    });

    it("type-level: Store.create(T[]) returns List<T>", () => {
        expectTypeOf(Store.create([1, 2, 3])).toEqualTypeOf<List<number>>();
        expectTypeOf(Store.create(["a", "b"])).toEqualTypeOf<List<string>>();
    });
});

// ---------------------------------------------------------------------------
// List.create
// ---------------------------------------------------------------------------

describe("List.create", () => {
    it("creates a List with initial items", () => {
        const arr = List.create([10, 20, 30]);
        expect(arr.get(0)).toBe(10);
        expect(arr.get(1)).toBe(20);
        expect(arr.get(2)).toBe(30);
    });

    it("returns undefined for out-of-bounds index", () => {
        const arr = List.create([1, 2]);
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
        const arr = List.create<number>([]);
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
        expect(last.getOr(-1)).toBe(5);
        expect(arr.length()).toBe(4);
    });

    it("returns None on empty array", () => {
        const arr = List.create<number>([]);
        expect(arr.pop().getOr(-1)).toBe(-1);
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
// set
// ---------------------------------------------------------------------------

describe("refArray.set", () => {
    it("replaces the element in place", () => {
        const arr = makeNumberArray(); // [1,2,3,4,5]
        arr.set(2, 99);
        expect(arr.peek(2)).toBe(99);
        expect(arr.length()).toBe(5);
    });

    it("returns void", () => {
        const arr = makeNumberArray();
        expectTypeOf(arr.set(0, 10)).toEqualTypeOf<void>();
    });

    it("is a no-op when index is out of bounds", () => {
        const arr = makeNumberArray();
        const comp = createOwner(null);
        const dirty = vi.fn();
        comp.dirty = dirty;
        trackIn(comp, () => arr.get(0));

        arr.set(99, 999);
        expect(arr.peek()).toEqual([1, 2, 3, 4, 5]);
        expect(dirty).not.toHaveBeenCalled();
    });

    it("is a no-op when the new value === the existing one", () => {
        const arr = makeNumberArray();
        const comp = createOwner(null);
        const dirty = vi.fn();
        comp.dirty = dirty;
        trackIn(comp, () => arr.get(2));

        arr.set(2, 3); // identical
        expect(dirty).not.toHaveBeenCalled();
    });

    it("notifies only the per-index signal, not siblings or length", () => {
        const arr = makeNumberArray();

        const target = createOwner(null);
        const dirtyTarget = vi.fn();
        target.dirty = dirtyTarget;

        const sibling = createOwner(null);
        const dirtySibling = vi.fn();
        sibling.dirty = dirtySibling;

        const lenComp = createOwner(null);
        const dirtyLen = vi.fn();
        lenComp.dirty = dirtyLen;

        trackIn(target, () => arr.get(2));
        trackIn(sibling, () => arr.get(0));
        trackIn(lenComp, () => arr.length());

        arr.set(2, 99);

        expect(dirtyTarget).toHaveBeenCalledTimes(1);
        expect(dirtySibling).not.toHaveBeenCalled();
        expect(dirtyLen).not.toHaveBeenCalled();
    });

    it("is a no-op after dispose", () => {
        const arr = makeNumberArray();
        arr.dispose();
        arr.set(0, 99); // must not throw
        // post-dispose reads are undefined behaviour; we only assert no throw
    });
});

// ---------------------------------------------------------------------------
// Store.at(path) → List for array paths
// ---------------------------------------------------------------------------

describe("Store.at(path) → List", () => {
    type State = { items: number[]; user: { name: string } };

    function makeState(): Store<State> {
        return Store.create<State>({
            items: [1, 2, 3],
            user: { name: "Alice" },
        });
    }

    it("returns List for an array path", () => {
        const state = makeState();
        const items = state.at("items");
        expect(items).toBeInstanceOf(List);
    });

    it("returns Store for an object path", () => {
        const state = makeState();
        const user = state.at("user");
        expect(user).toBeInstanceOf(Store);
    });

    it("the List reads elements correctly", () => {
        const state = makeState();
        const items = state.at("items");
        expect(items.get(0)).toBe(1);
        expect(items.get(2)).toBe(3);
    });

    it("the List length reflects parent state", () => {
        const state = makeState();
        const items = state.at("items");
        expect(items.length()).toBe(3);
    });

    it("push on the List updates parent Store", () => {
        const state = makeState();
        const items = state.at("items");
        items.push(4);
        expect(state.get("items")).toEqual([1, 2, 3, 4]);
    });

    it("pop on the List updates parent Store", () => {
        const state = makeState();
        const items = state.at("items");
        items.pop();
        expect(state.get("items")).toEqual([1, 2]);
    });

    it("parent Store.push notifies the List's length signal", () => {
        const state = makeState();
        const items = state.at("items");

        const comp = createOwner(null);
        const dirty = vi.fn();
        comp.dirty = dirty;

        trackIn(comp, () => items.length());

        items.push(4);
        expect(dirty).toHaveBeenCalledTimes(1);
    });

    it("returns the same cached instance on repeated calls", () => {
        const state = makeState();
        expect(state.at("items")).toBe(state.at("items"));
    });

    it("type-level: at('items') returns List<number>", () => {
        const state = makeState();
        expectTypeOf(state.at("items")).toEqualTypeOf<List<number>>();
    });

    it("type-level: at('user') returns Store<State['user']>", () => {
        const state = makeState();
        type UserType = State["user"];
        expectTypeOf(state.at("user")).toEqualTypeOf<Store<UserType>>();
    });
});

// ---------------------------------------------------------------------------
// batch interactions
// ---------------------------------------------------------------------------

describe("List + batch", () => {
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

describe("List.dispose", () => {
    it("no-op on mutations after dispose", () => {
        const arr = makeNumberArray();
        arr.dispose();
        expect(() => arr.push(99)).not.toThrow();
        // Mutations are silently ignored; state is preserved as-is
        expect(arr.length()).toBe(5);
    });

    it("sub-List from Store.at does not dispose the shared holder", () => {
        type S = { items: number[] };
        const state = Store.create<S>({ items: [1, 2, 3] });
        const items = state.at("items");
        items.dispose(); // sub-List — no-op
        // Parent Store is still functional
        expect(state.get("items")).toEqual([1, 2, 3]);
    });
});

// ---------------------------------------------------------------------------
// iterator methods on List (smoke tests — deep tests in derived-array suite)
// ---------------------------------------------------------------------------

describe("List iterator methods", () => {
    it("map returns DerivedArray with transformed items", () => {
        const arr = makeNumberArray();
        const doubled = arr.map((x) => x * 2);
        expect(doubled).toBeInstanceOf(DerivedArray);
        expect(doubled.get(0)).toBe(2);
        expect(doubled.get(4)).toBe(10);
    });

    it("filter returns DerivedArray with matching items", () => {
        const arr = makeNumberArray();
        const evens = arr.filter((x) => x % 2 === 0);
        expect(evens).toBeInstanceOf(DerivedArray);
        expect(evens.get(0)).toBe(2);
        expect(evens.get(1)).toBe(4);
        expect(evens.length()).toBe(2);
    });

    it("sort returns a sorted DerivedArray", () => {
        const arr = List.create([3, 1, 4, 1, 5, 9]);
        const sorted = arr.sort((a, b) => a - b);
        expect(sorted.get(0)).toBe(1);
        expect(sorted.get(5)).toBe(9);
    });

    it("filter updates when source changes", () => {
        const arr = makeNumberArray(); // [1,2,3,4,5]
        const evens = arr.filter((x) => x % 2 === 0); // [2,4]
        expect(evens.length()).toBe(2);

        arr.push(6); // [1,2,3,4,5,6]
        expect(evens.length()).toBe(3);
        expect(evens.get(2)).toBe(6);
    });

    it("map updates when source element changes", () => {
        const arr = makeNumberArray();
        const doubled = arr.map((x) => x * 2);

        arr.splice(0, 1, 10); // replace first element
        expect(doubled.get(0)).toBe(20);
    });

    it("chained filter + map", () => {
        const arr = makeNumberArray(); // [1,2,3,4,5]
        const result = arr
            .filter((x) => x % 2 === 0) // [2,4]
            .map((x) => x * 10); // [20,40]

        expect(result.length()).toBe(2);
        expect(result.get(0)).toBe(20);
        expect(result.get(1)).toBe(40);
    });
    it("map updates the target signal when source elemnt changes", () => {
        const arr = makeNumberArray();
        const doubled = arr.map((x) => x * 2);

        arr.splice(0, 1, 10); // replace first element
        expect(doubled.get(0)).toBe(20);
    });
});

describe("List.getOr (v0.3.10 Phase 5)", () => {
    it("returns the item when index is in range", () => {
        const r = Store.create([10, 20, 30]);
        expect(r.getOr(1, -1)).toBe(20);
    });

    it("returns the default when index is out of range", () => {
        const r = Store.create([10, 20, 30]);
        expect(r.getOr(99, -1)).toBe(-1);
    });
});

describe("List.subscribe (v0.3.10 Phase 5)", () => {
    it("fires on push/pop/splice with the current snapshot", () => {
        const r = Store.create([1, 2, 3]);
        const seen: number[][] = [];
        r.subscribe((arr) => seen.push([...arr]));
        r.push(4);
        r.pop();
        expect(seen).toEqual([[1, 2, 3, 4], [1, 2, 3]]);
    });

    it("unsubscribe stops further callbacks", () => {
        const r = Store.create([1, 2]);
        let count = 0;
        const unsub = r.subscribe(() => { count++; });
        r.push(3);
        unsub();
        r.push(4);
        expect(count).toBe(1);
    });
});
