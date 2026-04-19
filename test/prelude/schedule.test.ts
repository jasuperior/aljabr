import { describe, expect, it } from "vitest";
import {
    Schedule,
    ScheduleError,
    computeDelay,
} from "../../src/prelude/schedule";
import { getTag } from "../../src/union";
import { match } from "../../src/match";

// ---------------------------------------------------------------------------
// Schedule variant construction
// ---------------------------------------------------------------------------

describe("Schedule.Fixed", () => {
    it("carries the delay", () => {
        const s = Schedule.Fixed(500);
        expect(getTag(s)).toBe("Fixed");
        expect(s.delay).toBe(500);
    });
});

describe("Schedule.Linear", () => {
    it("carries delayPerAttempt with jitter defaulting to false", () => {
        const s = Schedule.Linear({ delayPerAttempt: 200 });
        expect(getTag(s)).toBe("Linear");
        expect(s.delayPerAttempt).toBe(200);
        expect(s.jitter).toBe(false);
    });

    it("accepts explicit jitter: true", () => {
        const s = Schedule.Linear({ delayPerAttempt: 100, jitter: true });
        expect(s.jitter).toBe(true);
    });
});

describe("Schedule.Exponential", () => {
    it("carries required fields with sensible defaults", () => {
        const s = Schedule.Exponential({ initialDelay: 100, maxDelay: 30_000 });
        expect(getTag(s)).toBe("Exponential");
        expect(s.initialDelay).toBe(100);
        expect(s.maxDelay).toBe(30_000);
        expect(s.multiplier).toBe(2);
        expect(s.jitter).toBe(false);
    });

    it("accepts custom multiplier and jitter", () => {
        const s = Schedule.Exponential({ initialDelay: 50, maxDelay: 5_000, multiplier: 3, jitter: true });
        expect(s.multiplier).toBe(3);
        expect(s.jitter).toBe(true);
    });
});

describe("Schedule.Custom", () => {
    it("carries the function", () => {
        const fn = (attempt: number) => attempt * 100;
        const s = Schedule.Custom(fn);
        expect(getTag(s)).toBe("Custom");
        expect(s.fn).toBe(fn);
    });
});

describe("Schedule — exhaustive match", () => {
    it("matches all four variants", () => {
        const schedules = [
            Schedule.Fixed(100),
            Schedule.Linear({ delayPerAttempt: 50 }),
            Schedule.Exponential({ initialDelay: 100, maxDelay: 1_000 }),
            Schedule.Custom(() => 200),
        ];
        const tags = schedules.map(s => match(s, {
            Fixed:       () => "Fixed",
            Linear:      () => "Linear",
            Exponential: () => "Exponential",
            Custom:      () => "Custom",
        }));
        expect(tags).toEqual(["Fixed", "Linear", "Exponential", "Custom"]);
    });
});

// ---------------------------------------------------------------------------
// ScheduleError variant construction
// ---------------------------------------------------------------------------

describe("ScheduleError.TimedOut", () => {
    it("carries elapsed and timeout", () => {
        const e = ScheduleError.TimedOut(5_100, 5_000);
        expect(getTag(e)).toBe("TimedOut");
        expect(e.elapsed).toBe(5_100);
        expect(e.timeout).toBe(5_000);
    });
});

describe("ScheduleError.MaxRetriesExceeded", () => {
    it("carries attempts and lastError", () => {
        const err = new Error("final failure");
        const e = ScheduleError.MaxRetriesExceeded(3, err);
        expect(getTag(e)).toBe("MaxRetriesExceeded");
        expect(e.attempts).toBe(3);
        expect(e.lastError).toBe(err);
    });
});

// ---------------------------------------------------------------------------
// computeDelay
// ---------------------------------------------------------------------------

describe("computeDelay — Fixed", () => {
    it("returns the fixed delay regardless of attempt number", () => {
        const s = Schedule.Fixed(300);
        expect(computeDelay(s, 1, null)).toBe(300);
        expect(computeDelay(s, 5, null)).toBe(300);
        expect(computeDelay(s, 100, null)).toBe(300);
    });
});

describe("computeDelay — Linear", () => {
    it("grows linearly: attempt × delayPerAttempt", () => {
        const s = Schedule.Linear({ delayPerAttempt: 200 });
        expect(computeDelay(s, 1, null)).toBe(200);
        expect(computeDelay(s, 2, null)).toBe(400);
        expect(computeDelay(s, 3, null)).toBe(600);
    });

    it("with jitter — result is in [50%, 100%] of nominal", () => {
        const s = Schedule.Linear({ delayPerAttempt: 1000, jitter: true });
        for (let i = 0; i < 50; i++) {
            const delay = computeDelay(s, 1, null)!;
            expect(delay).toBeGreaterThanOrEqual(500);
            expect(delay).toBeLessThanOrEqual(1000);
        }
    });
});

describe("computeDelay — Exponential", () => {
    it("doubles on each attempt with default multiplier=2", () => {
        const s = Schedule.Exponential({ initialDelay: 100, maxDelay: 10_000 });
        expect(computeDelay(s, 1, null)).toBe(100);   // 100 * 2^0
        expect(computeDelay(s, 2, null)).toBe(200);   // 100 * 2^1
        expect(computeDelay(s, 3, null)).toBe(400);   // 100 * 2^2
        expect(computeDelay(s, 4, null)).toBe(800);   // 100 * 2^3
    });

    it("caps at maxDelay", () => {
        const s = Schedule.Exponential({ initialDelay: 100, maxDelay: 500 });
        expect(computeDelay(s, 5, null)).toBe(500);
        expect(computeDelay(s, 10, null)).toBe(500);
    });

    it("uses a custom multiplier", () => {
        const s = Schedule.Exponential({ initialDelay: 100, maxDelay: 100_000, multiplier: 3 });
        expect(computeDelay(s, 1, null)).toBe(100);   // 100 * 3^0
        expect(computeDelay(s, 2, null)).toBe(300);   // 100 * 3^1
        expect(computeDelay(s, 3, null)).toBe(900);   // 100 * 3^2
    });

    it("with jitter — result is in [50%, 100%] of capped nominal", () => {
        const s = Schedule.Exponential({ initialDelay: 1000, maxDelay: 1000, jitter: true });
        for (let i = 0; i < 50; i++) {
            const delay = computeDelay(s, 1, null)!;
            expect(delay).toBeGreaterThanOrEqual(500);
            expect(delay).toBeLessThanOrEqual(1000);
        }
    });
});

describe("computeDelay — Custom", () => {
    it("delegates to the provided function", () => {
        const s = Schedule.Custom((attempt, error) => attempt * 10 + String(error).length);
        expect(computeDelay(s, 3, "err")).toBe(33); // 3*10 + "err".length
    });

    it("returning null signals unconditional termination", () => {
        const s = Schedule.Custom(() => null);
        expect(computeDelay(s, 1, null)).toBeNull();
        expect(computeDelay(s, 99, null)).toBeNull();
    });

    it("can implement conditional stop logic", () => {
        const s = Schedule.Custom((attempt) => attempt < 3 ? 100 : null);
        expect(computeDelay(s, 1, null)).toBe(100);
        expect(computeDelay(s, 2, null)).toBe(100);
        expect(computeDelay(s, 3, null)).toBeNull();
    });
});
