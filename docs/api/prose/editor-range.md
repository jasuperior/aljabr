# `aljabr/ui/prose` — EditorRange and RangePoint

The cursor / selection state of a prose document is modeled as an
`EditorRange` — a tagged union over the three modes a selection can be in.
Positions inside the document are described by `RangePoint`s.

## `RangePoint`

```ts
type RangePoint = {
    nodeId: string   // stable ID of the containing node
    offset: number   // character offset within the node's text
    line: number     // logical line (newline-delimited, NOT visual after wrap)
    col: number      // logical column
    absolute: number // absolute character offset in the document
}
```

### Why stable node IDs

The alternative is a path (`[0, 2, 1]` from the document root) or a direct
`ViewNode` reference. Paths invalidate on every structural mutation; direct
references couple the cursor to renderer internals and break across
re-renders. Stable IDs survive structural mutations, are serializable
(foundation for collaborative editing in v0.5.0), and let authors stamp their
own IDs via a JSX `id` prop for cases like permalink anchors.

### Why logical (not visual) line/col

Word-wrapped paragraphs would force the renderer to maintain layout
information that's expensive to compute on every cursor move. Authors who
need visual coordinates for a popup or tooltip (e.g., autocomplete dropdown
anchored to the cursor) read the browser's `getBoundingClientRect()` on the
active selection — that's already native behaviour and survives wrapping.

### Invariants

- **`absolute`** is the sum of preceding nodes' content lengths plus this
  node's local `offset`. The renderer's selection-binding layer (Phase 6)
  produces fully-populated `RangePoint`s when translating browser
  `Selection`s into the model.
- **`line` / `col`** count *logical* newlines (`\n` inside `Text.content`,
  block boundaries, `HardBreak` nodes) — not visual wraps.

## `EditorRange`

```ts
type Cursor    = Variant<"Cursor", { point: RangePoint }>
type TextRange = Variant<"Text",   { anchor: RangePoint; focus: RangePoint }>
type NodeRange = Variant<"Node",   { nodeId: string }>
type EditorRange = Cursor | TextRange | NodeRange
```

### The three modes

- **`Cursor`** — collapsed selection; one `RangePoint`.
- **`Text`** — text selection; an `anchor` (where selection started) and
  `focus` (where selection ended). `focus` may precede `anchor` when the user
  drag-selects right-to-left.
- **`Node`** — node selection; a single void node (e.g., an `<image>` clicked
  once) is "selected" as a unit. Commands like `Delete` operate differently
  in this mode (remove the whole node) versus text mode (remove the selected
  range).

### Construction

```ts
import { EditorRange } from "aljabr/ui/prose"

const cursor = EditorRange.Cursor(point)
const text   = EditorRange.Text(anchor, focus)
const node   = EditorRange.Node("img-1")
```

### Pattern matching

```ts
import { match } from "aljabr"

match(range, {
    Cursor: ({ point }) => `cursor at ${point.absolute}`,
    Text:   ({ anchor, focus }) => `text ${anchor.absolute}..${focus.absolute}`,
    Node:   ({ nodeId }) => `node ${nodeId}`,
})
```

## Wire serialization

`editorRangeSchema` and `rangePointSchema` ship in `aljabr/ui/prose` for
serializing ranges to a wire format. They are used by collaborative-editing
transports (v0.5.0) and the internal clipboard format (v0.4.1). Authors can
compose, override, or replace via the existing `aljabr/schema` builders.

The default discriminant key is `"type"`. Wire shapes:

```
EditorRange.Cursor(point)   → { type: "Cursor", point: {...} }
EditorRange.Text(a, f)      → { type: "Text", anchor: {...}, focus: {...} }
EditorRange.Node(nodeId)    → { type: "Node", nodeId: "..." }
```

To customize the discriminant key or remap variant tags, build the schema
directly with `Schema.variant`'s `options` argument.

```ts
import { roundtrip } from "aljabr/schema"
import { editorRangeSchema, EditorRange } from "aljabr/ui/prose"

const range = EditorRange.Node("img-1")
roundtrip(editorRangeSchema, { type: "Node", nodeId: "img-1" }) // → true
```

## Implementation note

`Schema.variant` invokes `factory[name](decodedPayload)` with one positional
argument (the whole decoded payload object), while `EditorRange`'s public
constructors take per-field arguments for ergonomics. The schema bridges this
with a small adapter object whose keys map decoded payloads to the public
factories — `EditorRange` itself stays a clean tagged union with
ergonomic call sites.

## Exports

```ts
// from "aljabr/ui/prose"
export { EditorRange, rangePointSchema, editorRangeSchema }
export type { RangePoint, Cursor, TextRange, NodeRange }
```

## Status

Phase 2 of v0.4.0. Phase 3 (`ProseCommand` + `defaultApply`) consumes
`EditorRange` and `RangePoint` directly.
