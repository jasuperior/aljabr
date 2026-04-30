# Canvas Internals

How the `aljabr/ui/canvas` renderer is put together — the data structures, the dispatch pattern, the side maps that make implicit text wrapping work, and the hit-test inverse-transform walk. Read this if you're contributing to the renderer, implementing a sibling renderer host, or trying to understand the seams in v0.3.9 work.

> Knowing the public API ([Canvas guide](../ui/canvas.md), [Canvas reference](../../api/ui/canvas.md)) helps but isn't required.

---

## The `CanvasNode` union

The scene graph is built from a two-variant tagged union:

```ts
type CanvasNode = CanvasElementNode | CanvasTextNode;

type CanvasElementNode = Variant<"Element", {
  tag: CanvasTag;                                  // rect | circle | ellipse | line | path | group | text
  props: Record<string, unknown>;
  children: CanvasNode[];
  parent: CanvasElementNode | null;
  bounds: CanvasBounds;
  zIndex: number;
  hitTest?: (x: number, y: number) => boolean;
}>;

type CanvasTextNode = Variant<"Text", { content: string }>;
```

A few choices worth flagging:

- **`Element` carries everything; `Text` carries only `content`.** `Text` has no `parent` field, no `bounds`, no `zIndex`. This minimises the variant payload and makes it clear what the node *is*: a leaf string. Implicit wrapping (below) promotes Text into Element when it needs scene-graph identity.
- **`tag` is a string literal**, not a tagged variant. The per-tag dispatch in the paint pass and host uses `match` + `when({ tag: "rect" }, …)` arms — same library pattern as union-level dispatch, but matching on the payload field. This keeps every tag's branch scoped to a structural match against its own props rather than a JS `switch`.
- **`hitTest` is hoisted out of `props`.** The pixel-perfect override lives on the variant payload, not in the props bag, because the hit-test walker needs to find it without a `props` lookup. The host's `setProperty` recognises the `onHitTest` key and writes to `el.hitTest` directly.

The variant **value** factory (`CanvasNode.Element({...})` / `CanvasNode.Text("…")`) lives at `src/ui/canvas/node.ts`. The barrel exports the *type* only — TypeScript's `verbatimModuleSyntax: true` rejects re-exporting the same identifier as both a type and a value through one barrel. Internal call sites use the factory directly; external authors don't need it.

---

## `match` + `when` as the dispatch primitive

Every per-variant and per-tag decision in the canvas renderer goes through `match` from the core library. Two patterns recur:

### Variant dispatch — Element vs Text

```ts
match(node, {
  Element: (el) => { /* … */ },
  Text:    () => undefined,
});
```

Used in the host (`insert`, `remove`, `setText`, `parentNode`, `nextSibling`), the paint pass (`paintNode`, `zIndexOf`, `sortChildrenByZIndex`), and the hit-test walker (`isElement`).

### Per-tag dispatch — `when` arms inside the Element branch

```ts
match(node, {
  Element: [
    when({ tag: "rect" },    ({ props }) => /* … */),
    when({ tag: "circle" },  ({ props }) => /* … */),
    when({ tag: "ellipse" }, ({ props }) => /* … */),
    when({ tag: "line" },    ({ props }) => /* … */),
    when({ tag: "path" },    ({ props }) => /* … */),
    when(__,                 () => /* group / text / unknown */),
  ],
  Text: () => /* … */,
});
```

`when({ tag: "rect" }, …)` is structural pattern matching against the variant payload, so the matched arm receives an `Element` typed exactly as the pattern narrowed it. The `when(__, …)` catch-all closes the dispatch — it's where `<group>`, `<path>`, `<text>` land for branches where their behaviour is "do nothing".

Why this pattern over a JS `switch`: it's the library's expressive form. Future bounds work (v0.3.9 path-string parsing, group descendant union) drops a single `when({ tag: "path" }, …)` arm into `recomputeBounds` to engage. The dispatch is the seam.

---

## The host

`canvasHost` (`src/ui/canvas/host.ts`) implements `RendererHost<CanvasNode, CanvasElementNode>`. Most methods are straightforward Element / Text dispatch — but two pieces deserve a look.

### `recomputeBounds(node)` — eager geometry → bounds

Called from `setProperty` whenever a geometry key changes (`x`, `y`, `width`, `height`, `cx`, `cy`, `r`, `rx`, `ry`, `x1`, `y1`, `x2`, `y2`, `d`). Computes the AABB for `rect`, `circle`, `ellipse`, `line` directly from props; falls through to `zeroBounds()` for `path`, `group`, `text` (the v0.3.8 deferrals).

