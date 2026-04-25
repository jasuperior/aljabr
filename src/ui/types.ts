/**
 * Core interfaces for the pluggable renderer system.
 *
 * `RendererHost` is the contract every rendering target must implement.
 * `RendererProtocol` is an optional batching escape hatch (e.g. rAF for canvas).
 */

/**
 * Contract that every rendering target must satisfy.
 *
 * The two type parameters separate the base node type (`N`) from the element
 * node type (`E`). In the DOM these are `Node` and `Element`; simpler targets
 * can collapse them to the same type (e.g. `RendererHost<VNode, VNode>`).
 *
 * @typeParam N - Base node type (covers text nodes, element nodes, anchors).
 * @typeParam E - Element node type; must extend `N`.
 *
 * @example
 * // Minimal in-memory host for testing
 * const memHost: RendererHost<MyNode, MyNode> = {
 *   createElement: (tag) => ({ tag, children: [], props: {} }),
 *   createText: (text) => ({ text }),
 *   insert: (parent, child, anchor) => { ... },
 *   remove: (child) => { ... },
 *   setProperty: (el, key, value) => { el.props[key] = value; },
 *   setText: (node, text) => { node.text = text; },
 *   parentNode: (node) => node.parent ?? null,
 *   nextSibling: (node) => node.next ?? null,
 * };
 *
 * @see {@link createRenderer} to use a host with the reconciler.
 * @see {@link domHost} for the production DOM implementation.
 */
export interface RendererHost<N, E extends N> {
    /**
     * Create a new element node for the given tag name.
     * @param tag - The HTML/XML tag name (e.g. `"div"`, `"span"`).
     * @returns A new, unattached element node.
     */
    createElement(tag: string): E;

    /**
     * Create a new text node with the given content.
     * @param text - The initial text content.
     * @returns A new, unattached text node.
     */
    createText(text: string): N;

    /**
     * Insert `child` into `parent` before `anchor`.
     * If `anchor` is `null` or omitted, appends to the end.
     * @param parent - The container element to insert into.
     * @param child - The node to insert.
     * @param anchor - The sibling to insert before; `null` appends.
     */
    insert(parent: E, child: N, anchor?: N | null): void;

    /**
     * Remove `child` from its current parent.
     * @param child - The node to detach and remove.
     */
    remove(child: N): void;

    /**
     * Set a property or attribute on an element.
     *
     * The host decides the mapping: DOM property assignment, `setAttribute`,
     * or event listener registration. Event handler props (`on*`) are passed
     * as-is — the renderer never wraps them reactively.
     *
     * @param el - The target element.
     * @param key - The property name (e.g. `"class"`, `"onClick"`, `"value"`).
     * @param value - The new value.
     */
    setProperty(el: E, key: string, value: unknown): void;

    /**
     * Update the text content of a text node in place.
     * @param node - The text node to update.
     * @param text - The new text content.
     */
    setText(node: N, text: string): void;

    /**
     * Return the parent element of `node`, or `null` if the node is detached.
     * @param node - The node to query.
     */
    parentNode(node: N): E | null;

    /**
     * Return the next sibling of `node`, or `null` if it is the last child.
     * @param node - The node to query.
     */
    nextSibling(node: N): N | null;

    /**
     * Optional hook called after an element is inserted into the tree.
     * @param el - The newly mounted element.
     */
    onMount?(el: E): void;

    /**
     * Optional hook called before an element is removed from the tree.
     * @param el - The element about to be unmounted.
     */
    onUnmount?(el: E): void;

    /**
     * Optional hook called after a property on an element is updated.
     * @param el - The element whose property changed.
     */
    onUpdate?(el: E): void;
}

/**
 * Optional batching escape hatch for controlling when reactive updates are
 * flushed to the rendering target.
 *
 * When provided to {@link createRenderer}, the renderer defers all pending
 * mutations by calling `scheduleFlush` instead of applying them synchronously.
 * The host calls the supplied `flush` callback when it is ready to process
 * updates. Multiple signal writes that arrive before the next flush are
 * coalesced — `scheduleFlush` is invoked only once per pending batch, not
 * once per write.
 *
 * Without a protocol, updates flush synchronously in the same microtask as
 * the signal write — the default for most applications.
 *
 * @example rAF batching — all writes in a frame become one DOM pass
 * ```ts
 * const rafProtocol: RendererProtocol = {
 *   scheduleFlush(flush) {
 *     requestAnimationFrame(flush);
 *   },
 * };
 * const { mount } = createRenderer(domHost, rafProtocol);
 * ```
 *
 * @example Microtask batching — defer to the next microtask checkpoint
 * ```ts
 * const microtaskProtocol: RendererProtocol = {
 *   scheduleFlush(flush) {
 *     queueMicrotask(flush);
 *   },
 * };
 * ```
 *
 * @see {@link createRenderer}
 */
export interface RendererProtocol {
    /**
     * Schedule a flush of pending rendering updates.
     * @param flush - Callback to invoke when the host is ready to apply updates.
     */
    scheduleFlush(flush: () => void): void;
}
