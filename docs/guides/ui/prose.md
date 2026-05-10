# Building UI with aljabr (Prose)

Aljabr's prose renderer is a contenteditable rich-text editor built on the same renderer abstraction as the DOM and canvas renderers. The author surface is a single `<Prose>` Component that wraps a `Dispatcher`-driven document model. There is no virtual DOM, no separate "schema layer," and no extension manager — the document model is a closed tagged union, edits are typed commands that produce inverses, and the contenteditable DOM is rewritten _from_ the model on every transition. The browser never owns authoritative state.

This guide builds up incrementally: a minimal editor, then commands and undo, then synthetic events, then embeds, then a static-authoring path with `parse.jsx`. By the end you'll have a complete picture of how the prose pipeline fits together.

> If you're new to the renderer-agnostic core (`view`, `Renderer.create`, `RendererHost`, function components, reactive props), read the [DOM guide](./dom.md) first. The reactive layer is identical here. If you're new to `Dispatcher`, skim the [Dispatcher reference](../../api/prelude/dispatcher.md) — it's the validated transactional state model the editor sits on.

---

## Setup

```sh
npm install aljabr
```

`<Prose>` itself is rendered by a parent renderer (typically DOM), so configure that renderer's JSX import source as usual:

```json
{
    "compilerOptions": {
        "jsx": "react-jsx",
        "jsxImportSource": "aljabr/ui/dom"
    }
}
```

If you also write **static** prose JSX trees (for `parse.jsx`, golden-document fixtures, or initial content), use a per-file pragma to switch the import source for those files:

```tsx
/** @jsxImportSource aljabr/ui/prose */
```

The parent renderer that hosts `<Prose>` keeps `aljabr/ui/dom` (or `aljabr/ui/canvas`); only static prose authoring needs `aljabr/ui/prose` as its import source.

---

## Part 1: A minimal editor

```tsx
/** @jsxImportSource aljabr/ui/dom */
import { Dispatcher } from "aljabr/prelude";
import { Renderer } from "aljabr/ui";
import { DomHost } from "aljabr/ui/dom";
import { Prose, ProseNode, EditorRange, proseProtocol } from "aljabr/ui/prose";

const initialDoc = ProseNode.Document([
    ProseNode.Heading(1, [ProseNode.Text("Hello")]),
    ProseNode.Block([ProseNode.Text("World")]),
]);

const editor = Dispatcher.create(
    {
        doc: initialDoc,
        cursor: EditorRange.Cursor({
            nodeId: "",
            offset: 0,
            line: 0,
            col: 0,
            absolute: 0,
        }),
    },
    proseProtocol,
);

const { mount } = Renderer.create(DomHost);
mount(() => <Prose state={editor} />, document.getElementById("root")!);
```

Three things just happened:

1. `Dispatcher.create(initialState, proseProtocol)` builds the editor's reactive state. `proseProtocol` bundles `extract` (returns `state.doc`) and `apply` (the reference command interpreter). Every dispatched command flows through `apply`, which returns a `Validation<ApplyResult, CommandError>` — invalid edits never mutate state.
2. `<Prose state={editor} />` returns a single `<div contenteditable>` view node. From the parent DOM renderer's perspective it's just an element; the Component encapsulates everything else (its own `ProseRenderer`, the contenteditable DOM, the `beforeinput` translator, native selection binding) in a `mounted` callback.
3. The DOM renderer mounts that view node into `#root`. Typing into the editor now produces typed commands that flow through `editor.dispatch` and re-render the document.

If you call `editor.peekState().doc`, you get the current `Document` tree — not a string of HTML. The DOM is a _projection_ of that tree, not the source of truth.

---

## Part 2: Reading state and dispatching commands

Authoring sits on the same `Dispatcher` API as the rest of aljabr. Read the current state with `editor.peekState()`; subscribe with `editor.subscribe(fn)`; dispatch a typed command with `editor.dispatch(cmd)`.

```ts
import { ProseCommand, MarkSet, EditorRange, getNodeId } from "aljabr/ui/prose";

// Imperatively bold the entire first paragraph:
const block = editor.peekState().doc.children[1]; // the <Block>
const id = getNodeId(block);
editor.dispatch(ProseCommand.Format(MarkSet.Bold(), EditorRange.Node(id)));
```

Under the hood the dispatcher routes the command through `proseProtocol.apply`, which:

1. Validates the command against the current document.
2. Produces a new `DocumentState` and an **inverse** command (in this case, `RemoveMark("Bold", …)`).
3. Returns `Validation.Valid({ next, inverse })` on success or `Validation.Invalid([CommandError, …])` on failure.

The renderer subscribes to the dispatcher; a successful transition triggers a fresh projection and the DOM updates surgically.

### Building toolbar buttons

Toolbars are normal DOM components that read and dispatch:

```tsx
function Toolbar({ editor }: { editor: Dispatcher<Document, DocumentState, ProseCommand> }) {
    const bold = () => {
        const { cursor } = editor.peekState();
        editor.dispatch(ProseCommand.Format(MarkSet.Bold(), cursor));
    };
    return (
        <div class="toolbar">
            <button onClick={bold}>B</button>
            <button onClick={() => /* heading, list, etc. */}>H1</button>
        </div>
    );
}
```