The eager strategy keeps `el.bounds` always-current — paint and hit-test never have to re-derive bounds from props. The cost is one numeric recompute per geometry-prop write, which is amortised by the rAF batching that coalesces multiple writes per frame.

### Implicit `<text>` wrapping (the side maps)

When the reconciler inserts a `CanvasTextNode` into a parent whose `tag` is not `"text"`, the host wraps the text in a synthetic `<text>` element and stores the wrapper in `parent.children`. Two `WeakMap`s manage the indirection:

```ts
const textWrappers   = new WeakMap<CanvasTextNode, CanvasElementNode>();  // Text → wrapper
const wrapperToText  = new WeakMap<CanvasElementNode, CanvasTextNode>();  // wrapper → Text (reverse)
```

The forward map (`textWrappers`) routes `setText` and `remove` from the original Text reference to the wrapper. The reverse map (`wrapperToText`) is what makes `nextSibling` work correctly: the reconciler holds Text references and walks `cur !== end` against them, so the host has to return the Text reference, not the wrapper, when the next slot in `parent.children` is a wrapper.

Without the reverse map, `mountReactiveRegion`'s `cur !== end` anchor walk would silently fail to terminate — the reconciler holds anchor *Text* nodes (`createText("")` start/end markers) and compares by reference. This is the precise bug that motivated the dual-map design.

`parentNode(node)` returns `null` for both bare Text and wrappers — the spec says Text has no parent, and wrappers are an internal detail the reconciler should never reason about. Consequence: code outside the host can't tell wrappers exist.

### Why not put `parent` on `Text`?

It would simplify `nextSibling` to a single dispatch table. But it would also bloat the variant payload for every Text node — many of which are anchor-only zero-width markers that the reconciler creates by the dozen for reactive regions. The side-map design keeps Text payload minimal and pushes the wrapping cost onto the (rarer) "Text appears in user content" path.

---

## The paint pass

`paintNode(ctx, node, viewportBounds?, parentContext?)` (`src/ui/canvas/paint.ts`) walks the scene graph and emits canvas operations. Per Element it does, in order:

1. **Cull check.** `viewportBounds` provided + `hasCullableBounds(el.bounds)` + `!intersects(el.bounds, viewportBounds)` → skip the entire subtree. The `hasCullableBounds` predicate (`width > 0 && height > 0`) is the gate that makes zero-bounds elements (`<group>`, `<path>`, `<text>` in v0.3.8) bypass culling.
2. **`ctx.save()`** — opens a transform / style boundary.
3. **`applyTransform`** — for `<group>` only, post-multiplies `translate(x, y) → rotate(rotate°) → scale(scale)` onto the running ctx. Other tags don't apply any transform; their `x`/`y` are geometry, not transform.
4. **Derive paint context.** For `<group>`, `deriveContext(parentContext, props)` returns a new `PaintContext` if any inheritable key is overridden (otherwise the parent context is forwarded by reference — descendants share the same object across un-affected boundaries). For non-group elements, the parent context flows through unchanged.
5. **Sort children** by `zIndex` ascending, in place. JS sort is stable since ES2019, so equal-zIndex siblings preserve insertion order automatically.
6. **`paintShape`** — `match` + `when` per tag, emitting the geometry-specific ctx calls.
7. **Recurse** into each child with the (possibly new) paint context.
8. **`ctx.restore()`** — closes the boundary.

`Text` variants are a no-op at the paint level — only their wrapping synthetic `<text>` Element is painted.

### Why a custom `PaintContext` reducer instead of `aljabr/signals`' `context()`?

`aljabr/signals`' `context()` API threads values through the **owner tree** (the reactive computation hierarchy), not the scene graph. The paint pass walks `CanvasElementNode.children` recursively and runs *outside* any owner — `peek()` is called on `Viewport` signals because we don't want paint to subscribe to anything.

Using `context()` would require wrapping each Element paint in `createOwner` + `runInContext`, allocating an owner tree parallel to the scene graph just for value lookup. The reducer (`PaintContext` + `deriveContext`) is a sync, allocation-conscious walk that costs ~one object allocation per `<group>` boundary that overrides a key.

This was a deliberate trade-off discussed during the v0.3.8 implementation.

### Layout-prop fallback for `<text>`

When painting a `<text>` element, layout-prop resolution adds an extra step:

```
el.props ?? parent.props (if shape) ?? paintContext ?? hardcoded default
```

The "shape parent" arm is what makes `<rect textAlign="center">label</rect>` work without an enclosing `<group>` — the wrapped synthetic `<text>` reaches up through `el.parent.props` for layout intent. `<group>` provides paint context the normal way; the rect's role is purely as a layout container.

