# Canvas Renderer (`aljabr/ui/canvas`)

A retained-mode 2D canvas renderer that implements `RendererHost<CanvasNode, CanvasElementNode>`. It composes with the same reconciler that drives `aljabr/ui/dom`, so JSX, function components, signals, `Ref`, and lifecycle scopes all work identically — the only difference is the host's tag vocabulary and per-frame paint pass.

> Reading this document assumes familiarity with the renderer-agnostic core (`view`, `createRenderer`, `RendererHost`, `RendererProtocol`, `ViewNode`, function components, reactive props). Those live in the [DOM reference](./dom.md); only the canvas-specific surface is covered here.

---

## Setup

### Installation

```sh
npm install aljabr
```

### JSX

To author canvas trees with JSX, set the canvas-specific import source. It can be set globally in `tsconfig.json` for a canvas-only project:

```json
{
  "compilerOptions": {
    "jsx": "react-jsx",
    "jsxImportSource": "aljabr/ui/canvas"
  }
}
```

Or per-file with a pragma — the right move when DOM and canvas component files coexist in one project:

```tsx
/** @jsxImportSource aljabr/ui/canvas */
import { createCanvasRenderer, Viewport } from "aljabr/ui/canvas";
```

DOM and canvas component files use different `jsxImportSource` values. The boundary type at interop points is `ViewNode`, which both runtimes produce — a function component written against one renderer can return JSX consumed by the other if the elements line up, but in practice the prop surfaces are different and you'd cross over by mounting a separate root.

---

## Core concepts

A canvas scene has three layers, each with a clear job:

1. **`CanvasNode`** — a retained scene-graph node. Created by the host's `createElement` / `createText` (or via JSX). The reconciler mutates this graph as signals fire; the paint pass walks it on the next rAF tick.
2. **`canvasHost`** — implements `RendererHost<CanvasNode, CanvasElementNode>`. The reconciler talks to this contract; the paint pass and hit-test walker read the resulting graph.
3. **`createCanvasRenderer(canvas, options?)`** — wires `canvasHost` to a `requestAnimationFrame`-backed `RendererProtocol` that schedules a single coalesced flush + repaint per frame, and attaches the pointer-event dispatcher to the canvas DOM element.

Unlike the DOM renderer, **the scene graph is the source of truth** — the canvas itself is a presentation surface. The reconciler updates `CanvasElementNode` props synchronously; the paint pass projects the graph onto pixels on the next animation frame.

---

## `createCanvasRenderer(canvas, options?)`

**Import:** `import { createCanvasRenderer } from "aljabr/ui/canvas"`

```ts
function createCanvasRenderer(
  canvas: HTMLCanvasElement,
  options?: CanvasRendererOptions,
): {
  view: typeof view;
  mount: (component: () => ViewNode) => () => void;
};
```

Pre-wires `canvasHost` with the rAF batching protocol, allocates a synthetic root `<group>` once per renderer, and attaches a single dispatcher per pointer event type (`pointerdown`, `pointerup`, `pointermove`, `pointerenter`, `pointerleave`, `click`, `dblclick`, `contextmenu`, `wheel`). Throws if `canvas.getContext("2d")` is unavailable.

```ts
import { createCanvasRenderer } from "aljabr/ui/canvas";

const canvas = document.querySelector<HTMLCanvasElement>("#scene")!;
const r = createCanvasRenderer(canvas);

const unmount = r.mount(() => (
  <rect x={10} y={10} width={100} height={100} fill="cornflowerblue" />
));

// Later — tears down listeners, disposes reactive subscriptions, clears the canvas:
unmount();
```

### `mount(component)` semantics

- The reconciler runs synchronously to populate the scene graph.
- An **initial paint** runs synchronously after the reconciler — by the time `mount` returns, the canvas has been cleared and painted.
- Subsequent reactive prop updates flow through the rAF protocol: each batch of writes triggers a single `clearRect` + `paintNode` pass on the next animation frame.
- The returned function unmounts: pointer listeners are removed, the reactive root is disposed (component owners cascade), and the canvas is cleared.

### `CanvasRendererOptions`

```ts
interface CanvasRendererOptions {
  viewport?: ViewportHandle;
}
```

