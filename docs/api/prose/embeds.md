# `aljabr/ui/prose` — Embed Registry

Embeds are the open extension point of the prose document model. They
project arbitrary domain data (images, polls, mentions, structured cards)
into the document tree with a payload schema that's validated on every
projection.

`BlockEmbed` and `InlineEmbed` are the two embed variants; each carries
`{ name, payload }` where `name` keys into a registry of definitions. The
projection (`projectDoc`) consults the registry at render time: the payload
is decoded against the definition's `Schema`, then the registered `render`
function turns the validated payload into a `ViewNode`. Failures emit a
placeholder span (with `console.warn` in dev mode).

## `EmbedDefinition`

```ts
type EmbedPlacement = "block" | "inline";

type EmbedDefinition<P = unknown> = {
    schema:    Schema<P>;
    placement: EmbedPlacement;
    render:    (payload: P) => ViewNode;
};

type EmbedRegistry = Record<string, EmbedDefinition>;
```

| Field        | Purpose                                                                                                       |
|--------------|---------------------------------------------------------------------------------------------------------------|
| `schema`     | Validated against the raw payload before `render` is called. Use `aljabr/schema`'s builders.                   |
| `placement`  | `"block"` or `"inline"`. Controls which document slot the embed is allowed in and the wrapper tag the projection emits (`<div>` for block, `<span>` for inline). |
| `render`     | Pure function from validated payload to a `ViewNode`. Run inside the renderer's reactive context, so it can call into signals. The projection wraps the result in `contenteditable={false}`. |

## `DEFAULT_EMBEDS`

The package ships one default embed: `image`, registered as a block embed.

```ts
import { DEFAULT_EMBEDS, type ImagePayload } from "aljabr/ui/prose";

DEFAULT_EMBEDS.image
// {
//   schema:    Schema.object({ src: string, alt: nullable(string), caption: nullable(string) }),
//   placement: "block",
//   render:    (payload) => <img src={payload.src} alt={payload.alt ?? ""} />,
// }
```

`<Prose>` merges author-supplied registries on top of the defaults, so
authors override `image` by re-registering it (or remove it by registering
`undefined`).

## Registration shape

The canonical example is the `image` registration shipped in `DEFAULT_EMBEDS`:

```ts
import { Schema } from "aljabr/schema";

const imageSchema = Schema.object({
    src:     Schema.string(),
    alt:     Schema.nullable(Schema.string()),
    caption: Schema.nullable(Schema.string()),
});
```

The registry entry pairs that schema with a placement and a render function.
Inside the document model the embed is referenced by name with the validated
payload as data:

```ts
import { ProseNode } from "aljabr/ui/prose";

ProseNode.BlockEmbed("image", { src: "/cover.png", alt: null, caption: null });
```

`<Prose embeds={…}>` merges author-supplied registrations on top of
`DEFAULT_EMBEDS`. Schemas are constructed with the builders from
`aljabr/schema` — `Schema.string`, `Schema.number`, `Schema.boolean`,
`Schema.literal`, `Schema.optional`, `Schema.nullable`, `Schema.nullish`,
`Schema.array`, `Schema.object`, `Schema.union`, `Schema.variant`,
`Schema.lazy`, `Schema.transform`. See the [Schema reference](../schema.md)
for the full builder list.

## Placement enforcement

The projection rejects placement mismatches:

- A `BlockEmbed("callout", …)` whose registry entry says `placement: "inline"`
  is rendered as a placeholder, with a dev-mode warning.
- An unregistered name renders a placeholder too — useful for previewing
  documents that reference embeds an authoring environment hasn't loaded.

The structural validator (`validatePlacement`) is independent of the registry
— it enforces that `BlockEmbed` lives in a block slot and `InlineEmbed` in an
inline slot regardless of registry shape.

## JSX integration via `parse.jsx`

When parsing static JSX trees, embed tags resolve through the same registry.
Two paths:

1. **Generic tags.** `<blockEmbed name="callout" payload={{ tone, body }}>`
   and `<inlineEmbed name="…" payload={…}>` work with any registry.
2. **Author-chosen tags.** When the registry has an entry whose name matches
   the JSX tag, the parser uses the JSX props (minus `id` / `children`) as
   the embed payload, decodes them through the registered schema, and emits
   `BlockEmbed` or `InlineEmbed` based on the registration's `placement`.
   The `ProseEmbeds` interface is the TypeScript module-augmentation point
   for declaring such tags as JSX intrinsics — see [`parse.jsx`](./parse.md)
   for the augmentation shape.

See [`parse.jsx`](./parse.md) for the full parse surface.

## See also

- [Document model](./document-model.md) — `BlockEmbed` / `InlineEmbed`
  variants in the closed primitive set
- [`<Prose>` Component](./index.md) — `embeds` prop merging
- [`parse.jsx`](./parse.md) — registry-aware static authoring
- [Schema](../schema.md) — building payload schemas
