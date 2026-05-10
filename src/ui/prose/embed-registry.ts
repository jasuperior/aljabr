/**
 * Embed registry — the open extension point of the prose document model.
 *
 * Authors register embed definitions with `<Prose embeds={…}>`; the registry
 * couples a payload schema, a placement (block-or-inline) constraint, and a
 * render function that turns a validated payload into a `ViewNode`. The
 * projection (see `projection.ts`) consults the registry when it encounters
 * `BlockEmbed` / `InlineEmbed` document variants.
 *
 * The package ships a default `image` registration; authors override or
 * remove it via the `embeds` prop on `<Prose>`.
 *
 * @module
 */
import { Schema, type Schema as SchemaT } from "../../schema/index.ts";
import { view, type ViewNode } from "../view-node.ts";

/**
 * Where in the document an embed is allowed to live: as a block-level node
 * (alongside paragraphs, headings, lists) or as an inline node (alongside
 * `Text` and `HardBreak` inside a block).
 */
export type EmbedPlacement = "block" | "inline";

/**
 * A single embed registration. Couples a payload schema, a placement
 * constraint, and a render function from validated payload to `ViewNode`.
 *
 * The projection decodes the raw payload against `schema` before calling
 * `render`. On failure the projection emits a placeholder element (and warns
 * in dev mode); the document tree is unaffected.
 *
 * @typeParam P - The shape of the validated payload, after `schema` decodes
 *   the raw `unknown` payload stored on `BlockEmbed` / `InlineEmbed`.
 */
export type EmbedDefinition<P = unknown> = {
    schema: SchemaT<P>;
    placement: EmbedPlacement;
    render: (payload: P) => ViewNode;
};

/**
 * A registry of embeds keyed by their author-chosen name. `<Prose embeds={…}>`
 * merges author-supplied registries on top of {@link DEFAULT_EMBEDS}.
 */
export type EmbedRegistry = Record<string, EmbedDefinition>;

const imageSchema = Schema.object({
    src:     Schema.string(),
    alt:     Schema.nullable(Schema.string()),
    caption: Schema.nullable(Schema.string()),
});

/**
 * Validated payload of the default-registered `image` block embed.
 *
 * Authors who replace the default registration with their own image renderer
 * may continue to reference this type, or define their own.
 */
export type ImagePayload = {
    src: string;
    alt: string | null;
    caption: string | null;
};

/**
 * Default embed registry. Ships a single `image` block embed; authors merge
 * additional registrations via the `embeds` prop on `<Prose>` (or override
 * `image` by re-registering the same key).
 */
export const DEFAULT_EMBEDS: EmbedRegistry = {
    image: {
        schema:    imageSchema as SchemaT<unknown>,
        placement: "block",
        render: (payload) => {
            const { src, alt } = payload as ImagePayload;
            return view("img", { src, alt: alt ?? "" });
        },
    },
};
