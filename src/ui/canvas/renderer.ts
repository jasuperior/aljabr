/**
 * `CanvasRenderer.create` — a thin wrapper around `Renderer.create(CanvasHost)`
 * that accepts a per-instance `viewport` for off-screen culling. With no
 * options, it is exactly `Renderer.create(CanvasHost)`; with `viewport`, it
 * builds a host wrapper whose `attach` threads `viewport.bounds()` through
 * the rAF repaint closure.
 *
 * @module
 */

import { Renderer } from "../renderer.ts";
import type { ViewNode, view } from "../view-node.ts";
import { CanvasHost, makeCanvasAttach } from "./host.ts";
import type { ViewportHandle } from "./viewport.ts";

/**
 * Configuration for {@link CanvasRenderer.create}.
 */
export interface CanvasRendererOptions {
    /**
     * Optional viewport whose `bounds()` drive per-frame culling. Without
     * one, every element with non-empty bounds is painted unconditionally.
     */
    viewport?: ViewportHandle;
}

/**
 * Convenience wrapper for canvas-backed rendering.
 *
 * `CanvasRenderer.create()` is equivalent to `Renderer.create(CanvasHost)`.
 * `CanvasRenderer.create({ viewport })` overrides the host's `attach` so the
 * rAF repaint reads `viewport.bounds()` for culling.
 *
 * @example Bare-bones — no viewport, no culling
 * ```tsx
 * import { CanvasRenderer } from "aljabr/ui/canvas";
 *
 * const canvas = document.querySelector<HTMLCanvasElement>("#scene")!;
 * const r = CanvasRenderer.create();
 * const unmount = r.mount(() => <rect x={10} y={10} width={100} height={100} />, canvas);
 * ```
 *
 * @example With pan/zoom + culling
 * ```tsx
 * import { CanvasRenderer, Viewport } from "aljabr/ui/canvas";
 *
 * const canvas = document.querySelector<HTMLCanvasElement>("#scene")!;
 * const vp = Viewport(canvas);
 * const r = CanvasRenderer.create({ viewport: vp });
 * r.mount(() => <group x={vp.x} y={vp.y} scale={vp.scale}>{/* ... *\/}</group>, canvas);
 * ```
 */
export const CanvasRenderer = {
    create(options: CanvasRendererOptions = {}): {
        view: typeof view;
        mount: (fn: () => ViewNode, container: HTMLCanvasElement) => () => void;
    } {
        if (options.viewport === undefined) {
            return Renderer.create(CanvasHost);
        }
        const viewportAwareHost = {
            ...CanvasHost,
            attach: makeCanvasAttach({ viewport: options.viewport }),
        };
        return Renderer.create(viewportAwareHost);
    },
} as const;
