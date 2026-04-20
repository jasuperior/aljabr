import { describe, it, expect } from "vitest";
import { signal } from "../../src/signals/index.ts";
import { getTag } from "../../src/union.ts";
import { createOwner, trackIn } from "../../src/prelude/context.ts";
import {
    Validation,
    type Validation as V,
} from "../../src/prelude/validation.ts";

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

// ---------------------------------------------------------------------------
// signal.protocol — custom state union
// ---------------------------------------------------------------------------

type EmailState = V<string, string>;

const emailProtocol = {
    extract: (s: EmailState) => {
        if (getTag(s) === "Valid") return (s as { value: string }).value;
        return null;
    },
};

describe("signal.protocol() — extraction", () => {
    it("getter returns extracted value for a value-carrying state", () => {
        const [email] = signal.protocol(
            Validation.Valid("ada@example.com") as EmailState,
            emailProtocol,
        );
        expect(email()).toBe("ada@example.com");
    });

    it("getter returns null for a non-value-carrying state (Unvalidated)", () => {
        const [email] = signal.protocol(
            Validation.Unvalidated() as EmailState,
            emailProtocol,
        );
        expect(email()).toBeNull();
    });

    it("getter returns null for a non-value-carrying state (Invalid)", () => {
        const [email] = signal.protocol(
            Validation.Invalid(["bad format"]) as EmailState as EmailState,
            emailProtocol,
        );
        expect(email()).toBeNull();
    });

    it("getter.state() returns the full S union", () => {
        const [email] = signal.protocol(
            Validation.Valid("ada@example.com") as EmailState,
            emailProtocol,
        );
        expect(getTag(email.state())).toBe("Valid");
    });
});

describe("signal.protocol() — StateSetter: raw variant", () => {
    it("updates state; getter reflects new extraction", () => {
        const [email, setEmail] = signal.protocol(
            Validation.Unvalidated() as EmailState,
            emailProtocol,
        );
        setEmail(Validation.Valid("ada@example.com"));
        expect(email()).toBe("ada@example.com");
    });

    it("transitioning to a non-value state returns null from getter", () => {
        const [email, setEmail] = signal.protocol(
            Validation.Valid("ada@example.com") as EmailState,
            emailProtocol,
        );
        setEmail(Validation.Invalid(["bad format"]) as EmailState);
        expect(email()).toBeNull();
    });
});

describe("signal.protocol() — StateSetter: functional form", () => {
    it("prev receives the full S state", () => {
        const [email, setEmail] = signal.protocol(
            Validation.Unvalidated() as EmailState,
            emailProtocol,
        );
        let received: EmailState | undefined;
        setEmail((prev) => { received = prev; return prev; });
        expect(getTag(received!)).toBe("Unvalidated");
    });

    it("conditional transition: stays unchanged when condition not met", () => {
        const [email, setEmail] = signal.protocol(
            Validation.Unvalidated() as EmailState,
            emailProtocol,
        );
        setEmail((prev) =>
            getTag(prev) === "Valid" ? Validation.Invalid(["err"]) as EmailState : prev,
        );
        expect(getTag(email.state())).toBe("Unvalidated");
    });

    it("conditional transition: applies when condition is met", () => {
        const [email, setEmail] = signal.protocol(
            Validation.Valid("ada@example.com") as EmailState,
            emailProtocol,
        );
        setEmail((prev) =>
            getTag(prev) === "Valid" ? Validation.Invalid(["err"]) as EmailState : prev,
        );
        expect(getTag(email.state())).toBe("Invalid");
    });
});

describe("signal.protocol() — isTerminal", () => {
    type ConnState =
        | { kind: "open"; value: string }
        | { kind: "closed"; value: null };

    const connProtocol = {
        extract: (s: ConnState): string | null =>
            s.kind === "open" ? s.value : null,
        isTerminal: (s: ConnState): boolean => s.kind === "closed",
    };

    it("reaching a terminal state freezes the signal", () => {
        const [conn, setConn] = signal.protocol<string, ConnState>(
            { kind: "open", value: "ws://localhost" },
            connProtocol,
        );
        setConn({ kind: "closed", value: null });
        setConn({ kind: "open", value: "ws://reconnect" });
        expect(conn.state()).toEqual({ kind: "closed", value: null });
    });

    it("getter returns null after terminal state", () => {
        const [conn, setConn] = signal.protocol<string, ConnState>(
            { kind: "open", value: "ws://localhost" },
            connProtocol,
        );
        setConn({ kind: "closed", value: null });
        expect(conn()).toBeNull();
    });
});

describe("signal.protocol() — reactive tracking", () => {
    it("getter() registers a dependency; setter notifies", () => {
        const [email, setEmail] = signal.protocol(
            Validation.Unvalidated() as EmailState,
            emailProtocol,
        );
        let dirty = false;
        const comp = createOwner(null);
        comp.dirty = () => { dirty = true; };
        trackIn(comp, () => email());
        setEmail(Validation.Valid("ada@example.com"));
        expect(dirty).toBe(true);
    });

    it("getter.state() registers a dependency; setter notifies", () => {
        const [email, setEmail] = signal.protocol(
            Validation.Unvalidated() as EmailState,
            emailProtocol,
        );
        let dirty = false;
        const comp = createOwner(null);
        comp.dirty = () => { dirty = true; };
        trackIn(comp, () => email.state());
        setEmail(Validation.Invalid(["err"]) as EmailState);
        expect(dirty).toBe(true);
    });
});