| Field | Effect |
|---|---|
| `viewport` | When provided, `viewport.bounds()` is read each frame and threaded into `paintNode`'s culling check. Off-screen subtrees skip their entire paint pass. Without a viewport, every element with non-empty bounds is painted unconditionally. |

The rAF protocol is intentionally not exposed — author renderers that need a different scheduling discipline use `createRenderer(canvasHost, myProtocol)` from `aljabr/ui` directly and run the paint pass themselves.

---

## `Viewport(canvas)`

**Import:** `import { Viewport, type ViewportHandle } from "aljabr/ui/canvas"`

```ts
function Viewport(canvas: HTMLCanvasElement): ViewportHandle;

interface ViewportHandle {
  x: Signal<number>;
  y: Signal<number>;
  scale: Signal<number>;
  bounds(): CanvasBounds;
  reset(): void;
}
```

A factory (intentionally not `useViewport` — `Viewport` is renderer-agnostic state, not a hook) that owns pan/zoom as `Signal<number>` instances and exposes the visible world-space rectangle for culling.

```tsx
import { createCanvasRenderer, Viewport } from "aljabr/ui/canvas";

const canvas = document.querySelector<HTMLCanvasElement>("#scene")!;
const vp = Viewport(canvas);
const r = createCanvasRenderer(canvas, { viewport: vp });

r.mount(() => (
  <group x={vp.x} y={vp.y} scale={vp.scale}>
    {/* world-space content */}
    <rect x={0} y={0} width={100} height={100} fill="red" />
  </group>
));

// Pan / zoom by writing the signals directly:
vp.x.set(100);
vp.scale.set(2);
vp.reset(); // back to (0, 0, 1)
```

### `bounds()`

Returns the current visible world-space rectangle, derived from `(x, y, scale)` and the canvas's pixel dimensions:

```
bounds = {
  x:      -x / scale,
  y:      -y / scale,
  width:  canvas.width  / scale,
  height: canvas.height / scale,
}
```

`bounds()` reads `peek()` on its signals — the call is **untracked**. It's invoked by the paint pass, which is a synchronous walk and not a reactive computation; the returned rectangle is consumed by `paintNode`'s `intersects` check.

### Signed-zero hardening

`scale === 0` is treated as 1 to keep `bounds()` finite; `-0` is normalised to `+0` so equality checks (`.toEqual({ x: 0, ... })`) compare cleanly.

### Canvas resize

The handle does not subscribe to canvas resize events. After resizing the underlying `HTMLCanvasElement`, trigger a repaint by writing any reactive prop on the scene graph (`vp.scale.set(vp.scale.peek() ?? 1)` is a common no-op trigger).

---

## `canvasHost`

**Import:** `import { canvasHost } from "aljabr/ui/canvas"`

The retained-mode implementation of `RendererHost<CanvasNode, CanvasElementNode>`. `createCanvasRenderer` wires it up automatically; you only reach for it directly when bringing your own protocol:

```ts
import { createRenderer } from "aljabr/ui";
import { canvasHost } from "aljabr/ui/canvas";

const { mount } = createRenderer(canvasHost, {
  scheduleFlush(flush) { queueMicrotask(flush); },
});
```

### Property mapping

`setProperty(el, key, value)` on a canvas element:

