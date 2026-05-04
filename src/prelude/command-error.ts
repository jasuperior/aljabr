import { union, type Union } from "../union.ts";
import { type DecodeError } from "../schema/index.ts";

/**
 * Standardised error union for `apply()` failures on a `Dispatcher`.
 *
 * Every `Dispatcher` whose `apply` rejects a command does so with a `CommandError`
 * (or an extension of it via `.merge`). Cross-domain tooling — history wrappers,
 * dev-tools panels, error reporters — speaks this one vocabulary.
 *
 * **Three base variants:**
 *
 * - `Rejected` — the command is structurally fine but the protocol declined to
 *   apply it (e.g., "cannot insert into a void node"). Carries a human-readable
 *   reason.
 * - `Conflict` — the current state is incompatible with the command (e.g.,
 *   "command targets a node ID that no longer exists"). Carries a detail
 *   string for diagnostics.
 * - `Invalid` — the command's payload failed schema validation. Carries the
 *   `DecodeError[]` from `aljabr/schema`.
 *
 * **Extending:**
 *
 * ```ts
 * const ProseCommandError = CommandError.merge({
 *     BoundaryViolation: (range: EditorRange) => ({ range }),
 *     SchemaConflict:    (detail: string) => ({ detail }),
 * })
 * ```
 */
export const CommandError = union({
    Rejected: (reason: string) => ({ reason }),
    Conflict: (detail: string) => ({ detail }),
    Invalid: (errors: DecodeError[]) => ({ errors }),
});

export type CommandError = Union<typeof CommandError>;
