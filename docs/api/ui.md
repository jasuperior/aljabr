# UI (`aljabr/ui`)

Aljabr's native rendering layer. A signal-driven, pluggable UI system built on the same reactive primitives as the rest of the prelude — no virtual DOM, no framework dependency.

---

## Setup

### Installation

```sh
npm install aljabr
```

The UI layer ships as a separate entry point; import from `aljabr/ui`.

### JSX (optional)

To write JSX/TSX, add the following to your `tsconfig.json`:

```json
{
  "compilerOptions": {
    "jsx": "react-jsx",
    "jsxImportSource": "aljabr/ui"
  }
}
```

TypeScript will automatically import `jsx` and `Fragment` from `aljabr/ui/jsx-runtime`. No additional runtime configuration is needed.

---

## Core concepts

The UI layer has three layers:

1. **`ViewNode`** — a typed description of what to render (element, component, fragment, text). Think of it as a lightweight, single-use instruction, not a persistent tree.
2. **`createRenderer(host)`** — binds a `ViewNode` tree to a rendering target. Returns a `mount` function.
3. **`RendererHost`** — the interface a rendering target implements. The included `domHost` targets the browser DOM; other targets (canvas, SSR, terminal) implement the same contract.

Reactivity is provided by the signal layer. There is no diffing: static structure is rendered once; dynamic regions use function children (`() => Child`) as the boundary between the static tree and the reactive graph.

---

## `view()`

**Import:** `import { view } from "aljabr/ui"`

The primary authoring primitive and JSX factory target. Three overloads:

### Element

```ts
view(tag: string, props?: Record<string, unknown> | null, ...children: Child[]): ElementViewNode
```

Creates a host element.

```ts
view("div", { class: "card" },
  view("h2", null, title),
  view("p", null, () => body.get()),
)
```

### Component

```ts
view(fn: (props: P) => ViewNode, props?: P | null, ...children: Child[]): ComponentViewNode
```

Invokes a function component. Children passed as rest args are merged into `props.children` (single child as a value, multiple as an array).

```ts
const Button = ({ label, onClick }: { label: string; onClick: () => void }) =>
  view("button", { onClick }, label);

view(Button, { label: "Save", onClick: handleSave })
```

### Fragment

```ts
view(Fragment, null, ...children: Child[]): FragmentViewNode
```

Groups children without a wrapping element.

```ts
view(Fragment, null,
  view("dt", null, "Term"),
  view("dd", null, "Definition"),
)
```

---

## `Child`

Everything `view()` accepts as a child:

| Type | Behavior |
|---|---|
| `string \| number \| boolean` | Rendered as a static text node |
| `null \| undefined \| false` | Skipped — renders nothing |
| `ViewNode` | Mounted as-is |
| `() => Child` | **Reactive region** — re-evaluated when signal dependencies change |
| `ReactiveArray<Child>` | **Reactive list** — re-rendered when the array mutates |
| `RefArray<Child>` | **Reactive list** — re-rendered when the array mutates |
| `{ get(): Child }` | **Readable shorthand** — normalised to `() => r.get()` by `view()` |

### Reactive children

Wrapping a child in a function creates a reactive region. The renderer subscribes to the signals read inside the function; when any of them change, only that region re-renders — not the whole tree.

```ts
const name = Signal.create("Alice");

view("p", null, () => `Hello, ${name.get()}`)
// Only the text inside <p> re-renders when name changes
```

### Conditional rendering

Returning `null` (or `undefined` / `false`) from a reactive child clears the region:

```ts
const isVisible = Signal.create(true);

view("div", null, () =>
  isVisible.get() ? view("span", null, "visible") : null
)
```

### Reactive lists

Pass a `ReactiveArray<Child>` (from `RefArray.map`, `.filter`, or `.sort`) directly as a child. Items can be `ViewNode` values, primitives, or nested `ReactiveArray` instances — the full `Child` type is supported:

```ts
const items = ref.at("list").map(item =>
  view("li", null, item.name)
);

view("ul", null, items)
```

The list region re-renders when the array mutates (structural or per-item changes).

---

## `Fragment`

**Import:** `import { Fragment } from "aljabr/ui"`

A unique symbol used as the `type` argument to create a `FragmentViewNode`. In JSX it is the `<>...</>` syntax.

```ts
// Direct API
view(Fragment, null, view("span", null, "a"), view("span", null, "b"))

// JSX
const el = <><span>a</span><span>b</span></>;
```

---

## `ViewNode`

**Import:** `import { ViewNode } from "aljabr/ui"`

Direct variant constructors. Prefer `view()` for typical usage; these are useful when building `ViewNode` values programmatically.

```ts
import { ViewNode } from "aljabr/ui";

ViewNode.Element({ tag: "div", props: { class: "box" }, children: [] })
ViewNode.Text("hello")
ViewNode.Component({ fn: MyComp, props: { label: "click" } })
ViewNode.Fragment([view("span", null, "a")])
```

