# `aljabr/ui/prose` — Document Model

The prose document model is the foundation of the v0.4.0 prose renderer. It
consists of three exports: the `ProseNode` tagged union (the closed primitive
set), the `MarkSet` tagged union (inline formatting), and `getNodeId` (stable
node identity).

## Closed primitive set

The renderer ships **eight node types**. Custom semantic nodes (mentions,
embeds, widgets) are JSX *components* that render to these primitives — not
new node types in the renderer.

| Tag         | Category   | Payload                                                  |
| ----------- | ---------- | -------------------------------------------------------- |
| `Document`  | Structural | `{ children: ProseNode[] }`                              |
| `Block`     | Block      | `{ children: ProseNode[] }`                              |
| `Heading`   | Block      | `{ level: 1..6; children: ProseNode[] }`                 |
| `Quote`     | Block      | `{ children: ProseNode[] }`                              |
| `Code`      | Block      | `{ language: string \| null; children: ProseNode[] }`    |
| `Text`      | Inline     | `{ content: string; marks: MarkSet[] }`                  |
| `Image`     | Void       | `{ src: string; alt: string \| null; caption: string \| null }` |
| `HardBreak` | Inline     | `{}`                                                     |
| `Hr`        | Void       | `{}`                                                     |

### Rationale

Custom node behaviour (editability, void semantics, cursor containment) is
expressible through props on existing primitives. A `<Mention>` JSX component
renders to `<text editable={false} mention userId="123">@jamel</text>` — the
renderer only needs to understand `<text>`. Opening the renderer to
author-registered node types would add ceremony (NodeSpec interfaces,
registration calls, lifecycle hooks) for capabilities that components already
provide.

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
])
```

Variants are tagged unions built with `aljabr`'s `union(...).typed(...)`
machinery — `match()` works exhaustively over them.

```ts
import { match } from "aljabr"

const label = match(node, {
    Document:  () => "doc",
    Block:     () => "block",
    Heading:   ({ level }) => `h${level}`,
    Quote:     () => "quote",
    Code:      ({ language }) => `code:${language ?? "plain"}`,
    Text:      ({ content }) => `"${content}"`,
    Image:     ({ src }) => `img:${src}`,
    HardBreak: () => "br",
    Hr:        () => "hr",
})
```

## Marks

Inline formatting lives on `<text>` as a `MarkSet[]`. `MarkSet` is itself a
tagged union with three categories of built-in variants:

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

The JSX surface (Phase 4) accepts the built-in style and payload marks as
*direct props* on `<text>` — `<text bold>`, `<text link={{ href }}>`,
`<text color="#f00">` — and collapses them into the underlying `marks` array.
Custom marks pass through the `marks={[...]}` prop directly. There is one
storage location, one union, one serialization path.

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

- **Stable across structural mutations.** A `RangePoint` (Phase 2) refers to a
  node by its ID, surviving inserts, deletes, and re-renders elsewhere in the
  tree.
- **Serializable.** The ID is a plain string. Cross-block references (e.g., a
  link mark targeting another block) just store the string in their own
  payload.
- **Off `JSON.stringify`.** The ID is held on a non-enumerable symbol-keyed
  property, so default JSON serialization is clean. Wire-format serialization
  via `aljabr/schema` reads the ID through `getNodeId` and emits it
  explicitly.
- **Caller-supplied or auto-generated.** Parsers (Phase 7's `parse.jsx`,
  future `parse.json`) pass IDs through; fresh authoring auto-generates.

## Placement validation

`validatePlacement(root)` walks a tree and reports structural violations as a
`Validation<ProseNode, PlacementError>`.

```
Document, Quote          → may contain blocks
Block, Heading, Code     → may contain inlines
Text, HardBreak, Image, Hr → leaves
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

`PlacementError` carries `{ nodeId, parentTag, childTag, message }`. Phase 7's
`parse.jsx` and the renderer (Phase 4) both consume this validator.

## Exports

```ts
// from "aljabr/ui/prose"
export { ProseNode, MarkSet, getNodeId, validatePlacement }
export type {
    Document, Block, Heading, Quote, Code,
    Text, Image, HardBreak, Hr,
    PlacementError,
}
```

The `aljabr/ui/prose/jsx-runtime` subpath ships the JSX factory and the
`JSX.IntrinsicElements` declarations for the primitives — set
`jsxImportSource: "aljabr/ui/prose"` (or use a per-file pragma) to type prose
components against the closed set.

## Status

Phase 1 of v0.4.0. Phase 2 (`EditorRange`/`RangePoint`) and Phase 3
(`ProseCommand` + `defaultApply`) build directly on these types.
