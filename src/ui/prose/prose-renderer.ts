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

/**
 * Configuration for {@link ProseRenderer.create}.
 */
export type ProseRendererOptions = {
    /**
     * Embed registry merged over {@link DEFAULT_EMBEDS}. Authors override or
     * remove default registrations by supplying entries with the same key.
     */
    embeds?: EmbedRegistry;
};

/**
 * Convenience wrapper for prose-backed rendering.
 *
 * `ProseRenderer.create({ embeds })` is equivalent to
 * `Renderer.create(ProseHost.create({ embeds }))` after merging `embeds`
 * over {@link DEFAULT_EMBEDS}. Authors typically don't construct one
 * directly — the `<Prose>` Component encapsulates lifecycle. Reach for it
 * when driving a contenteditable surface manually.
 */
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

/**
 * The shape returned by {@link ProseRenderer.create} — exposed as a named
 * type so authors can spell the return type without reconstructing it.
 */
export type ProseRendererInstance = {
    view: typeof view;
    mount: (fn: () => ViewNode, container: Element) => () => void;
};
