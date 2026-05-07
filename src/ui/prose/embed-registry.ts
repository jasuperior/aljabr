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

export type EmbedPlacement = "block" | "inline";

export type EmbedDefinition<P = unknown> = {
    schema: SchemaT<P>;
    placement: EmbedPlacement;
    render: (payload: P) => ViewNode;
};

export type EmbedRegistry = Record<string, EmbedDefinition>;

const imageSchema = Schema.object({
    src:     Schema.string(),
    alt:     Schema.nullable(Schema.string()),
    caption: Schema.nullable(Schema.string()),
});

export type ImagePayload = {
    src: string;
    alt: string | null;
    caption: string | null;
};

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