### `ViewNode` type

The `ViewNode` type (import it as a type) is the tagged union of all four variants:

```ts
import type { ViewNode } from "aljabr/ui";

type ViewNode =
  | ElementViewNode   // { tag, props, children }
  | TextViewNode      // { content }
  | ComponentViewNode // { fn, props }
  | FragmentViewNode  // { children }
```

---

## `createRenderer(host, protocol?)`

**Import:** `import { createRenderer } from "aljabr/ui"`

Binds the reconciler to a `RendererHost`. Returns `{ view, mount }`.

```ts
function createRenderer<N, E extends N>(
  host: RendererHost<N, E>,
  protocol?: RendererProtocol,
): {
  view: typeof view;
  mount: (fn: () => ViewNode, container: E) => () => void;
}
```

### `mount(fn, container)`

Renders the `ViewNode` returned by `fn` into `container`. Returns an unmount function that removes all nodes and disposes all reactive subscriptions.

```ts
import { createRenderer, view } from "aljabr/ui";
import { domHost } from "aljabr/ui/dom";

const { mount } = createRenderer(domHost);

const unmount = mount(
  () => view("h1", null, "Hello world"),
  document.getElementById("root")!,
);

// Later — cleans up everything:
unmount();
```

---

## `RendererHost<N, E>`

**Import:** `import type { RendererHost } from "aljabr/ui"`

The contract every rendering target must implement. `N` is the base node type; `E` extends `N` and represents element nodes.

```ts
interface RendererHost<N, E extends N> {
  createElement(tag: string): E;
  createText(text: string): N;
  insert(parent: E, child: N, anchor?: N | null): void;
  remove(child: N): void;
  setProperty(el: E, key: string, value: unknown): void;
  setText(node: N, text: string): void;
  parentNode(node: N): E | null;
  nextSibling(node: N): N | null;

  // Optional lifecycle hooks
  onMount?(el: E): void;
  onUnmount?(el: E): void;
  onUpdate?(el: E): void;
}
```

### Method reference

| Method | Description |
|---|---|
| `createElement(tag)` | Create a new, unattached element node |
| `createText(text)` | Create a new, unattached text node |
| `insert(parent, child, anchor?)` | Insert `child` before `anchor`; appends if `anchor` is `null` |
| `remove(child)` | Detach `child` from its parent |
| `setProperty(el, key, value)` | Set a prop, attribute, or event handler |
| `setText(node, text)` | Update a text node's content in place |
| `parentNode(node)` | Return the parent element, or `null` |
| `nextSibling(node)` | Return the next sibling, or `null` |
| `onMount?(el)` | Called after an element is inserted |
| `onUnmount?(el)` | Called before an element is removed |
| `onUpdate?(el)` | Called after a property is updated |

### `setProperty` convention

Event handlers (`on*` props) are passed as-is and never treated as reactive values by the reconciler. All other function props are tracked as reactive and re-called when their signal dependencies change.

---

## `RendererProtocol`

**Import:** `import type { RendererProtocol } from "aljabr/ui"`

Optional batching escape hatch. When provided to `createRenderer`, the renderer defers reactive updates by calling `scheduleFlush` instead of applying them synchronously. Multiple writes that arrive before the next flush are coalesced — `scheduleFlush` is called once per pending batch, not once per write.

```ts
interface RendererProtocol {
  scheduleFlush(flush: () => void): void;
}
```

Without a protocol, updates flush synchronously — the default for most applications.

### rAF batching

```ts
import { createRenderer } from "aljabr/ui";
import { domHost } from "aljabr/ui/dom";

const { mount } = createRenderer(domHost, {
  scheduleFlush(flush) {
    requestAnimationFrame(flush);
  },
});
```

All signal writes within a frame are batched into a single DOM pass on the next animation frame.

### Microtask batching

```ts
const { mount } = createRenderer(domHost, {
  scheduleFlush(flush) {
    queueMicrotask(flush);
  },
});
```

Defers the flush to the end of the current microtask queue — finer-grained than rAF but still avoids multiple synchronous DOM writes from a single event handler.

See the [Renderer Protocol guide](../guides/advanced/renderer-protocol.md) for a deeper walkthrough.

---

## `domHost`

**Import:** `import { domHost } from "aljabr/ui/dom"`

The production DOM implementation of `RendererHost<Node, Element>`. Pass it to `createRenderer` to target the browser DOM.

**Property mapping:**

| Prop key | DOM behavior |
|---|---|
| `class` / `className` | `setAttribute("class", value)` |
| `style` (string) | `setAttribute("style", value)` |
| `style` (object) | `Object.assign(el.style, value)` |
| `on*` (function) | `addEventListener(name.slice(2).toLowerCase(), handler)` |
| Known IDL property (`value`, `checked`, `disabled`, …) | Direct property assignment |
| Anything else | `setAttribute(key, String(value))` |
| Any prop set to `null` / `undefined` | `removeAttribute(key)` |

