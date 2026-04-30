# Changelog

All notable changes to aljabr are documented here. This project uses a rolling changelog — each entry covers one version. The most recent release is at the top.

---

## v0.3.8 — Canvas Renderer

_Minor release following v0.3.7. Ships a first-class retained-mode 2D canvas renderer at `aljabr/ui/canvas` — a fully pluggable `RendererHost<CanvasNode, CanvasElementNode>` that integrates with the existing reconciler with zero changes to the core. Also includes a small `Option.toResult` / `Result.Expect` follow-up from v0.3.7._

---

### New — `aljabr/ui/canvas` canvas renderer

The canvas renderer gives the same JSX, function-component, and signal model you already know from `aljabr/ui/dom`, targeted at `<canvas>` instead of the browser DOM. Install once, use everywhere — the split lives only in the `jsxImportSource` for each component file.

#### `createCanvasRenderer(canvas, options?)`

Pre-wires `canvasHost` with a `requestAnimationFrame`-backed `RendererProtocol` that schedules a single coalesced flush + repaint per animation frame, attaches one dispatcher per pointer/wheel event type to the canvas DOM element, and returns a `{ view, mount }` pair:

```ts
import { createCanvasRenderer } from "aljabr/ui/canvas";

const canvas = document.querySelector<HTMLCanvasElement>("#scene")!;
const r = createCanvasRenderer(canvas);
const unmount = r.mount(() => (
  <rect x={10} y={10} width={100} height={100} fill="cornflowerblue" />
));
```

The initial paint runs synchronously after `mount`. Subsequent reactive prop updates flow through the rAF protocol and coalesce — multiple `Signal.set` calls within a frame produce one repaint. `unmount()` removes all event listeners, disposes reactive subscriptions, and clears the canvas.

#### `Viewport(canvas)` — pan/zoom factory

Creates a `ViewportHandle` with `x`, `y`, `scale` as `Signal<number>` instances. Pass the handle into `createCanvasRenderer` to enable per-frame off-screen culling, and feed the signals into a root `<group>`:

```tsx
import { createCanvasRenderer, Viewport } from "aljabr/ui/canvas";

const vp = Viewport(canvas);
const r = createCanvasRenderer(canvas, { viewport: vp });

r.mount(() => (
  <group x={vp.x} y={vp.y} scale={vp.scale}>
    <rect x={0} y={0} width={100} height={100} fill="red" />
  </group>
));

vp.scale.set(2); // zoom in — repaints on the next rAF tick
vp.reset();      // back to (0, 0, 1)
```

`bounds()` on the handle returns the visible world-space rectangle `(-x/scale, -y/scale, w/scale, h/scale)`, read untracked from the signals since the paint pass is not a reactive computation.

#### `canvasHost` — `RendererHost<CanvasNode, CanvasElementNode>`

The retained-mode host. Most consumers use `createCanvasRenderer`; reach for `canvasHost` directly when bringing your own `RendererProtocol`:

```ts
import { createRenderer } from "aljabr/ui";
import { canvasHost } from "aljabr/ui/canvas";

const { mount } = createRenderer(canvasHost, {
  scheduleFlush(flush) { queueMicrotask(flush); },
});
```

#### Seven canvas primitives

JSX with `jsxImportSource: "aljabr/ui/canvas"` or a per-file pragma gives you:

| Tag | Geometry props | Notes |
|---|---|---|
| `<rect>` | `x y width height rx` | `rx > 0` triggers `roundRect` |
| `<circle>` | `cx cy r` | |
| `<ellipse>` | `cx cy rx ry` | |
| `<line>` | `x1 y1 x2 y2` | Stroke-only |
| `<path>` | `d` | SVG path string via `Path2D` |
| `<group>` | `x y scale rotate` | Transform-only container + paint-context boundary |
| `<text>` | `x y content` | Single-line; layout-aware under shape parents |

All tags accept `fill`, `stroke`, `strokeWidth`, `zIndex`, all pointer/wheel `on*` handlers, and `onHitTest`. Everything reactive — pass a `Signal`, `Derived`, or `() => value` anywhere a plain value is accepted.

#### Inherited paint props

