# `aljabr/ui/prose` — Commands

`ProseCommand` is the closed vocabulary of edits the prose renderer
understands. `defaultApply` is the reference interpreter; `proseProtocol`
bundles `extract` + `apply` for use with a `Dispatcher`.

Every command produces a `Validation<ApplyResult<DocumentState, ProseCommand>, CommandError>`.
A successful apply returns both the next `DocumentState` and an **inverse
command** that, when applied to the next state, restores the previous state.
This is the primitive every undo stack composes against.

## Vocabulary

| Variant            | Payload                                                  | Inverse                                |
| ------------------ | -------------------------------------------------------- | -------------------------------------- |
| `SetCursor`        | `{ range: EditorRange }`                                 | `SetCursor(prevCursor)`                |
| `Insert`           | `{ content: string \| ProseNode[]; at: RangePoint }`     | `DeleteForward` over inserted span     |
| `DeleteBackward`   | `{ range: EditorRange }`                                 | `Insert` of removed content            |
| `DeleteForward`    | `{ range: EditorRange }`                                 | `Insert` of removed content            |
| `Format`           | `{ mark: MarkSet; range: EditorRange }`                  | `RemoveMark` over the same range       |
| `RemoveMark`       | `{ markTag: string; range: EditorRange }`                | `Compound` of `Format` per segment     |
| `SplitBlock`       | `{ at: RangePoint; newBlockId: string \| null }`         | `MergeBlock(at)`                       |
| `MergeBlock`       | `{ at: RangePoint }`                                     | `SplitBlock` at the join point         |
| `SetBlockKind`     | `{ range: EditorRange; kind: BlockKind }`                | `Compound` restoring per-block kinds   |
| `ToggleList`       | `{ range: EditorRange; ordered: boolean }`               | `ToggleList` over the same range       |
| `IndentListItem`   | `{ range: EditorRange }`                                 | `OutdentListItem(range)`               |
| `OutdentListItem`  | `{ range: EditorRange }`                                 | `IndentListItem(range)`                |
| `SplitListItem`    | `{ at: RangePoint }`                                     | `MergeBlock` at the boundary           |
| `Compound`         | `{ steps: ProseCommand[] }`                              | `Compound` of reversed inverses        |

`BlockKind` is its own small union (`Block`, `Heading(level)`, `Quote`,
`Code(language)`) — distinct from `ProseNode` tags because it excludes void
blocks and carries per-kind metadata.

## Constructing commands

```ts
import { ProseCommand, EditorRange, MarkSet, BlockKind } from "aljabr/ui/prose"

ProseCommand.Insert("hello", point)              // string content
ProseCommand.Insert([ProseNode.HardBreak()], pt) // structural content
ProseCommand.Format(MarkSet.Bold(), range)
ProseCommand.SplitBlock(point)                   // auto block id
ProseCommand.SplitBlock(point, { newBlockId: "b2" })
ProseCommand.SetBlockKind(range, BlockKind.Heading(2))
ProseCommand.ToggleList(range, /* ordered */ false)
ProseCommand.IndentListItem(range)
ProseCommand.SplitListItem(point)
ProseCommand.Compound([cmd1, cmd2])
```

## Applying commands

```ts
import { defaultApply, proseProtocol } from "aljabr/ui/prose"
import { match } from "aljabr"

const result = defaultApply(state, ProseCommand.Insert("x", at))
match(result, {
    Valid:       ({ value: { next, inverse } }) => /* ... */,
    Invalid:     ({ errors }) => /* CommandError list */,
    Unvalidated: () => { /* unreachable */ },
})
```

`proseProtocol` is the `CommandProtocol<DocumentState, Document, ProseCommand>`
ready to plug into a `Dispatcher`:

```ts
import { Dispatcher } from "aljabr/prelude"
import { proseProtocol, ProseNode, EditorRange } from "aljabr/ui/prose"

const initialDoc = ProseNode.Document([
    ProseNode.Block([ProseNode.Text("Hello")]),
])
const editor = Dispatcher.create({
    doc: initialDoc,
    cursor: EditorRange.Cursor({ nodeId: "", offset: 0, line: 0, col: 0, absolute: 0 }),
}, proseProtocol)
```

