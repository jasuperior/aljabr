# `aljabr/ui/prose` — Commands

`ProseCommand` is the closed vocabulary of edits the prose renderer
understands. `defaultApply` is the reference interpreter; `proseProtocol`
bundles `extract` + `apply` for use with a `Dispatcher`.

Every command produces a `Validation<ApplyResult, CommandError>`. A successful
apply returns both the next `DocumentState` and an **inverse command** that,
when applied to the next state, restores the previous state. This is the
primitive every undo stack composes against.

## Vocabulary

| Variant         | Payload                                              | Inverse                              |
| --------------- | ---------------------------------------------------- | ------------------------------------ |
| `SetCursor`     | `{ range }`                                          | `SetCursor(prevCursor)`              |
| `Insert`        | `{ content: string \| ProseNode[]; at: RangePoint }` | `DeleteForward` over inserted span   |
| `DeleteBackward`| `{ range: EditorRange }`                             | `Insert` of removed content          |
| `DeleteForward` | `{ range: EditorRange }`                             | `Insert` of removed content          |
| `Format`        | `{ mark: MarkSet; range: EditorRange }`              | `RemoveMark` over the same range     |
| `RemoveMark`    | `{ markTag: string; range: EditorRange }`            | `Compound` of `Format` per segment   |
| `SplitBlock`    | `{ at: RangePoint; newBlockId: string \| null }`     | `MergeBlock(at)`                     |
| `MergeBlock`    | `{ at: RangePoint }`                                 | `SplitBlock` at the join point       |
| `SetBlockKind`  | `{ range: EditorRange; kind: BlockKind }`            | `Compound` restoring per-block kinds |
| `Compound`      | `{ steps: ProseCommand[] }`                          | `Compound` of reversed inverses      |

`BlockKind` is its own small union (`Block`, `Heading(level)`, `Quote`,
`Code(language)`) — distinct from `ProseNode` tags because it excludes void
blocks and carries per-kind metadata.

## Constructing commands

```ts
import { ProseCommand, EditorRange } from "aljabr/ui/prose"

ProseCommand.Insert("hello", point)              // string content
ProseCommand.Insert([ProseNode.HardBreak()], pt) // structural content
ProseCommand.Format(MarkSet.Bold(), range)
ProseCommand.SplitBlock(point)                   // auto block id
ProseCommand.SplitBlock(point, { newBlockId: "b2" })
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
ready to plug into a `Dispatcher`.

## Round-trip semantics

```ts
const { next, inverse } = unwrap(defaultApply(state, cmd))
const { next: restored } = unwrap(defaultApply(next, inverse))
// restored.doc and state.doc are equivalent under normalizeText
```

Equivalence is **post-normalization**. The model deliberately preserves
fragmentation produced by edits (e.g. an `Insert` between two same-marked
Texts leaves three Text nodes); consumers call `normalizeText` when they need
a canonical form. This keeps inverse anchors stable: a node ID referenced by
an inverse command is guaranteed to still exist in the immediate `next` state.

## Spanning ranges

Range commands (`DeleteBackward`, `DeleteForward`, `Format`, `RemoveMark`,
`SetBlockKind`) accept any `EditorRange` — including `TextRange` that crosses
block boundaries and `NodeRange`. Spanning deletes splice intermediate blocks;
spanning formats apply per-segment. The inverse for spanning operations is a
`Compound` whose steps reproduce the per-segment edits in reverse order.

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

Failures return `Validation.Invalid` with one or more `CommandError`s:

- `Conflict(msg)` — target node missing, wrong tag, or otherwise rejects the
  edit (e.g. `InsertMention` aimed at a non-Text node).
- `OutOfRange(msg)` — offset past content length, range endpoints inverted.
- `Invariant(msg)` — would produce a structurally invalid document
  (`validatePlacement` would fail on the result).

Apply implementations never throw for input-shaped errors; structural bugs in
the implementation itself are the only thing that escapes as exceptions.
