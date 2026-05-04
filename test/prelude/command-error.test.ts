import { describe, it, expect } from "vitest";
import { match } from "../../src/match.ts";
import { getTag } from "../../src/union.ts";
import { CommandError } from "../../src/prelude/command-error.ts";
import { DecodeError, Schema, decode } from "../../src/schema/index.ts";

describe("CommandError", () => {
    it("constructs Rejected with a reason", () => {
        const e = CommandError.Rejected("cannot insert into a void node");
        expect(getTag(e)).toBe("Rejected");
        expect(e.reason).toBe("cannot insert into a void node");
    });

    it("constructs Conflict with a detail", () => {
        const e = CommandError.Conflict("node id missing");
        expect(getTag(e)).toBe("Conflict");
        expect(e.detail).toBe("node id missing");
    });

    it("constructs Invalid with a DecodeError array", () => {
        const failed = decode(Schema.string(), 42);
        const errors =
            getTag(failed) === "Invalid"
                ? (failed.errors as DecodeError[])
                : [];
        const e = CommandError.Invalid(errors);
        expect(getTag(e)).toBe("Invalid");
        expect(e.errors.length).toBe(errors.length);
    });

    it("matches exhaustively over the three variants", () => {
        const cases: CommandError[] = [
            CommandError.Rejected("r"),
            CommandError.Conflict("c"),
            CommandError.Invalid([]),
        ];

        const labels = cases.map((c) =>
            match(c, {
                Rejected: ({ reason }) => `rejected:${reason}`,
                Conflict: ({ detail }) => `conflict:${detail}`,
                Invalid: ({ errors }) => `invalid:${errors.length}`,
            }),
        );

        expect(labels).toEqual([
            "rejected:r",
            "conflict:c",
            "invalid:0",
        ]);
    });
});

describe("CommandError.merge — extension", () => {
    const Extended = CommandError.merge({
        BoundaryViolation: (range: { start: number; end: number }) => ({
            range,
        }),
    });

    it("extends with new variants while preserving the base ones", () => {
        expect(typeof Extended.Rejected).toBe("function");
        expect(typeof Extended.Conflict).toBe("function");
        expect(typeof Extended.Invalid).toBe("function");
        expect(typeof Extended.BoundaryViolation).toBe("function");

        const e = Extended.BoundaryViolation({ start: 0, end: 5 });
        expect(getTag(e)).toBe("BoundaryViolation");
        expect(e.range).toEqual({ start: 0, end: 5 });
    });

    it("rejects overlapping keys at the type level", () => {
        // @ts-expect-error — `Rejected` already exists
        CommandError.merge({ Rejected: (r: string) => ({ reason: r }) });
    });
});