The `cursor` field of `DocumentState` is itself an `EditorRange` — pass it directly to range-bearing commands. When the range is collapsed, `Format` and friends interpret it as a no-op (the user has nothing selected); spanning ranges apply per-segment.

---

## Part 3: Undo / redo

Every successful apply produces an inverse. `editor.dispatch(cmd)` returns `Validation<ApplyResult<DocumentState, ProseCommand>, CommandError>`; on `Valid`, the value carries both `next` (the new state) and `inverse` (the command that undoes this one). Wrap dispatch with a thin helper that captures the inverse:

```ts
import { match } from "aljabr";
import { ProseCommand } from "aljabr/ui/prose";

const undoStack: ProseCommand[] = [];
const redoStack: ProseCommand[] = [];

function run(cmd: ProseCommand): void {
    match(editor.dispatch(cmd), {
        Valid: ({ value: { inverse } }) => {
            undoStack.push(inverse);
            redoStack.length = 0; // any new edit invalidates the redo stack
        },
        Invalid:     () => {},
        Unvalidated: () => {},
    });
}

function undo(): void {
    const inverse = undoStack.pop();
    if (!inverse) return;
    match(editor.dispatch(inverse), {
        Valid:       ({ value }) => { redoStack.push(value.inverse); },
        Invalid:     () => {},
        Unvalidated: () => {},
    });
}
```

The inverse is already a `ProseCommand` (often a `Compound` for multi-segment edits), so undo is "dispatch the inverse" — no special history transform. The library doesn't ship an opinionated history container in v0.4.0; owning a thin stack in userland is the path.

For edits that originate in `<Prose>`'s `beforeinput` translator (typing, deletes), use the `onInput` synthetic event (Part 4) to capture each command after it's been dispatched.

> **v0.4.1 plans:** the [v0.4.1 roadmap](../../roadmap/v0.4.1.md) introduces a first-class `History.create` wrapper around `Dispatcher` with a grouping registry, a `transaction(fn)` helper for forced single-entry grouping, and `Undo` / `Redo` as `ProseCommand` variants. The userland-stack pattern above is the v0.4.0 path; expect to migrate to the built-in container when v0.4.1 ships.

---

## Part 4: Synthetic events

`<Prose>` exposes a thin event surface for read-side reactions. None of these events drive state — they fire _after_ the dispatcher has settled.

```tsx
<Prose
    state={editor}
    onInput={({ command, range }) => {
        // Fires after each successfully dispatched beforeinput-translated command.
        // `range` is the cursor *after* the command was applied.
        analytics.track("edit", { type: getTag(command) });
    }}
    onSelect={({ range, prev }) => {
        // Fires on every cursor transition that yields a distinct range.
        toolbar.refreshActiveMarks(range);
    }}
    onFocus={({ range }) => surface.focused.set(true)}
    onBlur={({ range }) => surface.focused.set(false)}
/>
```

> **v0.4.1 plans:** `onPaste` and `onCompose` ship in v0.4.1 alongside paste interception (plaintext + internal-clipboard `Codec`) and IME composition handling (a hybrid model that exposes a `composing` field on `DocumentState`). See the [v0.4.1 roadmap](../../roadmap/v0.4.1.md) for the full event surface.

> **v0.4.1 plans:** keyboard shortcuts in v0.4.0 are wired in userland on the parent renderer (e.g., a `keydown` listener on a wrapping `<div>` that calls `editor.dispatch`). v0.4.1 introduces a static `bindings` prop on `<Prose>` and a `defaultBindings` export for spread-and-override. See the [v0.4.1 roadmap](../../roadmap/v0.4.1.md) Phase 4.

---

## Part 5: Embeds

Embeds are the open extension point of the document model. A `BlockEmbed` or `InlineEmbed` is a void node carrying `{ name, payload }`; a registry entry pairs a payload `Schema` with a placement (`"block"` or `"inline"`) and a `render` function from validated payload to `ViewNode`.

The package ships one default registration: `image` (a block embed). Insert one into the document by name:

```ts
import { ProseCommand, ProseNode } from "aljabr/ui/prose";

editor.dispatch(
    ProseCommand.Insert(
        [ProseNode.BlockEmbed("image", { src: "/cover.png", alt: null, caption: null })],
        /* at: */ someRangePoint,
    ),
);
```

The projection wraps every embed in `contenteditable={false}`, so the browser treats it as a void unit. Clicking on a registered void embed produces an `EditorRange.Node(id)` automatically — `DeleteBackward` then removes the whole embed.

### Adding a registration

`<Prose embeds={…}>` merges author-supplied registrations on top of `DEFAULT_EMBEDS`. Each entry's `schema` is built with the `Schema.*` builders from `aljabr/schema`; `placement` is `"block"` or `"inline"`; `render` returns a `ViewNode`. See the [embed registry reference](../../api/prose/embeds.md) for the canonical shape, placement enforcement, and JSX tag registration via the `ProseEmbeds` interface.

