# `aljabr/ui/prose` — `parse`

`parse` is the namespace for prose document parsers. v0.4.0 ships a single
member: `parse.jsx` — a registry-aware JSX → `DocumentState` parser.

> **v0.4.2 plans:** `parse.text`, `parse.html`, and `parse.json` are
> reserved for v0.4.2; v0.4.1's paste pipeline is structured to wire into
> them when they land. See the [v0.4.2 roadmap](../../roadmap/v0.4.2.md).

## `parse.jsx`

```ts
parse.jsx(
    node:    ViewNode,
    embeds?: EmbedRegistry,   // defaults to DEFAULT_EMBEDS
): Validation<DocumentState, DecodeError>;
```

Walks a JSX tree of prose primitives and returns
`Validation<DocumentState, DecodeError>`. The root must be a `<document>`
element (or a fragment whose first element child is one); the resulting
`DocumentState` carries the parsed `Document` plus a default cursor at the
first text node (or the document start when there is no text).

```tsx
/** @jsxImportSource aljabr/ui/prose */
import { parse } from "aljabr/ui/prose";
import { match } from "aljabr";

const result = parse.jsx(
    <document>
        <heading level={1}>Hello</heading>
        <block>
            <text>plain </text>
            <text bold>bold</text>
            <text italic>italic</text>
        </block>
        <list ordered>
            <listItem><block><text>first</text></block></listItem>
            <listItem><block><text>second</text></block></listItem>
        </list>
        <hr />
        <blockEmbed name="image" payload={{ src: "/cover.png", alt: null, caption: null }} />
    </document>,
);

match(result, {
    Valid:       ({ value }) => boot(value /* DocumentState */),
    Invalid:     ({ errors }) => console.error(errors /* DecodeError[] */),
    Unvalidated: () => {},
});
```

### Intrinsic tags

The closed structural set:

| Tag           | Required props        | Children                          | Builds            |
|---------------|-----------------------|-----------------------------------|-------------------|
| `document`    | —                     | blocks                            | `ProseNode.Document` |
| `block`       | —                     | inlines                           | `ProseNode.Block`    |
| `heading`     | `level: 1..6`         | inlines                           | `ProseNode.Heading`  |
| `quote`       | —                     | blocks                            | `ProseNode.Quote`    |
| `code`        | `language?: string`   | inlines (typically a single `<text>`) | `ProseNode.Code` |
| `list`        | `ordered?: boolean`   | `<listItem>` only                 | `ProseNode.List`     |
| `listItem`    | —                     | blocks                            | `ProseNode.ListItem` |
| `text`        | mark props *(see below)* | string children                | `ProseNode.Text`     |
| `break`       | —                     | —                                 | `ProseNode.HardBreak`|
| `hr`          | —                     | —                                 | `ProseNode.Hr`       |
| `blockEmbed`  | `name: string; payload: P` | —                            | `ProseNode.BlockEmbed`|
| `inlineEmbed` | `name: string; payload: P` | —                            | `ProseNode.InlineEmbed`|

Every intrinsic accepts an optional `id?: string` to pin a specific node ID.

### Mark props on `<text>`

```tsx
<text bold>strong</text>
<text italic underline>both</text>
<text link={{ href: "https://example.com" }}>linked</text>
<text color="#f00" backgroundColor="#ff0">styled</text>
<text fontSize={18}>sized</text>
<text marks={[Marks.Mention("user-123")]}>custom</text>
```

The boolean style marks (`bold`, `italic`, `underline`, `strike`, `code`),
the payload marks (`link`, `color`, `backgroundColor`, `fontFamily`,
`fontSize`), and a free-form `marks={[…]}` array are all collapsed into the
underlying `MarkSet[]`. Order: built-in marks first, then `marks={[]}`
appended.

### Author-registered embed tags

Registered embed names can be used directly as JSX tags. The parser uses the
prop bag (minus `id` / `children`) as the embed payload, runs it through the
embed's `schema`, and emits `BlockEmbed` or `InlineEmbed` based on the
registration's `placement`.

`ProseEmbeds` is a TypeScript interface exported from `aljabr/ui/prose`
that the package augments with its own `image` entry. Authors extend it via
module augmentation so their tag becomes a JSX intrinsic with type-checked
props:

```ts
declare module "aljabr/ui/prose" {
    interface ProseEmbeds {
        image: { src: string; alt?: string | null; caption?: string | null };
    }
}
```

The shape of the augmented entry must match the prop bag the parser will
hand to the registered schema for `decode`.

### Errors

Failures collect into a `DecodeError[]` (see `aljabr/schema`'s
[`DecodeError`](../schema.md)). The parser sequences child errors before
rejecting the parent — a single bad `<heading>` inside a paragraph won't
mask sibling errors.

Common error sites:

- Unknown tags (e.g. typo of `<headding>`)
- `<heading>` with no `level` or a non-integer level outside `1..6`
- `<list>` whose direct children are not `<listItem>`
- Missing or invalid `name`/`payload` on `<blockEmbed>` / `<inlineEmbed>`
- Embed payload that fails the registered schema
- Function components (intentionally unsupported — they couple to runtime
  reactivity)
- Top-level node that is not `<document>`

## See also

- [Document model](./document-model.md) — the closed primitive set
- [Embed registry](./embeds.md) — how registered embeds resolve
- [`<Prose>` Component](./index.md) — typically passes `parse.jsx`'s output
  into `Dispatcher.create(state, proseProtocol)`
- [Prelude: `Validation`](../prelude/validation.md) — the result type
- [Schema](../schema.md) — `DecodeError`, `Schema.*` builders for embed payloads
