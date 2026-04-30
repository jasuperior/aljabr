# Renderer Protocol

By default, every reactive update in aljabr's UI layer flushes synchronously — the moment a signal changes, the DOM reflects it. This is the right default: it is simple, predictable, and requires no async reasoning. But some scenarios demand more control over when mutations land.

`RendererProtocol` is the escape hatch. It gives you a hook between "a reactive update is ready" and "it is written to the host", so you can batch, coalesce, or throttle DOM mutations to match your rendering target's cadence.

---

## How the scheduler works

Without a protocol, `createRenderer` uses an immediate scheduler:

```ts
const schedule = (fn: () => void) => fn();
```

Every reactive update — a prop recomputation, a reactive region re-render, a list mutation — runs the moment its signal dependency fires.

With a protocol, the scheduler becomes a queue:

```ts
let pending = false;
const queue = new Set<() => void>();

const schedule = (fn: () => void): void => {
  queue.add(fn);
  if (!pending) {
    pending = true;
    protocol.scheduleFlush(() => {
      pending = false;
      const toRun = [...queue];
      queue.clear();
      for (const f of toRun) f();
    });
  }
};
```

The key property: `scheduleFlush` is called **once** per pending batch. Ten signal writes before the next flush produce one call, not ten. The flush callback drains the queue and resets the pending flag, so the next write after a flush starts a new batch.

---

## rAF batching

The most common use case — coalesce all updates within an animation frame:

```ts
import { createRenderer } from "aljabr/ui";
import { domHost } from "aljabr/ui/dom";

const { mount } = createRenderer(domHost, {
  scheduleFlush(flush) {
    requestAnimationFrame(flush);
  },
});
```

Signal changes that happen during event handlers, `setTimeout` callbacks, or fetch responses within the same frame are all deferred. At the next `requestAnimationFrame`, the renderer drains the queue and writes everything to the DOM in one pass. The browser sees a single layout cycle.

---

## Microtask batching

For scenarios where you want to coalesce writes within a single synchronous event but don't need to wait for a full frame:

```ts
const { mount } = createRenderer(domHost, {
  scheduleFlush(flush) {
    queueMicrotask(flush);
  },
});
```

This batches all writes from a single event handler (e.g. a button click that sets three signals) into one flush at the end of the microtask queue — without deferring to the next frame. Useful for tests that need deterministic, synchronous-ish flushing without `requestAnimationFrame` mocks.

---

## Custom rendering targets

The protocol is particularly useful for non-DOM targets. A canvas renderer or a terminal renderer likely has its own render loop. Wire the protocol to that loop:

```ts
// Hypothetical canvas renderer
import { createRenderer } from "aljabr/ui";
import { canvasHost } from "./canvas-host";

let flushPending: (() => void) | null = null;

function renderLoop() {
  if (flushPending) {
    flushPending();
    flushPending = null;
  }
  requestAnimationFrame(renderLoop);
}

requestAnimationFrame(renderLoop);

const { mount } = createRenderer(canvasHost, {
  scheduleFlush(flush) {
    flushPending = flush; // the render loop picks it up
  },
});
```

The renderer queues work; the render loop drains it at the right moment. Reactive updates and frame rendering stay in sync.

---

## Prop diffing and the protocol

Prop diffing (skipping `setProperty` when a reactive prop re-evaluates to the same value) works independently of the protocol. With batching, multiple writes to the same signal within a frame produce one flush; within that flush, the prop computation runs once and the old-vs-new comparison happens once. The two mechanisms compose without interaction.

---

## Testing with a protocol

When writing tests that use a protocol, you control flushing explicitly:

```ts
let flush: (() => void) | null = null;

const { mount } = createRenderer(host, {
  scheduleFlush(f) { flush = f; },
});

const sig = Signal.create("hello");
mount(() => view("p", null, () => sig.get()), host.root);

sig.set("world");
// DOM not updated yet — flush hasn't been called

flush!();
// DOM now reflects "world"
```

This pattern gives you deterministic control over when the DOM is updated in tests — useful for asserting intermediate states or verifying that multiple writes coalesce correctly.

---

## Choosing a strategy

| Scenario | Protocol |
|---|---|
| Most interactive apps | None (synchronous default) |
| High-frequency signal writes (animation, streaming) | rAF |
| Batch writes within one event, minimal latency | `queueMicrotask` |
| Custom render loop (canvas, WebGL, terminal) | Custom, tied to the loop |
| Deterministic integration tests | Manual flush (as above) |

---

## See also

- [API Reference: `RendererProtocol`](../../api/ui/dom.md#rendererprotocol)
- [API Reference: `createRenderer`](../../api/ui/dom.md#createrenderhost-protocol)
- [API Reference: Canvas renderer](../../api/ui/canvas.md) — `createCanvasRenderer` ships its own pre-wired rAF protocol
- [Guide: Building UI with aljabr (DOM)](../ui/dom.md) — Part 8 overview of batching
- [Guide: Building UI with aljabr (Canvas)](../ui/canvas.md) — sibling renderer authoring guide
- [Prelude: `batch`](../../api/prelude/context.md) — signal-level batching (orthogonal to the renderer protocol)