`fill`, `stroke`, `strokeWidth`, `fontFamily`, `fontSize`, `fontWeight`, `textAlign`, `verticalAlign`, and `padding` propagate down the scene graph through `<group>` boundaries. Non-group elements forward their parent's context unchanged. Per-prop resolution is `el.props[key] ?? group-context[key] ?? default`.

#### Layout-driven labels

A `<text>` element whose parent is a shape (rect/circle/ellipse/line/path) computes its `x` / `y` from the parent's bounds plus `textAlign`, `verticalAlign`, and `padding` — no explicit coordinates required:

```tsx
<rect x={10} y={10} width={120} height={40}
      fill="white" stroke="black"
      textAlign="center" verticalAlign="middle">
  Click me
</rect>
```

The wrapped label positions itself centred both horizontally and vertically. String children are implicitly wrapped in a synthetic `<text>` element at insert time; no explicit `<text>` tag is required.

#### Hit testing & events

The renderer attaches a single dispatcher per pointer and wheel event type (`pointerdown`, `pointerup`, `pointermove`, `pointerenter`, `pointerleave`, `click`, `dblclick`, `contextmenu`, `wheel`) to the canvas DOM element. On each event:

1. `hitTest(root, offsetX, offsetY)` walks the scene graph in reverse paint order, accumulating an inverse affine transform through `<group>` matrices, and returns the deepest element whose bounds (in local frame) contain the point.
2. `bubbleEvent(target, native)` walks `parent` pointers upward, dispatching the matching `on*` handler on each ancestor until `stopPropagation()` is called or the root is reached.

```tsx
<group onClick={() => console.log("group handler — fires after rect")}>
  <rect x={0} y={0} width={50} height={50} fill="red"
        onClick={(e) => { console.log("rect"); e.stopPropagation(); }} />
</group>
```

#### Pixel-perfect `onHitTest`

For irregular shapes, attach an `onHitTest` callback. When present, bounds are not consulted — the callback is the sole gate. The `on*` prefix is required so the reconciler doesn't treat the function as a reactive getter:

```tsx
const triangle = new Path2D("M 0 0 L 100 0 L 50 100 Z");
<path d="M 0 0 L 100 0 L 50 100 Z" fill="orange"
      onHitTest={(x, y) => ctx.isPointInPath(triangle, x, y)}
      onClick={() => console.log("triangle hit")} />
```

`(x, y)` are the element's local-frame coordinates post-inverse-transform.

#### Viewport culling

When a `Viewport` is configured, the paint pass skips entire subtrees whose element bounds don't intersect the visible world-space rect. `<group>`, `<path>`, and `<text>` currently report `zeroBounds()` (see [v0.3.9 roadmap](./v0.3.9.md) for the bounds-completeness follow-up); the paint pass treats zero-area bounds as non-cullable so those tags always paint.

---

### Improved — `Option.toResult` + `Result.Expect<T, E>` type tracking

**`Option.toResult` async-error overload.** A third overload accepts an async error thunk `() => Promise<E>`, which lifts `None` into a `Result.Expect` whose pending promise rejects with the constructed `E`. Authors who need a lazily-evaluated async fallback value no longer need to pre-await or wrap:

```ts
const r = await option.toResult(() => fetch("/error").then(r => r.json()));
```

**Overload-ordering fix.** A bug in the existing sync-thunk overload caused `E` to be inferred as `() => string` instead of `string` when the thunk returned a primitive. The overloads are now ordered correctly — async thunk first, sync thunk second, plain value third.

**`Result.Expect<T, E>` phantom `E`.** `Expected<T, E = never>` gains a phantom rejection-type parameter so the rejection type propagates through `Thenable.then` chains. `onRejected`'s `reason` parameter narrows from `any` to `E`; `Thenable.catch(fn)` is added as a shorthand. The `E` parameter tracks the rejection type of the underlying promise without requiring authors to handle it at each `then` call.

---

### Changed — DOM JSX import source

The DOM JSX runtime moved from `aljabr/ui/jsx-runtime` to `aljabr/ui/dom/jsx-runtime` to match its new parallel with the canvas runtime. Update `tsconfig.json` and per-file pragmas:

```diff
-  "jsxImportSource": "aljabr/ui"
+  "jsxImportSource": "aljabr/ui/dom"
```

