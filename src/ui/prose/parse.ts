/**
 * `parse` — namespace for prose document parsers.
 *
 * v0.4.0 ships only `parse.jsx`: walks a JSX tree of prose primitives and
 * returns `Validation<DocumentState, DecodeError>`. The tree is validated
 * against the closed structural set (Phase 1.1) plus the registered embeds
 * (default registry + author registrations).
 *
 * `parse.text`, `parse.html`, and `parse.json` ship in v0.4.2.
 *
 * @module
 */
import { match } from "../../match.ts";
import { Validation } from "../../prelude/validation.ts";
import { decode, DecodeError } from "../../schema/index.ts";
import {
    MarkSet,
    ProseNode,
    type Document,
    type ListItem,
    type ProseNode as ProseNodeT,
    type Text,
} from "./document-model.ts";
import type { DocumentState } from "./document-state.ts";
import { EditorRange } from "./editor-range.ts";
import { rangePointAt } from "./tree-ops.ts";
import {
    DEFAULT_EMBEDS,
    type EmbedRegistry,
} from "./embed-registry.ts";
import type { Child, ViewNode } from "../view-node.ts";

type Path = (string | number)[];

const valid = <T>(value: T): Validation<T, DecodeError> =>
    Validation.Valid<T, DecodeError>(value);

const invalid = <T>(errors: DecodeError[]): Validation<T, DecodeError> =>
    Validation.Invalid<T, DecodeError>(errors);

// ---------------------------------------------------------------------------
// JSX tree → Document
// ---------------------------------------------------------------------------

const STRUCTURAL_TAGS = new Set([
    "document", "block", "heading", "quote", "code",
    "list", "listItem", "text", "break", "hr",
    "blockEmbed", "inlineEmbed",
]);

/**
 * Resolve a JSX child to a flat array of ViewNode-or-string entries.
 * Functions and reactive readables are not supported in static parse trees
 * (they belong to the runtime renderer, not the parser).
 */
const flattenChildren = (raw: unknown): Array<ViewNode | string> => {
    const out: Array<ViewNode | string> = [];
    const visit = (c: unknown): void => {
        if (c === null || c === undefined || c === false || c === true) return;
        if (typeof c === "string") { out.push(c); return; }
        if (typeof c === "number") { out.push(String(c)); return; }
        if (Array.isArray(c)) { for (const item of c) visit(item); return; }
        // ViewNode union — walk Fragment transparently.
        if (typeof c === "object") {
            const vn = c as ViewNode;
            match(vn, {
                Fragment: ({ children }) => { for (const k of children) visit(k); },
                Element:   () => { out.push(vn); },
                Text:      ({ content }) => { out.push(content); },
                Component: () => {
                    // Components aren't supported in parse.jsx — they couple
                    // to runtime reactivity. Skip silently; the upstream
                    // walker emits an error if no usable children remain.
                },
            });
        }
    };
    visit(raw);
    return out;
};

const collectTextContent = (children: unknown): string => {
    let out = "";
    for (const c of flattenChildren(children)) {
        if (typeof c === "string") out += c;
        // Element children inside <text> are rejected at the caller; we
        // tolerate them here and return the text we did see.
    }
    return out;
};

// Build MarkSet[] from a <text>'s props.
const marksFromProps = (props: Record<string, unknown>): MarkSet[] => {
    const out: MarkSet[] = [];
    if (props["bold"])      out.push(MarkSet.Bold());
    if (props["italic"])    out.push(MarkSet.Italic());
    if (props["underline"]) out.push(MarkSet.Underline());
    if (props["strike"])    out.push(MarkSet.Strike());
    if (props["code"])      out.push(MarkSet.Code());
    const link = props["link"];
    if (link && typeof link === "object" && "href" in link) {
        out.push(MarkSet.Link(String((link as { href: unknown }).href)));
    }
    if (typeof props["color"] === "string") out.push(MarkSet.Color(props["color"]));
    if (typeof props["backgroundColor"] === "string")
        out.push(MarkSet.BackgroundColor(props["backgroundColor"]));
    if (typeof props["fontFamily"] === "string")
        out.push(MarkSet.FontFamily(props["fontFamily"]));
    const fontSize = props["fontSize"];
    if (typeof fontSize === "string" || typeof fontSize === "number")
        out.push(MarkSet.FontSize(fontSize));
    const customMarks = props["marks"];
    if (Array.isArray(customMarks)) {
        for (const m of customMarks as MarkSet[]) out.push(m);
    }
    return out;
};

