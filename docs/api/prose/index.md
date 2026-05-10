# Prose Renderer (`aljabr/ui/prose`)

A contenteditable rich-text editor built on the same renderer abstraction as
`aljabr/ui/dom` and `aljabr/ui/canvas`. The author surface is a single
`<Prose>` Component; everything else — typed commands, the document model,
the embed registry, native selection binding, the `beforeinput` translator —
is the pipeline that backs it.

> Reading this document assumes familiarity with the renderer-agnostic core
> (`view`, `Renderer.create`, `RendererHost`, `ViewNode`). Those live in the
> [DOM reference](../ui/dom.md). The prose-specific surface is covered here.

---

## At a glance

```tsx
/** @jsxImportSource aljabr/ui/dom */
import { Dispatcher } from "aljabr/prelude";
import {
    Prose,
    ProseNode,
    EditorRange,
    proseProtocol,
} from "aljabr/ui/prose";

const initialDoc = ProseNode.Document([
    ProseNode.Heading(1, [ProseNode.Text("Hello")]),
    ProseNode.Block([ProseNode.Text("World")]),
]);

const editor = Dispatcher.create(
    {
        doc: initialDoc,
        cursor: EditorRange.Cursor({
            nodeId: "", offset: 0, line: 0, col: 0, absolute: 0,
        }),
    },
    proseProtocol,
);

function App() {
    return <Prose state={editor} />;
}
```

The author owns the editor state as a `Dispatcher<Document, DocumentState, ProseCommand>`
(canonical variable name: `editor`), passes it to `<Prose state={editor}>`,
and the Component encapsulates everything else: its own `ProseRenderer`, the
contenteditable DOM, the `beforeinput` translator, native selection binding,
and a custom diff cycle from `editor.state().doc` to the DOM.

---

## Architecture

The pipeline from a keypress to a model update:

```
DOM beforeinput
  → translateBeforeInput(event, state)
  → ProseCommand
  → editor.dispatch(cmd)
  → proseProtocol.apply(state, cmd)
  → Validation<{ next, inverse }, CommandError>
  → editor.state() updates
  → projection re-runs
  → ProseRenderer reconciles new ViewNode tree against the contenteditable DOM
  → selection binding mirrors editor.state().cursor back into the browser Selection
```

Every browser intent flows through `beforeinput` (or composition / paste in
v0.4.1), gets converted to a typed command, validates through the protocol
that may reject it, and only then mutates the document model. The DOM is
rewritten *from* the model — never read back to recover state. The browser
never owns authoritative state; the author's `Dispatcher` does.

---

## Public surface

| Export                                     | Purpose                                                                      |
|--------------------------------------------|------------------------------------------------------------------------------|
| **Component**                              |                                                                              |
| `Prose`, `ProseProps`                      | Author-facing Component (`<Prose state={editor}>`)                           |
| `ProseInputEvent` / `ProseSelectEvent` / `ProseFocusEvent` | Synthetic event payloads passed to `<Prose>` callbacks            |
| **Document model**                         |                                                                              |
| `ProseNode`, `MarkSet`, `getNodeId`        | Node factories, mark factories, stable-id reader                             |
| `Document`, `Block`, `Heading`, `Quote`, `Code`, `List`, `ListItem`, `Text`, `HardBreak`, `Hr`, `BlockEmbed`, `InlineEmbed` | Per-variant TypeScript types |
| `validatePlacement`, `PlacementError`      | Structural validation                                                        |
| `BlockKind`, `DocumentState`               | Block-conversion union and reactive editor state shape                       |
| `normalizeText`                            | Coalesce adjacent same-marked Texts in a tree                                |
| **Commands**                               |                                                                              |
| `ProseCommand`, `defaultApply`, `proseProtocol` | Closed command union, reference apply, plug-in protocol                  |
| `SetCursorCmd` / `InsertCmd` / `DeleteBackwardCmd` / … | Per-variant TypeScript types                                       |
| **Selection**                              |                                                                              |
| `EditorRange`, `Cursor`, `TextRange`, `NodeRange`, `RangePoint` | Selection union and position type                                |
| `rangePointSchema`, `editorRangeSchema`    | Wire schemas for ranges                                                      |
| **Renderer / host**                        |                                                                              |
| `ProseHost`, `ProseHostOptions`            | DOM-shaped host (in v0.4.0 a delegate of `DomHost`) parameterised by embeds  |
| `ProseRenderer`, `ProseRendererOptions`, `ProseRendererInstance` | Convenience wrapper for `Renderer.create(ProseHost.create(...))`   |
| **Embeds**                                 |                                                                              |
| `EmbedDefinition`, `EmbedRegistry`, `EmbedPlacement`, `DEFAULT_EMBEDS`, `ImagePayload` | Open extension point for block / inline embeds         |
| `ProseEmbeds`                              | TypeScript module-augmentation point for JSX intrinsic registration          |
| **Pipeline plumbing**                      |                                                                              |
| `projectDoc`                               | `Document → ViewNode` projection (consults the embed registry)               |
| `translateBeforeInput`                     | DOM `InputEvent → ProseCommand \| null`                                      |
| `bindSelection`, `rangePointToDom`, `domToRangePoint`, `editorRangeToSelection`, `selectionToEditorRange` | Native selection ↔ model bridge        |
| **Parsing**                                |                                                                              |
| `parse`                                    | Static-authoring parser namespace; ships `parse.jsx` in v0.4.0               |