The old entry points (`aljabr/ui/jsx-runtime`, `aljabr/ui/jsx-dev-runtime`) are removed — no re-export shim. This is a pre-alpha library; the rename is clean with no stranded consumers.

---

### Docs

- `docs/api/ui.md` → `docs/api/ui/dom.md`; sibling `docs/api/ui/canvas.md` covers the full canvas API surface
- `docs/guides/ui.md` → `docs/guides/ui/dom.md`; sibling `docs/guides/ui/canvas.md` is a 7-part narrative guide from static elements to an interactive diagram
- New advanced guide: `docs/guides/advanced/canvas-internals.md` — paint-pass dispatch, hit-test inverse-transform walk, implicit text wrapping, file map, where v0.3.9 hooks in cleanly
- `docs/roadmap/v0.3.9.md` — three bounds-completeness deferrals with implementation strategy options

---

## v0.3.7 — Runnable Demo, Iterator Reactivity & List Reconciliation

_Patch release following v0.3.6. Ships the first runnable in-repo demo (`public/`) — a small todo app exercising unions, `Ref`, `RefArray`, the iterator chain, and the DOM renderer end-to-end. Building it surfaced the renderer and iterator-key gaps that the rest of this release closes: list mutations were tearing down and re-mounting the entire list, and key information was being lost across `map`/`filter`/`sort` chains. The renderer now reconciles surgically and keys survive the full iterator chain._

### New — Runnable demo app at `public/`

`npm run dev` now serves a working todo app from `public/` against the local source build. It is the first end-to-end consumer of the package living in the repo and doubles as a smoke test for the JSX runtime, the DOM renderer, and the reactive primitives. The Vite config was wired up to serve `public/` as a real dev root (previously the project shipped only the library build). The demo uses `Task = union({ Active, Done })`, a `Ref.create<Task[]>([])` for the list, and `tasks.filter(...).map(...)` to render rows — exactly the iterator-chain shape that motivates the reconciliation work below.

To run it:

```bash
npm install
npm run dev
```

> One typo blocked this from working as shipped: `public/index.html` referenced `./main.tsx` but the file was named `maint.tsx`. The file is now `public/main.tsx` and the dev server boots cleanly.

---

### Fixes

**`mountDerivedArray` — per-index owner scopes (Phase A)**

Carried a deferral since v0.3.4. The previous renderer subscribed to all of a `DerivedArray`'s signals inside a single `effectOwner` and tore down the entire mounted list on any change — toggling one item re-rendered every row. Each index now gets its own `Computation` subscribed only to `arr.get(i)`, and the outer `effectOwner` subscribes only to `arr.length()`:

- Length increases → create new per-index scopes for the appended indices.
- Length decreases → dispose trailing scopes; their cleanups remove the corresponding DOM nodes.
- `arr.get(i)` changes → only the scope at index `i` re-runs.

This eliminates full-list re-renders for the common cases: in-place mutation, append, and tail removal.

**`mountDerivedArray` — keyed scope reconciliation (Phase B)**

Per-index scopes still re-render shifted items when something is removed from the middle of a list — every later index's signal fires because its value changed, even though the underlying item is the same. Keyed scopes bind a scope's lifetime to item identity instead of position. The renderer checks `arr.keyAt(i)` (see below) on first render and after each length change: non-null values activate keyed mode, `null` falls back to Phase A.

In keyed mode the renderer maintains `Map<unknown, { scope: Computation; start: Node; end: Node }>` — one entry per live item — and on each update reconciles old vs. new key lists:

- **Removed keys**: dispose the scope; remove all DOM nodes between its `start` and `end` anchors.
- **New keys**: create a scope, insert anchors, reconcile the child at the correct position.
- **Moved keys** (same key, new position): re-insert the existing anchors and the nodes between them at the new position — without disposing or re-running the scope.
- **Same key, changed value**: the per-index signal fires and the scope re-runs at its current position.

In the demo app: toggling a task from Active to Done now re-renders only that one row, and switching the filter from "all" to "active" moves the surviving rows' DOM nodes without re-rendering them.

**`DerivedArray.filter()` and `DerivedArray.sort()` — inherit source key**

When no `opts.key` is provided and the source `DerivedArray` already has a `#keyFn`, the derived array now inherits it instead of falling back to reference identity. The items produced by filter and sort are a subset or reorder of the source items, so the source key function remains valid. `keyIsDefault` is cleared when a key is inherited; no warning is emitted.

