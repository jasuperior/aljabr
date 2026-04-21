import { describe, expect, it, vi, beforeEach } from "vitest";
import { persistedSignal, syncToStore, type PersistAdapter } from "../../src/prelude/persist";

// ---------------------------------------------------------------------------
// Fake adapter — no real localStorage needed
// ---------------------------------------------------------------------------

function makeAdapter(): PersistAdapter & { store: Record<string, string> } {
    const store: Record<string, string> = {};
    return {
        store,
        get: vi.fn((key: string) => store[key] ?? null),
        set: vi.fn((key: string, value: string) => { store[key] = value; }),
        remove: vi.fn((key: string) => { delete store[key]; }),
    };
}

// Flush multiple microtask/macrotask cycles so watchEffect's async thunk settles.
// watchEffect runs immediately on creation (initial value) and again on signal changes,
// but each re-run requires several async hops through the Effect scheduler.
const flush = async (rounds = 4) => {
    for (let i = 0; i < rounds; i++) {
        await new Promise<void>(resolve => setTimeout(resolve, 0));
    }
};

// ---------------------------------------------------------------------------
// persistedSignal
// ---------------------------------------------------------------------------

describe("persistedSignal — initial value", () => {
    it("uses initialValue when the store has no entry", async () => {
        const adapter = makeAdapter();
        const sig = persistedSignal("default", { key: "k", adapter });
        expect(sig.peek()).toBe("default");
    });

    it("rehydrates from the stored value when one exists", async () => {
        const adapter = makeAdapter();
        adapter.store["theme"] = JSON.stringify("dark");
        const sig = persistedSignal<"light" | "dark">("light", { key: "theme", adapter });
        expect(sig.peek()).toBe("dark");
    });

    it("falls back to initialValue when stored data is corrupt JSON", async () => {
        const adapter = makeAdapter();
        adapter.store["bad"] = "NOT_JSON{{{";
        const sig = persistedSignal("fallback", { key: "bad", adapter });
        expect(sig.peek()).toBe("fallback");
    });
});

describe("persistedSignal — writing through", () => {
    it("calls adapter.set() with the serialized value when signal is set", async () => {
        const adapter = makeAdapter();
        const sig = persistedSignal("initial", { key: "myKey", adapter });

        // Let the initial watchEffect run first
        await flush();
        (adapter.set as ReturnType<typeof vi.fn>).mockClear();

        sig.set("updated");
        await flush();

        expect(adapter.set).toHaveBeenCalledWith("myKey", JSON.stringify("updated"));
    });

    it("calls adapter.remove() when signal is set to null", async () => {
        const adapter = makeAdapter();
        const sig = persistedSignal<string | null>("hello", { key: "x", adapter });
        await flush();

        // Null-able signal: must cast
        (sig as unknown as { set(v: null): void }).set(null);
        await flush();

        expect(adapter.remove).toHaveBeenCalledWith("x");
    });
});

describe("persistedSignal — custom serialize / deserialize", () => {
    it("uses the provided serializer on writes", async () => {
        const adapter = makeAdapter();
        const serialize = vi.fn((v: number) => String(v));
        const deserialize = vi.fn((s: string) => Number(s));

        const sig = persistedSignal(0, { key: "n", adapter, serialize, deserialize });
        await flush();
        serialize.mockClear();
        (adapter.set as ReturnType<typeof vi.fn>).mockClear();

        sig.set(42);
        await flush();

        expect(serialize).toHaveBeenCalledWith(42);
        expect(adapter.set).toHaveBeenCalledWith("n", "42");
    });

    it("uses the provided deserializer on rehydration", async () => {
        const adapter = makeAdapter();
        adapter.store["n"] = "7";
        const deserialize = vi.fn((s: string) => Number(s));

        const sig = persistedSignal(0, { key: "n", adapter, deserialize });
        expect(deserialize).toHaveBeenCalledWith("7");
        expect(sig.peek()).toBe(7);
    });
});

// ---------------------------------------------------------------------------
// syncToStore
// ---------------------------------------------------------------------------

describe("syncToStore", () => {
    it("mirrors writes to the adapter", async () => {
        const adapter = makeAdapter();
        const { Signal } = await import("../../src/prelude/signal");
        const sig = Signal.create("hello");
        syncToStore(sig, { key: "s", adapter });
        // Let initial sync fire, then clear
        await flush();
        (adapter.set as ReturnType<typeof vi.fn>).mockClear();

        sig.set("world");
        await flush();

        expect(adapter.set).toHaveBeenCalledWith("s", JSON.stringify("world"));
    });

    it("stop function halts syncing", async () => {
        const adapter = makeAdapter();
        const { Signal } = await import("../../src/prelude/signal");
        const sig = Signal.create("a");
        const stop = syncToStore(sig, { key: "t", adapter });

        stop();

        sig.set("b");
        await flush();

        // adapter.set may have been called for the initial value, but NOT for "b"
        const calls = (adapter.set as ReturnType<typeof vi.fn>).mock.calls;
        const wroteB = calls.some(([, v]) => v === JSON.stringify("b"));
        expect(wroteB).toBe(false);
    });

    it("does not rehydrate — starts with current signal value", async () => {
        const adapter = makeAdapter();
        adapter.store["existing"] = JSON.stringify("stored");

        const { Signal } = await import("../../src/prelude/signal");
        const sig = Signal.create("fresh");
        syncToStore(sig, { key: "existing", adapter });

        // syncToStore must NOT overwrite the signal's value with the stored one
        expect(sig.peek()).toBe("fresh");
    });
});
