# API Reference: CommandError

```ts
import { CommandError } from "aljabr/prelude"
```

---

## Overview

`CommandError` is the standardised error union returned by `apply()` failures on a [`Dispatcher`](./dispatcher.md). Because every `Dispatcher`'s `apply` rejects with a `CommandError` (or an extension of it), cross-domain tooling — history wrappers, dev-tools panels, error reporters — speaks a single vocabulary.

If `CommandError` were author-defined per domain, every consumer of `Dispatcher` would carry a different error type and the type cross-compatibility story would collapse. Standardising the base union plus an extension path via `.merge` keeps both flexibility and uniformity.

---

## Variants

```ts
const CommandError = union({
    Rejected: (reason: string) => ({ reason }),
    Conflict: (detail: string) => ({ detail }),
    Invalid:  (errors: DecodeError[]) => ({ errors }),
})
```

- **`Rejected`** — the command is structurally fine but the protocol declined to apply it. The reason is human-readable. Examples: "cannot insert into a void node," "max reached," "validation failed."
- **`Conflict`** — the current state is incompatible with the command. The detail string is for diagnostics. Examples: "command targets a node ID that no longer exists," "stale state version."
- **`Invalid`** — the command's payload failed schema validation. Carries the existing `DecodeError[]` from [`aljabr/schema`](../schema.md), so structured field-level failure paths flow through unchanged.

---

## Usage

```ts
import { CommandError, Dispatcher, Validation } from "aljabr/prelude"
import { match } from "aljabr"

const protocol = {
    extract: (s) => s,
    apply: (state, cmd) =>
        match(cmd, {
            Insert: ({ at }) =>
                isVoidNode(state, at)
                    ? Validation.Invalid([CommandError.Rejected("cannot insert into void node")])
                    : Validation.Valid({ next: insertAt(state, at), inverse: ... }),
            // ...
        }),
}
```

Inspecting failures at the call site:

```ts
match(doc.dispatch(cmd), {
    Valid: ({ value }) => commit(value),
    Invalid: ({ errors }) => {
        for (const error of errors) {
            match(error, {
                Rejected: ({ reason }) => log(`rejected: ${reason}`),
                Conflict: ({ detail }) => log(`conflict: ${detail}`),
                Invalid:  ({ errors: decodeErrors }) => display(decodeErrors),
            })
        }
    },
    Unvalidated: () => {},
})
```

---

## Extending

Authors with domain-specific failure modes extend via `.merge` (see [union algebra](../union.md#algebra)):

```ts
const ProseCommandError = CommandError.merge({
    BoundaryViolation: (range: EditorRange) => ({ range }),
    SchemaConflict:    (detail: string) => ({ detail }),
})
```

The extended union has all base variants plus the new ones; `match` is exhaustive over both. Cross-domain tooling that pattern-matches on the base union will hit `[__]` for unknown variants — authors who extend should ship their own adapters for tooling that needs to inspect their custom variants.

Compile-time overlap rejection applies: `CommandError.merge({ Rejected: ... })` is a type error. To replace a base variant, chain `.omit("Rejected").merge({ Rejected: ... })` or use the `.extend` shorthand.

---

## See also

- [`Dispatcher`](./dispatcher.md) — the reactive container whose `apply` returns `Validation<_, CommandError>`.
- [union algebra](../union.md#algebra) — `.merge`, `.extend`, `.pick`, `.omit`.
- [`Validation`](./validation.md) — the success/failure container `apply` returns.
- [`DecodeError`](../schema.md) — carried by `CommandError.Invalid`.
