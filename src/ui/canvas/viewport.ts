/**
 * Pan/zoom viewport for the canvas renderer.
 *
 * `Viewport(canvas)` returns a handle whose `x`, `y`, `scale` are reactive
 * `Signal<number>` instances. Authors feed these into a root `<group>` to pan
 * and zoom the world, and the canvas renderer reads `bounds()` each frame to
 * cull off-screen subtrees:
 *
 * ```tsx
 * const vp = Viewport(canvas);
 * const r = createCanvasRenderer(canvas, { viewport: vp });
 *
 * <group x={vp.x} y={vp.y} scale={vp.scale}>
 *   {/* world content *\/}
 * </group>
 * ```
 *
 * Naming intentionally avoids a `use*` prefix — `Viewport` is a factory that
 * owns reactive state, not a hook.
 *
 * @module
 */

import { Signal } from "../../prelude/signal.ts";
import type { CanvasBounds } from "./node.ts";

/**
 * Reactive pan/zoom state plus the derived world-space rect used for culling.
 */
export interface ViewportHandle {
    /** World-space x-translation applied to the root group (signal). */
    x: Signal<number>;
    /** World-space y-translation applied to the root group (signal). */
    y: Signal<number>;
    /** Uniform world-space scale applied to the root group (signal). */
    scale: Signal<number>;
    /**
     * The current visible world-space rect. Reads `x`, `y`, `scale`, and the
     * canvas's pixel dimensions untracked — this is called from the paint
     * pass, which is not a reactive computation.
     */
    bounds(): CanvasBounds;
    /** Reset `x` and `y` to 0 and `scale` to 1. */
    reset(): void;
}

/**
 * Create a {@link ViewportHandle} bound to the given canvas element.
 *
 * Initial values: `x = 0`, `y = 0`, `scale = 1` (no pan, no zoom).
 *
 * @param canvas - The HTML canvas element whose pixel dimensions feed into
 *   `bounds()`. The handle does not subscribe to canvas resize events; if the
 *   canvas is resized authors should trigger a repaint themselves.
 */
export function Viewport(canvas: HTMLCanvasElement): ViewportHandle {
    const x = Signal.create<number>(0);
    const y = Signal.create<number>(0);
    const scale = Signal.create<number>(1);

    return {
        x,
        y,
        scale,
        bounds(): CanvasBounds {
            const sx = scale.peek() ?? 1;
            const tx = x.peek() ?? 0;
            const ty = y.peek() ?? 0;
            const safeScale = sx === 0 ? 1 : sx;
            // `+ 0` normalises a signed zero (`-tx / safeScale` when `tx === 0`
            // produces `-0`) so `toEqual` and downstream equality compare
            // cleanly against the canonical `0`.
            return {
                x: -tx / safeScale + 0,
                y: -ty / safeScale + 0,
                width: canvas.width / safeScale,
                height: canvas.height / safeScale,
            };
        },
        reset(): void {
            x.set(0);
            y.set(0);
            scale.set(1);
        },
    };
}
