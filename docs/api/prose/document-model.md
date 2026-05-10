# `aljabr/ui/prose` — Document Model

The prose document model is the foundation of the v0.4.0 prose renderer. It
consists of three pieces: the `ProseNode` tagged union (the closed primitive
set), the `MarkSet` tagged union (inline formatting), and `getNodeId` (stable
node identity). `Document` is the root variant; `DocumentState` (paired with
`EditorRange`) is what a `<Prose>` `Dispatcher` holds.

## Closed primitive set

The renderer ships **twelve node types**. Custom semantic nodes (mentions,
widgets, structured cards) are either embeds (registered via the
[embed registry](./embeds.md)) or JSX components that render to these
primitives — not new node types in the renderer.

| Tag           | Category   | Payload                                                  |
| ------------- | ---------- | -------------------------------------------------------- |
| `Document`    | Structural | `{ children: ProseNode[] }`                              |
| `Block`       | Block      | `{ children: ProseNode[] }`                              |
| `Heading`     | Block      | `{ level: 1..6; children: ProseNode[] }`                 |
| `Quote`       | Block      | `{ children: ProseNode[] }`                              |
| `Code`        | Block      | `{ language: string \| null; children: ProseNode[] }`    |
| `List`        | Block      | `{ ordered: boolean; children: ListItem[] }`             |
| `ListItem`    | Block-container | `{ children: ProseNode[] }`                         |
| `Text`        | Inline     | `{ content: string; marks: MarkSet[] }`                  |
| `HardBreak`   | Inline     | `{}`                                                     |
| `Hr`          | Void block | `{}`                                                     |
| `BlockEmbed`  | Void block | `{ name: string; payload: unknown }`                     |
| `InlineEmbed` | Void inline| `{ name: string; payload: unknown }`                     |

Image is **not** a primitive — it ships as a default-registered `BlockEmbed`
named `"image"` (see [embeds](./embeds.md)). Authors swap out the renderer or
replace the `image` schema by overriding it in the `embeds` prop on `<Prose>`.

### Rationale

The closed set covers the structural and inline semantics every prose editor
needs (paragraphs, headings, quotes, lists, code, hr, line breaks). Anything
domain-specific — mentions, datatables, polls, embeds of arbitrary services —
projects through the embed registry: a payload schema, a placement constraint
(block / inline), and a `render` function from validated payload to
`ViewNode`. The renderer never grows author-extensible "node types" — that
ceremony is replaced by the registry.

## Constructing nodes

Each variant has a factory on `ProseNode`. The trailing `id?: string` argument
lets callers pin a specific node ID; otherwise one is auto-generated.

```ts
import { ProseNode, MarkSet } from "aljabr/ui/prose"

const doc = ProseNode.Document([
    ProseNode.Heading(1, [ProseNode.Text("Aljabr")]),
    ProseNode.Block([
        ProseNode.Text("Hello, ", []),
        ProseNode.Text("world", [MarkSet.Bold()]),
        ProseNode.Text("."),
    ]),
    ProseNode.List(false /* unordered */, [
        ProseNode.ListItem([ProseNode.Block([ProseNode.Text("first item")])]),
        ProseNode.ListItem([ProseNode.Block([ProseNode.Text("second item")])]),
    ]),
    ProseNode.BlockEmbed("image", {
        src: "/cover.png", alt: "cover", caption: null,
    }),
])
```

Variants are tagged unions built with `aljabr`'s `union(...).typed(...)`
machinery — `match()` works exhaustively over them.

```ts
import { match } from "aljabr"

const label = match(node, {
    Document:    () => "doc",
    Block:       () => "block",
    Heading:     ({ level }) => `h${level}`,
    Quote:       () => "quote",
    Code:        ({ language }) => `code:${language ?? "plain"}`,
    List:        ({ ordered }) => ordered ? "ol" : "ul",
    ListItem:    () => "li",
    Text:        ({ content }) => `"${content}"`,
    HardBreak:   () => "br",
    Hr:          () => "hr",
    BlockEmbed:  ({ name }) => `block-embed:${name}`,
    InlineEmbed: ({ name }) => `inline-embed:${name}`,
})
```

## Marks

Inline formatting lives on `<Text>` as a `MarkSet[]`. `MarkSet` is a tagged
union with three categories of built-in variants:

- **Style marks** (no payload): `Bold`, `Italic`, `Underline`, `Strike`, `Code`.
- **Payload marks**: `Link({ href })`, `Color`, `BackgroundColor`,
  `FontFamily`, `FontSize`.
- **Custom marks**: extended via `MarkSet.merge({ ... })`. The built-in
  variants remain available on the merged union.

