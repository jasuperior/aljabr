import { match } from "../match.ts";
import {
    type Computation,
    createOwner,
    getCurrentComputation,
    trackIn,
    untrack,
    runInContext,
} from "../prelude/context.ts";
import { DerivedArray } from "../prelude/derived-array.ts";
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
 * @param host - The rendering target to use (e.g. `domHost`).
 * @param protocol - Optional batching protocol. When provided, reactive updates
 *   are deferred: the renderer queues them and calls `scheduleFlush` once,
 *   coalescing all pending work into a single pass. Omit for synchronous
 *   (immediate) updates — the default for most applications.
 * @returns An object with `view` (the {@link view} factory) and `mount`.
 *
 * @remarks
 * **Prop diffing.** Reactive props (e.g. `{ class: () => cls.get() }`) are
 * diffed before being applied: `host.setProperty` is only called when the
 * newly computed value differs from the previous one (`!==`). This avoids
 * redundant DOM writes when a signal notifies but the derived value is
 * unchanged.
 *
 * **Disposal order.** Component and reactive-region owners are disposed
 * LIFO — the most recently mounted subtree is torn down first. This matches
 * the guarantee provided by {@link createOwner}.
 *
 * @example Basic DOM usage
 * ```ts
 * import { createRenderer, view } from "aljabr/ui";
 * import { domHost } from "aljabr/ui/dom";
 *
 * const { mount } = createRenderer(domHost);
 *
 * const unmount = mount(
 *   () => view("h1", null, "Hello world"),
 *   document.getElementById("root")!,
 * );
 *
 * unmount(); // removes all nodes and disposes reactive subscriptions
 * ```
 *
 * @example rAF batching — coalesces all updates within a frame
 * ```ts
 * const { mount } = createRenderer(domHost, {
 *   scheduleFlush: (flush) => requestAnimationFrame(flush),
 * });
 * ```
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

    if (child instanceof DerivedArray || child instanceof RefArray) {
        mountDerivedArray(host, schedule, child, parent, anchor, owner);
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
// Reactive array reconciliation — DerivedArray<Child> / RefArray<Child>
//
// Phase A (positional): each index gets its own owner scope subscribing only
// to arr.get(i). The outer lengthOwner subscribes to arr.length() and
// adds/removes trailing scopes when the list grows or shrinks.
//
// Phase B (keyed): used when arr.keyAt is defined. The lengthOwner subscribes
// to arr.get() (root signal) so it fires on reorders as well as structural
// changes. Per-key scopes move in the DOM without re-running when items
// reorder; subscriptions are updated to the item's new index position.
// ---------------------------------------------------------------------------

type ReactiveList<T> = {
    get(): T[];
    get(i: number): T | undefined;
    length(): number;
    keyAt?: (i: number) => unknown | null;
};

function mountDerivedArray<N, E extends N>(
    host: RendererHost<N, E>,
    schedule: Schedule,
    arr: ReactiveList<Child>,
    parent: E,
    anchor: N | null,
    parentOwner: Computation,
): void {
    const listStart = host.createText("");
    const listEnd = host.createText("");
    host.insert(parent, listStart, anchor);
    host.insert(parent, listEnd, anchor);

    const lengthOwner = createOwner(parentOwner);
    lengthOwner.cleanups.add(() => {
        host.remove(listStart);
        host.remove(listEnd);
    });

    if (typeof arr.keyAt === "function") {
        // ── Phase B: keyed scope reconciliation ──────────────────────────────
        type Entry = {
            key: unknown;
            scope: Computation;
            iterOwner: Computation | null;
            currentIndex: number;
            start: N;
            end: N;
            rerender: () => void;
        };
        const keyedMap = new Map<unknown, Entry>();
        let orderedKeys: unknown[] = [];
        const keyAt = arr.keyAt.bind(arr);
        // Per-index signals fire during the source cascade, BEFORE onUpdate has
        // a chance to update currentIndex on entries that moved. If we rerender
        // synchronously, a moved entry would render content for its OLD index
        // (now belonging to a different key). Defer the rerender into a queue
        // that onUpdate drains after fixing currentIndex.
        const pendingRerender = new Set<Entry>();

        const createEntry = (key: unknown, idx: number): void => {
            const eStart = host.createText("");
            const eEnd = host.createText("");
            host.insert(parent, eStart, listEnd);
            host.insert(parent, eEnd, listEnd);
            const scope = createOwner(lengthOwner);
            const entry: Entry = {
                key,
                scope,
                iterOwner: null,
                currentIndex: idx,
                start: eStart,
                end: eEnd,
                rerender: () => {},
            };

            const rerender = (): void => {
                entry.iterOwner?.dispose();
                entry.iterOwner = null;
                let cur = host.nextSibling(eStart);
                while (cur !== null && cur !== eEnd) {
                    const next = host.nextSibling(cur);
                    host.remove(cur);
                    cur = next;
                }
                for (const src of [...scope.sources]) src.unsubscribe(scope);
                scope.sources.clear();
                const item = trackIn(scope, () => arr.get(entry.currentIndex));
                if (item !== undefined) {
                    entry.iterOwner = createOwner(scope);
                    untrack(() => reconcileChild(host, schedule, item, parent, eEnd, entry.iterOwner!));
                }
            };
            entry.rerender = rerender;

            scope.dirty = () => pendingRerender.add(entry);
            scope.cleanups.add(() => {
                pendingRerender.delete(entry);
                let cur = host.nextSibling(eStart);
                while (cur !== null && cur !== eEnd) {
                    const next = host.nextSibling(cur);
                    host.remove(cur);
                    cur = next;
                }
                host.remove(eStart);
                host.remove(eEnd);
            });
            keyedMap.set(key, entry);
            rerender();
        };

        const onUpdate = (): void => {
            for (const src of [...lengthOwner.sources]) src.unsubscribe(lengthOwner);
            lengthOwner.sources.clear();
            // Subscribe to root signal — fires on reorder, add, remove, or value change
            const items = trackIn(lengthOwner, () => arr.get());
            const newLen = items.length;
            const newKeys: unknown[] = Array.from({ length: newLen }, (_, i) => keyAt(i) ?? i);
            const oldKeySet = new Set(orderedKeys);
            const newKeySet = new Set(newKeys);

            // Remove entries for keys no longer present
            for (const key of orderedKeys) {
                if (!newKeySet.has(key)) {
                    keyedMap.get(key)!.scope.dispose();
                    keyedMap.delete(key);
                }
            }
            // Create entries for new keys (inserted before listEnd temporarily)
            for (let i = 0; i < newLen; i++) {
                if (!oldKeySet.has(newKeys[i])) createEntry(newKeys[i], i);
            }
            // Reorder: backward walk moves each entry's nodes into position.
            // Skip entirely when key order is unchanged — avoids DOM moves that
            // would reset CSS animations on unaffected items.
            const orderUnchanged = orderedKeys.length === newLen &&
                newKeys.every((k, i) => k === orderedKeys[i]);
            if (!orderUnchanged) {
                let insertBefore: N = listEnd;
                for (let i = newLen - 1; i >= 0; i--) {
                    const entry = keyedMap.get(newKeys[i])!;
                    const nodes: N[] = [entry.start];
                    let cur: N | null = host.nextSibling(entry.start);
                    while (cur !== null && cur !== entry.end) {
                        nodes.push(cur);
                        cur = host.nextSibling(cur);
                    }
                    nodes.push(entry.end);
                    for (const node of nodes) {
                        host.remove(node);
                        host.insert(parent, node, insertBefore);
                    }
                    insertBefore = entry.start;
                }
            }
            // Update currentIndex for entries that moved. Moved entries must
            // rerender to bind their DOM to the new index — the per-index
            // signal cascade may have already enqueued them with the stale index.
            for (let i = 0; i < newLen; i++) {
                const entry = keyedMap.get(newKeys[i])!;
                if (entry.currentIndex !== i) {
                    entry.currentIndex = i;
                    pendingRerender.add(entry);
                }
            }
            orderedKeys = newKeys;
            // Drain deferred rerenders with currentIndex now correct on every entry.
            for (const entry of pendingRerender) {
                if (keyedMap.get(entry.key) === entry) entry.rerender();
            }
            pendingRerender.clear();
        };

        lengthOwner.dirty = () => schedule(onUpdate);
        onUpdate();
    } else {
        // ── Phase A: positional per-index scopes ─────────────────────────────
        type IndexScope = { scope: Computation; start: N; end: N };
        const indexScopes: IndexScope[] = [];

        const mountIndex = (i: number): void => {
            const iStart = host.createText("");
            const iEnd = host.createText("");
            host.insert(parent, iStart, listEnd);
            host.insert(parent, iEnd, listEnd);
            const scope = createOwner(lengthOwner);
            let iterOwner: Computation | null = null;

            const rerender = (): void => {
                iterOwner?.dispose();
                iterOwner = null;
                let cur = host.nextSibling(iStart);
                while (cur !== null && cur !== iEnd) {
                    const next = host.nextSibling(cur);
                    host.remove(cur);
                    cur = next;
                }
                for (const src of [...scope.sources]) src.unsubscribe(scope);
                scope.sources.clear();
                const item = trackIn(scope, () => arr.get(i));
                if (item !== undefined) {
                    iterOwner = createOwner(scope);
                    untrack(() => reconcileChild(host, schedule, item, parent, iEnd, iterOwner!));
                }
            };

            scope.dirty = () => schedule(rerender);
            scope.cleanups.add(() => {
                let cur = host.nextSibling(iStart);
                while (cur !== null && cur !== iEnd) {
                    const next = host.nextSibling(cur);
                    host.remove(cur);
                    cur = next;
                }
                host.remove(iStart);
                host.remove(iEnd);
            });
            indexScopes.push({ scope, start: iStart, end: iEnd });
            rerender();
        };

        const onLengthChange = (): void => {
            for (const src of [...lengthOwner.sources]) src.unsubscribe(lengthOwner);
            lengthOwner.sources.clear();
            const newLen = trackIn(lengthOwner, () => arr.length());
            const oldLen = indexScopes.length;
            if (newLen > oldLen) {
                for (let i = oldLen; i < newLen; i++) mountIndex(i);
            } else if (newLen < oldLen) {
                for (let i = oldLen - 1; i >= newLen; i--) {
                    indexScopes[i].scope.dispose();
                    indexScopes.pop();
                }
            }
        };

        lengthOwner.dirty = () => schedule(onLengthChange);
        onLengthChange();
    }
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
