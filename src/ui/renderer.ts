import { match } from "../match.ts";
import {
    type Computation,
    createOwner,
    getCurrentComputation,
    trackIn,
    untrack,
    runInContext,
} from "../prelude/context.ts";
import { ReactiveArray } from "../prelude/reactive-array.ts";
import { RefArray } from "../prelude/ref.ts";
import type { RendererHost, RendererProtocol } from "./types.ts";
import { type Child, type ViewNode, view } from "./view-node.ts";

// ---------------------------------------------------------------------------
// createRenderer
// ---------------------------------------------------------------------------

/**
 * Create a renderer bound to a specific {@link RendererHost}.
 *
 * Returns a `{ view, mount }` pair. `view` is re-exported for convenience so
 * callers only need to import from the renderer. `mount` attaches a component
 * tree to a container and returns an unmount function.
 *
 * @typeParam N - Base node type of the host.
 * @typeParam E - Element node type of the host; must extend `N`.
 * @param host - The rendering target to use (e.g. {@link domHost}).
 * @param _protocol - Optional batching protocol; reserved for v0.3.4 rAF support.
 * @returns An object with `view` (the {@link view} factory) and `mount`.
 *
 * @example
 * import { createRenderer } from "aljabr/ui";
 * import { domHost } from "aljabr/ui/dom";
 *
 * const { mount } = createRenderer(domHost);
 *
 * const unmount = mount(
 *   () => view("h1", null, "Hello world"),
 *   document.getElementById("root")!,
 * );
 *
 * // Later:
 * unmount(); // removes all nodes and disposes reactive subscriptions
 */
export function createRenderer<N, E extends N>(
    host: RendererHost<N, E>,
    protocol?: RendererProtocol,
): {
    view: typeof view;
    mount: (fn: () => ViewNode, container: E) => () => void;
} {
    const schedule = makeScheduler(protocol);
    return {
        view,
        mount(fn: () => ViewNode, container: E): () => void {
            const rootOwner = createOwner(null);
            runInContext(rootOwner, () => {
                const node = fn();
                untrack(() => reconcileViewNode(host, schedule, node, container, null, rootOwner));
            });
            return () => rootOwner.dispose();
        },
    };
}

// ---------------------------------------------------------------------------
// Scheduler — immediate (no protocol) or deferred via RendererProtocol
// ---------------------------------------------------------------------------

