/**
 * Canvas renderer entry point.
 *
 * Re-exports the {@link CanvasNode} type, the {@link CanvasHost}
 * implementation of `RendererHost`, the {@link CanvasRenderer} convenience
 * wrapper, the {@link Canvas} Component, the {@link Viewport} factory, and
 * supporting types.
 *
 * The {@link CanvasNode} value (the variant factory used as
 * `CanvasNode.Element({...})` / `CanvasNode.Text("…")`) is not re-exported
 * from this barrel — `verbatimModuleSyntax: true` rejects exporting the same
 * identifier as both a type and a value through this surface. Authors who
 * need the factory import it directly from `aljabr/ui/canvas/node`.
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
export { CanvasHost } from "./host.ts";
export { Viewport } from "./viewport.ts";
export type { ViewportHandle } from "./viewport.ts";
export { CanvasRenderer } from "./renderer.ts";
export type { CanvasRendererOptions } from "./renderer.ts";
export type { CanvasSyntheticEvent } from "./hit-test.ts";
export { Canvas } from "./component.tsx";
export type { CanvasProps } from "./component.tsx";
