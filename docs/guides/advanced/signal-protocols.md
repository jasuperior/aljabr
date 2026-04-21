# Signal Protocols

A plain `Signal<T>` has three lifecycle states: `Unset`, `Active<T>`, and `Disposed`. That's enough for most uses. But some reactive values have richer temporal state — a debounced input is either quiet, waiting, or settled; an optimistically-updated field is either confirmed, pending server acknowledgment, or in conflict. That state belongs on the signal itself, not scattered across derived values and effect flags.

`SignalProtocol<S, T>` is the mechanism for encoding that into the signal. You replace the default `SignalState<T>` lifecycle with a domain union of your own, and the signal's `.state()` becomes a pattern-matchable value that carries the full picture.

---

## The gap between `get()` and `state()`

Before building a custom protocol, it helps to understand why these two methods exist.

`.get()` extracts `T | null` from the current state — the readable value, or `null` if there is none. It's what `Derived` and `watchEffect` depend on.

`.state()` returns the full state union — whatever `S` is — and also registers a dependency. It's for reactive contexts where you need to distinguish between states that all return the same `T` from `.get()`, or where the interesting information is in the state variant itself, not the extracted value.

```ts
const email = Signal.create(
  Validation.Unvalidated() as Validation<string, string>,
  {
    extract: (state) => match(state, {
      Unvalidated: () => null,
      Valid:       ({ value }) => value,
      Invalid:     () => null,  // errors are in the state, not in get()
    }),
  },
)

// A downstream Derived only cares about the valid string — use get()
const upperEmail = Derived.create(() => email.get()?.toUpperCase() ?? "")

// A UI component cares about errors too — use state()
const fieldState = Derived.create(() => match(email.state(), {
  Unvalidated: () => ({ kind: "pristine" }),
  Valid:       () => ({ kind: "valid" }),
  Invalid:     ({ errors }) => ({ kind: "invalid", errors }),
}))
```

`upperEmail` re-runs when the extracted string changes. `fieldState` re-runs on any state transition — including `Unvalidated → Invalid` where both return `null` from `.get()`. Both are correct because they use the right read.

---

## Building a debounce protocol

A debounced input has three meaningful states: **Idle** (no pending value), **Pending** (a value is queued, waiting to settle), and **Settled** (the value has settled and is ready for consumers).

`get()` should return the settled value or `null` when pending. `.state()` should let a render decide whether to show a spinner, the pending value, or the quiet state.

### Defining the state union

```ts
import { union, match, Union } from "aljabr"
import { Signal, type SignalProtocol } from "aljabr/prelude"

const DebounceState = union({
  Idle:    {},
  Pending: (draft: string, timerId: ReturnType<typeof setTimeout>) => ({ draft, timerId }),
  Settled: (value: string) => ({ value }),
})
type DebounceState = Union<typeof DebounceState>
```

`Pending` carries the draft value and the timer ID. `Settled` carries the resolved value. `Idle` is the initial state before any input.

### The protocol

The protocol tells the signal how to extract `T` from `DebounceState` and whether any state is terminal:

```ts
const debounceProtocol: SignalProtocol<DebounceState, string> = {
  extract: (state) => match(state, {
    Idle:    () => null,
    Pending: () => null,     // not yet settled — consumers see null
    Settled: ({ value }) => value,
  }),
}
```

### The factory function

Wrap `Signal.create` in a factory that handles the timer logic. The factory is the only place that calls `signal.set()` — external code never reaches past the factory:

```ts
type DebounceHandle = {
  readonly signal: Signal<string, DebounceState>
  write(draft: string): void
  flush(): void
  cancel(): void
}

function createDebounceSignal(delay: number): DebounceHandle {
  const signal = Signal.create(
    DebounceState.Idle() as DebounceState,
    debounceProtocol,
  )

  function write(draft: string): void {
    const current = signal.peekState()

    // Cancel any pending timer
    match(current, {
      Pending: ({ timerId }) => clearTimeout(timerId),
      [__]:    () => {},
    })

    const timerId = setTimeout(() => {
      signal.set(DebounceState.Settled(draft))
    }, delay)

    signal.set(DebounceState.Pending(draft, timerId))
  }

  function flush(): void {
    const current = signal.peekState()
    match(current, {
      Pending: ({ draft, timerId }) => {
        clearTimeout(timerId)
        signal.set(DebounceState.Settled(draft))
      },
      [__]: () => {},
    })
  }

  function cancel(): void {
    const current = signal.peekState()
    match(current, {
      Pending: ({ timerId }) => {
        clearTimeout(timerId)
        signal.set(DebounceState.Idle())
      },
      [__]: () => {},
    })
  }

  return { signal, write, flush, cancel }
}
```

