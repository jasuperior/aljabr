import type { RendererHost } from "../types.ts";
import { Renderer } from "../renderer.ts";
import type { ViewNode, view } from "../view-node.ts";

// ---------------------------------------------------------------------------
// DomHost — DOM implementation of RendererHost
// ---------------------------------------------------------------------------

/**
 * Production DOM implementation of {@link RendererHost}.
 *
 * Pass to {@link Renderer.create} (or use {@link DomRenderer.create} as a
 * convenience wrapper) to mount component trees into the browser DOM.
 *
 * **Property mapping:**
 * - `class` / `className` → `setAttribute("class", value)`
 * - `style` (string) → `setAttribute("style", value)`
 * - `style` (object) → `Object.assign(el.style, value)`
 * - `on*` (function) → `addEventListener(eventName, handler)`
 * - Known IDL properties (`value`, `checked`, `disabled`, …) → direct assignment
 * - Everything else → `setAttribute(key, String(value))`
 */
export const DomHost: RendererHost<Node, Element> = {
    createElement(tag: string): Element {
        return document.createElement(tag);
    },

    createText(text: string): Node {
        return document.createTextNode(text);
    },

    insert(parent: Element, child: Node, anchor?: Node | null): void {
        parent.insertBefore(child, anchor ?? null);
    },

    remove(child: Node): void {
        child.parentNode?.removeChild(child);
    },

    setProperty(el: Element, key: string, value: unknown): void {
        if (key === "class" || key === "className") {
            el.setAttribute("class", value == null ? "" : String(value));
            return;
        }

        if (key === "style") {
            if (value == null) {
                (el as HTMLElement).removeAttribute("style");
            } else if (typeof value === "string") {
                (el as HTMLElement).setAttribute("style", value);
            } else if (typeof value === "object") {
                Object.assign((el as HTMLElement).style, value);
            }
            return;
        }

        if (key.startsWith("on") && typeof value === "function") {
            const eventName = key.slice(2).toLowerCase();
            el.addEventListener(eventName, value as EventListener);
            return;
        }

        if (key in el) {
            (el as unknown as Record<string, unknown>)[key] = value;
        } else if (value == null) {
            el.removeAttribute(key);
        } else {
            el.setAttribute(key, String(value));
        }
    },

    setText(node: Node, text: string): void {
        node.textContent = text;
    },

    parentNode(node: Node): Element | null {
        return node.parentNode as Element | null;
    },

    nextSibling(node: Node): Node | null {
        return node.nextSibling;
    },

    attach(container: Element) {
        return { root: container, dispose: () => {} };
    },
};

// ---------------------------------------------------------------------------
// DomRenderer — thin wrapper over Renderer.create(DomHost)
// ---------------------------------------------------------------------------

/**
 * Convenience wrapper. `DomRenderer.create()` is equivalent to
 * `Renderer.create(DomHost)`. Authors can use either form interchangeably.
 */
export const DomRenderer = {
    create(): {
        view: typeof view;
        mount: (fn: () => ViewNode, container: Element) => () => void;
    } {
        return Renderer.create(DomHost);
    },
} as const;
