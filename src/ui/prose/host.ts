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

export type ProseHostOptions = {
    embeds: EmbedRegistry;
};

export const ProseHost = {
    create(_options: ProseHostOptions): RendererHost<Node, Element> {
        // The registry is consulted by `projectDoc`, not by the host. The
        // options are accepted here for API stability — future versions may
        // grow host-level behaviour that depends on the registry.
        return DomHost;
    },
} as const;
