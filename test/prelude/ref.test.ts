import { describe, expect, it, expectTypeOf, vi } from "vitest";
import { Ref, type PathValue } from "../../src/prelude/ref";
import { Signal } from "../../src/prelude/signal";
import { Derived } from "../../src/prelude/derived";
import { Option, type Some, type None } from "../../src/prelude/option";
import { getTag } from "../../src/union";
import { batch, createOwner, trackIn } from "../../src/prelude/context";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type State = {
    user: { name: string; age: number };
    scores: number[];
    active: boolean;
};

function makeState(): Ref<State> {
    return Ref.create<State>({
        user: { name: "Alice", age: 30 },
        scores: [1, 2, 3],
        active: true,
    });
}

// ---------------------------------------------------------------------------
// Creation
// ---------------------------------------------------------------------------

describe("Ref.create", () => {
    it("creates an active Ref with an initial value", () => {
        const ref = makeState();
        expect(ref.isUnset).toBe(false);
        expect(ref.get("user.name")).toBe("Alice");
    });

    it("creates an Unset Ref when called with no argument", () => {
        const ref = Ref.create<State>();
        expect(ref.isUnset).toBe(true);
    });

    it("get returns undefined on an Unset Ref", () => {
        const ref = Ref.create<State>();
        expect(ref.get("active")).toBeUndefined();
    });

    it("registers a cleanup with the current owner", () => {
        const owner = createOwner(null);
        let disposed = false;

        trackIn(owner, () => {
            const ref = Ref.create({ x: 1 });
            // Monkey-patch the dispose to observe it
            const orig = ref.dispose.bind(ref);
            ref.dispose = () => {
                disposed = true;
                orig();
            };
        });

        owner.dispose();
        expect(disposed).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// get
// ---------------------------------------------------------------------------

describe("ref.get", () => {
    it("reads a top-level path", () => {
        const ref = makeState();
        expect(ref.get("active")).toBe(true);
    });

    it("reads a nested path", () => {
        const ref = makeState();
        expect(ref.get("user.name")).toBe("Alice");
        expect(ref.get("user.age")).toBe(30);
    });

    it("reads an array index path", () => {
        const ref = makeState();
        expect(ref.get("scores.0")).toBe(1);
        expect(ref.get("scores.2")).toBe(3);
    });

    it("registers only the accessed path as a dependency", () => {
        const ref = makeState();
        const comp = createOwner(null);
        const dirty = vi.fn();
        comp.dirty = dirty;

        trackIn(comp, () => ref.get("user.name"));

        ref.set("user.name", "Bob");
        expect(dirty).toHaveBeenCalledTimes(1);
    });

    it("a change to an unread path does not dirty the computation", () => {
        const ref = makeState();
        const comp = createOwner(null);
        const dirty = vi.fn();
        comp.dirty = dirty;

        trackIn(comp, () => ref.get("user.name"));

        // Change a completely different path — should not notify
        ref.set("user.age", 99);
        expect(dirty).not.toHaveBeenCalled();
    });

    it("does not dirty a comp watching user.name when scores changes", () => {
        const ref = makeState();
        const comp = createOwner(null);
        const dirty = vi.fn();
        comp.dirty = dirty;

        trackIn(comp, () => ref.get("user.name"));

        ref.set("scores", [10, 20]);
        expect(dirty).not.toHaveBeenCalled();
    });
});

// ---------------------------------------------------------------------------
// get() — whole-object reactive read
// ---------------------------------------------------------------------------

describe("ref.get() — no-arg whole-object", () => {
    it("returns the full object", () => {
        const ref = makeState();
        const val = ref.get();
        expect(val?.user.name).toBe("Alice");
        expect(val?.scores).toEqual([1, 2, 3]);
    });

    it("reflects any mutation", () => {
        const ref = makeState();
        ref.set("user.name", "Bob");
        expect(ref.get()?.user.name).toBe("Bob");
    });

    it("registers a dependency that fires on any path change", () => {
        const ref = makeState();
        const comp = createOwner(null);
        const dirty = vi.fn();
        comp.dirty = dirty;

        trackIn(comp, () => ref.get());

        ref.set("user.age", 99);
        expect(dirty).toHaveBeenCalledTimes(1);
    });

    it("returns undefined when Ref is unset", () => {
        const ref = Ref.create<{ x: number }>();
        expect(ref.get()).toBeUndefined();
    });
});

// ---------------------------------------------------------------------------
// peek() — whole-object untracked read
// ---------------------------------------------------------------------------

describe("ref.peek() — untracked", () => {
    it("peek() returns the full object without tracking", () => {
        const ref = makeState();
        const comp = createOwner(null);
        const dirty = vi.fn();
        comp.dirty = dirty;

        trackIn(comp, () => ref.peek());

        ref.set("user.name", "Bob");
        expect(dirty).not.toHaveBeenCalled();
        expect(ref.peek()?.user.name).toBe("Bob");
    });

    it("peek(path) returns the value at path without tracking", () => {
        const ref = makeState();
        const comp = createOwner(null);
        const dirty = vi.fn();
        comp.dirty = dirty;

        trackIn(comp, () => ref.peek("user.name"));

        ref.set("user.name", "Bob");
        expect(dirty).not.toHaveBeenCalled();
        expect(ref.peek("user.name")).toBe("Bob");
    });
});

// ---------------------------------------------------------------------------
// set
// ---------------------------------------------------------------------------

describe("ref.set", () => {
    it("updates the value at a top-level path", () => {
        const ref = makeState();
        ref.set("active", false);
        expect(ref.get("active")).toBe(false);
    });

    it("updates a nested path without touching siblings", () => {
        const ref = makeState();
        ref.set("user.name", "Bob");
        expect(ref.get("user.name")).toBe("Bob");
        expect(ref.get("user.age")).toBe(30); // sibling unchanged
    });

    it("does not notify when value is reference-equal", () => {
        const ref = makeState();
        const comp = createOwner(null);
        const dirty = vi.fn();
        comp.dirty = dirty;

        trackIn(comp, () => ref.get("active"));

        ref.set("active", true); // same value
        expect(dirty).not.toHaveBeenCalled();
    });

    it("notifies a computation watching an ancestor path", () => {
        const ref = makeState();
        const comp = createOwner(null);
        const dirty = vi.fn();
        comp.dirty = dirty;

        trackIn(comp, () => ref.get("user")); // watching whole user object

        ref.set("user.name", "Bob");
        expect(dirty).toHaveBeenCalledTimes(1);
    });

    it("notifies a computation watching a descendant path", () => {
        const ref = makeState();
        const comp = createOwner(null);
        const dirty = vi.fn();
        comp.dirty = dirty;

        trackIn(comp, () => ref.get("user.name")); // watching leaf

        ref.set("user", { name: "Bob", age: 99 }); // setting ancestor
        expect(dirty).toHaveBeenCalledTimes(1);
    });

    it("transitions an Unset Ref to active on first set", () => {
        const ref = Ref.create<State>();
        expect(ref.isUnset).toBe(true);
        ref.set("active", false);
        expect(ref.isUnset).toBe(false);
        expect(ref.get("active")).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// patch
// ---------------------------------------------------------------------------

describe("ref.patch", () => {
    it("updates the ref state with deep changes", () => {
        const ref = makeState();
        ref.patch("user", { name: "Bob", age: 30 });
        expect(ref.get("user.name")).toBe("Bob");
        expect(ref.get("user.age")).toBe(30);
    });

    it("only notifies signals at changed leaf paths", () => {
        const ref = makeState();

        const nameComp = createOwner(null);
        const nameDirty = vi.fn();
        nameComp.dirty = nameDirty;

        const ageComp = createOwner(null);
        const ageDirty = vi.fn();
        ageComp.dirty = ageDirty;

        trackIn(nameComp, () => ref.get("user.name"));
        trackIn(ageComp, () => ref.get("user.age"));

        // Only name changes
        ref.patch("user", { name: "Bob", age: 30 });

        expect(nameDirty).toHaveBeenCalledTimes(1);
        expect(ageDirty).not.toHaveBeenCalled();
    });

    it("skips unchanged sub-trees via reference equality", () => {
        const scores = [1, 2, 3];
        const ref = Ref.create({ user: { name: "Alice" }, scores });

        const scoresComp = createOwner(null);
        const scoresDirty = vi.fn();
        scoresComp.dirty = scoresDirty;

        trackIn(scoresComp, () => ref.get("scores"));

        // Pass the same scores reference — should not notify
        ref.patch("scores", scores);
        expect(scoresDirty).not.toHaveBeenCalled();
    });

    it("does not notify when root value is reference-equal", () => {
        const user = { name: "Alice", age: 30 };
        const ref = Ref.create({ user });

        const comp = createOwner(null);
        const dirty = vi.fn();
        comp.dirty = dirty;

        trackIn(comp, () => ref.get("user.name"));

        ref.patch("user", user); // same reference
        expect(dirty).not.toHaveBeenCalled();
    });

    it("set notifies unchanged sibling signals; patch does not", () => {
        const ref = makeState();

        const ageComp = createOwner(null);
        const ageDirty = vi.fn();
        ageComp.dirty = ageDirty;

        trackIn(ageComp, () => ref.get("user.age"));

        // patch only changes name — age subscriber should not be notified
        ref.patch("user", { name: "Bob", age: 30 });
        expect(ageDirty).not.toHaveBeenCalled();

        // set replaces the whole user subtree — age subscriber WILL be notified
        ref.set("user", { name: "Carol", age: 30 });
        expect(ageDirty).toHaveBeenCalledTimes(1);
    });

    it("transitions an Unset Ref to active on first patch", () => {
        const ref = Ref.create<State>();
        ref.patch("user", { name: "Alice", age: 30 });
        expect(ref.isUnset).toBe(false);
        expect(ref.get("user.name")).toBe("Alice");
    });
});

// ---------------------------------------------------------------------------
// at — object path → Ref<V>
// ---------------------------------------------------------------------------

describe("ref.at — object path", () => {
    it("returns a Ref scoped to the path", () => {
        const ref = makeState();
        const userRef = ref.at("user");
        expect(userRef).toBeInstanceOf(Ref);
    });

    it("returns the same Ref instance on repeated calls", () => {
        const ref = makeState();
        expect(ref.at("user")).toBe(ref.at("user"));
    });

    it("sub-Ref.get reads values from root state", () => {
        const ref = makeState();
        const userRef = ref.at("user") as Ref<{ name: string; age: number }>;
        expect(userRef.get("name" as any)).toBe("Alice");
    });

    it("mutations on sub-Ref are reflected in root state", () => {
        const ref = makeState();
        const userRef = ref.at("user") as Ref<{ name: string; age: number }>;
        userRef.set("name" as any, "Bob");
        expect(ref.get("user.name")).toBe("Bob");
    });

    it("sub-Ref tracks through root signal map", () => {
        const ref = makeState();
        const userRef = ref.at("user") as Ref<{ name: string; age: number }>;

        const comp = createOwner(null);
        const dirty = vi.fn();
        comp.dirty = dirty;

        trackIn(comp, () => (userRef as any).get("name"));

        ref.set("user.name", "Bob");
        expect(dirty).toHaveBeenCalledTimes(1);
    });
});

// ---------------------------------------------------------------------------
// at — leaf path → Derived<V>
// ---------------------------------------------------------------------------

describe("ref.at — leaf path", () => {
    it("returns a Derived handle for a primitive path", () => {
        const ref = makeState();
        const handle = ref.at("active");
        expect(handle).toBeInstanceOf(Derived);
    });

    it("returns the same Derived on repeated calls", () => {
        const ref = makeState();
        expect(ref.at("active")).toBe(ref.at("active"));
    });

    it("Derived.get() returns the current value", () => {
        const ref = makeState();
        const handle = ref.at("active") as Derived<boolean | undefined>;
        expect(handle.get()).toBe(true);
    });

    it("Derived.get() tracks the path dependency", () => {
        const ref = makeState();
        const handle = ref.at("active") as Derived<boolean | undefined>;

        const comp = createOwner(null);
        const dirty = vi.fn();
        comp.dirty = dirty;

        trackIn(comp, () => handle.get());

        ref.set("active", false);
        expect(dirty).toHaveBeenCalledTimes(1);
    });

    it("Derived.set() writes back to the Ref", () => {
        const ref = makeState();
        const handle = ref.at("active") as Derived<boolean | undefined>;
        handle.set(false);
        expect(ref.get("active")).toBe(false);
    });

    it("Derived.get() reflects a set done on the root Ref", () => {
        const ref = makeState();
        const handle = ref.at("active") as Derived<boolean | undefined>;
        ref.set("active", false);
        expect(handle.get()).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// push
// ---------------------------------------------------------------------------

describe("ref.push", () => {
    it("appends an item to the array", () => {
        const ref = makeState();
        ref.push("scores", 4);
        expect(ref.get("scores")).toEqual([1, 2, 3, 4]);
    });

    it("appends multiple items", () => {
        const ref = makeState();
        ref.push("scores", 4, 5);
        expect(ref.get("scores")).toEqual([1, 2, 3, 4, 5]);
    });

    it("notifies the array path signal", () => {
        const ref = makeState();
        const comp = createOwner(null);
        const dirty = vi.fn();
        comp.dirty = dirty;

        trackIn(comp, () => ref.get("scores"));

        ref.push("scores", 4);
        expect(dirty).toHaveBeenCalledTimes(1);
    });

    it("does not notify an unrelated path computation", () => {
        const ref = makeState();
        const comp = createOwner(null);
        const dirty = vi.fn();
        comp.dirty = dirty;

        trackIn(comp, () => ref.get("user.name"));

        ref.push("scores", 4);
        expect(dirty).not.toHaveBeenCalled();
    });
});

// ---------------------------------------------------------------------------
// pop
// ---------------------------------------------------------------------------

describe("ref.pop", () => {
    it("removes and returns the last element", () => {
        const ref = makeState();
        const val = ref.pop("scores");
        expect(val.getOrElse(-1)).toBe(3);
        expect(ref.get("scores")).toEqual([1, 2]);
    });

    it("returns None on an empty array", () => {
        const ref = Ref.create({ items: [] as number[] });
        expect(ref.pop("items").getOrElse(-1)).toBe(-1);
    });

    it("notifies the array path signal", () => {
        const ref = makeState();
        const comp = createOwner(null);
        const dirty = vi.fn();
        comp.dirty = dirty;

        trackIn(comp, () => ref.get("scores"));

        ref.pop("scores");
        expect(dirty).toHaveBeenCalledTimes(1);
    });

    it("is a no-op on an empty array and does not notify", () => {
        const ref = Ref.create({ items: [] as number[] });
        const comp = createOwner(null);
        const dirty = vi.fn();
        comp.dirty = dirty;

        trackIn(comp, () => ref.get("items"));

        ref.pop("items");
        expect(dirty).not.toHaveBeenCalled();
    });
});

// ---------------------------------------------------------------------------
// splice
// ---------------------------------------------------------------------------

describe("ref.splice", () => {
    it("removes elements at start index", () => {
        const ref = makeState();
        ref.splice("scores", 1, 1);
        expect(ref.get("scores")).toEqual([1, 3]);
    });

    it("inserts elements at index without removing", () => {
        const ref = makeState();
        ref.splice("scores", 1, 0, 10, 20);
        expect(ref.get("scores")).toEqual([1, 10, 20, 2, 3]);
    });

    it("replaces elements", () => {
        const ref = makeState();
        ref.splice("scores", 0, 2, 99, 98);
        expect(ref.get("scores")).toEqual([99, 98, 3]);
    });

    it("notifies the array path signal", () => {
        const ref = makeState();
        const comp = createOwner(null);
        const dirty = vi.fn();
        comp.dirty = dirty;

        trackIn(comp, () => ref.get("scores"));

        ref.splice("scores", 0, 1);
        expect(dirty).toHaveBeenCalledTimes(1);
    });
});

// ---------------------------------------------------------------------------
// move
// ---------------------------------------------------------------------------

describe("ref.move", () => {
    it("swaps two elements", () => {
        const ref = makeState();
        ref.move("scores", 0, 2);
        expect(ref.get("scores")).toEqual([3, 2, 1]);
    });

    it("is a no-op when from === to", () => {
        const ref = makeState();
        const comp = createOwner(null);
        const dirty = vi.fn();
        comp.dirty = dirty;

        trackIn(comp, () => ref.get("scores"));

        ref.move("scores", 1, 1);
        expect(dirty).not.toHaveBeenCalled();
        expect(ref.get("scores")).toEqual([1, 2, 3]);
    });

    it("only notifies signals at the two swapped indices", () => {
        const ref = makeState();

        const idx0 = createOwner(null);
        const dirty0 = vi.fn();
        idx0.dirty = dirty0;

        const idx1 = createOwner(null);
        const dirty1 = vi.fn();
        idx1.dirty = dirty1;

        const idx2 = createOwner(null);
        const dirty2 = vi.fn();
        idx2.dirty = dirty2;

        trackIn(idx0, () => ref.get("scores.0"));
        trackIn(idx1, () => ref.get("scores.1"));
        trackIn(idx2, () => ref.get("scores.2"));

        ref.move("scores", 0, 2); // swap index 0 and 2

        expect(dirty0).toHaveBeenCalledTimes(1);
        expect(dirty2).toHaveBeenCalledTimes(1);
        expect(dirty1).not.toHaveBeenCalled(); // index 1 untouched
    });
});

// ---------------------------------------------------------------------------
// dispose
// ---------------------------------------------------------------------------

describe("ref.dispose", () => {
    it("set is a no-op after dispose", () => {
        const ref = makeState();
        ref.dispose();
        ref.set("active", false);
        // get still returns whatever was last tracked before dispose
        // (internal signal is disposed, so we verify set didn't throw)
        expect(() => ref.set("active", false)).not.toThrow();
    });

    it("patch is a no-op after dispose", () => {
        const ref = makeState();
        ref.dispose();
        expect(() => ref.patch("user", { name: "Bob", age: 30 })).not.toThrow();
    });

    it("sub-Ref.dispose() is a no-op — only root can be disposed", () => {
        const ref = makeState();
        const userRef = ref.at("user") as Ref<{ name: string; age: number }>;
        expect(() => userRef.dispose()).not.toThrow();

        // Root is still alive after sub-Ref dispose
        ref.set("user.name", "Bob");
        expect(ref.get("user.name")).toBe("Bob");
    });
});

// ---------------------------------------------------------------------------
// batch integration
// ---------------------------------------------------------------------------

describe("batch + Ref", () => {
    it("defers notifications until the batch exits", () => {
        const ref = makeState();
        const comp = createOwner(null);
        const dirty = vi.fn();
        comp.dirty = dirty;

        trackIn(comp, () => ref.get("user.name"));

        batch(() => {
            ref.set("user.name", "Bob");
            expect(dirty).not.toHaveBeenCalled(); // deferred
        });

        expect(dirty).toHaveBeenCalledTimes(1);
    });

    it("deduplicates notifications across multiple set calls in a batch", () => {
        const ref = makeState();
        const comp = createOwner(null);
        const dirty = vi.fn();
        comp.dirty = dirty;

        trackIn(comp, () => ref.get("user.name"));

        batch(() => {
            ref.set("user.name", "Bob");
            ref.set("user.name", "Carol");
        });

        expect(dirty).toHaveBeenCalledTimes(1);
        expect(ref.get("user.name")).toBe("Carol");
    });
});

// ---------------------------------------------------------------------------
// delete
// ---------------------------------------------------------------------------

describe("ref.delete", () => {
    it("removes an object key — get returns undefined", () => {
        const ref = makeState();
        ref.delete("user.name");
        expect(ref.get("user.name")).toBeUndefined();
    });

    it("cascades to descendant signals", () => {
        const ref = makeState();
        const nameComp = createOwner(null);
        const nameDirty = vi.fn();
        nameComp.dirty = nameDirty;
        const ageComp = createOwner(null);
        const ageDirty = vi.fn();
        ageComp.dirty = ageDirty;

        trackIn(nameComp, () => ref.get("user.name"));
        trackIn(ageComp, () => ref.get("user.age"));

        ref.delete("user");

        expect(nameDirty).toHaveBeenCalledTimes(1);
        expect(ageDirty).toHaveBeenCalledTimes(1);
    });

    it("notifies exact-path subscribers", () => {
        const ref = makeState();
        const comp = createOwner(null);
        const dirty = vi.fn();
        comp.dirty = dirty;

        trackIn(comp, () => ref.get("active"));
        ref.delete("active");
        expect(dirty).toHaveBeenCalledTimes(1);
    });

    it("does not notify unrelated path subscribers", () => {
        const ref = makeState();
        const comp = createOwner(null);
        const dirty = vi.fn();
        comp.dirty = dirty;

        trackIn(comp, () => ref.get("active"));
        ref.delete("user.name");
        expect(dirty).not.toHaveBeenCalled();
    });

    it("cached .at() sub-Ref stays alive and transitions to isUnset", () => {
        const ref = makeState();
        const userRef = ref.at("user") as Ref<{ name: string; age: number }>;
        ref.delete("user");
        expect(userRef.isUnset).toBe(true);
        expect(ref.at("user")).toBe(userRef); // same cached instance
    });

    it("re-setting a deleted path restores the value", () => {
        const ref = makeState();
        ref.delete("user.name");
        ref.set("user.name", "Carol");
        expect(ref.get("user.name")).toBe("Carol");
    });

    it("releases a binding at the deleted path", () => {
        const ref = makeState();
        const sig = Signal.create("Bound");
        ref.bind("user.name", sig);
        ref.delete("user.name");
        sig.set("After delete");
        // Binding released — the set on sig should not update the ref
        expect(ref.get("user.name")).toBeUndefined();
    });

    it("removes an element from a nested array by index path", () => {
        // Exercises #deleteAtPath Array.isArray branch (tail.length === 0, obj is array)
        const ref = makeState(); // scores: [1, 2, 3]
        ref.delete("scores.1"); // remove index 1 → [1, 3]
        const scores = ref.get("scores") as number[];
        expect(scores).toHaveLength(2);
        expect(scores[0]).toBe(1);
        expect(scores[1]).toBe(3);
    });

    it("recursively descends into a nested array element to delete a deeper key", () => {
        // Exercises #deleteAtPath recursive Array.isArray branch (tail.length > 0, obj is array)
        type Row = { items: Array<{ id: number; label: string }> };
        const ref = Ref.create<Row>({
            items: [
                { id: 1, label: "a" },
                { id: 2, label: "b" },
            ],
        });
        ref.delete("items.0.label"); // recurse into array[0], delete "label"
        const first = ref.get("items.0")!;
        expect(first.id).toBe(1);
        expect(first.label).toBeUndefined();
        const second = ref.get("items.1") as { id: number; label: string };
        expect(second.label).toBe("b"); // sibling unchanged
    });
});

// ---------------------------------------------------------------------------
// maybeAt
// ---------------------------------------------------------------------------

describe("ref.maybeAt", () => {
    it("returns Some(value) when path exists", () => {
        const ref = makeState();
        const handle = ref.maybeAt("user.name");
        const result = handle.get();
        expect(result).not.toBeNull();
        expect(getTag(result!)).toBe("Some");
        expect((result as Some<string>).value).toBe("Alice");
    });

    it("returns None after the path is deleted", () => {
        const ref = makeState();
        const handle = ref.maybeAt("user.name");
        ref.delete("user.name");
        const result = handle.get();
        expect(result).not.toBeNull();
        expect(getTag(result!)).toBe("None");
    });

    it("returns None for an Unset Ref", () => {
        const ref = Ref.create<State>();
        const handle = ref.maybeAt("active");
        const result = handle.get();
        expect(result).not.toBeNull();
        expect(getTag(result!)).toBe("None");
    });

    it("transitions from None to Some when path is re-set after deletion", () => {
        const ref = makeState();
        const handle = ref.maybeAt("active");
        ref.delete("active");
        expect(getTag(handle.get()!)).toBe("None");
        ref.set("active", false);
        expect(getTag(handle.get()!)).toBe("Some");
    });

    it("each call returns a fresh Derived (not cached)", () => {
        const ref = makeState();
        // maybeAt is not cached — this is intentional, it creates a new Derived
        const a = ref.maybeAt("active");
        const b = ref.maybeAt("active");
        expect(a).not.toBe(b);
    });
});

// ---------------------------------------------------------------------------
// bind / unbind / boundAt
// ---------------------------------------------------------------------------

describe("ref.bind", () => {
    it("sets the path to the signal's current value immediately", () => {
        const ref = makeState();
        const sig = Signal.create("Bound");
        ref.bind("user.name", sig);
        expect(ref.get("user.name")).toBe("Bound");
    });

    it("updates the path when the signal changes", () => {
        const ref = makeState();
        const sig = Signal.create("Bound");
        ref.bind("user.name", sig);
        sig.set("Updated");
        expect(ref.get("user.name")).toBe("Updated");
    });

    it("notifies Ref subscribers when the bound signal changes", () => {
        const ref = makeState();
        const sig = Signal.create("Bound");
        ref.bind("user.name", sig);

        const comp = createOwner(null);
        const dirty = vi.fn();
        comp.dirty = dirty;
        trackIn(comp, () => ref.get("user.name"));

        sig.set("Updated");
        expect(dirty).toHaveBeenCalledTimes(1);
    });

    it("re-binding replaces the existing subscription", () => {
        const ref = makeState();
        const sigA = Signal.create("A");
        const sigB = Signal.create("B");
        ref.bind("user.name", sigA);
        ref.bind("user.name", sigB);

        sigA.set("A-updated");
        expect(ref.get("user.name")).toBe("B"); // still B, sigA detached

        sigB.set("B-updated");
        expect(ref.get("user.name")).toBe("B-updated");
    });

    it("source signal disposal sets path to undefined and releases binding", () => {
        const ref = makeState();
        const sig = Signal.create("Bound");
        ref.bind("user.name", sig);
        sig.dispose();
        expect(ref.get("user.name")).toBeUndefined();
        expect(ref.boundAt("user.name")).toBeNull();
    });
});

describe("ref.set — implicit unbind", () => {
    it("plain set() unbinds and the old signal no longer drives the path", () => {
        const ref = makeState();
        const sig = Signal.create("Bound");
        ref.bind("user.name", sig);
        ref.set("user.name", "Plain");
        sig.set("Signal-updated");
        expect(ref.get("user.name")).toBe("Plain");
    });

    it("boundAt returns null after implicit unbind via set()", () => {
        const ref = makeState();
        const sig = Signal.create("Bound");
        ref.bind("user.name", sig);
        ref.set("user.name", "Plain");
        expect(ref.boundAt("user.name")).toBeNull();
    });
});

describe("ref.unbind", () => {
    it("releases the binding without changing the current value", () => {
        const ref = makeState();
        const sig = Signal.create("Bound");
        ref.bind("user.name", sig);
        ref.unbind("user.name");
        expect(ref.get("user.name")).toBe("Bound"); // last value retained
        sig.set("After unbind");
        expect(ref.get("user.name")).toBe("Bound"); // no longer tracking
    });

    it("boundAt returns null after unbind", () => {
        const ref = makeState();
        const sig = Signal.create("Bound");
        ref.bind("user.name", sig);
        ref.unbind("user.name");
        expect(ref.boundAt("user.name")).toBeNull();
    });

    it("is a no-op when no binding exists", () => {
        const ref = makeState();
        expect(() => ref.unbind("user.name")).not.toThrow();
    });
});

describe("ref.boundAt", () => {
    it("returns the bound signal", () => {
        const ref = makeState();
        const sig = Signal.create("Bound");
        ref.bind("user.name", sig);
        expect(ref.boundAt("user.name")).toBe(sig);
    });

    it("returns null when no binding exists", () => {
        const ref = makeState();
        expect(ref.boundAt("user.name")).toBeNull();
    });
});

// ---------------------------------------------------------------------------
// PathValue type inference
// ---------------------------------------------------------------------------

describe("PathValue type inference", () => {
    it("resolves a top-level key", () => {
        expectTypeOf<PathValue<State, "active">>().toEqualTypeOf<boolean>();
    });

    it("resolves a nested key", () => {
        expectTypeOf<PathValue<State, "user.name">>().toEqualTypeOf<string>();
        expectTypeOf<PathValue<State, "user.age">>().toEqualTypeOf<number>();
    });

    it("resolves an array index", () => {
        expectTypeOf<PathValue<State, "scores.0">>().toEqualTypeOf<number>();
    });

    it("Ref.get return type matches PathValue", () => {
        const ref = makeState();
        expectTypeOf(ref.get("active")).toEqualTypeOf<boolean | undefined>();
        expectTypeOf(ref.get("user.name")).toEqualTypeOf<string | undefined>();
    });
});
