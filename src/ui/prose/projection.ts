/**
 * Document → ViewNode projection.
 *
 * Walks a `Document` tree and emits a `ViewNode` tree of native HTML tags
 * (block → `<p>`, heading → `<h{level}>`, list → `<ul>`/`<ol>`, etc.). Marks
 * on `<text>` are mapped to wrapping inline tags per the §1.2 DOM mapping.
 *
 * Embeds (`BlockEmbed`/`InlineEmbed`) consult the supplied registry: the
 * payload is validated against the registered `Schema`; on success the
 * registered `render` produces a `ViewNode` which is wrapped in a
 * `contenteditable={false}` container so the browser treats the embed as a
 * void unit. On validation failure a placeholder `<span>` is emitted (and
 * `console.warn`'d in dev mode).
 *
 * Why native tags rather than abstract prose intrinsics: `RendererHost`'s
 * `createElement(tag)` does not see element props, so `Heading.level` cannot
 * influence tag selection at element-creation time. Translating variants to
 * native tags here keeps the host trivial and avoids reconciler surgery.
 *
 * @module
 */
import { match } from "../../match.ts";
import { decode } from "../../schema/index.ts";
import { view, type Child, type ViewNode } from "../view-node.ts";
import {
    getNodeId,
    type Document,
    type MarkSet,
    type ProseNode,
    type Text,
} from "./document-model.ts";
import type { EmbedRegistry } from "./embed-registry.ts";

const __DEV__ =
    (globalThis as { process?: { env?: { NODE_ENV?: string } } })
        .process?.env?.["NODE_ENV"] !== "production";

const idAttr = (n: ProseNode): Record<string, unknown> => ({
    "data-aljabr-id": getNodeId(n),
});

/**
 * Project a Document into a ViewNode tree. The returned ViewNode is a
 * Fragment of the document's children — so mounting it directly on a single
 * container element fills that element with the document's blocks.
 */
export const projectDoc = (
    doc: Document,
    embeds: EmbedRegistry,
): ViewNode => {
    const children = doc.children.map((c) => projectNode(c, embeds));
    return view("div", {
        "data-aljabr-id": getNodeId(doc),
        "data-aljabr-doc": "",
    }, ...children);
};

const projectNode = (n: ProseNode, embeds: EmbedRegistry): Child =>
    match(n, {
        Document:    ({ children }) =>
            view("div", idAttr(n), ...children.map((c) => projectNode(c, embeds))),
        Block:       ({ children }) =>
            view("p", idAttr(n), ...children.map((c) => projectNode(c, embeds))),
        Heading:     ({ level, children }) =>
            view(`h${level}`, idAttr(n), ...children.map((c) => projectNode(c, embeds))),
        Quote:       ({ children }) =>
            view("blockquote", idAttr(n), ...children.map((c) => projectNode(c, embeds))),
        Code:        ({ language, children }) =>
            view("pre", idAttr(n),
                view("code",
                    language ? { class: `language-${language}` } : null,
                    ...children.map((c) => projectNode(c, embeds)),
                ),
            ),
        List:        ({ ordered, children }) =>
            view(ordered ? "ol" : "ul", idAttr(n),
                ...children.map((c) => projectNode(c, embeds)),
            ),
        ListItem:    ({ children }) =>
            view("li", idAttr(n),
                ...children.map((c) => projectNode(c, embeds)),
            ),
        Text:        (t: Text) => projectText(n, t),
        HardBreak:   () => view("br", idAttr(n)),
        Hr:          () => view("hr", idAttr(n)),
        BlockEmbed:  ({ name, payload }) =>
            projectEmbed(n, name, payload, "block", embeds),
        InlineEmbed: ({ name, payload }) =>
            projectEmbed(n, name, payload, "inline", embeds),
    });

