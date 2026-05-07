/**
 * ProseRenderer — thin wrapper over `Renderer.create(ProseHost.create(...))`.
 *
 * `ProseRenderer.create({ embeds? })` returns the same `{ view, mount }`
 * shape as the universal `Renderer.create`. `mount(fn, container)` is the
 * symmetric mount signature shared with `DomRenderer` and `CanvasRenderer`.
 *
 * Authors typically don't construct a `ProseRenderer` directly — the
 * `<Prose>` Component encapsulates lifecycle. The wrapper exists for the
 * rare case of driving a contenteditable surface manually (and for symmetry
 * with the other renderer wrappers).
 *
 * @module
 */
import { Renderer } from "../renderer.ts";
import type { Child, ViewNode, view } from "../view-node.ts";
import { ProseHost } from "./host.ts";
import { DEFAULT_EMBEDS, type EmbedRegistry } from "./embed-registry.ts";

export type ProseRendererOptions = {
    embeds?: EmbedRegistry;
};

export const ProseRenderer = {
    create(options: ProseRendererOptions = {}): {
        view: typeof view;
        mount: (fn: () => Child, container: Element) => () => void;
    } {
        const embeds = { ...DEFAULT_EMBEDS, ...options.embeds };
        const host = ProseHost.create({ embeds });
        return Renderer.create(host) as {
            view: typeof view;
            mount: (fn: () => Child, container: Element) => () => void;
        };
    },
} as const;

// Re-export the projection-driving registry for callers that bypass <Prose>.
export type { EmbedRegistry };
export { DEFAULT_EMBEDS };

// Type-only marker so authors can name the renderer's return type without
// reconstructing it.
export type ProseRendererInstance = {
    view: typeof view;
    mount: (fn: () => ViewNode, container: Element) => () => void;
};
