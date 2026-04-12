# API Reference: Reactive Context

```ts
import { batch, runInContext, createOwner } from "aljabr/prelude"
```

---

## Overview

The reactive context utilities give you control over how and when signal notifications fire, and how reactive ownership propagates across async boundaries. In most applications you only need `batch` — the other two are escape hatches for advanced ownership management.

---

## `batch`

```ts
function batch(fn: () => void): void
```

Defer all signal notifications until `fn` returns. Dependents are notified exactly once after the batch completes, regardless of how many of their dependencies were written to inside `fn`.

Nested `batch()` calls are safe — the flush only runs when the outermost batch exits.

```ts
import { batch } from "aljabr/prelude"

const x = Signal.create(1)
const y = Signal.create(2)
const sum = Derived.create(() => (x.get() ?? 0) + (y.get() ?? 0))

// Without batch: `sum` would re-evaluate after each set
batch(() => {
    x.set(10)
    y.set(20)
})
// `sum` re-evaluates once here, not twice
sum.get() // 30
```

### When to use batch

- When you need to write to multiple signals that share a downstream computation and want to avoid intermediate re-evaluations.
- In event handlers that update several pieces of state at once (e.g. a form submission that clears several fields).
- Anywhere you can reason that the intermediate states between writes are meaningless to downstream consumers.

---

## `createOwner`

```ts
function createOwner(parent?: Computation | null): Computation
```

Create a new node in the reactive owner tree. Signals and derived values created inside a reactive computation are automatically parented to it and disposed when the owner is disposed.

Passing `null` creates a **root owner** with no parent. Omitting `parent` (or passing `undefined`) uses the currently active computation as the parent.

Returns a `Computation` handle whose `dispose()` method tears down the entire subtree: all children, signal subscriptions, and cleanup callbacks registered by owned resources.

```ts
import { createOwner } from "aljabr/prelude"

const root = createOwner(null)

// Signals and deriveds created inside runInContext(root, ...) are owned by root
runInContext(root, () => {
    const count = Signal.create(0)     // owned by root
    const doubled = Derived.create(() => count.get()! * 2) // owned by root
})

// Disposes count, doubled, and all their subscriptions
root.dispose()
```

### `Computation`

The value returned by `createOwner`. You rarely need to interact with it directly beyond calling `.dispose()`. The relevant surface:

```ts
type Computation = {
    dispose(): void
    // Internal tracking — do not mutate directly
}
```

---

## `runInContext`

```ts
function runInContext<T>(owner: Computation, fn: () => T): T
```

Execute `fn` with `owner` as the active tracking context. Signal reads inside `fn` register `owner` as a subscriber, and `Signal.create()` / `Derived.create()` calls inside `fn` are owned by `owner`.

This is the primary tool for preserving reactive ownership across async boundaries. Reactive tracking only works synchronously — after an `await`, you are no longer inside the original computation context. `runInContext` lets you re-enter it.

```ts
import { createOwner, runInContext } from "aljabr/prelude"

const owner = createOwner(null)

// Set up some async work
async function setupReactiveData() {
    const rawData = await fetchConfig()

    // Re-enter the owner after the await
    runInContext(owner, () => {
        const config = Signal.create(rawData) // owned by `owner`
        const derived = Derived.create(() => processConfig(config.get()))
    })
}

// Later, owner.dispose() cleans up config and derived
```

### Worker and setTimeout boundaries

The same pattern applies across any async boundary where the call stack is broken:

```ts
const owner = createOwner(null)

setTimeout(() => {
    // No active computation here — use runInContext to restore
    runInContext(owner, () => {
        const tick = Signal.create(Date.now())
    })
}, 1000)
```

---

## Examples

### Batched form reset

```ts
import { Signal, Derived, batch } from "aljabr/prelude"

const name    = Signal.create("")
const email   = Signal.create("")
const message = Signal.create("")
const isValid = Derived.create(() =>
    name.get()!.length > 0 &&
    email.get()!.includes("@") &&
    message.get()!.length > 0
)

function resetForm() {
    batch(() => {
        name.set("")
        email.set("")
        message.set("")
    })
    // isValid re-evaluates once: false
}
```

### Scoped reactive subtree

```ts
import { createOwner, runInContext, Signal, Derived } from "aljabr/prelude"

function createUserScope(userId: number) {
    const scope = createOwner(null)

    runInContext(scope, () => {
        const user   = Signal.create<User | null>(null)
        const name   = Derived.create(() => user.get()?.name ?? "Loading...")

        fetchUser(userId).then(u => user.set(u))

        return { user, name }
    })

    return {
        dispose: () => scope.dispose(),
    }
}

const userScope = createUserScope(42)
// Later, when the user navigates away:
userScope.dispose() // cleans up user, name, and all subscriptions
```

---

## See also

- [`Signal`](./signal.md) — the reactive source values that notifications propagate through
- [`Derived`](./derived.md) — lazy computed values that subscribe to signals
- [`watchEffect`](./effect.md#watcheffect) — reactive async effect runner
