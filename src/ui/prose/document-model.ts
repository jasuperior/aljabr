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

export type Document    = Variant<"Document",    { children: ProseNode[] }>;
export type Block       = Variant<"Block",       { children: ProseNode[] }>;
export type Heading     = Variant<"Heading",     { level: 1 | 2 | 3 | 4 | 5 | 6; children: ProseNode[] }>;
export type Quote       = Variant<"Quote",       { children: ProseNode[] }>;
export type Code        = Variant<"Code",        { language: string | null; children: ProseNode[] }>;
export type List        = Variant<"List",        { ordered: boolean; children: ListItem[] }>;
export type ListItem    = Variant<"ListItem",    { children: ProseNode[] }>;
export type Text        = Variant<"Text",        { content: string; marks: MarkSet[] }>;
export type HardBreak   = Variant<"HardBreak",   {}>;
export type Hr          = Variant<"Hr",          {}>;
export type BlockEmbed  = Variant<"BlockEmbed",  { name: string; payload: unknown }>;
export type InlineEmbed = Variant<"InlineEmbed", { name: string; payload: unknown }>;

export type ProseNode =
    | Document | Block | Heading | Quote | Code | List | ListItem
    | Text | HardBreak | Hr | BlockEmbed | InlineEmbed;

// Underlying variant factories. The closed primitive set means ProseNode does
// not need union-algebra operations (`merge`, `extend`) — so we wrap each
// factory by hand to stamp a stable, non-enumerable node ID on the final
// variant instance (the union machinery uses Object.assign internally, which
// drops non-enumerable properties from the payload).
const _ProseNode = union([]).typed({
    Document:    (children: ProseNode[]) => ({ children }) as Document,
    Block:       (children: ProseNode[]) => ({ children }) as Block,
    Heading:     (level: 1 | 2 | 3 | 4 | 5 | 6, children: ProseNode[]) =>
        ({ level, children }) as Heading,
    Quote:       (children: ProseNode[]) => ({ children }) as Quote,
    Code:        (language: string | null, children: ProseNode[]) =>
        ({ language, children }) as Code,
    List:        (ordered: boolean, children: ListItem[]) =>
        ({ ordered, children }) as List,
    ListItem:    (children: ProseNode[]) => ({ children }) as ListItem,
    Text:        (content: string, marks: MarkSet[] = []) =>
        ({ content, marks }) as Text,
    HardBreak:   () => ({}) as HardBreak,
    Hr:          () => ({}) as Hr,
    BlockEmbed:  (name: string, payload: unknown) =>
        ({ name, payload }) as BlockEmbed,
    InlineEmbed: (name: string, payload: unknown) =>
        ({ name, payload }) as InlineEmbed,
});

export const ProseNode = {
    Document:    (children: ProseNode[], id?: string): Document =>
        stampId(_ProseNode.Document(children), id),
    Block:       (children: ProseNode[], id?: string): Block =>
        stampId(_ProseNode.Block(children), id),
    Heading:     (level: 1 | 2 | 3 | 4 | 5 | 6, children: ProseNode[], id?: string): Heading =>
        stampId(_ProseNode.Heading(level, children), id),
    Quote:       (children: ProseNode[], id?: string): Quote =>
        stampId(_ProseNode.Quote(children), id),
    Code:        (language: string | null, children: ProseNode[], id?: string): Code =>
        stampId(_ProseNode.Code(language, children), id),
    List:        (ordered: boolean, children: ListItem[], id?: string): List =>
        stampId(_ProseNode.List(ordered, children), id),
    ListItem:    (children: ProseNode[], id?: string): ListItem =>
        stampId(_ProseNode.ListItem(children), id),
    Text:        (content: string, marks: MarkSet[] = [], id?: string): Text =>
        stampId(_ProseNode.Text(content, marks), id),
    HardBreak:   (id?: string): HardBreak => stampId(_ProseNode.HardBreak(), id),
    Hr:          (id?: string): Hr => stampId(_ProseNode.Hr(), id),
    BlockEmbed:  (name: string, payload: unknown, id?: string): BlockEmbed =>
        stampId(_ProseNode.BlockEmbed(name, payload), id),
    InlineEmbed: (name: string, payload: unknown, id?: string): InlineEmbed =>
        stampId(_ProseNode.InlineEmbed(name, payload), id),
} as const;

// ============================================================================
// Placement rules and validation
// ============================================================================

const BLOCK_CONTAINERS = new Set(["Document", "Quote", "ListItem"]);
const INLINE_CONTAINERS = new Set(["Block", "Heading", "Code"]);
const LIST_CONTAINERS = new Set(["List"]);
const BLOCKS = new Set([
    "Block", "Heading", "Quote", "Code", "List", "Hr", "BlockEmbed",
]);
const LIST_CHILDREN = new Set(["ListItem"]);
const INLINES = new Set(["Text", "HardBreak", "InlineEmbed"]);

export type PlacementError = {
    nodeId: string;
    parentTag: string;
    childTag: string;
    message: string;
};

const allowedChildren = (parent: string): Set<string> | null => {
    if (BLOCK_CONTAINERS.has(parent)) return BLOCKS;
    if (INLINE_CONTAINERS.has(parent)) return INLINES;
    if (LIST_CONTAINERS.has(parent)) return LIST_CHILDREN;
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
 *  - `Document`, `Quote`, and `ListItem` hold blocks (`Block`, `Heading`,
 *    `Quote`, `Code`, `List`, `Hr`, `BlockEmbed`).
 *  - `List` holds `ListItem` children only.
 *  - `Block`, `Heading`, `Code` hold inlines (`Text`, `HardBreak`,
 *    `InlineEmbed`).
 *  - `Text`, `HardBreak`, `Hr`, `BlockEmbed`, `InlineEmbed` are leaves.
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
