/**
 * `createCanvasRenderer` — pre-wires {@link canvasHost} with a
 * `requestAnimationFrame`-backed `RendererProtocol` and a clear+repaint
 * driver. The result has the same `{ view, mount }` shape as
 * {@link createRenderer} so authors can swap renderers without restructuring
 * their component code.
 *
 * Optional `viewport` — when provided, its `bounds()` are read each frame
 * and threaded through {@link paintNode} for off-screen subtree culling.
 *
 * @module
 */

import { createRenderer } from "../renderer.ts";
import type { RendererProtocol } from "../types.ts";
import { type ViewNode, view } from "../view-node.ts";
import { canvasHost } from "./host.ts";
import {
    CanvasNode,
    zeroBounds,
    type CanvasElementNode,
} from "./node.ts";
import { paintNode } from "./paint.ts";
import type { ViewportHandle } from "./viewport.ts";

/**
 * Configuration for {@link createCanvasRenderer}.
 */
export interface CanvasRendererOptions {
    /**
     * Optional viewport whose `bounds()` drive per-frame culling. Without
     * one, every element with non-empty bounds is painted unconditionally.
     */
    viewport?: ViewportHandle;
}

/**
 * Create a canvas-backed renderer.
 *
 * The returned `mount(component)` wires the component tree into a synthetic
 * root group, paints once synchronously after the initial mount, and then
 * re-paints inside each subsequent rAF flush (after the reconciler has
 * applied any queued reactive prop updates).
 *
 * Calling the returned unmount function tears down the reactive subscriptions
 * and clears the canvas.
 *
 * @example
 * ```ts
 * import { createCanvasRenderer, Viewport } from "aljabr/ui/canvas";
 *
 * const canvas = document.querySelector("canvas")!;
 * const vp = Viewport(canvas);
 * const r = createCanvasRenderer(canvas, { viewport: vp });
 *
 * const unmount = r.mount(() => (
 *   <group x={vp.x} y={vp.y} scale={vp.scale}>
 *     <rect x={0} y={0} width={100} height={100} fill="red" />
 *   </group>
 * ));
 * ```
 */
export function createCanvasRenderer(
    canvas: HTMLCanvasElement,
    options: CanvasRendererOptions = {},
): {
    view: typeof view;
    mount: (component: () => ViewNode) => () => void;
} {
    const ctx = canvas.getContext("2d");
    if (ctx === null) {
        throw new Error("createCanvasRenderer: 2d context not available");
    }

    // Synthetic root — a plain `<group>` that the reconciler mounts into.
    // It does not paint anything itself (group is transform-only and we
    // leave its transform props at the defaults), but its children are the
    // top of the user-authored scene graph.
    const root: CanvasElementNode = CanvasNode.Element({
        tag: "group",
        props: {},
        children: [],
        parent: null,
        bounds: zeroBounds(),
        zIndex: 0,
    });

    const repaint = (): void => {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        paintNode(ctx, root, options.viewport?.bounds());
    };

    const protocol: RendererProtocol = {
        scheduleFlush(flush) {
            requestAnimationFrame(() => {
                flush();
                repaint();
            });
        },
    };

    const inner = createRenderer(canvasHost, protocol);

    return {
        view,
        mount(component: () => ViewNode): () => void {
            const unmount = inner.mount(component, root);
            // Initial paint — the reconciler mounts synchronously, so by the
            // time we reach this line the scene graph reflects the first
            // render. Subsequent reactive updates flow through the rAF
            // protocol above.
            repaint();
            return () => {
                unmount();
                ctx.clearRect(0, 0, canvas.width, canvas.height);
            };
        },
    };
}