### Using the debounce signal

```ts
const search = createDebounceSignal(300)

// Wire to an input
input.addEventListener("input", (e) => {
  search.write((e.target as HTMLInputElement).value)
})

// Downstream consumer — only fires when the value settles
const results = AsyncDerived.create(async (signal) => {
  const query = search.signal.get()  // null while Pending or Idle
  if (!query) return []
  return fetchResults(query, signal)
})

// UI — shows the pending indicator
const searchStatus = Derived.create(() =>
  match(search.signal.state(), {
    Idle:    () => null,
    Pending: ({ draft }) => `Searching for "${draft}"...`,
    Settled: ({ value }) => `Results for "${value}"`,
  })
)
```

`results` depends on `search.signal.get()` — it only triggers a fetch when the value settles. `searchStatus` depends on `search.signal.state()` — it re-runs on every transition, including `Idle → Pending` where `get()` returns `null` both before and after.

---

## Building an optimistic update protocol

Optimistic updates need three states: **Confirmed** (server-acknowledged value), **Optimistic** (locally-applied, waiting for server confirmation), and **Conflicted** (server returned a value different from the optimistic one).

This is harder to fake with separate signals. The conflict state requires knowing both the local value and the server value simultaneously, and the right rendering depends on the relationship between them.

### Defining the state union

```ts
const OptimisticState = union({
  Confirmed:  (value: string) => ({ value }),
  Optimistic: (value: string, requestId: string) => ({ value, requestId }),
  Conflicted: (local: string, server: string, requestId: string) => ({ local, server, requestId }),
})
type OptimisticState = Union<typeof OptimisticState>
```

`Optimistic` carries a `requestId` so the server response can be matched against the outstanding request — stale responses from cancelled requests are ignored.

### The protocol and factory

```ts
const optimisticProtocol: SignalProtocol<OptimisticState, string> = {
  extract: (state) => match(state, {
    Confirmed:  ({ value }) => value,
    Optimistic: ({ value }) => value,   // show local value while pending
    Conflicted: ({ local }) => local,   // show local value while conflicted
  }),
}

type OptimisticHandle = {
  readonly signal: Signal<string, OptimisticState>
  apply(value: string, save: (v: string) => Promise<string>): void
  resolve(requestId: string, serverValue: string): void
  accept(): void   // accept local in a conflict
  revert(): void   // revert to server in a conflict
}

function createOptimisticSignal(initial: string): OptimisticHandle {
  const signal = Signal.create(
    OptimisticState.Confirmed(initial) as OptimisticState,
    optimisticProtocol,
  )

  function apply(value: string, save: (v: string) => Promise<string>): void {
    const requestId = crypto.randomUUID()
    signal.set(OptimisticState.Optimistic(value, requestId))

    save(value).then(
      (serverValue) => resolve(requestId, serverValue),
      () => {
        // Network failure — if still waiting on this request, revert
        const s = signal.peekState()
        match(s, {
          Optimistic: ({ requestId: rid }) => {
            if (rid === requestId) signal.set(OptimisticState.Confirmed(initial))
          },
          [__]: () => {},
        })
      },
    )
  }

  function resolve(requestId: string, serverValue: string): void {
    const s = signal.peekState()
    match(s, {
      Optimistic: ({ value, requestId: rid }) => {
        if (rid !== requestId) return  // stale response
        if (value === serverValue) {
          signal.set(OptimisticState.Confirmed(serverValue))
        } else {
          signal.set(OptimisticState.Conflicted(value, serverValue, requestId))
        }
      },
      [__]: () => {},
    })
  }

  function accept(): void {
    const s = signal.peekState()
    match(s, {
      Conflicted: ({ local }) => signal.set(OptimisticState.Confirmed(local)),
      [__]: () => {},
    })
  }

  function revert(): void {
    const s = signal.peekState()
    match(s, {
      Conflicted: ({ server }) => signal.set(OptimisticState.Confirmed(server)),
      [__]: () => {},
    })
  }

  return { signal, apply, resolve, accept, revert }
}
```