```ts
// before — key lost on chained filter, renderer falls back to position-based
const done = visibleTasks.filter(t => isDone(t));        // keyFn = identity

// after — key inherited from visibleTasks, renderer uses keyed reconciliation
const done = visibleTasks.filter(t => isDone(t));        // keyFn = taskId (inherited)
```

**`DerivedArray.map()` — index-based key inheritance**

`map` changes the element type (`T → U`), so the source key function cannot operate on mapped items directly. `map` now inherits the source key as an index-based closure that resolves `sourceKeyFn(source.peek(i))` for index `i`. The resulting `DerivedArray<U>` carries this index key and exposes it via `keyAt(i)` so the renderer can reconcile mapped rows by source identity.

```ts
// visibleTasks: DerivedArray<Task> with keyFn = taskId
const rows = visibleTasks.map(task => <TaskItem task={task} />);
rows.keyAt(0); // → taskId(visibleTasks.peek(0))
```

---

### New — `RefArray.map(fn, opts?)`

`RefArray` is the mutable root of the iterator chain and has no key to inherit. Authors mapping directly off a `RefArray` (without a prior `filter` or `sort`) previously had no way to inject a key for the renderer. `map` now accepts a second argument matching the shape used elsewhere in the iterator chain:

```ts
const tasks = Ref.create<Task[]>([]);
const rows = tasks.map(task => <TaskItem task={task} />, { key: taskId });
```

Non-breaking: callers that omit `opts` get the previous behavior — no key, position-based reconciliation in the renderer.

---

### New — `DerivedArray.keyAt(i): unknown | null`

A single public method the renderer uses to retrieve the key for any index:

- For `filter`/`sort` arrays: `#keyFn(#items[i])`.
- For `map` arrays with an inherited source key: delegates to the stored index-based closure.
- For `map` arrays with no key (e.g. mapping off an unkeyed `RefArray` without `opts.key`): returns `null`.

`null` signals the renderer to fall back to position-based reconciliation for that array.

---

### Future Work

Keyed reconciliation within a single renderer is complete after this release. Composition across renderers (e.g. a DOM list item containing a canvas sub-renderer) remains a userland pattern — spawn a new renderer root, tie its cleanup to the parent owner. A first-class `createPortal` primitive for `aljabr/ui` will be considered in a future version if the pattern proves common in application code.

---

## v0.3.6 — Bug Fixes: match() Inference & Ref.patch() Variant Diffing

_Patch release following v0.3.5. Two correctness fixes surfaced by first-party application code using union variants inside reactive Ref state._

### Fixes

**`match()` return type inference**

TypeScript could not propagate the result type `R` through the non-homomorphic mapped matcher types (`ExactMatchers`, `FallbackMatchers`), causing the return type of `match()` to collapse to `unknown` in some inference contexts. The overloads now infer the matchers object as `M` and extract the result type via `InferMatchResult<M>` — a mapped type over `M`'s values. No change to runtime behavior or call-site syntax.

**`Ref.patch()` treating union variants as plain objects**

`collectLeafChanges` (the deep-diff engine powering `Ref.patch()`) would recurse into a union variant's payload by key when it encountered a variant on either side of a diff. This caused incorrect fine-grained notifications — only changed payload keys were notified, rather than the whole-variant path — and could silently drop tag-level changes when tags differed. The fix detects union variants via the internal `tag` symbol before recursing: if the tags differ (or only one side is a variant), the whole path is treated as an atomic replacement.

---

## v0.3.5 — RefArray Hardening & DerivedArray Rename

_Patch release following v0.3.4. Motivated by first-party application code (a todo app built against the published package) that exposed type-system gaps and a missing method surface on `RefArray`._

### Breaking Changes

**`ReactiveArray<T>` renamed to `DerivedArray<T>`**

The `ReactiveArray` export no longer exists. Replace every import and type annotation with `DerivedArray` — a mechanical find-and-replace. The runtime behavior is identical.

```diff
- import { ReactiveArray } from "aljabr/prelude"
+ import { DerivedArray } from "aljabr/prelude"
```

**`RefArray.pop()` return type changed from `T | undefined` to `Option<T>`**

