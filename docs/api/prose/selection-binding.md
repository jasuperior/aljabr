# `aljabr/ui/prose` — Selection Binding

Native selection binding is the bridge between the editor's `cursor`
(`EditorRange`) and the browser's `Selection` (DOM `(node, offset)` tuples).
It is wired automatically by `<Prose>`; the lower-level functions are
exposed for custom integrations (e.g., a contenteditable surface driven by a
non-Component renderer or a server-side `Range` projection).

The projection stamps every prose node's stable ID on its DOM element via
`data-aljabr-id`. Selection conversion uses this attribute as the bridge
between the model's `RangePoint` (carrying a stable `nodeId` and logical
character offset) and the browser's `(node, offset)` selection model.

## Sync directions

- **model → DOM**: `editorRangeToSelection` consumes an `EditorRange` and
  writes to the supplied `Selection`.
- **DOM → model**: `selectionToEditorRange` reads a `Selection` and produces
  an `EditorRange` (or `null` if the selection lies outside the prose root).

`bindSelection` wires both directions to a `Dispatcher` and prevents the
obvious feedback loop: when the model→DOM update would set the same selection
that's already current, it skips; when DOM→model dispatches a `SetCursor`,
the resulting model→DOM update is suppressed by the same comparison.

## API

```ts
function bindSelection<Cmd extends ProseCommand>(
    dispatcher: Dispatcher<Document, DocumentState, Cmd>,
    root:       Element,
): () => void;

function rangePointToDom(
    point: RangePoint,
    root:  Element,
): { node: Node; offset: number } | null;

function domToRangePoint(
    node:      Node,
    domOffset: number,
    root:      Element,
    doc:       Document,
): RangePoint | null;

function editorRangeToSelection(
    range: EditorRange,
    root:  Element,
    sel:   Selection,
): void;

function selectionToEditorRange(
    sel:  Selection | null,
    root: Element,
    doc:  Document,
): EditorRange | null;
```

### `bindSelection(dispatcher, root)`

Owns:

- a `selectionchange` listener on `document` (the only event that fires for
  native caret/drag-selection changes; not bubbled from the editor),
- a dispatcher subscription that mirrors `cursor` to the browser selection.

Suppresses feedback by comparing the *current* browser selection to the
`EditorRange` it would write — if they already agree, skip the write.

Returns a teardown function that detaches both listeners.

### `selectionToEditorRange` — void-node detection

When the browser selection is collapsed on a void node (an `Hr`, a
`BlockEmbed`, or an `InlineEmbed`), the function surfaces it as
`EditorRange.Node(id)` rather than a degenerate `EditorRange.Cursor`. This
is what makes single-clicking a default-registered `image` block produce a
node selection automatically — commands like `DeleteBackward` then operate
on the whole node.

## Custom integration

The `<Prose>` Component already wires `bindSelection`. Reach for the lower-
level helpers when:

- driving a contenteditable surface manually (no Component tree),
- hosting two prose surfaces that share a single dispatcher,
- pre-computing selection state for a server-rendered snapshot,
- running selection sync inside a custom event-loop discipline.

```ts
import { bindSelection } from "aljabr/ui/prose";

const teardown = bindSelection(editor, contentEditableRoot);
// ... later
teardown();
```

## See also

- [`EditorRange` / `RangePoint`](./editor-range.md)
- [`<Prose>` Component](./index.md) — the surface that wires `bindSelection`
  by default
- [Document model](./document-model.md) — the `data-aljabr-id` stamping that
  makes the bridge possible (the projection writes it on every element)
