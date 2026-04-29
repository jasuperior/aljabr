/**
 * Canvas renderer entry point.
 *
 * Re-exports the {@link CanvasNode} type, the {@link canvasHost}
 * implementation of `RendererHost`, the pre-wired
 * {@link createCanvasRenderer}, the {@link Viewport} factory, and supporting
 * types.
 *
 * The {@link CanvasNode} value (the variant factory used as
 * `CanvasNode.Element({...})` / `CanvasNode.Text("…")`) is not re-exported
 * from this barrel — `verbatimModuleSyntax: true` rejects exporting the same
 * identifier as both a type and a value through this surface. Authors who
 * need the factory import it directly from `aljabr/ui/canvas/node`.
 *
 * Internal paint utilities and the rAF protocol are not exported. Authors
 * who need a custom protocol use `createRenderer(canvasHost, myProtocol)`
 * from `aljabr/ui` directly.
 *
 * @module
 */

export type {
    CanvasBounds,
    CanvasElementNode,
    CanvasNode,
    CanvasTag,
    CanvasTextNode,
} from "./node.ts";
export { zeroBounds } from "./node.ts";
export { canvasHost } from "./host.ts";
export { Viewport } from "./viewport.ts";
export type { ViewportHandle } from "./viewport.ts";
export { createCanvasRenderer } from "./renderer.ts";
export type { CanvasRendererOptions } from "./renderer.ts";
