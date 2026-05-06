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
