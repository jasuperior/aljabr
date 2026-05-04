# API Reference: Dispatcher

```ts
import { Dispatcher, type CommandProtocol, type ApplyResult } from "aljabr/prelude"
```

---

## Overview

`Dispatcher<T, S, Cmd>` is a reactive container whose writes route through a typed `apply` function returning `Validation<ApplyResult<S, Cmd>, CommandError>`.

Where [`Signal`](./signal.md) treats writes as state replacements (`signal.set(newState)` overwrites whatever was there), `Dispatcher` treats writes as **discrete, named, validated operations**. Authors define a `Cmd` union; every write goes through `dispatch(cmd)`, which routes through the protocol's `apply` and either commits a state transition or rejects with a structured error list.

This shape is the foundation for any domain that wants:

- **Validated writes** — "this transition is illegal in the current state"
- **Discrete write history** — every change has a typed name
- **Inverses for undo** — `apply` produces both the next state and the inverse command in one pass
- **Rejectable transactions** — return `Validation.Invalid(errors)` from `apply` to leave state unchanged

The first production consumer is the prose renderer's document state (lifting off in v0.4.0). Form validation, multi-step wizards, and state machines with non-trivial transition rules are equally good fits.

---

## `Dispatcher.create()`

```ts
Dispatcher.create<T, S, Cmd>(
    initial: S,
    protocol: CommandProtocol<S, T, Cmd>,
): Dispatcher<T, S, Cmd>
```

Creates a new dispatcher with an initial state and a protocol. If created inside a reactive owner, the dispatcher is automatically disposed when the owner is disposed.

```ts
const counter = Dispatcher.create(0, counterProtocol)
```

---

## `CommandProtocol<S, T, Cmd>`

```ts
type CommandProtocol<S, T, Cmd> = {
    extract: (state: S) => T | null
    apply: (current: S, command: Cmd) => Validation<ApplyResult<S, Cmd>, CommandError>
    isTerminal?: (state: S) => boolean
}
```

- `extract` — produce the readable value from the current state. Return `null` if no value is available in this state.
- `apply` — given the current state and a dispatched command, return either `Validation.Valid({ next, inverse })` to commit the transition or `Validation.Invalid(errors)` to reject. The inverse is a command that, when dispatched against `next`, returns the state to `current` — this is what makes undo work.
- `isTerminal` (optional) — return `true` to mark a state as terminal. Once a state is terminal, the dispatcher is disposed and further `dispatch` calls throw.

`CommandProtocol` is a strict superset of [`SignalProtocol`](./signal.md) — `extract` and `isTerminal` have the same semantics. The new slot is `apply`.

---

## `ApplyResult<S, Cmd>`

```ts
type ApplyResult<S, Cmd> = {
    next: S
    inverse: Cmd
}
```

The success payload returned by `apply`. The `inverse` is itself a command in the same union — undoing a dispatch goes through the same `dispatch` pipeline as the forward operation.

---

## `dispatch()`

```ts
dispatch(command: Cmd): Validation<ApplyResult<S, Cmd>, CommandError>
```

Routes the command through `protocol.apply` and returns the resulting `Validation`.

- On `Valid` — internal state is updated to `result.next` and dependents are notified.
- On `Invalid` — state is unchanged and no notification fires.

Authors decide whether to inspect failures or fire-and-forget. Most editor-side dispatches will ignore the return value; validation-heavy domains pattern-match on it.

```ts
match(counter.dispatch(Counter.Increment()), {
    Valid: ({ value: { next, inverse } }) => log(`now ${next}; undo by dispatching`, inverse),
    Invalid: ({ errors }) => display(errors),
    Unvalidated: () => {},
})
```

Throws if the dispatcher has been disposed.

---

## Read API

```ts
get(): T | null              // tracked — registers a dependency
state(): S                   // tracked — registers a dependency, returns full state
peekState(): S               // untracked — safe outside reactive contexts
```

Mirrors [`Signal`](./signal.md)'s read surface:

- `get()` returns `T | null` (the extracted value).
- `state()` returns the full `S` for pattern-matching inside reactive contexts.
- `peekState()` is the untracked variant for use outside reactive owners.

---

## Worked example: bounded counter

```ts
import { Dispatcher, CommandError } from "aljabr/prelude"
import { Validation, union, match, type Union } from "aljabr"

const Counter = union({
    Increment: () => ({}),
    Decrement: () => ({}),
    Set: (n: number) => ({ n }),
})
type CounterCmd = Union<typeof Counter>

const counter = Dispatcher.create(0, {
    extract: (n: number) => n,
    apply: (current, cmd) =>
        match(cmd, {
            Increment: () =>
                current >= 10
                    ? Validation.Invalid([CommandError.Rejected("max reached")])
                    : Validation.Valid({
                          next: current + 1,
                          inverse: Counter.Decrement(),
                      }),
            Decrement: () =>
                current <= 0
                    ? Validation.Invalid([CommandError.Rejected("min reached")])
                    : Validation.Valid({
                          next: current - 1,
                          inverse: Counter.Increment(),
                      }),
            Set: ({ n }) =>
                Validation.Valid({
                    next: n,
                    inverse: Counter.Set(current),
                }),
        }),
})

counter.dispatch(Counter.Increment())  // Valid; state = 1
counter.dispatch(Counter.Set(99))      // Valid; state = 99
counter.dispatch(Counter.Increment())  // Invalid (Rejected("max reached")); state = 99

// Undo via the inverse
match(counter.dispatch(Counter.Decrement()), {
    Valid: ({ value: { inverse } }) => counter.dispatch(inverse),
    [__]: () => {},
})
```

---

## Worked example: form field with validation

```ts
const Field = union({
    Edit: (value: string) => ({ value }),
    Validate: () => ({}),
})

const field = Dispatcher.create(
    Validation.Unvalidated<string, string>(),
    {
        extract: (state) =>
            match(state, {
                Valid: ({ value }) => value,
                [__]: () => null,
            }),
        apply: (current, cmd) =>
            match(cmd, {
                Edit: ({ value }) =>
                    Validation.Valid({
                        next: Validation.Unvalidated<string, string>(),
                        inverse: Field.Edit(extract(current) ?? ""),
                    }),
                Validate: () => {
                    const value = extract(current)
                    if (value === null)
                        return Validation.Invalid([
                            CommandError.Rejected("cannot validate empty"),
                        ])
                    if (!value.includes("@"))
                        return Validation.Valid({
                            next: Validation.Invalid<string, string>(["not an email"]),
                            inverse: Field.Edit(value),
                        })
                    return Validation.Valid({
                        next: Validation.Valid<string, string>(value),
                        inverse: Field.Edit(value),
                    })
                },
            }),
    },
)
```

---

## Disposal

```ts
counter.dispose()
counter.dispatch(...)  // throws — cannot dispatch on a disposed dispatcher
```

Dispatchers created inside a reactive owner are auto-disposed when the owner is disposed. Manually dispose to release subscribers early.

If `protocol.isTerminal(state)` returns `true` after a successful `apply`, the dispatcher is disposed automatically.
