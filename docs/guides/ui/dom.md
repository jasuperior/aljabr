# Building UI with aljabr

Aljabr's native UI layer is a signal-driven rendering system. It does not diff a virtual DOM, manage a fiber, or own your re-render cycle. It renders a static tree synchronously on mount, then surgically updates the parts of that tree whose reactive dependencies change — and nothing else.

This guide starts with a static element, adds reactivity one piece at a time, builds a component with lifecycle, then wires in a reactive list. By the end you'll have a complete picture of how the static and reactive layers fit together.

---

## Setup

Install aljabr and configure your tsconfig for JSX (optional):

```sh
npm install aljabr
```

```json
// tsconfig.json
{
  "compilerOptions": {
    "jsx": "react-jsx",
    "jsxImportSource": "aljabr/ui/dom"
  }
}
```

If you're not using JSX, everything in this guide works identically with the direct `view()` API.

---

## Part 1: Static tree

The entry point for the UI layer is `createRenderer`. Pass it a host (the DOM host for browser apps) and you get back a `mount` function.

```ts
import { createRenderer, view } from "aljabr/ui";
import { domHost } from "aljabr/ui/dom";

const { mount } = createRenderer(domHost);
```

`mount` takes a factory function and a container element. The factory returns a `ViewNode` — the description of what to render.

```ts
const unmount = mount(
  () => view("div", { class: "app" },
    view("h1", null, "Hello, aljabr"),
    view("p", null, "A static tree."),
  ),
  document.getElementById("root")!,
);
```

This renders once and does not set up any reactive subscriptions. The DOM is written; nothing watches for changes.

`unmount()` removes every inserted node and disposes all reactive subscriptions. Always call it when tearing down.

---

## Part 2: Reactive text

To make a piece of the tree dynamic, wrap it in a function. That function becomes a **reactive region** — the renderer subscribes to the signals read inside it and re-evaluates it whenever any of them change.

```ts
import { Signal } from "aljabr/prelude";

const name = Signal.create("Alice");

mount(
  () => view("p", null, () => `Hello, ${name.get()}`),
  document.body,
);

// Later — only the text inside <p> re-renders:
name.set("Bob");
```

The `<p>` element itself is rendered once and never touched again. Only the text node inside it — bracketed by invisible anchor nodes — is replaced when `name` changes.

### Conditional rendering

Returning `null` (or `undefined` / `false`) from a reactive child clears the region. Returning a `ViewNode` replaces it.

```ts
const isLoggedIn = Signal.create(false);

mount(
  () => view("div", null,
    () => isLoggedIn.get()
      ? view("span", null, "Welcome back")
      : view("a", { href: "/login" }, "Sign in"),
  ),
  document.body,
);

isLoggedIn.set(true);
// The <a> is removed and a <span> is inserted in its place
```

---

## Part 3: Reactive props

For **host elements**, any prop value that is a `Signal`, `Derived`, or other readable (anything with a `.get()` method that is not a `DerivedArray` or `RefArray`) is automatically normalised into a reactive getter before the element is mounted. You can also pass an explicit function — both are equivalent.

```ts
const theme = Signal.create<"light" | "dark">("light");

mount(
  () => view("div", { class: theme },  // shorthand — signal auto-wrapped
    view("p", null, "Content"),
  ),
  document.body,
);

theme.set("dark");
// Only the class attribute is updated — <p> is untouched
```

The explicit function form is equivalent and useful when the prop value is a derived expression rather than a direct signal read:

```ts
view("div", { class: () => `app app--${theme.get()}` }, ...)
```

The same shorthand works for children. Passing a signal as a child wraps it in a reactive region:

```ts
const name = Signal.create("Alice");

view("p", null, name)              // shorthand — signal auto-wrapped
view("p", null, () => name.get())  // equivalent explicit form
```

Event handlers (`onClick`, `onInput`, etc.) are always passed as-is and are never treated as reactive getters:

```ts
view("button", {
  onClick: () => theme.set(theme.get() === "light" ? "dark" : "light"),
}, "Toggle theme")
```