---

## Function components

A component is any function `(props: P) => ViewNode`. There is no class component, no hook system, no special registration — just a function.

```ts
type CounterProps = { initial: number };

function Counter({ initial }: CounterProps) {
  const count = Signal.create(initial);
  return view("div", null,
    view("span", null, () => String(count.get())),
    view("button", { onClick: () => count.set((count.get() ?? 0) + 1) }, "+"),
  );
}

mount(() => view(Counter, { initial: 0 }), document.body);
```

### Lifecycle via `Scope`

Components do not have explicit lifecycle methods. Cleanup is handled by the owner tree: any `Signal`, `Derived`, or `Scope` created inside a component is owned by that component's computation owner and disposed when the component unmounts.

```ts
function Timer() {
  const elapsed = Signal.create(0);
  const id = setInterval(() => elapsed.set((elapsed.get() ?? 0) + 1), 1000);

  // defer() registers a cleanup on the current owner
  defer(() => clearInterval(id));

  return view("span", null, () => `${elapsed.get()}s`);
}
```

### Context

Aljabr's existing `context<T>()` primitive works across component boundaries. Context flows through the owner tree — no Provider component needed.

```ts
import { context } from "aljabr/prelude";

const Theme = context<"light" | "dark">("light");

function App() {
  Theme.provide("dark");
  return view(Toolbar, {});
}

function Toolbar() {
  const theme = Theme.consume(); // "dark"
  return view("nav", { class: theme }, "...");
}
```

---

## Reactive props

Any prop value that is a function (and does not start with `on`) is treated as a reactive getter. The renderer subscribes to the signals it reads; when dependencies change, only that prop is updated.

```ts
const cls = Signal.create("active");

view("div", { class: () => cls.get() })
// <div class="active">

cls.set("inactive");
// <div class="inactive"> — only the class attribute is updated
```

Passing a `Signal`, `Derived`, or any other readable directly (without wrapping in `() =>`) works too — `view()` normalises it automatically for host element props:

```ts
view("div", { class: cls })  // equivalent to { class: () => cls.get() }
```

Event handler props (`onClick`, `onInput`, etc.) are always passed as-is and never tracked reactively.

### Prop diffing

Reactive prop computations are diffed before writing to the host: `host.setProperty` is only called when the new value differs from the previous one (`!==`). If a signal notifies but the derived prop value is unchanged, the DOM write is skipped.

---

## Dev-mode warnings

In development builds (`process.env.NODE_ENV !== "production"`), aljabr emits `console.warn` messages for common authoring mistakes. These checks are tree-shaken in production bundles.

### Signal passed as a component prop

```
[aljabr] Signal/readable passed as component prop "count".
Components receive the raw value — call .get() inside the component body
to read it reactively, or use () => view(Component, { count: signal.get() })
to make the whole component reactive.
```

**Why it fires:** Unlike host element props (where readables are auto-wrapped), component props are forwarded as-is. If you write `view(Counter, { count: sig })`, the component receives a `Signal` object — not a number. The warning surfaces this mismatch early.

**Fix options:**
- Type the prop as `Signal<T>` and call `.get()` inside the component to place reactivity granularly.
- Pass `() => view(Counter, { count: sig.get() })` to re-run the whole component when the signal changes.

---

## JSX reference

With `jsxImportSource: "aljabr/ui"` in your `tsconfig.json`, JSX compiles to identical `view()` calls:

```tsx
// JSX
const el = (
  <div class="app">
    <h1>{title}</h1>
    <p>{() => body.get()}</p>
  </div>
);

// Equivalent direct API
const el = view("div", { class: "app" },
  view("h1", null, title),
  view("p", null, () => body.get()),
);
```

### Component JSX

```tsx
function Greeting({ name }: { name: string }) {
  return <p>Hello, {name}</p>;
}

// JSX
<Greeting name="world" />

// Equivalent
view(Greeting, { name: "world" })
```

### Fragment JSX

```tsx
// JSX
<>{items.map(i => <li key={i.id}>{i.name}</li>)}</>

// Equivalent
view(Fragment, null, ...items.map(i => view("li", null, i.name)))
```

---

## See also

- [Guide: Building UI with aljabr](../guides/ui.md) — walkthrough from a static tree to a fully reactive component
- [Prelude: `Signal` / `Derived`](./prelude/signal.md) — reactive primitives used in components
- [Prelude: `Ref` / `RefArray` / `ReactiveArray`](./prelude/ref.md) — structured state and reactive lists
- [Prelude: `Scope` / `defer`](./prelude/scope.md) — component lifecycle and resource cleanup
- [Prelude: `context`](./prelude/context.md) — cross-component context threading
