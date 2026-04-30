# UI (`aljabr/ui`)

Aljabr's UI layer is a renderer-agnostic core (`view`, `createRenderer`, `RendererHost`, the `ViewNode` union) shipped with two production rendering targets:

| Renderer | Entry point | Use when |
|---|---|---|
| **DOM** | `aljabr/ui/dom` (`domHost`) | Building browser apps with HTML elements |
| **Canvas** | `aljabr/ui/canvas` (`createCanvasRenderer`, `Viewport`, `canvasHost`) | Building diagramming tools, data visualisation, or any retained-mode 2D scene graph |

Both renderers consume the same `ViewNode` tree and the same JSX surface — only the host implementation and per-tag prop semantics differ. A component file picks its renderer through its `jsxImportSource` (`aljabr/ui/dom` or `aljabr/ui/canvas`); a single application can host both side by side.

---

## Per-renderer references

- **[DOM renderer](./dom.md)** — `view`, `Fragment`, `ViewNode`, `createRenderer`, `RendererHost`, `RendererProtocol`, `domHost`, the DOM property mapping, function components, reactive props, dev warnings, JSX setup. The shared core API lives in this document; the canvas reference cross-links to it for every renderer-agnostic concept.
- **[Canvas renderer](./canvas.md)** — `createCanvasRenderer`, `Viewport`, `canvasHost`, the `CanvasNode` union, `CanvasSyntheticEvent`, the seven canvas-primitive intrinsic elements, paint-context inheritance, hit testing with the `onHitTest` override.

---

## Choosing between them

You don't have to pick one. The DOM renderer is the right default for traditional HTML UI (forms, navigation, anything semantic). The canvas renderer is purpose-built for scenes where you'd otherwise reach for `<canvas>` and a tangle of imperative draw calls — diagrams, plots, node editors, custom visualisations. Common patterns:

- **DOM-only:** standard web app
- **Canvas-only:** a fullscreen visualisation that owns its container
- **DOM shell + canvas surface:** menus, toolbars, and tooltips in DOM; the diagram surface in canvas. Wire them together with shared signals — both renderers consume the same reactive primitives.

For an architectural deep-dive on the canvas renderer (paint pass, hit-test inverse-transform walk, implicit text wrapping), see the [Canvas internals](../../guides/advanced/canvas-internals.md) advanced guide.

---

## See also

- [Guides: UI](../../guides/ui/) — narrative walkthroughs for both renderers
- [Renderer Protocol guide](../../guides/advanced/renderer-protocol.md) — custom batching schedulers
- [Prelude: `Signal`/`Derived`/`Ref`](../prelude/) — the reactive primitives both renderers consume