| Key | Effect |
|---|---|
| `zIndex` | Hoisted onto `el.zIndex` (also stored in `el.props.zIndex`). The paint pass sorts siblings ascending. |
| `onHitTest` | Hoisted onto `el.hitTest` (a `(x: number, y: number) => boolean` callback). Stored as `on*` so the reconciler doesn't invoke it as a reactive getter. |
| Geometry keys (`x`, `y`, `width`, `height`, `cx`, `cy`, `r`, `rx`, `ry`, `x1`, `y1`, `x2`, `y2`, `d`) | Recompute `el.bounds` eagerly via the per-tag bounds dispatch (`rect`/`circle`/`ellipse`/`line` exact; `path`/`group`/`text` currently `zeroBounds()` — see [Bounds completeness](#bounds-completeness)). |
| `on*` event handlers | Stored as raw functions in `el.props`; the `bubbleEvent` walker dispatches to them. |
| Anything else | Stored in `el.props[key]` for the paint pass to read. |

### Implicit `<text>` wrapping

When the reconciler inserts a `CanvasTextNode` into a parent whose `tag` is not `"text"`, the host wraps the text in a synthetic `<text>` element — the wrapper is what physically lives in `parent.children` from then on. Two `WeakMap`s manage the indirection (`textWrappers: Text → wrapper`, `wrapperToText: wrapper → Text`) so the reconciler keeps holding the original Text reference while the host dispatches `setText` / `remove` / `nextSibling` against the wrapper. This is what makes `<rect>label</rect>` paint a label inside the rect's bounds without any explicit `<text>` authoring.

In dev mode, the host warns if a `CanvasTextNode` lands inside a `<line>` or `<path>` parent — those have no meaningful layout bounds and the wrapped text will fall back to position `(0, 0)`.

### Bounds completeness

Three tags currently report `zeroBounds()` from `recomputeBounds`:

- `<path>` — pending the SVG path-string parser
- `<group>` — pending the descendant-union walker (with cache invalidation)
- `<text>` — pending font-metric measurement via a shared offscreen canvas

The paint and hit-test passes treat zero-area bounds as **non-cullable, non-bounds-hittable** — those tags always paint and need an `onHitTest` override to participate in hit tests by anything other than their descendants. See the [v0.3.9 roadmap](../../roadmap/v0.3.9.md) for implementation strategies and acceptance criteria.

---

## The `CanvasNode` union

**Import:** `import type { CanvasNode, CanvasElementNode, CanvasTextNode, CanvasBounds, CanvasTag } from "aljabr/ui/canvas"`

```ts
type CanvasNode = CanvasElementNode | CanvasTextNode;

type CanvasElementNode = Variant<"Element", {
  tag: CanvasTag;
  props: Record<string, unknown>;
  children: CanvasNode[];
  parent: CanvasElementNode | null;
  bounds: CanvasBounds;
  zIndex: number;
  hitTest?: (x: number, y: number) => boolean;
}>;

type CanvasTextNode = Variant<"Text", { content: string }>;

type CanvasTag = "rect" | "circle" | "ellipse" | "line" | "path" | "group" | "text";

interface CanvasBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}
```

The variant **value** factory (`CanvasNode.Element({...})` / `CanvasNode.Text("…")`) lives at `aljabr/ui/canvas/node` — the public barrel exports the type only because `verbatimModuleSyntax: true` rejects exporting one identifier as both a type and a value through the same surface. In practice authors don't need the factory: `canvasHost.createElement` / `createText` and the JSX runtime cover all construction.

### `zeroBounds()`

```ts
import { zeroBounds } from "aljabr/ui/canvas";
zeroBounds(); // { x: 0, y: 0, width: 0, height: 0 }
```

Returns a fresh zero rect on each call. Used as the starting bounds for newly created elements before geometry props are set.

---

## JSX intrinsic elements

Setting `jsxImportSource: "aljabr/ui/canvas"` makes these seven tags available in JSX. Every tag accepts the inheritable paint props (`fill`, `stroke`, `strokeWidth`, `lineCap`, `fontFamily`, `fontSize`, `fontWeight`, `textAlign`, `verticalAlign`, `padding`), the event handlers (`onPointerDown`/`onPointerUp`/`onPointerMove`/`onPointerEnter`/`onPointerLeave`/`onClick`/`onDblClick`/`onContextMenu`/`onWheel`), the `onHitTest` override, `zIndex`, and `children`. Tag-specific keys are listed below.

| Tag | Geometry props | Notes |
|---|---|---|
| `rect` | `x`, `y`, `width`, `height`, `rx` | `rx > 0` triggers `roundRect`. |
| `circle` | `cx`, `cy`, `r` | Full-circle arc. |
| `ellipse` | `cx`, `cy`, `rx`, `ry` | |
| `line` | `x1`, `y1`, `x2`, `y2` | Stroke-only — `fill` is ignored. |
| `path` | `d` | SVG path string consumed via `Path2D`. |
| `group` | `x`, `y`, `scale`, `rotate` | Transform-only container; provides paint-context inheritance to descendants. `rotate` is in degrees. |
| `text` | `x`, `y`, `content` | Single-line. When the parent is a shape, `x`/`y` are computed from the parent's bounds + layout props (see [Text layout](#text-layout)). |

All numeric prop values accept the same `Reactive<T>` shape as the DOM renderer: a plain number, a `() => number` getter, or a readable like `Signal<number>` / `Derived<number>`.

---

## Inherited paint props

Six paint props and three text-layout props inherit through the scene graph:

| Prop | Default | Notes |
|---|---|---|
| `fontFamily` | `"sans-serif"` | |
| `fontSize` | `14` | |
| `fontWeight` | `"normal"` | |
| `fill` | `"none"` | `"none"` skips the `fillStyle` write entirely, matching SVG. |
| `stroke` | `"none"` | Same convention. |
| `strokeWidth` | `1` | |
| `textAlign` | `"left"` | `"left"` \| `"center"` \| `"right"` |
| `verticalAlign` | `"top"` | `"top"` \| `"middle"` \| `"bottom"` |
| `padding` | `0` | Number (uniform) or `{ top, right, bottom, left }`. |

### How inheritance works

The paint pass threads a `PaintContext` object through recursion. **Only `<group>` boundaries derive a new context** — non-group elements forward their parent's context unchanged. Per-element resolution is `el.props[key] ?? context[key] ?? hardcoded default`.

A consequence: setting `fill="red"` on a `<rect>` does **not** propagate red into a wrapped child label. Wrap the rect in a `<group fill="red">` if you want descendants to inherit, or set the prop on the text directly. This matches the v0.3.8 spec; if you need every-element context inheritance, file an issue with the use case.

### Layout-prop fallback for `<text>`

When a `<text>` has a *shape* parent (`rect`/`circle`/`ellipse`/`line`/`path`), its layout props add an extra fallback step: `el.props ?? parent.props ?? context ?? default`. This is what makes `<rect textAlign="center">label</rect>` Just Work without an enclosing group — the wrapped `<text>` reaches up to the rect's own props for layout intent.

---

## Text layout

When a `<text>` element sits inside a *shape* parent, its `x` and `y` are computed from the parent's bounds plus the resolved layout props — the text element's own `x`/`y` are ignored. Under a non-shape parent (top-level or under `<group>`), the text uses its own `x`/`y` verbatim.

```
contentX:
  textAlign="left"    → parent.bounds.x + padding.left
  textAlign="center"  → parent.bounds.x + parent.bounds.width / 2
  textAlign="right"   → parent.bounds.x + parent.bounds.width - padding.right

contentY:
  verticalAlign="top"    → parent.bounds.y + padding.top + fontSize    (baseline offset)
  verticalAlign="middle" → parent.bounds.y + parent.bounds.height / 2
  verticalAlign="bottom" → parent.bounds.y + parent.bounds.height - padding.bottom

ctx.textAlign     = textAlign
ctx.textBaseline  = "middle" when verticalAlign === "middle", else "alphabetic"
```

Word wrapping is out of scope. Authors needing multi-line text emit multiple `<text>` elements (one per line) or integrate an external library such as Pretext.

---

## Events

### `CanvasSyntheticEvent`

```ts
import type { CanvasSyntheticEvent } from "aljabr/ui/canvas";

interface CanvasSyntheticEvent {
  type: string;
  target: CanvasElementNode;
  offsetX: number; offsetY: number;
  clientX: number; clientY: number;
  buttons: number; button: number;
  ctrlKey: boolean; shiftKey: boolean; altKey: boolean; metaKey: boolean;
  pointerType?: string;       // PointerEvent only
  pointerId?: number;         // PointerEvent only
  deltaX?: number; deltaY?: number; deltaZ?: number; deltaMode?: number;  // WheelEvent only
  nativeEvent: Event;
  stopPropagation(): void;
  preventDefault(): void;
}
```

A synthetic event mirroring the most-used `PointerEvent` and `WheelEvent` fields. `target` is the deepest element the hit test landed on. `stopPropagation()` halts the bubble at the calling handler; `preventDefault()` forwards to the native event.

### Hit testing

For each native pointer event the dispatcher receives, `hitTest(root, offsetX, offsetY)` walks the scene graph in **reverse paint order** (topmost sibling first), accumulating an inverse transform as it descends through `<group>` matrices. At each non-group `Element`:

1. If `el.hitTest` is set, the override decides — bounds are not consulted. (This is what makes `<path>` elements with custom hit functions hittable while their bounds are still `zeroBounds()`.)
2. Otherwise, the screen point is inverse-transformed into the element's local frame and tested against `el.bounds` with an inclusive contains check.

`<group>` elements are transparent — never the hit target themselves; only their descendants can be hit. `Text` variants are skipped (the synthetic `<text>` wrapper is what gets hit-tested).

### Bubbling

Once a target is found, `bubbleEvent(target, native)` walks `parent` pointers from the target up to the root, dispatching each ancestor's matching `on*` prop (`pointerdown` → `onPointerDown`, `wheel` → `onWheel`, …) until either the chain terminates or a handler calls `event.stopPropagation()`.

```tsx
<group onClick={(e: CanvasSyntheticEvent) => console.log("group:", e.target.tag)}>
  <rect
    x={0} y={0} width={50} height={50} fill="red"
    onClick={(e) => {
      console.log("rect clicked");
      e.stopPropagation(); // halts the bubble — group's onClick won't fire
    }}
  />
</group>
```

### Pixel-perfect override (`onHitTest`)

For irregular shapes (paths, complex polygons, anything where the AABB is a poor approximation), attach an `onHitTest` callback. It receives the element's **local-frame** coordinates (post-inverse-transform) and returns whether the point counts as a hit:

```tsx
import type { CanvasSyntheticEvent } from "aljabr/ui/canvas";

const path2D = new Path2D("M 0 0 L 100 0 L 50 100 Z");

<path
  d="M 0 0 L 100 0 L 50 100 Z"
  fill="orange"
  onHitTest={(x, y) => ctx.isPointInPath(path2D, x, y)}
  onClick={(e: CanvasSyntheticEvent) => console.log("triangle hit at", e.offsetX, e.offsetY)}
/>
```

The `on` prefix is intentional — it's what makes the reconciler treat the function as a non-reactive callback. Without it, a 2-arg pixel-perfect function would be invoked as a reactive getter (`fn()` with no args) and the result stored on the element, losing the function reference.

---

## Performance & scaling

- **zIndex sort.** Sibling order is sorted ascending by `zIndex` per paint (and per hit-test, in reverse). JavaScript's `Array.prototype.sort` is stable since ES2019, so equal-zIndex siblings preserve insertion order automatically — no auxiliary index needed.
- **Viewport culling.** Configure a `Viewport` to skip off-screen subtrees by AABB intersection. Tags whose bounds remain `zeroBounds()` (`<group>`, `<path>`, `<text>` — see [Bounds completeness](#bounds-completeness)) bypass the gate, paying child-by-child intersect cost. The [v0.3.9 roadmap](../../roadmap/v0.3.9.md) lifts these.
- **rAF batching.** All reactive prop writes within a single animation frame coalesce into one `clearRect` + `paintNode` pass. Multiple `Signal.set` calls in a single event handler flush together.
- **Per-prop diffing.** Reactive prop computations are diffed before being written back to the host: if a signal notifies but the derived value hasn't changed (`!==`), the `setProperty` call is skipped entirely.

---

## See also

- [DOM renderer reference](./dom.md) — the shared core API (`view`, `createRenderer`, `RendererHost`, `RendererProtocol`, `ViewNode`, function components, reactive props)
- [Canvas guide](../../guides/ui/canvas.md) — narrative walkthrough from primitives to interactive scenes
- [Canvas internals](../../guides/advanced/canvas-internals.md) — paint pass dispatch, hit-test inverse-transform walk, implicit text wrapping
- [Renderer Protocol guide](../../guides/advanced/renderer-protocol.md) — bringing your own batching scheduler
- [v0.3.9 roadmap](../../roadmap/v0.3.9.md) — pending bounds-completeness work for `<path>`, `<group>`, `<text>`
- [Prelude: `Signal` / `Derived`](../prelude/signal.md) — reactive primitives every prop accepts
- [Prelude: `Ref` / `RefArray`](../prelude/ref.md) — structured state and reactive lists