---

## Hit testing

`hitTest(root, sx, sy)` (`src/ui/canvas/hit-test.ts`) walks the scene graph in **reverse paint order** (topmost sibling first), accumulating a world-to-screen affine matrix as it descends through `<group>` transforms.

### Affine matrix — 6-element row-major

```ts
type AffineMatrix = readonly [a, b, c, d, e, f];

// |a c e|
// |b d f|
// |0 0 1|
```

Same shape as `CanvasRenderingContext2D.setTransform` arguments. World-to-screen: `s = (a·w.x + c·w.y + e, b·w.x + d·w.y + f)`. The hit-test walker mirrors the paint pass's `T·R·S` post-multiplication exactly so the inverse walk lines up by construction — if paint produces a particular transform for a given group, hit-test inverts that same transform.

### `groupLocalMatrix(props)` — building from group props

```ts
function groupLocalMatrix(props): AffineMatrix {
  const tx  = props.x ?? 0;
  const ty  = props.y ?? 0;
  const rot = (props.rotate ?? 0) * Math.PI / 180;
  const s   = props.scale ?? 1;
  return [s·cos(rot), s·sin(rot), -s·sin(rot), s·cos(rot), tx, ty];
}
```

`compose(parent, local)` yields the next level down. At a non-group leaf, `applyInverse(currentMatrix, sx, sy)` projects the screen point back into the leaf's local frame.

### The decision per element

For each `Element` visited (in reverse paint order — `el.children[i]` for `i = length-1 down to 0`, since paint sorts ascending by `zIndex` and we want topmost first):

1. **`<group>`**: compose its matrix; recurse children; **never** return the group itself (groups are transparent).
2. **Non-group with `el.hitTest` defined**: the override decides. Bounds are not consulted. This is the only path available for tags whose bounds are still `zeroBounds()` (`<path>`, `<text>`).
3. **Non-group without `el.hitTest`**: inverse-transform the screen point, test `boundsContains(el.bounds, lx, ly)` (inclusive — touching edges count). Hit on success.
4. **`Text` variants**: skipped (only the synthetic wrapper participates).

The descendant-first walk means a child sitting on top of a parent (in paint order) can claim the hit before the parent does.

### Why `onHitTest` is authoritative

The v0.3.8 §6.4 spec said "bounds gate, then optional hitTest verification" — which is what the Phase 6 implementation did initially. Phase 7 flipped this: with the override defined, bounds are not consulted at all.

Reason: if bounds were the gate, `<path>` elements (whose bounds are still `zeroBounds()` in v0.3.8) would never reach their override. The bounds rect "doesn't describe me, ask this function instead" interpretation is the only one that makes the override useful for the tags that need it most. The Phase 6 test was rewritten to assert the new contract.

This will be reconsidered in v0.3.9 once `<path>` and `<text>` grow real bounds — at that point bounds-then-override may become viable again, but the override-only-when-defined fallback should still apply for true irregular shapes.

---

## Event dispatch

`bubbleEvent(target, native)` walks `parent` pointers from the hit target upward, building a `CanvasSyntheticEvent` (mirrors PointerEvent + WheelEvent fields, plus `target`, `nativeEvent`, `stopPropagation`, `preventDefault`) and invoking each ancestor's matching `on*` prop.

### `EVENT_HANDLER_MAP`

```ts
{
  pointerdown:  "onPointerDown",
  pointerup:    "onPointerUp",
  pointermove:  "onPointerMove",
  pointerenter: "onPointerEnter",
  pointerleave: "onPointerLeave",
  click:        "onClick",
  dblclick:     "onDblClick",
  contextmenu:  "onContextMenu",
  wheel:        "onWheel",
}
```

Hardcoded — short and unambiguous, no string-mangling logic. Adding a new event type is one map entry plus a listener attach in `createCanvasRenderer`.

### Why `onHitTest` is named `on*`

The reconciler treats every prop whose key starts with `on` as a non-reactive callback (it skips the reactive-prop tracking that would otherwise call functions as zero-arg getters). A 2-arg pixel-perfect `(x, y) => boolean` function passed as `hitTest` (without the `on` prefix) would be invoked as `fn()`, the result stored on the element, and the function reference lost.

The `onHitTest` naming co-opts that reconciler rule. The host's `setProperty` recognises `key === "onHitTest"` and writes the function to `el.hitTest` (the variant payload field). This is a v0.3.8 divergence from the original spec text (which said `hitTest` without the prefix); the reasoning is documented in §6.4 of the v0.3.8 roadmap.