const projectText = (n: ProseNode, t: Text): ViewNode => {
    // Text content sits inside zero-or-more wrapping mark tags. We track the
    // outermost element so the node ID lands on the visible boundary.
    const wraps: Array<{ tag: string; props?: Record<string, unknown> }> = [];
    let inlineStyle: Record<string, string> | null = null;
    for (const m of t.marks) {
        const w = markWrap(m);
        if (w === "style") {
            inlineStyle ??= {};
            applyStyleMark(m, inlineStyle);
        } else if (w !== null) {
            wraps.push(w);
        }
    }

    let inner: ViewNode = view("span", { "data-aljabr-text": "" }, t.content);
    // Wrap inside-out: first mark in `wraps` is innermost, last is outermost.
    for (const w of wraps) {
        inner = view(w.tag, w.props ?? null, inner);
    }
    if (inlineStyle) {
        inner = view("span", { style: inlineStyle }, inner);
    }
    // Stamp the text node ID on the outermost wrapper. If there were no marks
    // and no style, replace the inner span's id-less props with the id-bearing
    // props.
    if (wraps.length === 0 && inlineStyle === null) {
        return view("span", {
            ...idAttr(n),
            "data-aljabr-text": "",
        }, t.content);
    }
    // Attach the id to the outermost wrapper via re-construction.
    return wrapWithId(inner, getNodeId(n));
};

const wrapWithId = (vn: ViewNode, id: string): ViewNode =>
    match(vn, {
        Element: ({ tag, props, children }) =>
            view(tag, { ...props, "data-aljabr-id": id }, ...children),
        Text:      () => view("span", { "data-aljabr-id": id }, vn),
        Component: () => view("span", { "data-aljabr-id": id }, vn),
        Fragment:  () => view("span", { "data-aljabr-id": id }, vn),
    });

const markWrap = (
    m: MarkSet,
): { tag: string; props?: Record<string, unknown> } | "style" | null =>
    match(m, {
        Bold:            () => ({ tag: "strong" }),
        Italic:          () => ({ tag: "em" }),
        Underline:       () => ({ tag: "u" }),
        Strike:          () => ({ tag: "s" }),
        Code:            () => ({ tag: "code" }),
        Link:            ({ href }) => ({ tag: "a", props: { href } }),
        Color:           () => "style" as const,
        BackgroundColor: () => "style" as const,
        FontFamily:      () => "style" as const,
        FontSize:        () => "style" as const,
    });

const applyStyleMark = (m: MarkSet, into: Record<string, string>): void => {
    match(m, {
        Color:           ({ value }) => { into["color"] = String(value); },
        BackgroundColor: ({ value }) => { into["backgroundColor"] = String(value); },
        FontFamily:      ({ value }) => { into["fontFamily"] = String(value); },
        FontSize:        ({ value }) =>
            { into["fontSize"] = typeof value === "number" ? `${value}px` : String(value); },
        Bold:            () => {},
        Italic:          () => {},
        Underline:       () => {},
        Strike:          () => {},
        Code:             () => {},
        Link:            () => {},
    });
};

const projectEmbed = (
    n: ProseNode,
    name: string,
    payload: unknown,
    placement: "block" | "inline",
    embeds: EmbedRegistry,
): ViewNode => {
    const def = embeds[name];
    if (!def) {
        if (__DEV__) {
            console.warn(`[aljabr/prose] unregistered embed "${name}"`);
        }
        return placeholder(n, placement, `unknown embed: ${name}`);
    }
    if (def.placement !== placement) {
        if (__DEV__) {
            console.warn(
                `[aljabr/prose] embed "${name}" registered as ${def.placement} but used as ${placement}`,
            );
        }
        return placeholder(n, placement, `placement mismatch: ${name}`);
    }
    const decoded = decode(def.schema, payload);
    return match(decoded, {
        Valid: ({ value }) => {
            const rendered = def.render(value);
            const wrapperTag = placement === "block" ? "div" : "span";
            return view(wrapperTag, {
                ...idAttr(n),
                "data-aljabr-embed": name,
                contentEditable: "false",
            }, rendered);
        },
        Invalid: ({ errors }) => {
            if (__DEV__) {
                console.warn(
                    `[aljabr/prose] embed "${name}" payload validation failed:`,
                    errors,
                );
            }
            return placeholder(n, placement, `invalid payload: ${name}`);
        },
        Unvalidated: () =>
            placeholder(n, placement, `unvalidated payload: ${name}`),
    });
};

const placeholder = (
    n: ProseNode,
    placement: "block" | "inline",
    msg: string,
): ViewNode => {
    const tag = placement === "block" ? "div" : "span";
    return view(tag, {
        ...idAttr(n),
        "data-aljabr-embed-error": msg,
        contentEditable: "false",
    });
};