Pass `editor` as `state={editor}` to `<Prose>` (see the [Prose overview](./index.md)).

## Round-trip semantics

```ts
const { next, inverse } = unwrap(defaultApply(state, cmd))
const { next: restored } = unwrap(defaultApply(next, inverse))
// restored.doc and state.doc are equivalent under normalizeText
```

Equivalence is **post-normalization**. The model deliberately preserves
fragmentation produced by edits (e.g. an `Insert` between two same-marked
Texts leaves three Text nodes); consumers call `normalizeText` (also exported
from `aljabr/ui/prose`) when they need a canonical form. This keeps inverse
anchors stable: a node ID referenced by an inverse command is guaranteed to
still exist in the immediate `next` state.

## Spanning ranges

Range commands (`DeleteBackward`, `DeleteForward`, `Format`, `RemoveMark`,
`SetBlockKind`) accept any `EditorRange` — including `TextRange` that crosses
block boundaries and `NodeRange`. Spanning deletes splice intermediate blocks;
spanning formats apply per-segment. The inverse for spanning operations is a
`Compound` whose steps reproduce the per-segment edits in reverse order.

## List operations

`ToggleList`, `IndentListItem`, `OutdentListItem`, and `SplitListItem` operate
on the structural list shape:

- **`ToggleList`** wraps the block ancestor of `range.from` in a single-item
  list, or unwraps the enclosing list back to flat blocks. The `ordered`
  argument selects `<ol>` vs `<ul>` on the wrap path.
- **`IndentListItem`** demotes the enclosing list item under its preceding
  sibling — appending into a same-`ordered` nested list when one exists, or
  creating one otherwise.
- **`OutdentListItem`** promotes the enclosing list item one level up.
  Top-level outdents split the list around the promoted item; nested
  outdents promote it to a sibling of its enclosing item.
- **`SplitListItem`** is the `<Enter>` semantics inside a list item: splits
  the surrounding block via `SplitBlock`, then partitions the item's blocks
  into the original item and a new sibling.

The `beforeinput` translator dispatches `SplitListItem` for `insertParagraph`
when the cursor is inside a list item, and `SplitBlock` otherwise.

## Extending the vocabulary

`ProseCommand` is open via `union.merge`. Domain-specific commands extend the
base union; the apply composes via `match()` with a `[__]` fallback that
delegates to `defaultApply`:

```ts
import { ProseCommand, defaultApply } from "aljabr/ui/prose"
import { match, __ } from "aljabr"

const ExtendedCommand = ProseCommand.merge({
    InsertMention: (userId: string, at: RangePoint) => ({ userId, at }),
})

const extendedApply = (state, cmd) =>
    match(cmd, {
        InsertMention: ({ userId, at }) => /* custom logic, return Validation */,
        [__]: (c) => defaultApply(state, c),
    })
```

The extension's apply is responsible for producing an inverse — typically a
built-in command (`DeleteForward` over the inserted span) so that undo flows
back through `defaultApply` without further extension support.

## Errors

Failures return `Validation.Invalid` with one or more `CommandError`s
(see [`CommandError`](../prelude/command-error.md)):

- `Conflict(msg)` — target node missing, wrong tag, or otherwise rejects the
  edit (e.g. `Insert(text)` aimed at a non-Text node).
- `Rejected(msg)` — input shape is invalid for the command (e.g.
  `SetBlockKind` with a Node range pointing at a non-block).
- `OutOfRange(msg)` — offset past content length, range endpoints inverted.
- `Invariant(msg)` — would produce a structurally invalid document
  (`validatePlacement` would fail on the result).

Apply implementations never throw for input-shaped errors; structural bugs in
the implementation itself are the only thing that escapes as exceptions.

## See also

- [Document model](./document-model.md) — `ProseNode`, `MarkSet`, `BlockKind`,
  `validatePlacement`, `DocumentState`
- [`EditorRange` / `RangePoint`](./editor-range.md) — the selection model
  every range-bearing command consumes
- [`<Prose>` Component & `ProseRenderer`](./index.md) — the surface that
  dispatches these commands
- [`beforeinput` translator](./before-input.md) — DOM `InputEvent` → command
  routing for the contenteditable surface
