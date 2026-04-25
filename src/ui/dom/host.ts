import type { RendererHost } from "../types.ts";

// ---------------------------------------------------------------------------
// domHost — DOM implementation of RendererHost
// ---------------------------------------------------------------------------

/**
 * Production DOM implementation of {@link RendererHost}.
 *
 * Pass to {@link createRenderer} to mount component trees into the browser DOM.
 *
 * **Property mapping:**
 * - `class` / `className` → `setAttribute("class", value)`
 * - `style` (string) → `setAttribute("style", value)`
 * - `style` (object) → `Object.assign(el.style, value)`
 * - `on*` (function) → `addEventListener(eventName, handler)`
 * - Known IDL properties (`value`, `checked`, `disabled`, …) → direct assignment
 * - Everything else → `setAttribute(key, String(value))`
 *
 * @example
 * import { createRenderer } from "aljabr/ui";
 * import { domHost } from "aljabr/ui/dom";
 *
 * const { mount } = createRenderer(domHost);
 * const unmount = mount(() => view("p", null, "hello"), document.body);
 */
export const domHost: RendererHost<Node, Element> = {
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

        // Reflect known IDL properties directly (value, checked, disabled, etc.)
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
};
