import { union, type Union } from "../../union.ts";
import type { Document } from "./document-model.ts";
import type { EditorRange } from "./editor-range.ts";

/**
 * The reactive state owned by a prose `Dispatcher`. The renderer reads
 * `doc` for the document tree and `cursor` for the current selection;
 * commands transition both atomically.
 */
export type DocumentState = {
    doc: Document;
    cursor: EditorRange;
};

/**
 * Discriminator for `SetBlockKind` — the *kind* of block to convert a range
 * of blocks into. Headings carry their level; code blocks carry an optional
 * language. `Block` and `Quote` carry no payload.
 *
 * This is a small sibling union rather than a re-use of `ProseNode` tags
 * because (a) it doesn't include the void block kinds (`Image`, `Hr`) — those
 * aren't valid conversion targets — and (b) the per-kind payload (heading
 * level, code language) is part of the command parameter, not derived from a
 * source node.
 */
export const BlockKind = union({
    Block:   () => ({}),
    Heading: (level: 1 | 2 | 3 | 4 | 5 | 6) => ({ level }),
    Quote:   () => ({}),
    Code:    (language: string | null) => ({ language }),
});
export type BlockKind = Union<typeof BlockKind>;