### Listener attachment lifecycle

`createCanvasRenderer.mount` attaches one dispatcher per event type to the canvas DOM element (9 listeners total). The unmount cleanup tears all 9 down before disposing the reactive root and clearing the canvas. Lifecycle is symmetric and tested by listener-count assertions in `event-integration.test.ts`.

---

## The rAF protocol

`createCanvasRenderer` constructs an internal `RendererProtocol`:

```ts
const protocol: RendererProtocol = {
  scheduleFlush(flush) {
    requestAnimationFrame(() => {
      flush();    // applies queued reconciler work (host.setProperty etc.)
      repaint();  // ctx.clearRect + paintNode(ctx, root, viewport.bounds())
    });
  },
};
```

Single rAF per pending batch — multiple `Signal.set` calls within the same tick coalesce into one flush + one repaint. The initial paint after `mount` runs synchronously (the reconciler mounts synchronously and we paint at the end of the call) so authors don't have to wait a frame to see anything.

The protocol is intentionally **not** exported from the canvas barrel. Authors who need a different scheduling discipline construct their own protocol and pass it to `createRenderer(canvasHost, myProtocol)` directly — `aljabr/ui` is the right level for protocol composition.

---

## File map

| File | Role |
|---|---|
| `src/ui/canvas/node.ts` | `CanvasNode` union + variant factory + types + `zeroBounds()` |
| `src/ui/canvas/host.ts` | `canvasHost` implementing `RendererHost<CanvasNode, CanvasElementNode>` + the implicit-wrap WeakMaps + `recomputeBounds` |
| `src/ui/canvas/paint.ts` | `paintNode` + `paintShape` per-tag `when` arms + culling + zIndex sort + transform composition |
| `src/ui/canvas/paint-context.ts` | `PaintContext` reducer + `deriveContext` + `normalizePadding` + root defaults |
| `src/ui/canvas/hit-test.ts` | `hitTest`, `bubbleEvent`, `EVENT_HANDLER_MAP`, `CanvasSyntheticEvent`, affine matrix math |
| `src/ui/canvas/viewport.ts` | `Viewport(canvas)` factory + `ViewportHandle` |
| `src/ui/canvas/renderer.ts` | `createCanvasRenderer` — rAF protocol + listener wiring + initial paint + unmount cleanup |
| `src/ui/canvas/jsx-runtime.ts` | `jsx` / `jsxs` / `jsxDEV` factory + `JSX.IntrinsicElements` namespace + per-tag prop interfaces |
| `src/ui/canvas/jsx-dev-runtime.ts` | Re-exports from `jsx-runtime` |
| `src/ui/canvas/index.ts` | Public barrel (types + `canvasHost` + `Viewport` + `createCanvasRenderer` + `CanvasSyntheticEvent`) |

`paint.ts`, `hit-test.ts`, and `paint-context.ts` are intentionally **not** re-exported from the barrel — they're internal compositions that `createCanvasRenderer` consumes. Custom-protocol authors who want to build their own `createRenderer(canvasHost, …)` use the public host + viewport surface and run paint themselves; they don't currently get a packaged `paintNode`. That's a deliberate scoping decision and could be revisited if a use case appears.

---

## Where to look for work

Three places where v0.3.9 (or beyond) hooks in cleanly:

1. **`recomputeBounds` in `host.ts`** — the per-tag `when` dispatch is where path-string parsing and group descendant-union land. Drop in real bounds; the existing intersect / hit-test walks engage automatically.
2. **`hit-test.ts`'s `groupLocalMatrix`** — if a future primitive grows its own transform (e.g., a `<rect transform="rotate(45)">`), the matrix builder is the single place that needs updating.
3. **`paint.ts`'s `paintShape` `when` arms** — adding a new primitive tag is one `when({ tag: "newtag" }, …)` arm here, plus a parallel arm in `recomputeBounds`, plus a JSX prop interface in `jsx-runtime.ts`. No reconciler changes.

The renderer is structured to make those edits local. If you find yourself touching three modules to add a tag, something has drifted — file an issue.

---

## See also

- [Canvas guide](../ui/canvas.md) — authoring reference
- [Canvas API reference](../../api/ui/canvas.md) — public surface
- [Renderer Protocol guide](./renderer-protocol.md) — bringing your own batching scheduler
- [v0.3.9 roadmap](../../roadmap/v0.3.9.md) — bounds-completeness work in flight
- [v0.3.8 roadmap](../../roadmap/v0.3.8.md) — the implementation plan this renderer was built from
