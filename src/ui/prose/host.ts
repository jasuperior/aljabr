/**
 * ProseHost — DOM host specialised for the prose surface.
 *
 * `ProseHost.create({ embeds })` returns a `RendererHost` instance suitable
 * for `Renderer.create`. In v0.4.0 it is a strict superset of `DomHost`:
 * every method delegates to `DomHost`, and the registry is carried only for
 * future extension. Embed projection happens inside `projectDoc` (see
 * `projection.ts`), not inside the host's `createElement` — this keeps the
 * host trivial and honours the `RendererHost` contract that
 * `createElement(tag)` does not see element props.
 *
 * The lowercase `proseHost` global singleton intentionally does not exist:
 * `ProseHost` is parameterised by the embed registry, so each `<Prose>`
 * instance creates its own host through `ProseHost.create(...)`.
 *
 * @module
 */
import { DomHost } from "../dom/host.ts";
import type { RendererHost } from "../types.ts";
import type { EmbedRegistry } from "./embed-registry.ts";

/**
 * Configuration for {@link ProseHost.create}.
 */
export type ProseHostOptions = {
    /**
     * The embed registry consumed by the projection layer. The host carries
     * it for future extension; in v0.4.0 it is unused inside the host
     * itself.
     */
    embeds: EmbedRegistry;
};

/**
 * Factory for a prose-shaped {@link RendererHost}. In v0.4.0 the produced
 * host delegates every method to {@link DomHost}; the registry is
 * consulted by the projection (`projectDoc`), not by the host itself.
 *
 * Use through {@link ProseRenderer.create} unless you need a custom host
 * wrapper.
 */
export const ProseHost = {
    create(_options: ProseHostOptions): RendererHost<Node, Element> {
        // The registry is consulted by `projectDoc`, not by the host. The
        // options are accepted here for API stability — future versions may
        // grow host-level behaviour that depends on the registry.
        return DomHost;
    },
} as const;
