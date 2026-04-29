/**
 * Canvas renderer entry point.
 *
 * Re-exports the {@link CanvasNode} type, the {@link canvasHost}
 * implementation of `RendererHost`, and supporting types. Pre-wired
 * `createCanvasRenderer`, `Viewport`, and the rAF protocol arrive in Phase 4.
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
export { canvasHost } from "./host.ts";