```ts
const Marks = MarkSet.merge({
    Mention: (userId: string) => ({ userId }),
    Comment: (threadId: string) => ({ threadId }),
})

const text = ProseNode.Text("@jamel", [
    Marks.Bold(),
    Marks.Mention("user-123"),
])
```

The JSX surface (parse.jsx) accepts the built-in style and payload marks as
*direct props* on `<text>` — `<text bold>`, `<text link={{ href }}>`,
`<text color="#f00">` — and collapses them into the underlying `marks` array.
Custom marks pass through the `marks={[...]}` prop directly.

## Node IDs

Every node carries a stable, non-enumerable string ID, accessible via
`getNodeId(node)`:

```ts
import { getNodeId } from "aljabr/ui/prose"

const block = ProseNode.Block([])
getNodeId(block) // → "n1xa3f9z" (auto-generated)

const pinned = ProseNode.Block([], "intro-paragraph")
getNodeId(pinned) // → "intro-paragraph"
```

### Properties

- **Stable across structural mutations.** A `RangePoint` refers to a
  node by its ID, surviving inserts, deletes, and re-renders elsewhere in the
  tree.
- **Serializable.** The ID is a plain string. Cross-block references (e.g., a
  link mark targeting another block) just store the string in their own
  payload.
- **Off `JSON.stringify`.** The ID is held on a non-enumerable symbol-keyed
  property, so default JSON serialization is clean. Wire-format serialization
  via `aljabr/schema` reads the ID through `getNodeId` and emits it
  explicitly.
- **Caller-supplied or auto-generated.** Parsers (`parse.jsx`,
  future `parse.json`) pass IDs through; fresh authoring auto-generates.
- **Stamped on the rendered DOM.** The projection writes
  `data-aljabr-id="<id>"` on every element it produces; the
  selection-binding layer uses this attribute to translate browser
  `Selection`s into `RangePoint`s and back.

## `DocumentState`

```ts
type DocumentState = {
    doc: Document
    cursor: EditorRange
}
```

The reactive state owned by a prose `Dispatcher`. The renderer reads `doc`
for the document tree and `cursor` for the current selection; commands
transition both atomically.

## `BlockKind`

```ts
const BlockKind = union({
    Block:   () => ({}),
    Heading: (level: 1 | 2 | 3 | 4 | 5 | 6) => ({ level }),
    Quote:   () => ({}),
    Code:    (language: string | null) => ({ language }),
})
```

A small sibling union used by the [`SetBlockKind` command](./commands.md). It
deliberately excludes `Hr` and `BlockEmbed` (those aren't valid conversion
targets) and carries per-kind payload (heading level, code language).

## Placement validation

`validatePlacement(root)` walks a tree and reports structural violations as a
`Validation<ProseNode, PlacementError>`:

```
Document, Quote, ListItem    → may contain blocks (Block, Heading, Quote, Code, List, Hr, BlockEmbed)
Block, Heading, Code         → may contain inlines (Text, HardBreak, InlineEmbed)
List                         → ListItem children only
Text, HardBreak, Hr,
BlockEmbed, InlineEmbed      → leaves (no children)
```

```ts
import { validatePlacement } from "aljabr/ui/prose"
import { match } from "aljabr"

match(validatePlacement(root), {
    Valid:       ({ value })  => value,
    Invalid:     ({ errors }) => { throw new Error(JSON.stringify(errors)); },
    Unvalidated: ()           => { throw new Error("unreachable"); },
})
```

`PlacementError` carries `{ nodeId, parentTag, childTag, message }`.
`parse.jsx` and the commands layer both consume this validator.

## Exports

```ts
// from "aljabr/ui/prose"
export { ProseNode, MarkSet, getNodeId, validatePlacement }
export { BlockKind }
export type {
    Document, Block, Heading, Quote, Code, List, ListItem,
    Text, HardBreak, Hr, BlockEmbed, InlineEmbed,
    DocumentState,
    PlacementError,
}
```

The `aljabr/ui/prose/jsx-runtime` subpath ships the JSX factory and the
`JSX.IntrinsicElements` declarations for the primitives — set
`jsxImportSource: "aljabr/ui/prose"` (or use a per-file pragma) to type prose
components against the closed set. Author-registered embed tags can be added
to the intrinsic set through the exported `ProseEmbeds` interface (TypeScript
module augmentation).

## See also

- [`<Prose>` Component & `ProseRenderer`](./index.md) — author surface and
  renderer wrapper
- [Commands & `defaultApply`](./commands.md) — the closed command vocabulary
- [`EditorRange` / `RangePoint`](./editor-range.md) — selection model
- [Embed registry](./embeds.md) — schema-driven block/inline extension points
- [`parse.jsx`](./parse.md) — registry-aware static authoring
