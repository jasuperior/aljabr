import { union, getTag, type Union, type Variant } from "../../union.ts";
import { Validation } from "../../prelude/validation.ts";

// ============================================================================
// Marks
// ============================================================================

export const MarkSet = union({
    Bold:            () => ({}),
    Italic:          () => ({}),
    Underline:       () => ({}),
    Strike:          () => ({}),
    Code:            () => ({}),
    Link:            (href: string) => ({ href }),
    Color:           (value: string) => ({ value }),
    BackgroundColor: (value: string) => ({ value }),
    FontFamily:      (value: string) => ({ value }),
    FontSize:        (value: string | number) => ({ value }),
});
export type MarkSet = Union<typeof MarkSet>;

// ============================================================================
// Node ID
// ============================================================================

const NODE_ID = Symbol("aljabr.prose.nodeId");

let _counter = 0;
const generateNodeId = (): string =>
    `n${(++_counter).toString(36)}${Math.random().toString(36).slice(2, 8)}`;

const stampId = <T extends object>(node: T, id?: string): T => {
    Object.defineProperty(node, NODE_ID, {
        value: id ?? generateNodeId(),
        enumerable: false,
        writable: false,
        configurable: true,
    });
    return node;
};

export const getNodeId = (node: ProseNode): string =>
    (node as unknown as { [NODE_ID]: string })[NODE_ID];

// ============================================================================
// ProseNode union
// ============================================================================

export type Document  = Variant<"Document",  { children: ProseNode[] }>;
export type Block     = Variant<"Block",     { children: ProseNode[] }>;
export type Heading   = Variant<"Heading",   { level: 1 | 2 | 3 | 4 | 5 | 6; children: ProseNode[] }>;
export type Quote     = Variant<"Quote",     { children: ProseNode[] }>;
export type Code      = Variant<"Code",      { language: string | null; children: ProseNode[] }>;
export type Text      = Variant<"Text",      { content: string; marks: MarkSet[] }>;
export type Image     = Variant<"Image",     { src: string; alt: string | null; caption: string | null }>;
export type HardBreak = Variant<"HardBreak", {}>;
export type Hr        = Variant<"Hr",        {}>;

export type ProseNode =
    | Document | Block | Heading | Quote | Code
    | Text | Image | HardBreak | Hr;

// Underlying variant factories. The closed primitive set means ProseNode does
// not need union-algebra operations (`merge`, `extend`) — so we wrap each
// factory by hand to stamp a stable, non-enumerable node ID on the final
// variant instance (the union machinery uses Object.assign internally, which
// drops non-enumerable properties from the payload).
const _ProseNode = union([]).typed({
    Document:  (children: ProseNode[]) => ({ children }) as Document,
    Block:     (children: ProseNode[]) => ({ children }) as Block,
    Heading:   (level: 1 | 2 | 3 | 4 | 5 | 6, children: ProseNode[]) =>
        ({ level, children }) as Heading,
    Quote:     (children: ProseNode[]) => ({ children }) as Quote,
    Code:      (language: string | null, children: ProseNode[]) =>
        ({ language, children }) as Code,
    Text:      (content: string, marks: MarkSet[] = []) =>
        ({ content, marks }) as Text,
    Image:     (src: string, alt: string | null = null, caption: string | null = null) =>
        ({ src, alt, caption }) as Image,
    HardBreak: () => ({}) as HardBreak,
    Hr:        () => ({}) as Hr,
});

export const ProseNode = {
    Document:  (children: ProseNode[], id?: string): Document =>
        stampId(_ProseNode.Document(children), id),
    Block:     (children: ProseNode[], id?: string): Block =>
        stampId(_ProseNode.Block(children), id),
    Heading:   (level: 1 | 2 | 3 | 4 | 5 | 6, children: ProseNode[], id?: string): Heading =>
        stampId(_ProseNode.Heading(level, children), id),
    Quote:     (children: ProseNode[], id?: string): Quote =>
        stampId(_ProseNode.Quote(children), id),
    Code:      (language: string | null, children: ProseNode[], id?: string): Code =>
        stampId(_ProseNode.Code(language, children), id),
    Text:      (content: string, marks: MarkSet[] = [], id?: string): Text =>
        stampId(_ProseNode.Text(content, marks), id),
    Image:     (src: string, alt: string | null = null, caption: string | null = null, id?: string): Image =>
        stampId(_ProseNode.Image(src, alt, caption), id),
    HardBreak: (id?: string): HardBreak => stampId(_ProseNode.HardBreak(), id),
    Hr:        (id?: string): Hr => stampId(_ProseNode.Hr(), id),
} as const;

// ============================================================================
// Placement rules and validation
// ============================================================================

const BLOCK_CONTAINERS = new Set(["Document", "Quote"]);
const INLINE_CONTAINERS = new Set(["Block", "Heading", "Code"]);
const BLOCKS = new Set(["Block", "Heading", "Quote", "Code", "Image", "Hr"]);
const INLINES = new Set(["Text", "HardBreak"]);

export type PlacementError = {
    nodeId: string;
    parentTag: string;
    childTag: string;
    message: string;
};

const allowedChildren = (parent: string): Set<string> | null => {
    if (BLOCK_CONTAINERS.has(parent)) return BLOCKS;
    if (INLINE_CONTAINERS.has(parent)) return INLINES;
    return null; // leaf node — no children allowed
};

const collectErrors = (node: ProseNode, errors: PlacementError[]): void => {
    const parent = getTag(node);
    const children = (node as { children?: ProseNode[] }).children;
    if (!children) return;

    const allowed = allowedChildren(parent);
    if (allowed === null) {
        if (children.length > 0) {
            errors.push({
                nodeId: getNodeId(node),
                parentTag: parent,
                childTag: getTag(children[0]!),
                message: `<${parent}> is a leaf node and cannot contain children`,
            });
        }
        return;
    }

    for (const child of children) {
        const childTag = getTag(child);
        if (!allowed.has(childTag)) {
            errors.push({
                nodeId: getNodeId(node),
                parentTag: parent,
                childTag,
                message: `<${childTag}> is not allowed inside <${parent}>`,
            });
        }
        collectErrors(child, errors);
    }
};

/**
 * Validate the structural placement rules of a prose tree.
 *
 * Rules:
 *  - `Document` and `Quote` hold blocks (`Block`, `Heading`, `Quote`, `Code`, `Image`, `Hr`).
 *  - `Block`, `Heading`, `Code` hold inlines (`Text`, `HardBreak`).
 *  - `Text`, `HardBreak`, `Image`, `Hr` are leaves.
 */
export const validatePlacement = (
    root: ProseNode,
): Validation<ProseNode, PlacementError> => {
    const errors: PlacementError[] = [];
    collectErrors(root, errors);
    return errors.length === 0
        ? Validation.Valid<ProseNode, PlacementError>(root)
        : Validation.Invalid<ProseNode, PlacementError>(errors);
};
