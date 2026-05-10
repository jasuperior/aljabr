# `aljabr/ui/prose` — `beforeinput` Translator

`translateBeforeInput(event, state)` is the pure function that converts a
DOM `InputEvent` into a `ProseCommand` (or `null` if the input type is not
handled in v0.4.0). The `<Prose>` Component installs a `beforeinput`
listener on its contenteditable root, calls `event.preventDefault()` (so
the browser never mutates the DOM), and routes the result of this
translator into `editor.dispatch(...)`.

## Signature

```ts
function translateBeforeInput(
    event: InputEvent,
    state: DocumentState,
): ProseCommand | null;
```

Returning `null` signals "not handled" — the Component swallows the event
silently.

## Coverage

| `event.inputType`         | Produces                                                         |
|---------------------------|------------------------------------------------------------------|
| `insertText`              | `Insert(event.data, cursorPoint)`                                |
| `insertParagraph`         | `SplitListItem(at)` inside a list item; `SplitBlock(at)` otherwise |
| `insertLineBreak`         | `Insert([HardBreak()], at)`                                      |
| `deleteContentBackward`   | `DeleteBackward(state.cursor)`                                   |
| `deleteWordBackward`      | `DeleteBackward(state.cursor)` *(word-extension is v0.4.1)*      |
| `deleteContentForward`    | `DeleteForward(state.cursor)`                                    |
| `deleteWordForward`       | `DeleteForward(state.cursor)`                                    |
| anything else             | `null`                                                           |

> **v0.4.1 plans:** `historyUndo` / `historyRedo`, paste
> (`insertFromPaste`), and composition events are deferred to v0.4.1, where
> they wire into the new `History.create` wrapper, the paste pipeline, and
> the IME composition handler respectively. See the
> [v0.4.1 roadmap](../../roadmap/v0.4.1.md).

## Why a pure function

Keeping the translator pure makes it trivially testable and lets advanced
integrations:

- intercept a command before dispatch (filter, log, transform),
- replay tests directly from synthetic `InputEvent`s,
- compose alternate translators (e.g. a Vim-mode binding layer that handles
  most events itself but falls back to `translateBeforeInput` for plain
  text input).

```ts
import { translateBeforeInput } from "aljabr/ui/prose";

el.addEventListener("beforeinput", (e) => {
    e.preventDefault();
    const cmd = translateBeforeInput(e, editor.peekState());
    if (cmd && shouldDispatch(cmd)) editor.dispatch(cmd);
});
```

## See also

- [Commands](./commands.md) — the `ProseCommand` union the translator
  produces
- [`<Prose>` Component](./index.md) — the surface that wires this translator
  by default
- [v0.4.1 roadmap](../../roadmap/v0.4.1.md) — paste, IME, history, keyboard
  bindings