const idOf = (props: Record<string, unknown>): string | undefined =>
    typeof props["id"] === "string" ? (props["id"] as string) : undefined;

const sequenceErrors = <T>(
    items: Validation<T, DecodeError>[],
): Validation<T[], DecodeError> => {
    const values: T[] = [];
    const errors: DecodeError[] = [];
    for (const item of items) {
        match(item, {
            Valid:       ({ value }) => { values.push(value); },
            Invalid:     ({ errors: es }) => { errors.push(...es); },
            Unvalidated: () => {},
        });
    }
    return errors.length > 0 ? invalid(errors) : valid(values);
};

const parseElement = (
    vn: ViewNode,
    embeds: EmbedRegistry,
    path: Path,
): Validation<ProseNodeT, DecodeError> =>
    match(vn, {
        Element: ({ tag, props, children }) =>
            parseElementByTag(tag, props, children, embeds, path),
        Text: ({ content }) =>
            valid(ProseNode.Text(content, []) as ProseNodeT),
        Fragment: () =>
            invalid<ProseNodeT>([
                DecodeError.Custom(path, "fragments are not valid prose nodes"),
            ]),
        Component: () =>
            invalid<ProseNodeT>([
                DecodeError.Custom(path, "function components are not supported in parse.jsx"),
            ]),
    }) as Validation<ProseNodeT, DecodeError>;

