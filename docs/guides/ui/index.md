# Building UI with aljabr

Aljabr's UI layer ships three production renderers and a renderer-agnostic core. Pick the guide that matches the surface you're building.

| Guide | Renderer | Read this when |
|---|---|---|
| **[Building UI with aljabr (DOM)](./dom.md)** | `aljabr/ui/dom` | Building anything HTML-based — forms, navigation, semantic content. Covers `view`, `Renderer.create`, `DomRenderer.create`, `DomHost`, JSX, components, lifecycle, reactive lists. |
| **[Building UI with aljabr (Canvas)](./canvas.md)** | `aljabr/ui/canvas` | Building diagramming tools, data visualisation plugins, node editors, or any retained-mode 2D canvas scene. Covers primitives, `Viewport`, layout-driven labels, events, pixel-perfect hit testing, and the `<Canvas>` Component. |
| **[Building UI with aljabr (Prose)](./prose.md)** | `aljabr/ui/prose` | Building a contenteditable rich-text surface — articles, notes, comments. Covers the document model, the `<Prose>` Component, typed commands & undo, embeds, and parsing static JSX into a `DocumentState`. |

The reactive primitives (`Signal`, `Derived`, `Store`, `List`, `Scope`) and `Dispatcher` are renderer-agnostic — pick them up from the [prelude guides](../../api/prelude/index.md) and they compose with any renderer unchanged.

For an architectural deep-dive on the canvas renderer's internals (the `CanvasNode` union, paint-pass dispatch, hit-test inverse-transform walk, implicit text wrapping), see [Canvas internals](../advanced/canvas-internals.md) under the advanced guides.