> **Component props are different.** The auto-wrapping above applies only to host element props. When you write `view(MyComponent, { count: sig })`, the component receives the `Signal` object itself — not a reactive getter. See [Part 4](#part-4-function-components) for how to handle this correctly.

---

## Part 4: Function components

A component is any function that takes props and returns a `ViewNode`. No classes, no decorators, no registration.

```ts
type GreetingProps = { name: string };

function Greeting({ name }: GreetingProps) {
  return view("p", null, `Hello, ${name}`);
}

mount(() => view(Greeting, { name: "world" }), document.body);
```

### Local reactive state

To make a component's output reactive, accept signal getters as props and use them inside function children:

```ts
type CounterProps = { label: string };

function Counter({ label }: CounterProps) {
  const count = Signal.create(0);

  return view("div", null,
    view("span", null, label, ": "),
    view("strong", null, () => String(count.get())),
    view("button", { onClick: () => count.set((count.get() ?? 0) + 1) }, "+"),
  );
}
```

The `Signal.create` call is local to the component. The reactive graph is owned by this component instance and disposed when the component unmounts.

### Passing signals into components

Signals passed as component props arrive in the component body as-is — the component receives the `Signal` object and decides where reactivity goes. The shorthand normalization that applies to host elements does **not** apply at the component boundary.

```ts
type CounterProps = { count: Signal<number> };

function Counter({ count }: CounterProps) {
  return view("strong", null, () => String(count.get()));
}

const n = Signal.create(0);
view(Counter, { count: n })
// n.set(1) → only the <strong> text updates
```

To re-run the entire component when an external signal changes — tearing down and rebuilding the subtree — wrap the invocation in a reactive region:

```ts
() => view(Counter, { count: n.get() })
// n.set(1) → Counter's full subtree rebuilds
```

Use the passthrough form when only part of the component's output should be reactive. Use the reactive invocation form when the component should act as a pure function of its props — and accept that the cost is a full remount.

### Children

Pass children to a component via `props.children`:

```ts
type CardProps = { title: string; children: Child };

function Card({ title, children }: CardProps) {
  return view("div", { class: "card" },
    view("h3", null, title),
    children,
  );
}

// Single child
view(Card, { title: "Note" }, view("p", null, "Content here"))

// Multiple children (array)
view(Card, { title: "Note" }, view("p", null, "First"), view("p", null, "Second"))
```

---

## Part 5: Lifecycle

Components do not have lifecycle methods. Cleanup is handled by the owner tree: anything created inside a component — `Signal`, `Derived`, `Scope`, timers — is owned by that component's owner and automatically disposed when the component unmounts.

Use `defer()` to register arbitrary cleanup work:

```ts
import { Signal, defer } from "aljabr/prelude";

function Clock() {
  const time = Signal.create(new Date().toLocaleTimeString());

  const id = setInterval(() => {
    time.set(new Date().toLocaleTimeString());
  }, 1000);

  defer(() => clearInterval(id));
  // When Clock unmounts, the interval is cleared automatically

  return view("span", null, () => time.get());
}
```

For heavier resource management, use `Scope` and `Resource`:

```ts
import { Scope, Resource } from "aljabr/prelude";

function DataStream({ url }: { url: string }) {
  const data = Signal.create<string | null>(null);
  const scope = Scope();

  scope.acquire(
    Resource(
      () => {
        const ws = new WebSocket(url);
        ws.onmessage = (e) => data.set(e.data);
        return ws;
      },
      (ws) => ws.close(),
    ),
  );

  defer(() => scope.dispose());

  return view("pre", null, () => data.get() ?? "Connecting...");
}
```

---

## Part 6: Reactive lists

Pass a `DerivedArray<ViewNode>` directly as a child to render a reactive list. `DerivedArray` is the read-only view returned by `RefArray.map`, `.filter`, or `.sort`.

```ts
import { Ref, Signal } from "aljabr/prelude";

type Task = { id: number; text: string; done: boolean };

const tasks = Ref.create<{ list: Task[] }>({
  list: [
    { id: 1, text: "Buy groceries", done: false },
    { id: 2, text: "Write docs", done: true },
  ],
});

const filter = Signal.create<"all" | "active" | "done">("all");
```

Build the reactive list view by chaining from the `RefArray`:

```ts
const visibleRows = tasks.at("list")
  .filter(task => {
    const f = filter.get();
    if (f === "active") return !task.done;
    if (f === "done") return task.done;
    return true;
  })
  .map(task =>
    view("li", { class: task.done ? "done" : "" }, task.text)
  );
```

Use it as a child of the list element:

```ts
mount(
  () => view("div", null,
    view("ul", null, visibleRows),
    view("button", { onClick: () => filter.set("active") }, "Active"),
    view("button", { onClick: () => filter.set("done") }, "Done"),
    view("button", { onClick: () => filter.set("all") }, "All"),
  ),
  document.body,
);
```

When `filter` changes, the renderer re-evaluates `visibleRows` and replaces the list region. When an individual task is mutated (`tasks.set("list.0.done", true)`), only the affected row re-renders.

### Adding and removing items

`RefArray` mutations — `push`, `pop`, `splice`, `move` — trigger the reactive list to re-render:

```ts
tasks.push("list", { id: 3, text: "Ship it", done: false });
// New <li> appears at the bottom

tasks.splice("list", 1, 1);
// Second item removed
```

---

## Part 7: Putting it together

A complete task app with add, toggle, and filter — all reactive, all component-scoped:

```ts
import { createRenderer, view, Fragment } from "aljabr/ui";
import { domHost } from "aljabr/ui/dom";
import { Ref, Signal } from "aljabr/prelude";

const { mount } = createRenderer(domHost);

type Task = { id: number; text: string; done: boolean };
let nextId = 1;

const state = Ref.create<{
  tasks: Task[];
  filter: "all" | "active" | "done";
  input: string;
}>({
  tasks: [],
  filter: "all",
  input: "",
});

function TaskItem({ task }: { task: Task }) {
  return view("li", null,
    view("input", {
      type: "checkbox",
      checked: task.done,
      onChange: () => {
        const idx = state.get("tasks").findIndex(t => t.id === task.id);
        if (idx >= 0) state.set(`tasks.${idx}.done`, !task.done);
      },
    }),
    view("span", { class: task.done ? "done" : "" }, task.text),
  );
}

function App() {
  const rows = state.at("tasks")
    .filter(t => {
      const f = state.get("filter");
      if (f === "active") return !t.done;
      if (f === "done") return t.done;
      return true;
    })
    .map(task => view(TaskItem, { task }));

  return view("div", { class: "app" },
    view("h1", null, "Tasks"),

    // Add form
    view("div", null,
      view("input", {
        value: () => state.get("input"),
        onInput: (e: Event) =>
          state.set("input", (e.target as HTMLInputElement).value),
        onKeydown: (e: KeyboardEvent) => {
          if (e.key !== "Enter") return;
          const text = state.get("input")?.trim();
          if (!text) return;
          state.push("tasks", { id: nextId++, text, done: false });
          state.set("input", "");
        },
      }),
      view("button", {
        onClick: () => {
          const text = state.get("input")?.trim();
          if (!text) return;
          state.push("tasks", { id: nextId++, text, done: false });
          state.set("input", "");
        },
      }, "Add"),
    ),

    // List
    view("ul", null, rows),

    // Filter bar
    view("div", null,
      (["all", "active", "done"] as const).map(f =>
        view("button", {
          class: () => state.get("filter") === f ? "active" : "",
          onClick: () => state.set("filter", f),
        }, f)
      ),
    ),
  );
}

mount(() => view(App, {}), document.getElementById("root")!);
```

---

## Part 8: Batching updates with RendererProtocol

By default, every reactive update flushes synchronously — a signal write is immediately reflected in the DOM. This is fine for most apps, but for high-frequency updates (rapid user input, animation ticks, bulk data loads) it can cause unnecessary layout thrash.

Pass a `RendererProtocol` to `createRenderer` to defer and coalesce updates:

```ts
import { createRenderer } from "aljabr/ui";
import { domHost } from "aljabr/ui/dom";

const { mount } = createRenderer(domHost, {
  scheduleFlush(flush) {
    requestAnimationFrame(flush);
  },
});
```

Now every reactive update that fires within a single animation frame is queued. The renderer calls `scheduleFlush` once and applies all pending DOM mutations together on the next frame — one layout pass instead of many.

Multiple `scheduleFlush` calls for the same pending batch are coalesced: if ten signals change before the next frame, `scheduleFlush` is called once, not ten times.

### When to use it

| Scenario | Recommendation |
|---|---|
| Interactive UI, form inputs, normal navigation | Default (synchronous) — simpler, predictable |
| Rapid signal writes (60fps animation, streaming data) | rAF protocol — one DOM pass per frame |
| Test environments | Default (synchronous) — no async required |
| Canvas / WebGL rendering targets | Custom protocol tied to the render loop |

See the [Renderer Protocol guide](../advanced/renderer-protocol.md) for a full walkthrough including custom schedulers and testing patterns.

---

## How it works

A few implementation details worth knowing as a consumer:

**Reactive regions use anchor nodes.** When you write `() => someSignal.get()`, the renderer inserts two invisible text nodes around the dynamic content. On each re-run, nodes between the anchors are removed and new ones inserted. This is how the renderer can update a subsection of the DOM without touching the rest of the tree.

**Function props have per-prop owners.** Each reactive prop (`{ class: () => ... }`) gets its own computation owner. A change to one signal only re-runs that prop's computation — not the whole element render.

**Component owners form a tree.** Each component creates a child owner of its parent. When a component's owner is disposed (on unmount), all child owners — and all signals, derived values, and deferred cleanups registered inside — are disposed in reverse creation order (LIFO).

**Auto-wrapping is host-element-only.** For host elements (`view("div", ...)`) `view()` normalises readables in props and children — a `Signal` becomes `() => signal.get()` before the element is mounted. For **component** invocations (`view(MyComp, ...)`), props are forwarded as-is. If you write `view(Counter, { count: cls })` where `cls` is a `Signal`, the component receives the `Signal` object. Write `view(Counter, { count: cls.get() })` to pass a snapshot, type the prop as `Signal<T>` and call `.get()` inside, or wrap the whole call in `() =>` to re-run the component reactively.

---

## See also

- [API Reference: `aljabr/ui` (DOM renderer)](../../api/ui/dom.md) — full reference for `view`, `createRenderer`, `RendererHost`, `domHost`, JSX
- [Guide: Canvas renderer](./canvas.md) — sibling guide for retained-mode 2D canvas authoring
- [Reactive UI patterns](../advanced/reactive-ui.md) — deep dive into `Ref`, `Derived`, `AsyncDerived` composition for complex state
- [Resource Lifetime](../advanced/resource-lifetime.md) — `Scope`, `Resource`, and bracket patterns for cleanup
- [API Reference: `Ref` / `RefArray` / `DerivedArray`](../../api/prelude/ref.md)
- [API Reference: `Signal` / `Derived`](../../api/prelude/signal.md)
