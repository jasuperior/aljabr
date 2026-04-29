import { describe, it, expect } from "vitest";
import { Viewport } from "../../../src/ui/canvas/viewport.ts";

function fakeCanvas(width: number, height: number): HTMLCanvasElement {
    return { width, height } as unknown as HTMLCanvasElement;
}

describe("Viewport", () => {
    describe("initial state", () => {
        it("starts with x=0, y=0, scale=1", () => {
            const vp = Viewport(fakeCanvas(800, 600));
            expect(vp.x.peek()).toBe(0);
            expect(vp.y.peek()).toBe(0);
            expect(vp.scale.peek()).toBe(1);
        });

        it("bounds() at the origin returns the full canvas in world space", () => {
            const vp = Viewport(fakeCanvas(800, 600));
            expect(vp.bounds()).toEqual({ x: 0, y: 0, width: 800, height: 600 });
        });
    });

    describe("pan", () => {
        it("translates the visible world rect by -x/-y", () => {
            const vp = Viewport(fakeCanvas(800, 600));
            vp.x.set(100);
            vp.y.set(50);
            // World point (sx - vp.x) / vp.scale: at scale=1, world rect
            // shifts by -vp.x / -vp.y.
            expect(vp.bounds()).toEqual({
                x: -100,
                y: -50,
                width: 800,
                height: 600,
            });
        });
    });

    describe("zoom", () => {
        it("scales width/height by 1/scale", () => {
            const vp = Viewport(fakeCanvas(800, 600));
            vp.scale.set(2);
            expect(vp.bounds()).toEqual({ x: 0, y: 0, width: 400, height: 300 });
        });

        it("composes pan and zoom", () => {
            const vp = Viewport(fakeCanvas(800, 600));
            vp.x.set(200);
            vp.y.set(100);
            vp.scale.set(2);
            // world.x = -tx/scale = -100; world.y = -50; w/h = 400/300
            expect(vp.bounds()).toEqual({
                x: -100,
                y: -50,
                width: 400,
                height: 300,
            });
        });

        it("guards against scale=0 (treats as 1) so bounds stays finite", () => {
            const vp = Viewport(fakeCanvas(800, 600));
            vp.scale.set(0);
            const b = vp.bounds();
            expect(Number.isFinite(b.width)).toBe(true);
            expect(Number.isFinite(b.height)).toBe(true);
            expect(Number.isFinite(b.x)).toBe(true);
            expect(Number.isFinite(b.y)).toBe(true);
        });
    });

    describe("reset", () => {
        it("returns to x=0, y=0, scale=1", () => {
            const vp = Viewport(fakeCanvas(800, 600));
            vp.x.set(100);
            vp.y.set(200);
            vp.scale.set(3);
            vp.reset();
            expect(vp.x.peek()).toBe(0);
            expect(vp.y.peek()).toBe(0);
            expect(vp.scale.peek()).toBe(1);
        });
    });

    describe("bounds() reflects current canvas dimensions", () => {
        it("reads canvas.width / canvas.height live each call", () => {
            const canvas = fakeCanvas(800, 600);
            const vp = Viewport(canvas);
            expect(vp.bounds().width).toBe(800);
            // Resize the canvas — bounds() picks up the new dimensions.
            (canvas as { width: number }).width = 1024;
            (canvas as { height: number }).height = 768;
            expect(vp.bounds().width).toBe(1024);
            expect(vp.bounds().height).toBe(768);
        });
    });
});
