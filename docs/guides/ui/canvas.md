# Building UI with aljabr (Canvas)

Aljabr's canvas renderer is a retained-mode 2D scene graph that targets `<canvas>`. It plugs into the same reconciler that drives the DOM renderer — same JSX, same `view()` factory, same component model, same reactive primitives. The only things that change are the host's tag vocabulary, the per-tag prop semantics, and a paint pass that runs once per animation frame.

This guide builds up incrementally: a single static rect, then reactive props, then a panning/zooming viewport, then layout-driven labels, then events. By the end you'll have authored a minimal interactive diagramming surface and know exactly which v0.3.8 affordances you're standing on.

> If you're new to the renderer-agnostic core (`view`, `createRenderer`, `RendererHost`, `Signal`/`Ref`), read the [DOM guide](./dom.md) first. The reactive layer is identical; this guide assumes you're past that and want canvas specifics.

---

## Setup

```sh
npm install aljabr
```

For JSX, point `jsxImportSource` at the canvas runtime — globally if the project is canvas-only, or per-file via a pragma if you mix DOM and canvas trees:

```json
// tsconfig.json — canvas-only
{
  "compilerOptions": {
    "jsx": "react-jsx",
    "jsxImportSource": "aljabr/ui/canvas"
  }
}
```

```tsx
// Per-file pragma — when DOM and canvas component files coexist
/** @jsxImportSource aljabr/ui/canvas */
```

You also need a `<canvas>` element to mount into. The renderer reads its `width` / `height` for paint clearing and viewport bounds, so size it to the surface you want to draw on:

```html
<canvas id="scene" width="800" height="600"></canvas>
```

