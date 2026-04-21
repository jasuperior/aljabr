# Advanced Patterns

The guides in this section are not about learning more APIs. They're about the patterns that only emerge when you stop using aljabr's pieces in isolation and let them compose.

The [Getting Started](../getting-started.md) guide covers `union`, `match`, and the core mechanics. The [Union Patterns](../union-patterns.md) guide covers the depth of the `union()` API itself — impl classes, generics, Trait constraints. These guides assume that foundation and go further.

---

## A taste of what's ahead

A search-as-you-type feature sounds simple. In practice it involves at least five distinct concerns that most codebases handle inconsistently: domain state, input validation, reactive data flow, debounce timing, and resource cleanup. Here's what each concern looks like when you reach for the right tool:

```ts
import { union, match, Union } from "aljabr"
import { Signal, Ref, Derived, AsyncDerived, Validation, Scope, Resource } from "aljabr/prelude"

// The domain state is a typed union — not a status string, not a boolean flag.
// Guide 1 covers how to model these, chain them, and compose them with Result and Option.
const SearchState = union({
  Idle:      {},
  Searching: (term: string) => ({ term }),
  Done:      (results: Product[], term: string) => ({ results, term }),
  Empty:     (term: string) => ({ term }),
})
type SearchState = Union<typeof SearchState>
```

```ts
// Input validation accumulates all errors before touching the network.
// Guide 1 shows the difference between Result (short-circuit) and Validation (accumulate).
function parseQuery(raw: string): Validation<string, string> {
  const trimmed = raw.trim()
  if (trimmed.length === 0) return Validation.Invalid(["Enter a search term"])
  if (trimmed.length < 2)  return Validation.Invalid(["Enter at least 2 characters"])
  return Validation.Valid(trimmed)
}
```

```ts
// The reactive graph is backed by fine-grained structured state.
// Guide 3 shows how Ref, Derived, and AsyncDerived compose around a real UI concern.
const store = Ref.create({ query: "", results: [] as Product[], page: 1 })
const summary = Derived.create(() =>
  `${store.get("results").length} results for "${store.get("query")}"`
)
const page = AsyncDerived.create(async () => {
  const q = store.get("query")
  const p = store.get("page")
  return fetchProducts({ q, p })
})
```

```ts
// The input signal knows it's debounced — that's encoded in its state union, not in a setTimeout.
// Guide 4 shows how to build custom signal protocols for exactly this kind of temporal state.
const input = Signal.create("", DebounceProtocol({ delay: 300 }))

match(input.state(), {
  Idle:    () => renderPlaceholder(),
  Pending: () => renderSpinner(),
  Settled: ({ value }) => store.patch("query", value),
})
```

```ts
// Cleanup is declared alongside acquisition — nothing leaks when the panel closes.
// Guide 5 shows how Scope, Resource, and defer compose into a structured teardown.
const scope = Scope.create()
scope.acquire(Resource(
  () => subscribeToInventoryUpdates(),
  (sub) => sub.unsubscribe(),
))
scope.defer(() => store.patch("query", ""))
```

Each snippet above could be woven into the same feature without them knowing about each other. That's the composability the guides are designed to build.

---

## Progression

The guides form a natural reading order. Union branching establishes the shared vocabulary — Result, Option, Validation, and domain unions — that every subsequent guide relies on. From there, parser construction and reactive UI are independent branches. Signal protocols and resource lifetime build on reactive UI.

| Guide | What it covers |
|---|---|
| [1. Union Branching](./union-branching.md) | Result chaining, Option as a null discipline, Validation accumulation, cross-container composition, and modeling domain state as a typed union |
| [2. Parser Construction](./parser-construction.md) | Token and AST unions, recursive match evaluation, and decoding external data through the schema pipeline into typed domain models |
| [3. Reactive UI](./reactive-ui.md) | Composing Ref, Derived, AsyncDerived, and Effect around a real UI concern — structured state, lazy computation, and async data |
| [4. Signal Protocols](./signal-protocols.md) | Custom SignalProtocol implementations — debounce, optimistic updates, and any temporal state that lives inside the reactive primitive itself |
| [5. Resource Lifetime](./resource-lifetime.md) | Scope, Resource, acquire, and defer — structured teardown for signals, effects, subscriptions, and async work tied to the same lifetime |

After Union Branching, you can read guides 2 and 3 in either order. Guides 4 and 5 build on guide 3.

---

## See also

- [Getting Started](../getting-started.md)
- [Union Patterns](../union-patterns.md) — impl classes, Trait constraints, generics, RemoteData
- [Working with External Data](../schema.md)
- [Resilient Async](../resilient-async.md)
