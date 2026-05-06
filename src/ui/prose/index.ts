export {
    MarkSet,
    ProseNode,
    getNodeId,
    validatePlacement,
} from "./document-model.ts";
export type {
    Document,
    Block,
    Heading,
    Quote,
    Code,
    Text,
    Image,
    HardBreak,
    Hr,
    PlacementError,
} from "./document-model.ts";

export {
    EditorRange,
    rangePointSchema,
    editorRangeSchema,
} from "./editor-range.ts";
export type {
    RangePoint,
    Cursor,
    TextRange,
    NodeRange,
} from "./editor-range.ts";

export { BlockKind } from "./document-state.ts";
export type { DocumentState } from "./document-state.ts";

export { normalizeText } from "./tree-ops.ts";

export {
    ProseCommand,
    defaultApply,
    proseProtocol,
} from "./commands.ts";
export type {
    SetCursorCmd,
    InsertCmd,
    DeleteBackwardCmd,
    DeleteForwardCmd,
    FormatCmd,
    RemoveMarkCmd,
    SplitBlockCmd,
    MergeBlockCmd,
    SetBlockKindCmd,
    CompoundCmd,
} from "./commands.ts";