If your scene needs to fill the viewport, resize the canvas yourself (the renderer doesn't observe DOM resize events) and trigger a repaint by writing any reactive prop on the scene graph.

---

## Part 1: A single static element

```tsx
/** @jsxImportSource aljabr/ui/canvas */
import { createCanvasRenderer } from "aljabr/ui/canvas";

const canvas = document.querySelector<HTMLCanvasElement>("#scene")!;
const r = createCanvasRenderer(canvas);

const unmount = r.mount(() => (
  <rect x={50} y={50} width={200} height={100} fill="cornflowerblue" />
));
```

`createCanvasRenderer(canvas)` does three things up-front: it gets the 2D context, allocates a synthetic root `<group>` to mount into, and attaches a single dispatcher per pointer event type to the canvas DOM element. `mount` runs the reconciler synchronously, then paints synchronously — by the time `mount` returns, the rect is on screen.

Calling the returned `unmount()` removes every listener, disposes the reactive subscriptions, and clears the canvas.

### The seven primitives

| Tag | Geometry props | Notes |
|---|---|---|
| `<rect>` | `x`, `y`, `width`, `height`, `rx` | `rx > 0` triggers `roundRect` |
| `<circle>` | `cx`, `cy`, `r` | |
| `<ellipse>` | `cx`, `cy`, `rx`, `ry` | |
| `<line>` | `x1`, `y1`, `x2`, `y2` | Stroke-only — `fill` is ignored |
| `<path>` | `d` | SVG path string consumed via `Path2D` |
| `<group>` | `x`, `y`, `scale`, `rotate` (degrees) | Transform-only container |
| `<text>` | `x`, `y`, `content` | Single-line; layout-aware under shape parents (Part 4) |

Every tag also accepts the inheritable paint props (`fill`, `stroke`, `strokeWidth`, `lineCap`, `fontFamily`, `fontSize`, `fontWeight`, `textAlign`, `verticalAlign`, `padding`), the pointer/wheel handlers (`onClick`, `onPointerDown`, …), `onHitTest`, `zIndex`, and `children`.

---

## Part 2: Reactive props

Same model as the DOM renderer — pass a function or a readable, the renderer subscribes:

```tsx
import { Signal } from "aljabr/prelude";
import { createCanvasRenderer } from "aljabr/ui/canvas";

const x = Signal.create(50);
const fill = Signal.create("cornflowerblue");

const r = createCanvasRenderer(canvas);
r.mount(() => (
  <rect
    x={() => x.get() ?? 0}
    y={50}
    width={200}
    height={100}
    fill={() => fill.get() ?? "none"}
  />
));

// Later — these mutations coalesce into a single rAF tick + repaint:
x.set(120);
fill.set("salmon");
```

A few details that matter once you're animating:

- **rAF batching is automatic.** All reactive prop writes within a single animation frame coalesce: `setProperty` runs once per dirty prop, and the canvas is cleared and repainted exactly once. You don't manage the loop.
- **Per-prop diffing.** If a signal notifies but the derived value is `===` the previous value, the `setProperty` write is skipped entirely.
- **Function ≡ readable.** `<rect x={x}>` and `<rect x={() => x.get()}>` are equivalent for host element props — `view()` auto-wraps readables.

---

## Part 3: Pan & zoom with `Viewport`

A diagram surface needs a viewport. The `Viewport` factory owns pan and zoom as signals, and exposes the visible world-space rectangle for off-screen culling:

```tsx
import { Viewport, createCanvasRenderer } from "aljabr/ui/canvas";

const canvas = document.querySelector<HTMLCanvasElement>("#scene")!;
const vp = Viewport(canvas);
const r = createCanvasRenderer(canvas, { viewport: vp });

r.mount(() => (
  <group x={vp.x} y={vp.y} scale={vp.scale}>
    {/* world-space content goes here */}
    <rect x={0} y={0} width={100} height={100} fill="red" />
    <rect x={5000} y={5000} width={100} height={100} fill="blue" />
  </group>
));

// Pan and zoom by writing directly to the signals:
vp.x.set(150);
vp.scale.set(2);
vp.reset(); // back to (0, 0, 1)
```

Two things just happened:

1. **The root `<group>` applies the transform.** `<group x={vp.x} y={vp.y} scale={vp.scale}>` translates and scales the entire world relative to the canvas. Authors don't compose transforms manually; nesting `<group>`s composes them via `ctx.save()` / `ctx.restore()`.
2. **Off-screen content is culled.** Because we passed `{ viewport: vp }` to `createCanvasRenderer`, the paint pass intersects each element's bounds against `vp.bounds()` and skips entire subtrees that don't overlap. The blue rect at `(5000, 5000)` doesn't paint when the viewport is anywhere near the origin.

### Why `Viewport` is a factory, not a hook

You'll notice it's `Viewport(canvas)`, not `useViewport(canvas)`. The factory naming is deliberate — it owns reactive state but it isn't a hook in the React sense (no rules-of-call, no per-component invocation). One viewport per canvas, called once at setup time.

### The handle

```ts
interface ViewportHandle {
  x: Signal<number>;
  y: Signal<number>;
  scale: Signal<number>;
  bounds(): CanvasBounds;
  reset(): void;
}
```

`bounds()` is called by the paint pass on every frame; it returns the world-space rect derived from `(x, y, scale)` and the canvas's pixel dimensions. The signals can also be wired to wheel and drag handlers — see Part 5.

### A caveat — bounds completeness

`<group>`, `<path>`, and `<text>` currently report zero-area bounds (the v0.3.8 release deliberately deferred their bounds computation). The paint pass treats zero-area bounds as **non-cullable** — those tags always paint. In practice this means:

- Off-screen subtrees nested inside a `<group>` still cost a per-child intersect test.
- Off-screen `<path>` elements paint regardless of viewport.
- Off-screen `<text>` elements paint regardless of viewport.

For most diagramming workloads (a few hundred elements) this is fine. The [v0.3.9 roadmap](../../roadmap/v0.3.9.md) lifts these via a path-string parser, descendant-union for groups, and offscreen-canvas measurement for text.

---

## Part 4: Labels — layout, not coordinates

This is the part of the canvas API that diverges most from how you'd write canvas code by hand.

```tsx
<rect x={100} y={100} width={150} height={60} fill="white" stroke="black">
  Click me
</rect>
```

That's a button. The string `"Click me"` becomes a `Text` node, the host wraps it implicitly in a synthetic `<text>` element on insert, and the paint pass positions the text from the rect's bounds + the rect's layout props (which default to `textAlign: "left"`, `verticalAlign: "top"`, `padding: 0`).

To centre it:

```tsx
<rect
  x={100} y={100} width={150} height={60}
  fill="white" stroke="black"
  textAlign="center" verticalAlign="middle"
>
  Click me
</rect>
```

The shape is the layout container; the text inherits position from its bounds. You don't compute coordinates yourself — and when you reactively change the rect's position or size, the label follows automatically.

### When the inheritance applies

Layout-prop resolution for a `<text>` inside a shape is `el.props ?? parent.props ?? paint-context ?? default`. So:

- Setting layout props on the rect directly works (the example above).
- Setting them on an enclosing `<group>` works too (paint-context inheritance — see Part 6).
- Setting them on the `<text>` itself overrides everything else.

### Word wrap

There is no word wrap. A label longer than the rect's width simply overflows. For multi-line text, emit multiple `<text>` elements (one per line) or integrate an external library such as Pretext.

---

## Part 5: Events

Pointer / wheel / mouse events bubble through the scene graph the same way DOM events bubble:

```tsx
import type { CanvasSyntheticEvent } from "aljabr/ui/canvas";

<group onClick={(e: CanvasSyntheticEvent) => console.log("group:", e.target.tag)}>
  <rect
    x={0} y={0} width={50} height={50} fill="red"
    onClick={(e) => {
      console.log("rect clicked");
      e.stopPropagation(); // stops the bubble; group's handler does not fire
    }}
  />
</group>
```

The hit test runs in **reverse paint order** (topmost element first), accumulating an inverse transform as it descends through `<group>` matrices, then bubbles up `parent` pointers from the deepest hit. `<group>` is transparent — never the hit target itself, only its descendants.

### Pan + zoom via wheel

Wire `vp.x` / `vp.y` / `vp.scale` to native wheel + drag handlers on the canvas:

```tsx
canvas.addEventListener("wheel", (e) => {
  e.preventDefault();
  const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
  vp.scale.set((vp.scale.peek() ?? 1) * factor);
});
```

You don't need a synthetic wheel handler on a scene element for this — the canvas DOM element listens at the boundary, and the renderer's own dispatchers don't interfere with your direct listeners.

### Pixel-perfect hit testing for paths

Bounding-box hit tests are wrong for irregular shapes. Override with `onHitTest`:

```tsx
const triangle = new Path2D("M 0 0 L 100 0 L 50 100 Z");

<path
  d="M 0 0 L 100 0 L 50 100 Z"
  fill="orange"
  onHitTest={(x, y) => ctx.isPointInPath(triangle, x, y)}
  onClick={() => console.log("triangle hit")}
/>
```

The `(x, y)` arguments are the element's **local-frame** coordinates (post-inverse-transform), so they line up with the path geometry directly. The `on` prefix is required: it's how the reconciler knows not to invoke the function as a reactive getter.

For paths specifically — because their bounds are still `zeroBounds()` in v0.3.8 — `onHitTest` is the *only* way to make a path hittable through bounding-box-style logic. Without it, paths are unreachable via the hit-test walker.

---

## Part 6: Inherited paint context (briefly)

Six paint props inherit through the scene graph: `fill`, `stroke`, `strokeWidth`, `fontFamily`, `fontSize`, `fontWeight`. Three layout props inherit too: `textAlign`, `verticalAlign`, `padding`.

**Only `<group>` boundaries provide context.** Setting `fill="red"` on a `<rect>` does *not* propagate red into the rect's children — only `<group>` is a context-provider tag. If you want descendants to inherit, wrap the relevant subtree in a `<group>`:

```tsx
<group fill="red" fontSize={20}>
  <rect x={0} y={0} width={100} height={50}>label A</rect>
  <rect x={120} y={0} width={100} height={50}>label B</rect>
  {/* both labels render in red, 20px font */}
</group>
```

A child's own prop always wins over the inherited value.

For the full resolution rules, see the [API reference](../../api/ui/canvas.md#inherited-paint-props).

---

## Part 7: A complete example

Pulling everything together — a tiny pannable diagram with two clickable nodes:

```tsx
/** @jsxImportSource aljabr/ui/canvas */
import { Signal } from "aljabr/prelude";
import { createCanvasRenderer, Viewport } from "aljabr/ui/canvas";
import type { CanvasSyntheticEvent } from "aljabr/ui/canvas";

const canvas = document.querySelector<HTMLCanvasElement>("#scene")!;
const vp = Viewport(canvas);
const r = createCanvasRenderer(canvas, { viewport: vp });

const selected = Signal.create<string | null>(null);

const Node = ({ id, x, y, label }: { id: string; x: number; y: number; label: string }) => (
  <rect
    x={x} y={y} width={120} height={40}
    fill={() => (selected.get() === id ? "lightblue" : "white")}
    stroke="black" strokeWidth={1}
    textAlign="center" verticalAlign="middle"
    onClick={(e: CanvasSyntheticEvent) => {
      selected.set(id);
      e.stopPropagation();
    }}
  >
    {label}
  </rect>
);

r.mount(() => (
  <group
    x={vp.x} y={vp.y} scale={vp.scale}
    onClick={() => selected.set(null)}
    fontSize={14} fontFamily="sans-serif"
  >
    <Node id="a" x={50}  y={50} label="Node A" />
    <Node id="b" x={250} y={50} label="Node B" />
  </group>
));

// Wheel-to-zoom — direct DOM listener, no synthetic event needed
canvas.addEventListener("wheel", (e) => {
  e.preventDefault();
  const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
  vp.scale.set((vp.scale.peek() ?? 1) * factor);
});
```

Things to notice:

- `Node` is a **plain function component**. No special canvas-component decoration; `view(Node, props)` works the same as it does in DOM.
- The `selected` signal drives a reactive `fill` on each rect. Clicking a node updates the signal; the next rAF tick repaints both rects with their new fills.
- Layout props (`textAlign`, `verticalAlign`) on the rect position the implicitly-wrapped label without any explicit `<text>` element.
- The outer `<group>` provides the font context for descendant labels and a click handler that clears selection — `e.stopPropagation()` on the rect's click prevents that handler from firing when a node is clicked.

---

## Mixing with the DOM renderer

The two renderers happily coexist. A common pattern:

- DOM toolbar / sidebar / menus, mounted into a normal `<div>` shell with `domHost`
- Canvas surface mounted into a sibling `<canvas>` with `canvasHost`
- Both share signals (selection, current-tool, zoom level) — write from one renderer, read from the other; the reactive layer doesn't care which renderer owns the subscription

For tooltip-style overlays (a DOM popover positioned over a canvas element), do the math against the canvas's bounding rect plus your `Viewport` transform. There's no built-in `createPortal` in v0.3.8 — that pattern stays in userland for now.

---

## See also

- [Canvas API reference](../../api/ui/canvas.md) — `createCanvasRenderer`, `Viewport`, `canvasHost`, JSX prop tables, `CanvasSyntheticEvent`
- [DOM guide](./dom.md) — the renderer-agnostic reactive layer in detail (signals, components, lifecycle)
- [Canvas internals](../advanced/canvas-internals.md) — paint-pass dispatch, hit-test inverse-transform walk, implicit text wrapping
- [Renderer Protocol guide](../advanced/renderer-protocol.md) — bringing your own batching scheduler
- [v0.3.9 roadmap](../../roadmap/v0.3.9.md) — what's coming for `<path>`, `<group>`, `<text>` bounds completeness
