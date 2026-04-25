/**
 * Core interfaces for the pluggable renderer system.
 *
 * `RendererHost` is the contract every rendering target must implement.
 * `RendererProtocol` is an optional batching escape hatch (e.g. rAF for canvas).
 */

export interface RendererHost<N, E extends N> {
    createElement(tag: string): E;
    createText(text: string): N;
    insert(parent: E, child: N, anchor?: N | null): void;
    remove(child: N): void;
    setProperty(el: E, key: string, value: unknown): void;
    setText(node: N, text: string): void;
    parentNode(node: N): E | null;
    nextSibling(node: N): N | null;
    onMount?(el: E): void;
    onUnmount?(el: E): void;
    onUpdate?(el: E): void;
}

export interface RendererProtocol {
    scheduleFlush(flush: () => void): void;
}
