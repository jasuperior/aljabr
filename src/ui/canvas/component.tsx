/** @jsxImportSource ../dom */

/**
 * `<Canvas>` — a renderer-agnostic Component that hosts a canvas-backed
 * subtree inside any parent renderer.
 *
 * The Component returns a plain `<canvas>` element with a `mounted` callback
 * that spawns {@link CanvasRenderer.create} and mounts the children function
 * into it. Lifecycle is fully encapsulated — the parent renderer (typically
 * the DOM) sees only the `<canvas>` view node and its `mounted` hook.
 *
 * For escape-hatch use (Three.js, Pixi, raw 2d), the low-level
 * `<canvas mounted={...}>` intrinsic remains available — `<Canvas>` is the
 * high-level path.
 *
 * @module
 */

import { defer } from "../../prelude/scope.ts";
import type { ViewNode } from "../view-node.ts";
import { CanvasRenderer } from "./renderer.ts";
import type { ViewportHandle } from "./viewport.ts";

export interface CanvasProps {
    /**
     * Optional viewport whose `bounds()` drive per-frame culling.
     */
    viewport?: ViewportHandle;
    /**
     * The canvas scene as a function returning a `ViewNode` tree of canvas
     * intrinsics. Pass as a child: `<Canvas>{Scene}</Canvas>`.
     */
    children: () => ViewNode;
}

export function Canvas({ viewport, children }: CanvasProps): ViewNode {
    return (
        <canvas
            mounted={(el) => {
                const r = CanvasRenderer.create({ viewport });
                const unmount = r.mount(children, el as HTMLCanvasElement);
                defer(unmount);
            }}
        />
    );
}