---

## `<Prose>` Component

**Import:** `import { Prose, type ProseProps } from "aljabr/ui/prose"`

```ts
type ProseProps<Cmd extends ProseCommand = ProseCommand> = {
    state:     Dispatcher<Document, DocumentState, Cmd>;
    embeds?:   EmbedRegistry;
    readonly?: boolean;
    onInput?:  (event: ProseInputEvent<Cmd>) => void;
    onSelect?: (event: ProseSelectEvent) => void;
    onFocus?:  (event: ProseFocusEvent) => void;
    onBlur?:   (event: ProseFocusEvent) => void;
};
```

| Prop        | Effect                                                                                                                  |
|-------------|-------------------------------------------------------------------------------------------------------------------------|
| `state`     | The editor's `Dispatcher`. Canonical variable name: `editor`. The Component subscribes to it for both doc and cursor.   |
| `embeds`    | Optional registry merged over `DEFAULT_EMBEDS` for this surface. See [embeds](./embeds.md).                             |
| `readonly`  | When true, drops `contenteditable`, hides the caret, and skips `beforeinput` wiring. Toggling flips between modes without remounting. |
| `onInput`   | Fires after each successfully dispatched `beforeinput`-translated command. Receives `{ command, range }`.               |
| `onSelect`  | Fires on every cursor transition that yields a distinct range. Receives `{ range, prev }`.                              |
| `onFocus` / `onBlur` | Fires on the contenteditable's focus / blur events. Receives `{ range }` (the current selection or `null`).     |

The Component returns a single `<div contenteditable>` view node from a
parent renderer's perspective; all prose-internal lifecycle (renderer mount,
DOM listeners, selection binding) is scoped to the `mounted` callback and
disposed on unmount.

The `state` dispatcher type parameter `Cmd` defaults to `ProseCommand`; pass
an extended union (e.g. `ProseCommand.merge({...})`) and `<Prose>` will type
`onInput.command` as that extended type.

### Synthetic events

```ts
type ProseInputEvent<Cmd extends ProseCommand = ProseCommand> = {
    command: Cmd;
    range:   EditorRange;
};

type ProseSelectEvent = {
    range: EditorRange;
    prev:  EditorRange;
};

type ProseFocusEvent = {
    range: EditorRange | null;
};
```

> **v0.4.1 plans:** `onPaste` and `onCompose` ship in v0.4.1 alongside
> paste interception (plaintext + internal-clipboard `Codec`) and IME
> composition handling (which exposes a `composing` field on
> `DocumentState`). A `bindings` prop and a `defaultBindings` export ship
> at the same time for keyboard shortcuts. A `History.create` wrapper
> around `Dispatcher` with a `transaction(fn)` helper and `Undo` / `Redo`
> as `ProseCommand` variants ships in the same release. See the
> [v0.4.1 roadmap](../../roadmap/v0.4.1.md) for the full surface.

