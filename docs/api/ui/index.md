# UI (`aljabr/ui`)

Aljabr's UI layer is a renderer-agnostic core (`view`, `Renderer.create`, `RendererHost`, the `ViewNode` union) shipped with three production rendering targets:

| Renderer   | Entry point         | Use when                                                                                            |
|------------|---------------------|-----------------------------------------------------------------------------------------------------|
| **DOM**    | `aljabr/ui/dom`     | Browser apps with HTML elements (`DomHost`, `DomRenderer.create()`).                                |
| **Canvas** | `aljabr/ui/canvas`  | Diagramming tools, dataviz, node editors, retained-mode 2D scenes (`CanvasRenderer.create`, `<Canvas>`, `Viewport`, `CanvasHost`). |
| **Prose**  | `aljabr/ui/prose`   | Contenteditable rich-text surfaces (`<Prose>` Component, `ProseRenderer`, embed registry, commands, `parse.jsx`). |

All three renderers consume the same `ViewNode` tree and the same JSX surface — only the host implementation, per-tag prop semantics, and (for prose) the document → view projection differ. A component file picks its renderer through its `jsxImportSource` (`aljabr/ui/dom`, `aljabr/ui/canvas`, or `aljabr/ui/prose`); a single application can host all three side by side.

## v0.4.0 architecture

`Renderer.create(host)` is the central primitive every concrete renderer is built on. Hosts are stateless vtables exposing one new method — `attach(container)` — that adopts a parent-renderer-supplied container and returns the host's internal root, an optional batching protocol, and a per-mount disposer. Surface binding moves to `mount`: `r.mount(fn, container)` is uniform across renderers.

Each concrete renderer ships a thin static-method wrapper:

```ts
DomRenderer.create()             // ≡ Renderer.create(DomHost)
CanvasRenderer.create({ viewport? })
ProseRenderer.create({ embeds? })
```

`<Canvas>` and `<Prose>` are author-facing Components that encapsulate their own renderers — drop them inside any parent renderer's mount tree and lifecycle is fully managed.

---

## Per-renderer references

- **[DOM renderer](./dom.md)** — `view`, `Fragment`, `ViewNode`, `Renderer.create`, `DomRenderer.create`, `DomHost`, `RendererHost.attach`, `RendererProtocol`, the DOM property mapping, function components, reactive props, dev warnings, JSX setup. The shared core API lives in this document; the canvas and prose references cross-link to it for renderer-agnostic concepts.
- **[Canvas renderer](./canvas.md)** — `CanvasRenderer.create`, `<Canvas>` Component, `Viewport`, `CanvasHost`, the `CanvasNode` union, `CanvasSyntheticEvent`, the seven canvas-primitive intrinsic elements, paint-context inheritance, hit testing with the `onHitTest` override.
- **Prose renderer** — see [`docs/api/prose/`](../prose/index.md) for the full prose surface: `<Prose>` Component, `ProseHost`, `ProseRenderer`, document model, commands, embeds, projection, `parse.jsx`, native selection binding.

---

## Choosing between them

You don't have to pick one. The DOM renderer is the right default for traditional HTML UI (forms, navigation, anything semantic). The canvas renderer is purpose-built for scenes where you'd otherwise reach for `<canvas>` and a tangle of imperative draw calls — diagrams, plots, node editors, custom visualisations. The prose renderer is the right path for any contenteditable surface (notes, articles, comments) where the author needs typed commands, undo, embeds, and selection plumbing without the contenteditable event soup. Common patterns:

- **DOM-only:** standard web app
- **Canvas-only:** a fullscreen visualisation that owns its container
- **DOM shell + canvas surface:** menus, toolbars, and tooltips in DOM; the diagram surface in canvas. Wire them together with shared signals — both renderers consume the same reactive primitives.
- **DOM shell + prose surface:** an article editor where chrome (toolbar, sidebar) lives in DOM and the article body is `<Prose state={editor}>`. Both share the same `Dispatcher`-driven state model.

For an architectural deep-dive on the canvas renderer (paint pass, hit-test inverse-transform walk, implicit text wrapping), see the [Canvas internals](../../guides/advanced/canvas-internals.md) advanced guide.

---

## See also

- [Guides: UI](../../guides/ui/index.md) — narrative walkthroughs for all three renderers
- [Renderer Protocol guide](../../guides/advanced/renderer-protocol.md) — custom batching schedulers
- [Prelude: `Signal`/`Derived`/`Store`](../prelude/index.md) — the reactive primitives every renderer consumes
- [Prelude: `Dispatcher`](../prelude/dispatcher.md) — the validated transactional state model `<Prose>` is built on