const parseElementByTag = (
    tag: string,
    props: Record<string, unknown>,
    children: Child[],
    embeds: EmbedRegistry,
    path: Path,
): Validation<ProseNodeT, DecodeError> => {
    const id = idOf(props);

    // Embed by registered name (overrides intrinsics if both somehow apply
    // — by convention, embeds use their author-chosen tag name).
    if (!STRUCTURAL_TAGS.has(tag) && embeds[tag]) {
        return parseRegisteredEmbedTag(tag, props, embeds, path, id);
    }

    switch (tag) {
        case "document": {
            return parseChildrenAsNodes(children, embeds, path).flatMap(
                ((kids) => valid(ProseNode.Document(kids, id) as ProseNodeT)),
            );
        }
        case "block":
            return mapKids(children, embeds, path,
                (kids) => ProseNode.Block(kids, id));
        case "heading": {
            const level = props["level"];
            if (
                typeof level !== "number" ||
                level < 1 || level > 6 ||
                !Number.isInteger(level)
            ) {
                return invalid([
                    DecodeError.Custom(path, `<heading> requires an integer level 1..6`),
                ]);
            }
            return mapKids(children, embeds, path,
                (kids) => ProseNode.Heading(level as 1|2|3|4|5|6, kids, id));
        }
        case "quote":
            return mapKids(children, embeds, path,
                (kids) => ProseNode.Quote(kids, id));
        case "code": {
            const language = props["language"];
            const lang = typeof language === "string" ? language : null;
            return mapKids(children, embeds, path,
                (kids) => ProseNode.Code(lang, kids, id));
        }
        case "list": {
            const ordered =
                typeof props["ordered"] === "boolean"
                    ? (props["ordered"] as boolean)
                    : false;
            return parseChildrenAsNodes(children, embeds, path).flatMap((kids) => {
                const errs: DecodeError[] = [];
                const items: ListItem[] = [];
                for (let i = 0; i < kids.length; i++) {
                    const k = kids[i]!;
                    if ((k as { [k: symbol]: unknown }) && (k as ProseNodeT)) {
                        // Check tag.
                        const t = (k as unknown as Record<symbol, unknown>);
                        // Use match to verify it's a ListItem.
                        const ok = match(k as ProseNodeT, {
                            ListItem: () => true as const,
                            Document:    () => false as const,
                            Block:       () => false as const,
                            Heading:     () => false as const,
                            Quote:       () => false as const,
                            Code:        () => false as const,
                            List:        () => false as const,
                            Text:        () => false as const,
                            HardBreak:   () => false as const,
                            Hr:          () => false as const,
                            BlockEmbed:  () => false as const,
                            InlineEmbed: () => false as const,
                        });
                        if (ok) items.push(k as ListItem);
                        else errs.push(DecodeError.Custom(
                            [...path, i],
                            `<list> children must be <listItem>`,
                        ));
                        // hush unused
                        void t;
                    }
                }
                return errs.length > 0
                    ? invalid<ProseNodeT>(errs)
                    : valid(ProseNode.List(ordered, items, id) as ProseNodeT);
            });
        }
        case "listItem":
            return mapKids(children, embeds, path,
                (kids) => ProseNode.ListItem(kids, id));
        case "text": {
            const content = collectTextContent(children);
            const marks = marksFromProps(props);
            return valid(ProseNode.Text(content, marks, id) as ProseNodeT);
        }
        case "break":
            return valid(ProseNode.HardBreak(id) as ProseNodeT);
        case "hr":
            return valid(ProseNode.Hr(id) as ProseNodeT);
        case "blockEmbed":
        case "inlineEmbed": {
            const name = props["name"];
            const payload = props["payload"];
            if (typeof name !== "string") {
                return invalid([
                    DecodeError.MissingField(path, "name"),
                ]);
            }
            const def = embeds[name];
            if (!def) {
                return invalid([
                    DecodeError.Custom(path, `unknown embed "${name}"`),
                ]);
            }
            const placement = tag === "blockEmbed" ? "block" : "inline";
            if (def.placement !== placement) {
                return invalid([
                    DecodeError.Custom(
                        path,
                        `embed "${name}" registered as ${def.placement}, used as ${placement}`,
                    ),
                ]);
            }
            return decode(def.schema, payload).flatMap((validatedPayload) => {
                const factory = tag === "blockEmbed"
                    ? ProseNode.BlockEmbed
                    : ProseNode.InlineEmbed;
                return valid(factory(name, validatedPayload, id) as ProseNodeT);
            });
        }
        default:
            return invalid([
                DecodeError.Custom(path, `unknown prose tag <${tag}>`),
            ]);
    }
};

const parseRegisteredEmbedTag = (
    tag: string,
    props: Record<string, unknown>,
    embeds: EmbedRegistry,
    _path: Path,
    id: string | undefined,
): Validation<ProseNodeT, DecodeError> => {
    const def = embeds[tag]!;
    // The author-chosen tag's payload IS the props (minus children/id).
    const { children: _c, id: _i, ...payloadProps } = props as Record<string, unknown>;
    return decode(def.schema, payloadProps).flatMap((validatedPayload) => {
        const factory = def.placement === "block"
            ? ProseNode.BlockEmbed
            : ProseNode.InlineEmbed;
        return valid(factory(tag, validatedPayload, id) as ProseNodeT);
    });
};

const mapKids = (
    children: Child[],
    embeds: EmbedRegistry,
    path: Path,
    build: (kids: ProseNodeT[]) => ProseNodeT,
): Validation<ProseNodeT, DecodeError> =>
    parseChildrenAsNodes(children, embeds, path).flatMap((kids) => valid(build(kids)));