---

## `ProseRenderer`

**Import:** `import { ProseRenderer, type ProseRendererOptions } from "aljabr/ui/prose"`

```ts
const ProseRenderer: {
    create(options?: ProseRendererOptions): {
        view: typeof view;
        mount: (fn: () => Child, container: Element) => () => void;
    };
};

type ProseRendererOptions = {
    embeds?: EmbedRegistry;
};
```

A thin wrapper over `Renderer.create(ProseHost.create({ embeds }))`. The
`<Prose>` Component creates one of these internally — authors typically
don't construct it directly, but it's exposed for the rare case of driving a
contenteditable surface manually (e.g., a server-side render pass that
projects a document without a Component tree).

```ts
import { ProseRenderer, projectDoc, DEFAULT_EMBEDS } from "aljabr/ui/prose";

const r = ProseRenderer.create({ embeds: { ...DEFAULT_EMBEDS, /* ... */ } });
const unmount = r.mount(
    () => projectDoc(editor.peekState().doc, DEFAULT_EMBEDS),
    document.getElementById("editor")!,
);
```

`mount(fn, container)` returns the same shape as the universal
`Renderer.create`. The container is a normal `Element`; the prose host's
`attach` is currently the identity (the `<Prose>` Component installs the
contenteditable attribute and `beforeinput` listener in its own `mounted`
callback, not inside the host).

## `ProseHost`

**Import:** `import { ProseHost, type ProseHostOptions } from "aljabr/ui/prose"`

```ts
const ProseHost: {
    create(options: ProseHostOptions): RendererHost<Node, Element>;
};

type ProseHostOptions = {
    embeds: EmbedRegistry;
};
```

A factory for a DOM-shaped `RendererHost`. In v0.4.0 the produced host
delegates every method to `DomHost` — the registry is consulted by
`projectDoc`, not by the host itself, because the `RendererHost` contract's
`createElement(tag)` does not see element props (so `Heading.level` cannot
influence tag selection at element-creation time). Translating
variants → native tags lives in the projection layer.

There is no lowercase `proseHost` singleton: `ProseHost` is parameterised by
the embed registry, so each `<Prose>` instance creates its own host through
`ProseHost.create({ embeds })`.

---

## JSX setup

To author static prose trees with JSX (for `parse.jsx`, snapshot fixtures, or
golden documents), set the prose-specific import source:

```json
{
  "compilerOptions": {
    "jsx": "react-jsx",
    "jsxImportSource": "aljabr/ui/prose"
  }
}
```

Or per-file:

```tsx
/** @jsxImportSource aljabr/ui/prose */
import { parse } from "aljabr/ui/prose";

const result = parse.jsx(
    <document>
        <heading level={1}>Hello</heading>
        <block>
            <text>World</text>
            <text bold>!</text>
        </block>
    </document>,
);
```

`parse.jsx` returns `Validation<DocumentState, DecodeError>`. See
[`parse.jsx`](./parse.md) for the full surface and how to register custom
embed tags via TypeScript module augmentation.

The parent renderer hosting `<Prose>` uses **its own** `jsxImportSource`
(typically `aljabr/ui/dom`); only static prose JSX (parsed at build / load
time) needs `aljabr/ui/prose` as its import source.

---

## See also

- [Document model](./document-model.md)
- [Commands](./commands.md)
- [`EditorRange` / `RangePoint`](./editor-range.md)
- [Embed registry](./embeds.md)
- [`parse.jsx`](./parse.md)
- [Selection binding](./selection-binding.md)
- [`beforeinput` translator](./before-input.md)
- [Prose guide](../../guides/ui/prose.md) — narrative walkthrough from a
  static document to a fully wired editor
- [DOM renderer reference](../ui/dom.md) — the shared `Renderer.create` /
  `RendererHost` core
- [Prelude: `Dispatcher`](../prelude/dispatcher.md) — the validated
  transactional state model `<Prose>` is built on