function makeScheduler(protocol: RendererProtocol | undefined): (fn: () => void) => void {
    if (!protocol) return (fn) => fn();

    let pending = false;
    const queue = new Set<() => void>();

    return (fn: () => void): void => {
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
}

// ---------------------------------------------------------------------------
// Internal reconciler
// ---------------------------------------------------------------------------

type Schedule = (fn: () => void) => void;

function reconcileChild<N, E extends N>(
    host: RendererHost<N, E>,
    schedule: Schedule,
    child: Child,
    parent: E,
    anchor: N | null,
    owner: Computation,
): void {
    if (child === null || child === undefined || child === false) return;

    if (typeof child === "string" || typeof child === "number" || child === true) {
        const text = host.createText(String(child));
        host.insert(parent, text, anchor);
        owner.cleanups.add(() => host.remove(text));
        return;
    }

    if (child instanceof ReactiveArray || child instanceof RefArray) {
        mountReactiveArray(host, schedule, child, parent, anchor, owner);
        return;
    }

    if (typeof child === "function") {
        mountReactiveRegion(host, schedule, child as () => Child, parent, anchor, owner);
        return;
    }

    reconcileViewNode(host, schedule, child as ViewNode, parent, anchor, owner);
}

function reconcileViewNode<N, E extends N>(
    host: RendererHost<N, E>,
    schedule: Schedule,
    node: ViewNode,
    parent: E,
    anchor: N | null,
    owner: Computation,
): void {
    match(node, {
        Element: ({ tag, props, children }) => {
            const el = host.createElement(tag);

            for (const [key, value] of Object.entries(props)) {
                if (typeof value === "function" && !key.startsWith("on")) {
                    // Reactive prop — track via a dedicated effect computation
                    const propComp = createOwner(owner);
                    const UNSET = Symbol();
                    let prevVal: unknown = UNSET;
                    const apply = (): void => {
                        for (const src of [...propComp.sources]) src.unsubscribe(propComp);
                        propComp.sources.clear();
                        const val = trackIn(propComp, value as () => unknown);
                        if (val !== prevVal) {
                            host.setProperty(el, key, val);
                            prevVal = val;
                        }
                        propComp.dirty = () => schedule(apply);
                    };
                    propComp.dirty = () => schedule(apply);
                    apply();
                } else {
                    host.setProperty(el, key, value);
                }
            }

            for (const child of children) {
                reconcileChild(host, schedule, child, el, null, owner);
            }

            host.insert(parent, el as N, anchor);
            host.onMount?.(el);
            owner.cleanups.add(() => {
                host.onUnmount?.(el);
                host.remove(el as N);
            });
        },

        Text: ({ content }) => {
            const text = host.createText(content);
            host.insert(parent, text, anchor);
            owner.cleanups.add(() => host.remove(text));
        },

        Component: ({ fn, props }) => {
            // Run the component function inside a dedicated owner so that any
            // Signals / Deriveds created inside are properly owned and cleaned up.
            const compOwner = createOwner(owner);
            const result = runInContext(compOwner, () => fn(props));
            untrack(() => reconcileViewNode(host, schedule, result, parent, anchor, compOwner));
        },

        Fragment: ({ children }) => {
            for (const child of children) {
                reconcileChild(host, schedule, child, parent, anchor, owner);
            }
        },
    });
}

// ---------------------------------------------------------------------------
// Reactive region — function child
//
// Creates two invisible anchor text nodes that bracket the dynamic content.
// When the getter re-runs (because a dependency changed), the previous nodes
// are cleaned up and new ones inserted between the anchors.
// ---------------------------------------------------------------------------

function mountReactiveRegion<N, E extends N>(
    host: RendererHost<N, E>,
    schedule: Schedule,
    getter: () => Child,
    parent: E,
    anchor: N | null,
    parentOwner: Computation,
): void {
    const start = host.createText("");
    const end = host.createText("");
    host.insert(parent, start, anchor);
    host.insert(parent, end, anchor);

    let iterOwner: Computation | null = null;
    const effectOwner = createOwner(parentOwner);

    const rerun = (): void => {
        // Dispose previous iteration — cleanups remove DOM nodes
        if (iterOwner !== null) {
            iterOwner.dispose();
            iterOwner = null;
        }

        // Safety sweep: remove any nodes remaining between anchors
        let cur = host.nextSibling(start);
        while (cur !== null && cur !== end) {
            const next = host.nextSibling(cur);
            host.remove(cur);
            cur = next;
        }

        // Re-subscribe to dependencies and evaluate getter
        for (const src of [...effectOwner.sources]) src.unsubscribe(effectOwner);
        effectOwner.sources.clear();
        const result = trackIn(effectOwner, getter);

        // Mount result in a fresh iteration owner (untracked to prevent
        // re-tracking the outer effectOwner when nested signals are read)
        iterOwner = createOwner(effectOwner);
        untrack(() => reconcileChild(host, schedule, result, parent, end, iterOwner!));
    };

    effectOwner.dirty = () => schedule(rerun);
    effectOwner.cleanups.add(() => {
        iterOwner?.dispose();
        iterOwner = null;
        let cur = host.nextSibling(start);
        while (cur !== null && cur !== end) {
            const next = host.nextSibling(cur);
            host.remove(cur);
            cur = next;
        }
        host.remove(start);
        host.remove(end);
    });

    rerun();
}

// ---------------------------------------------------------------------------
// Reactive array reconciliation — ReactiveArray<ViewNode> child
//
// The renderer tracks length() and each get(i) signal together. Any change
// (structural or per-item) re-renders the whole list region. Fine-grained
// per-index updates are left for v0.3.4.
// ---------------------------------------------------------------------------

type ReactiveList<T> = { get(i: number): T | undefined; length(): number };

function mountReactiveArray<N, E extends N>(
    host: RendererHost<N, E>,
    schedule: Schedule,
    arr: ReactiveList<Child>,
    parent: E,
    anchor: N | null,
    parentOwner: Computation,
): void {
    const start = host.createText("");
    const end = host.createText("");
    host.insert(parent, start, anchor);
    host.insert(parent, end, anchor);

    let iterOwner: Computation | null = null;
    const effectOwner = createOwner(parentOwner);

    const rerender = (): void => {
        iterOwner?.dispose();
        iterOwner = null;

        let cur = host.nextSibling(start);
        while (cur !== null && cur !== end) {
            const next = host.nextSibling(cur);
            host.remove(cur);
            cur = next;
        }

        for (const src of [...effectOwner.sources]) src.unsubscribe(effectOwner);
        effectOwner.sources.clear();

        // Snapshot the array — reads length() and get(i) to subscribe
        const items: (Child | undefined)[] = [];
        trackIn(effectOwner, () => {
            const len = arr.length();
            for (let i = 0; i < len; i++) items.push(arr.get(i));
        });

        iterOwner = createOwner(effectOwner);
        untrack(() => {
            for (const item of items) {
                if (item !== undefined) {
                    reconcileChild(host, schedule, item, parent, end, iterOwner!);
                }
            }
        });
    };

    effectOwner.dirty = () => schedule(rerender);
    effectOwner.cleanups.add(() => {
        iterOwner?.dispose();
        iterOwner = null;
        let cur = host.nextSibling(start);
        while (cur !== null && cur !== end) {
            const next = host.nextSibling(cur);
            host.remove(cur);
            cur = next;
        }
        host.remove(start);
        host.remove(end);
    });

    rerender();
}

// ---------------------------------------------------------------------------
// getCurrentOwner — exposed for renderers that need the owner tree
// ---------------------------------------------------------------------------

/**
 * Return the currently active owner computation, or `null` if called outside
 * a reactive context.
 *
 * Primarily useful for custom renderer implementations or advanced
 * integrations that need to attach cleanups or child owners to the current
 * component's scope.
 *
 * @returns The active {@link Computation}, or `null`.
 */
export function getCurrentOwner(): Computation | null {
    return getCurrentComputation();
}
