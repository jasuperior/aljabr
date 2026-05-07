/**
 * Core interfaces for the pluggable renderer system.
 *
 * `RendererHost` is the contract every rendering target must implement.
 * `RendererProtocol` is an optional batching escape hatch (e.g. rAF for canvas).
 */

/**
 * Contract that every rendering target must satisfy.
 *
 * The three type parameters separate the base node type (`N`) from the element
 * node type (`E`) and the user-facing container type (`Container`). In the DOM
 * `Container = E = Element`; for canvas `Container = HTMLCanvasElement` while
 * `E` is the canvas scene-graph element.
 *
 * @typeParam N - Base node type (covers text nodes, element nodes, anchors).
 * @typeParam E - Element node type; must extend `N`.
 * @typeParam Container - The user-supplied surface passed to `mount`.
 *   Defaults to `E` (the dom/prose case where the container *is* the host's
 *   element type). Overridden where the surface differs from the host's
 *   internal element type — canvas uses `HTMLCanvasElement`.
 *
 * @see {@link Renderer.create} to use a host with the reconciler.
 */
export interface RendererHost<N, E extends N, Container = E> {
    /**
     * Create a new element node for the given tag name.
     */
    createElement(tag: string): E;

    /**
     * Create a new text node with the given content.
     */
    createText(text: string): N;

    /**
     * Insert `child` into `parent` before `anchor`. If `anchor` is `null` or
     * omitted, appends to the end.
     */
    insert(parent: E, child: N, anchor?: N | null): void;

    /**
     * Remove `child` from its current parent.
     */
    remove(child: N): void;

    /**
     * Set a property or attribute on an element. The host decides the mapping:
     * DOM property assignment, `setAttribute`, or event listener registration.
     * Event handler props (`on*`) are passed as-is — the renderer never wraps
     * them reactively.
     */
    setProperty(el: E, key: string, value: unknown): void;

    /**
     * Update the text content of a text node in place.
     */
    setText(node: N, text: string): void;

    /**
     * Return the parent element of `node`, or `null` if the node is detached.
     */
    parentNode(node: N): E | null;

    /**
     * Return the next sibling of `node`, or `null` if it is the last child.
     */
    nextSibling(node: N): N | null;

    /**
     * Adopt the user-supplied `container` and return:
     * - `root`: the host's internal element the reconciler should mount into.
     * - `protocol`: an optional batching protocol (e.g. rAF for canvas). When
     *   present, reactive updates are coalesced; when absent, updates flush
     *   synchronously.
     * - `dispose`: a teardown callback the renderer chains into the
     *   `mount`-returned unmount.
     *
     * For DOM-shaped hosts where `Container = E`, the typical implementation
     * is the identity: `{ root: container, dispose: () => {} }`.
     */
    attach(container: Container): {
        root: E;
        protocol?: RendererProtocol;
        /**
         * Called by the renderer synchronously after the initial reconciliation
         * completes. Hosts that need to do work once the scene graph is
         * populated (e.g. canvas's first paint) hook here.
         */
        onMounted?: () => void;
        dispose: () => void;
    };

    /**
     * Optional hook called after an element is inserted into the tree.
     */
    onMount?(el: E): void;

    /**
     * Optional hook called before an element is removed from the tree.
     */
    onUnmount?(el: E): void;

    /**
     * Optional hook called after a property on an element is updated.
     */
    onUpdate?(el: E): void;
}

/**
 * Optional batching escape hatch for controlling when reactive updates are
 * flushed to the rendering target.
 *
 * Returned from {@link RendererHost.attach} when the host wants to coalesce
 * mutations (e.g. canvas's rAF-driven repaint). Multiple signal writes that
 * arrive before the next flush are coalesced — `scheduleFlush` is invoked
 * only once per pending batch, not once per write.
 */
export interface RendererProtocol {
    /**
     * Schedule a flush of pending rendering updates.
     * @param flush - Callback to invoke when the host is ready to apply updates.
     */
    scheduleFlush(flush: () => void): void;
}
