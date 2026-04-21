import { describe, expect, it, expectTypeOf } from "vitest";
import { Fault, type Fail, type Defect, type Interrupted, type Fault as FaultType } from "../../src/prelude/fault";
import { getTag, instanceOf } from "../../src/union";
import { match } from "../../src/match";

describe("Fault.Fail", () => {
    it("carries the error payload", () => {
        const f = Fault.Fail("domain error");
        expect(getTag(f)).toBe("Fail");
        expect(f.error).toBe("domain error");
    });

    it("works with object error types", () => {
        const err = new Error("oops");
        const f = Fault.Fail(err);
        expect(f.error).toBe(err);
    });

    it("preserves generic type parameter", () => {
        const f = Fault.Fail(42);
        expectTypeOf(f).toExtend<Fail<number>>();
    });
});

describe("Fault.Defect", () => {
    it("carries an unknown thrown value", () => {
        const thrown = new TypeError("unexpected");
        const f = Fault.Defect(thrown);
        expect(getTag(f)).toBe("Defect");
        expect(f.thrown).toBe(thrown);
    });

    it("accepts any thrown value including primitives", () => {
        const f = Fault.Defect("raw string panic");
        expect(f.thrown).toBe("raw string panic");
        expectTypeOf(f).toExtend<Defect>();
    });
});

describe("Fault.Interrupted", () => {
    it("carries an optional reason", () => {
        const reason = "user cancelled";
        const f = Fault.Interrupted(reason);
        expect(getTag(f)).toBe("Interrupted");
        expect(f.reason).toBe(reason);
    });

    it("reason is optional (undefined by default)", () => {
        const f = Fault.Interrupted();
        expect(getTag(f)).toBe("Interrupted");
        expect(f.reason).toBeUndefined();
        expectTypeOf(f).toExtend<Interrupted>();
    });
});

describe("Fault — exhaustive match", () => {
    it("matches all three variants", () => {
        const cases: Array<[FaultType<string>, string]> = [
            [Fault.Fail("e"),       "fail"],
            [Fault.Defect(new Error()), "defect"],
            [Fault.Interrupted(),   "interrupted"],
        ];

        for (const [fault, expected] of cases) {
            const result = match(fault, {
                Fail:        () => "fail",
                Defect:      () => "defect",
                Interrupted: () => "interrupted",
            });
            expect(result).toBe(expected);
        }
    });

    it("Fail arm receives the typed error", () => {
        const f = Fault.Fail(99);
        const result = match(f as FaultType<number>, {
            Fail:        ({ error }) => error * 2,
            Defect:      () => -1,
            Interrupted: () => -2,
        });
        expect(result).toBe(198);
    });

    it("Defect arm receives the thrown value", () => {
        const err = new Error("boom");
        const f = Fault.Defect(err);
        const result = match(f as FaultType<never>, {
            Fail:        () => null,
            Defect:      ({ thrown }) => thrown,
            Interrupted: () => null,
        });
        expect(result).toBe(err);
    });
});

describe("instanceOf — Fault.Fail detection", () => {
    it("returns true for a Fail instance", () => {
        const f = Fault.Fail("err");
        expect(instanceOf(Fault.Fail, f)).toBe(true);
    });

    it("returns false for Defect", () => {
        const f = Fault.Defect(new Error());
        expect(instanceOf(Fault.Fail, f)).toBe(false);
    });

    it("returns false for Interrupted", () => {
        const f = Fault.Interrupted();
        expect(instanceOf(Fault.Fail, f)).toBe(false);
    });

    it("returns false for an unrelated object", () => {
        expect(instanceOf(Fault.Fail, { tag: "Fail", error: "x" })).toBe(false);
    });

    it("mirrors the catch-block detection pattern used in AsyncDerived", () => {
        const thrownByUser = Fault.Fail(new Error("domain"));
        const thrownByRuntime = new TypeError("unexpected");

        function classify(e: unknown): string {
            if (instanceOf(Fault.Fail, e)) return "domain";
            return "defect";
        }

        expect(classify(thrownByUser)).toBe("domain");
        expect(classify(thrownByRuntime)).toBe("defect");
    });
});