```diff
- const last: number | undefined = items.pop()
+ const last: Option<number> = items.pop()
+ // unwrap: items.pop().getOrElse(fallback)
```

**`Ref.pop(path)` return type changed from `ArrayItem<T, P> | undefined` to `Option<ArrayItem<T, P>>`**

Same pattern as `RefArray.pop()`. Both changes align destructive reads with the library's error-handling philosophy: absence is semantically meaningful and callers should handle it explicitly.

---

### New — `Ref.create<T[]>` type coercion fix

`Ref.create<Task[]>([])` now correctly returns `RefArray<Task>` instead of the erroneous `RefArray<Task[]>`. A new overload is prepended to the chain:

```ts
static create<T extends unknown[]>(initial: T): RefArray<T[number]>
```

TypeScript picks this overload first when an explicit array type parameter is supplied, resolving the element type via `T[number]`. The existing inferred-argument overload (`Ref.create([...tasks])`) is unaffected.

---

### New — `RefArray` methods

#### Mutations

| Method | Returns | Notes |
|---|---|---|
| `set(index, value)` | `Option<T>` | Replace in-place; fires only the per-index signal. `Some(oldValue)` on success, `None` if out of bounds. Does not extend the array. |
| `shift()` | `Option<T>` | Remove and return the first element. |
| `unshift(...items)` | `void` | Prepend one or more items. |

#### Precise-tracking reads

Stop at the first match; only visited indices are tracked as dependencies.

| Method | Returns |
|---|---|
| `find(predicate)` | `Option<T>` |
| `findIndex(predicate)` | `Option<number>` |
| `findLastIndex(predicate)` | `Option<number>` |
| `includes(value)` | `boolean` |

#### Full-array reactive reads

Track all per-index signals and the length signal; re-evaluate on any element or size change.

| Method | Returns |
|---|---|
| `join(separator?)` | `string` |
| `reduce(fn, initial)` | `U` |
| `reduceRight(fn, initial)` | `U` |

---

### New — whole-value `get()` and `peek()` overloads

All three array/object containers gain a no-argument `get()` overload that returns the entire underlying value as a reactive read, and a `peek()` method that mirrors it untracked.

| Call | Tracking | Returns |
|---|---|---|
| `RefArray.get()` | Coarse — root signal, fires on any mutation | `T[]` |
| `RefArray.get(i)` | Fine — per-index signal (unchanged) | `T \| undefined` |
| `RefArray.peek()` | None | `T[]` |
| `RefArray.peek(i)` | None | `T \| undefined` |
| `DerivedArray.get()` | Coarse — dedicated `#rootSignal`, fires on every re-computation | `T[]` |
| `DerivedArray.get(i)` | Fine — per-index signal (unchanged) | `T \| undefined` |
| `DerivedArray.peek()` | None | `T[]` |
| `DerivedArray.peek(i)` | None | `T \| undefined` |
| `Ref.get()` | Coarse — root path signal, fires on any write | `T \| undefined` |
| `Ref.get(path)` | Fine — per-path signal (unchanged) | `PathValue<T, P> \| undefined` |
| `Ref.peek()` | None | `T \| undefined` |
| `Ref.peek(path)` | None | `PathValue<T, P> \| undefined` |

The no-arg `get()` is deliberately coarse — use it when you need the full value. For fine-grained subscriptions, supply an index or path, or use iterator methods (`filter`, `find`, `reduce`, etc.).

---

### Intentionally unchanged

`RefArray.get(i)`, `DerivedArray.get(i)`, and `Ref.get(path)` remain `T | undefined` / `PathValue<T, P> | undefined`. Wrapping high-frequency reactive read primitives in `Option` would add ceremony at every internal callsite and break the common authoring pattern (`tasks.get(0)?.name`). See the v0.3.5 roadmap for the full rationale.

---

## v0.3.4

See [`docs/roadmap/v0.3.4.md`](./v0.3.4.md).

## v0.3.3

See [`docs/roadmap/v0.3.3.md`](./v0.3.3.md).

## v0.3.2

See [`docs/roadmap/v0.3.2.md`](./v0.3.2.md).

## v0.3.0

See [`docs/roadmap/v0.3.0.md`](./v0.3.0.md).
