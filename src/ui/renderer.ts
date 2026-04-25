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
import type { RendererHost, RendererProtocol } from "./types.ts";
import { type Child, type ViewNode, view } from "./view-node.ts";

// ---------------------------------------------------------------------------
// createRenderer
// ---------------------------------------------------------------------------

export function createRenderer<N, E extends N>(
    host: RendererHost<N, E>,
    _protocol?: RendererProtocol,
): {
    view: typeof view;
    mount: (fn: () => ViewNode, container: E) => () => void;
} {
    return {
        view,
        mount(fn: () => ViewNode, container: E): () => void {
            const rootOwner = createOwner(null);
            runInContext(rootOwner, () => {
                const node = fn();
                untrack(() => reconcileViewNode(host, node, container, null, rootOwner));
            });
            return () => rootOwner.dispose();
        },
    };
}

// ---------------------------------------------------------------------------
// Internal reconciler
// ---------------------------------------------------------------------------

function reconcileChild<N, E extends N>(
    host: RendererHost<N, E>,
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

    if (child instanceof ReactiveArray) {
        mountReactiveArray(host, child, parent, anchor, owner);
        return;
    }

    if (typeof child === "function") {
        mountReactiveRegion(host, child as () => Child, parent, anchor, owner);
        return;
    }

    reconcileViewNode(host, child as ViewNode, parent, anchor, owner);
}

function reconcileViewNode<N, E extends N>(
    host: RendererHost<N, E>,
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
                    const update = (): void => {
                        for (const src of [...propComp.sources]) src.unsubscribe(propComp);
                        propComp.sources.clear();
                        const val = trackIn(propComp, value as () => unknown);
                        host.setProperty(el, key, val);
                        propComp.dirty = update;
                    };
                    propComp.dirty = update;
                    update();
                } else {
                    host.setProperty(el, key, value);
                }
            }

            for (const child of children) {
                reconcileChild(host, child, el, null, owner);
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
            untrack(() => reconcileViewNode(host, result, parent, anchor, compOwner));
        },

        Fragment: ({ children }) => {
            for (const child of children) {
                reconcileChild(host, child, parent, anchor, owner);
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
        untrack(() => reconcileChild(host, result, parent, end, iterOwner!));
    };

    effectOwner.dirty = rerun;
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

function mountReactiveArray<N, E extends N>(
    host: RendererHost<N, E>,
    arr: ReactiveArray<ViewNode>,
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
        const items: (ViewNode | undefined)[] = [];
        trackIn(effectOwner, () => {
            const len = arr.length();
            for (let i = 0; i < len; i++) items.push(arr.get(i));
        });

        iterOwner = createOwner(effectOwner);
        untrack(() => {
            for (const item of items) {
                if (item !== undefined) {
                    reconcileViewNode(host, item, parent, end, iterOwner!);
                }
            }
        });
    };

    effectOwner.dirty = rerender;
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

export function getCurrentOwner(): Computation | null {
    return getCurrentComputation();
}