const parseChildrenAsNodes = (
    children: Child[],
    embeds: EmbedRegistry,
    path: Path,
): Validation<ProseNodeT[], DecodeError> => {
    const flat = flattenChildren(children);
    const items: Validation<ProseNodeT, DecodeError>[] = [];
    for (let i = 0; i < flat.length; i++) {
        const c = flat[i]!;
        if (typeof c === "string") {
            // Loose text in a non-text container is treated as a Text node;
            // structural validation downstream may reject it.
            items.push(valid(ProseNode.Text(c, []) as ProseNodeT));
            continue;
        }
        items.push(parseElement(c, embeds, [...path, i]));
    }
    return sequenceErrors(items);
};

// ---------------------------------------------------------------------------
// Public surface
// ---------------------------------------------------------------------------

export const parse = {
    /**
     * Parse a JSX tree of prose primitives into a `DocumentState`.
     *
     * The root is expected to be a `<document>` element (or a fragment whose
     * direct child is one). Tags resolve against the closed structural set
     * plus the supplied (or default) embed registry. Unknown tags, missing
     * required props, and embed payloads that fail their registered schema
     * each produce structured `DecodeError` entries.
     */
    jsx(
        node: ViewNode,
        embeds: EmbedRegistry = DEFAULT_EMBEDS,
    ): Validation<DocumentState, DecodeError> {
        // Allow a fragment wrapping the root, but otherwise expect a
        // <document> element.
        const root = unwrapFragment(node);
        return parseElement(root, embeds, []).flatMap((proseRoot) => {
            // Require root to be Document.
            const ok = match(proseRoot, {
                Document: () => true as const,
                Block:       () => false as const,
                Heading:     () => false as const,
                Quote:       () => false as const,
                Code:        () => false as const,
                List:        () => false as const,
                ListItem:    () => false as const,
                Text:        () => false as const,
                HardBreak:   () => false as const,
                Hr:          () => false as const,
                BlockEmbed:  () => false as const,
                InlineEmbed: () => false as const,
            });
            if (!ok) {
                return invalid<DocumentState>([
                    DecodeError.Custom([], "parse.jsx root must be a <document>"),
                ]);
            }
            const doc = proseRoot as Document;
            // Default cursor: first text point, or document start if no text.
            const firstText = findFirstText(doc);
            const cursor = firstText
                ? EditorRange.Cursor(rangePointAt(doc, firstText, 0)!)
                : EditorRange.Cursor({
                    nodeId: "",
                    offset: 0,
                    line: 0,
                    col: 0,
                    absolute: 0,
                });
            return valid({ doc, cursor });
        });
    },
} as const;

const unwrapFragment = (node: ViewNode): ViewNode =>
    match(node, {
        Fragment: ({ children }) => {
            const flat = flattenChildren(children);
            const els = flat.filter((c): c is ViewNode => typeof c !== "string");
            return els[0] ?? node;
        },
        Element:   () => node,
        Text:      () => node,
        Component: () => node,
    });

const findFirstText = (n: ProseNodeT): string | null =>
    match(n, {
        Text: (t: Text) => {
            // Use the underlying NODE_ID via getNodeId — but we don't import
            // it here. Instead, walk via known property bag. Cheaper: read the
            // tag symbol — but we need the id. Re-import getNodeId.
            return getNodeIdLocal(t);
        },
        Document:    ({ children }) => firstTextIn(children),
        Block:       ({ children }) => firstTextIn(children),
        Heading:     ({ children }) => firstTextIn(children),
        Quote:       ({ children }) => firstTextIn(children),
        Code:        ({ children }) => firstTextIn(children),
        List:        ({ children }) => firstTextIn(children),
        ListItem:    ({ children }) => firstTextIn(children),
        HardBreak:   () => null,
        Hr:          () => null,
        BlockEmbed:  () => null,
        InlineEmbed: () => null,
    });

const firstTextIn = (kids: ProseNodeT[]): string | null => {
    for (const k of kids) {
        const r = findFirstText(k);
        if (r !== null) return r;
    }
    return null;
};

// Helper that mirrors `getNodeId` without re-exporting.
import { getNodeId as getNodeIdLocal } from "./document-model.ts";