### Using the optimistic signal

```ts
const displayName = createOptimisticSignal("Alice")

// User edits their display name
saveButton.addEventListener("click", () => {
  const newName = nameInput.value
  displayName.apply(newName, (v) => api.updateDisplayName(v))
})

// Downstream — always sees the local value (confirmed or optimistic)
const greeting = Derived.create(() =>
  `Hello, ${displayName.signal.get() ?? "..."}`
)

// UI — shows conflict resolution UI when needed
const nameFieldState = Derived.create(() =>
  match(displayName.signal.state(), {
    Confirmed:  ({ value }) => ({ type: "stable", value }),
    Optimistic: ({ value }) => ({ type: "saving", value }),
    Conflicted: ({ local, server }) => ({
      type: "conflict",
      local,
      server,
      acceptLocal: () => displayName.accept(),
      acceptServer: () => displayName.revert(),
    }),
  })
)
```

`greeting` uses `.get()` — it only cares about the current display value, regardless of whether it's confirmed or optimistic. `nameFieldState` uses `.state()` — it needs to show different UI in each state, including the conflict resolution options.

---

## Composing protocol signals with Derived

Protocol signals compose with `Derived` the same way plain signals do. The key: use `.get()` in computations that only care about the extracted value, and `.state()` in computations that need the full state.

```ts
// Both signals power a single summary line
const searchSummary = Derived.create(() => {
  const searchState = search.signal.state()
  const nameState   = displayName.signal.state()

  const who = match(nameState, {
    Confirmed:  ({ value }) => value,
    Optimistic: ({ value }) => `${value} (saving)`,
    Conflicted: ({ local }) => `${local} (conflict)`,
  })

  return match(searchState, {
    Idle:    () => `${who} — no active search`,
    Pending: ({ draft }) => `${who} is searching for "${draft}"...`,
    Settled: ({ value }) => `${who} searched for "${value}"`,
  })
})
```

This works because `.state()` inside a `Derived` computation registers exactly the same kind of dependency as `.get()`. Whenever either signal transitions between states, `searchSummary` recomputes.

### Using `isTerminal` for one-shot signals

If a state is logically final — once reached, the signal should never change — use `isTerminal` in the protocol to freeze it permanently:

```ts
const ConfirmationState = union({
  Pending:   {},
  Confirmed: (code: string) => ({ code }),
  Expired:   {},
})
type ConfirmationState = Union<typeof ConfirmationState>

const confirmationProtocol: SignalProtocol<ConfirmationState, string> = {
  extract: (state) => match(state, {
    Pending:   () => null,
    Confirmed: ({ code }) => code,
    Expired:   () => null,
  }),
  isTerminal: (state) => match(state, {
    Pending:   () => false,
    Confirmed: () => true,  // once confirmed, freeze
    Expired:   () => true,  // once expired, freeze
  }),
}

const confirmation = Signal.create(
  ConfirmationState.Pending() as ConfirmationState,
  confirmationProtocol,
)

confirmation.set(ConfirmationState.Confirmed("abc-123"))
confirmation.set(ConfirmationState.Pending())  // no-op — terminal state is frozen
```

After a terminal `set()`, the signal is permanently frozen: all subscribers are cleared and future writes are silently ignored. This is useful for one-shot workflows — email verification, payment authorization — where state should only move forward.

---

## When to use a protocol

A custom protocol is worth the ceremony when:

- The signal has more than two meaningful states and the distinction matters to rendering or downstream logic
- State transitions need to carry associated data (a timer ID, a request ID, a conflict pair)
- You want `isTerminal` semantics — a signal that permanently freezes once a condition is met
- The signal's state is a domain concept, not just an implementation detail

For simpler cases — a boolean toggle, a nullable value, a value that's either set or not — the default `SignalState<T>` is the right choice. The goal is to encode the complexity that already exists in your domain, not to introduce new complexity.

---

## See also

- [Reactive UI](./reactive-ui.md) — composing protocol signals in a reactive graph with Ref and AsyncDerived
- [Resource Lifetime](./resource-lifetime.md) — disposing protocol signals when their owner unmounts
- [API Reference: Signal](../../api/prelude/signal.md)
