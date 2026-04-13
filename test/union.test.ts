import { describe, it, expect } from "vitest";
import {
    __,
    tag,
    predTag,
    whenTag,
    union,
    getTag,
    pred,
    when,
    Trait,
    type Pred,
    type WhenArm,
} from "../src/union.ts";

// ==========================================
// union()
// ==========================================

describe("union()", () => {
    const Shape = union({
        Circle: (radius: number) => ({ radius }),
        Rect: (w: number, h: number) => ({ w, h }),
        Dot: { x: 0, y: 0 },
    });

    it("creates callable factories for each variant", () => {
        expect(typeof Shape.Circle).toBe("function");
        expect(typeof Shape.Rect).toBe("function");
        expect(typeof Shape.Dot).toBe("function");
    });

    it("function variants forward args to payload", () => {
        const c = Shape.Circle(5);
        expect(c.radius).toBe(5);

        const r = Shape.Rect(10, 20);
        expect(r.w).toBe(10);
        expect(r.h).toBe(20);
    });

    it("constant variants return correct payload", () => {
        const d = Shape.Dot();
        expect(d.x).toBe(0);
        expect(d.y).toBe(0);
    });

    it("constant variants return a fresh object each call", () => {
        const a = Shape.Dot();
        const b = Shape.Dot();
        expect(a).not.toBe(b);
    });

    it("variant carries the correct [tag]", () => {
        expect(getTag(Shape.Circle(1))).toBe("Circle");
        expect(getTag(Shape.Rect(1, 2))).toBe("Rect");
        expect(getTag(Shape.Dot())).toBe("Dot");
    });

    it("[tag] is non-enumerable and not in Object.keys()", () => {
        const c = Shape.Circle(5);
        expect(Object.keys(c)).not.toContain(tag.toString());
        expect(Object.prototype.propertyIsEnumerable.call(c, tag)).toBe(false);
    });

    it("[tag] is not an own property (lives on prototype)", () => {
        const c = Shape.Circle(5);
        expect(Object.prototype.hasOwnProperty.call(c, tag)).toBe(false);
        expect((c as any)[tag]).toBe("Circle");
    });

    describe("with impl classes", () => {
        abstract class Trackable extends Trait<{ size: number }> {
            tracked = true;
            version = 1;
        }
        class Timestamped {
            createdAt = 0;
            describe() {
                return `I was created at: ${this.createdAt}`;
            }
        }

        const Tagged = union([Trackable, Timestamped])({
            // payload satisfies Trackable's requirement: { size: number }
            Box: (size: number) => ({ size }),
        });

        it("mixes in own instance properties from impl classes", () => {
            const b = Tagged.Box(10);
            expect(b.tracked).toBe(true);
            expect(b.version).toBe(1);
            expect(b.createdAt).toBe(0);
        });

        it("mixes in own methods from impl classes", () => {
            const b = Tagged.Box(10);
            expect(b.describe).toBeTypeOf("function");
        });

        it("mixes in own properties from all impl classes", () => {
            const b = Tagged.Box(10);
            expect("createdAt" in b).toBe(true);
        });

        it("payload values shadow impl defaults", () => {
            abstract class Shadowable extends Trait<{
                size: number;
                tracked: boolean;
            }> {
                tracked = true;
            }
            const Capped = union([Shadowable])({
                Item: (size: number, tracked: boolean) => ({ size, tracked }),
            });
            const item = Capped.Item(0, false);
            expect(item.tracked).toBe(false);
        });
    });

    describe("Trait requirement enforcement", () => {
        it("plain classes used as impl impose no requirements", () => {
            class NoReqs {
                x = 1;
            }
            // Any payload is valid — no Trait<R> declared
            const U = union([NoReqs])({
                A: () => ({}),
            });
            expect(U.A().x).toBe(1);
        });

        it("impl class not extending Trait is treated as Trait<{}>", () => {
            class Mixin {
                extra = 42;
            }
            const U = union([Mixin])({
                A: (n: number) => ({ n }),
            });
            expect(U.A(5).extra).toBe(42);
            expect(U.A(5).n).toBe(5);
        });
    });
});

// ==========================================
// getTag()
// ==========================================

describe("getTag()", () => {
    const Ev = union({ Start: { count: 0 }, Stop: { count: 0 } });

    it("returns the variant name string", () => {
        expect(getTag(Ev.Start())).toBe("Start");
        expect(getTag(Ev.Stop())).toBe("Stop");
    });
});

// ==========================================
// pred()
// ==========================================

describe("pred()", () => {
    it("returns an object tagged with predTag", () => {
        const p = pred((x: number) => x > 0);
        expect((p as any)[predTag]).toBe(true);
    });

    it("stores the fn on the returned object", () => {
        const fn = (x: number) => x > 0;
        const p = pred(fn);
        expect(p.fn).toBe(fn);
    });

    it("boolean predicate: fn returns true when condition holds", () => {
        const p = pred((x: number) => x > 0);
        expect(p.fn(1)).toBe(true);
        expect(p.fn(-1)).toBe(false);
    });

    it("type predicate: fn narrows at runtime correctly", () => {
        const p = pred((x: string): x is "Enter" => x === "Enter");
        expect(p.fn("Enter")).toBe(true);
        expect(p.fn("Escape")).toBe(false);
    });

    it("TypeScript: Pred type is parameterized correctly", () => {
        const p: Pred<number> = pred((x: number) => x > 0);
        expect(p).toBeDefined();
    });
});

// ==========================================
// when()
// ==========================================

describe("when()", () => {
    const handler = () => "result";

    it("when(__, handler) stores pattern === __", () => {
        const arm = when(__, handler) as WhenArm<any, any>;
        expect(arm[whenTag]).toBe(true);
        expect(arm.pattern).toBe(__);
        expect(arm.guard).toBeUndefined();
        expect(arm.handler).toBe(handler);
    });

    it("when(guard, handler) stores empty pattern and the guard", () => {
        const guard = (v: any) => v > 0;
        const arm = when(guard, handler) as WhenArm<any, any>;
        expect(arm[whenTag]).toBe(true);
        expect(arm.pattern).toEqual({});
        expect(arm.guard).toBe(guard);
        expect(arm.handler).toBe(handler);
    });

    it("when(pattern, handler) stores pattern with no guard", () => {
        const pattern = { key: "Enter" };
        const arm = when(pattern, handler) as WhenArm<any, any>;
        expect(arm[whenTag]).toBe(true);
        expect(arm.pattern).toBe(pattern);
        expect(arm.guard).toBeUndefined();
        expect(arm.handler).toBe(handler);
    });

    it("when(pattern, guard, handler) stores all three", () => {
        const pattern = { key: "Enter" };
        const guard = (v: any) => v.active;
        const arm = when(pattern, guard, handler) as WhenArm<any, any>;
        expect(arm[whenTag]).toBe(true);
        expect(arm.pattern).toBe(pattern);
        expect(arm.guard).toBe(guard);
        expect(arm.handler).toBe(handler);
    });

    it("all forms return an object tagged with whenTag", () => {
        const guard = (_v: any) => true;
        expect((when(__, handler) as any)[whenTag]).toBe(true);
        expect((when(guard, handler) as any)[whenTag]).toBe(true);
        expect((when({}, handler) as any)[whenTag]).toBe(true);
        expect((when({}, guard, handler) as any)[whenTag]).toBe(true);
    });
});