### When the registry rejects a payload

If `decode(schema, payload)` is `Valid`, the registered `render` runs. If it's `Invalid`, the projection emits a placeholder element (and warns in dev mode) — the document tree itself is unaffected, and the editor remains usable. This is what makes documents portable across authoring environments that haven't loaded the same embed registry: missing or invalid embeds degrade gracefully instead of corrupting state.

---

## Part 6: Static authoring with `parse.jsx`

For initial content, fixtures, or markdown-equivalent flows, write the document as JSX and parse it at boot:

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
        </block>
        <list>
            <listItem>
                <block>
                    <text>first</text>
                </block>
            </listItem>
            <listItem>
                <block>
                    <text>second</text>
                </block>
            </listItem>
        </list>
        <blockEmbed
            name="image"
            payload={{ src: "/cover.png", alt: null, caption: null }}
        />
    </document>,
    embeds /* optional — defaults to DEFAULT_EMBEDS */,
);

const initialState = match(result, {
    Valid: ({ value }) => value,
    Invalid: ({ errors }) => {
        throw new Error(JSON.stringify(errors));
    },
    Unvalidated: () => {
        throw new Error("unreachable");
    },
});

const editor = Dispatcher.create(initialState, proseProtocol);
```

`parse.jsx` walks the tree, validates structural placement, decodes embed payloads against their registered schemas, and returns a `Validation<DocumentState, DecodeError>`. Author-registered embed names work as JSX tags directly when augmented through the `ProseEmbeds` interface — see [`parse.jsx`](../../api/prose/parse.md).

---

## Part 7: Read-only mode

The `<Prose>` Component accepts a `readonly: boolean` prop. When true, it drops `contenteditable`, hides the caret via `caret-color: transparent`, and skips the `beforeinput` listener entirely. The native selection sync still runs, so `onSelect` continues to fire — handy for highlight-and-react flows in display mode.

`readonly` is read once when the Component evaluates, so to toggle it reactively, wrap `<Prose>` in a function child that re-evaluates when the gating signal changes. The same `editor` dispatcher flows through both views — only the surface around it changes:

```tsx
const isEditing = Signal.create(false);

<div>
    {() =>
        isEditing.get()
            ? <Prose state={editor} />
            : <Prose state={editor} readonly />
    }
</div>;

// Toggle:
isEditing.set(true);
```

---

## How it fits together

A few implementation details worth knowing as a consumer:

- **The DOM is a projection.** `projectDoc(doc, embeds)` walks the document tree and emits a `ViewNode` tree of native HTML tags (`<p>`, `<h1>`, `<ul>`, …). Marks become wrapping inline tags. Embeds run through the registry. The `ProseRenderer` reconciles this projection against the contenteditable DOM via the same `Renderer.create` reconciler the DOM renderer uses.
- **`data-aljabr-id` stamps.** Every projected element carries `data-aljabr-id="<nodeId>"`. The selection-binding layer uses these attributes to translate browser `Selection`s into `RangePoint`s and back. This is what makes `RangePoint` survive structural mutations elsewhere in the tree.
- **Every browser intent flows through `beforeinput`.** The `<Prose>` Component installs a single `beforeinput` listener, calls `event.preventDefault()`, runs the typed translator (`translateBeforeInput(event, state)`), and routes the resulting command through `editor.dispatch`. The DOM never updates from the browser — it updates from the projection.
- **The selection loop is feedback-guarded.** When the dispatcher's cursor changes, the renderer writes the matching `Selection`. When the user changes the selection in the browser, a `selectionchange` listener dispatches a `SetCursor` command. Both directions compare the candidate range against the current state and skip when they already agree.
- **`ProseHost` is a stateless vtable.** `ProseHost.create({ embeds })` returns a host whose method bodies delegate to `DomHost` in v0.4.0. The registry travels with the host for future extension; today the projection layer is what consumes it.

---

## See also

- [Prose API reference](../../api/prose/index.md) — `<Prose>` props, `ProseRenderer`, `ProseHost`
- [Document model](../../api/prose/document-model.md) — closed primitive set, marks, lists, embeds, placement validation
- [Commands](../../api/prose/commands.md) — full command vocabulary, inverses, list operations, extension via `union.merge`
- [`EditorRange` / `RangePoint`](../../api/prose/editor-range.md) — selection model
- [Embed registry](../../api/prose/embeds.md) — payload schemas, placement enforcement, JSX tag registration
- [`parse.jsx`](../../api/prose/parse.md) — static authoring surface
- [Selection binding](../../api/prose/selection-binding.md) — `bindSelection` and the lower-level conversion helpers
- [`beforeinput` translator](../../api/prose/before-input.md) — DOM `InputEvent` → `ProseCommand` mapping
- [Prelude: `Dispatcher`](../../api/prelude/dispatcher.md) — the validated transactional state model
- [DOM guide](./dom.md) — the renderer-agnostic reactive layer (signals, components, lifecycle)
