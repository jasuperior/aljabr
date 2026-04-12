# API Reference: Tree

```ts
import { Tree, type Leaf, type Branch } from "aljabr/prelude"
```

---

## Overview

`Tree<T>` is a recursive binary tree union with two variants: `Leaf` (a terminal node with a value) and `Branch` (an interior node with a value and two child subtrees). All variants share `map`, `fold`, and `depth` via the `Traversable<T>` impl mixin.

---

## Variants

### `Tree.Leaf<T>`

A terminal node holding a single value.

```ts
Tree.Leaf<T>(value: T): Leaf<T>
```

| Property | Type | Description |
|---|---|---|
| `value` | `T` | The node's value |

### `Tree.Branch<T>`

An interior node with a value and two child subtrees.

```ts
Tree.Branch<T>(value: T, left: Tree<T>, right: Tree<T>): Branch<T>
```

| Property | Type | Description |
|---|---|---|
| `value` | `T` | The node's value |
| `left` | `Tree<T>` | The left subtree |
| `right` | `Tree<T>` | The right subtree |

---

## Type definitions

```ts
type Leaf<T>   = Variant<"Leaf",   { value: T },                              Traversable<T>>
type Branch<T> = Variant<"Branch", { value: T; left: Tree<T>; right: Tree<T>}, Traversable<T>>
type Tree<T>   = Leaf<T> | Branch<T>
```

---

## `Traversable<T>` — shared behavior

### `.map<U>(fn)`

```ts
.map<U>(fn: (value: T) => U): Tree<U>
```

Apply a function to every node value, preserving the tree structure.

```ts
const nums = Tree.Branch(1, Tree.Leaf(2), Tree.Leaf(3))

const doubled = nums.map(n => n * 2)
// Branch(2, Leaf(4), Leaf(6))
```

### `.fold<U>(fn, initial)`

```ts
.fold<U>(fn: (acc: U, value: T) => U, initial: U): U
```

Reduce the tree to a single value using pre-order traversal (root → left → right).

```ts
const tree = Tree.Branch(
    1,
    Tree.Branch(2, Tree.Leaf(4), Tree.Leaf(5)),
    Tree.Leaf(3),
)

const sum = tree.fold((acc, v) => acc + v, 0)
// 1 + 2 + 4 + 5 + 3 = 15

const values = tree.fold((acc, v) => [...acc, v], [] as number[])
// [1, 2, 4, 5, 3] — pre-order
```

### `.depth()`

```ts
.depth(): number
```

Return the height of the tree: `0` for a `Leaf`, `1 + max(left.depth(), right.depth())` for a `Branch`.

```ts
Tree.Leaf(1).depth()    // 0

Tree.Branch(
    1,
    Tree.Branch(2, Tree.Leaf(4), Tree.Leaf(5)),
    Tree.Leaf(3),
).depth()               // 2
```

---

## Pattern matching

```ts
import { match } from "aljabr"

match(tree, {
    Leaf:   ({ value }) => `leaf: ${value}`,
    Branch: ({ value, left, right }) => `branch(${value})`,
})
```

---

## Examples

### Building an expression tree

```ts
type Expr = number | ["add", Expr, Expr] | ["mul", Expr, Expr]

const exprTree = Tree.Branch(
    "add" as const,
    Tree.Branch("mul" as const, Tree.Leaf(2), Tree.Leaf(3)),
    Tree.Leaf(4),
)

// Evaluate: (2 * 3) + 4
function evaluate(t: Tree<number | "add" | "mul">): number {
    return match(t, {
        Leaf: ({ value }) => value as number,
        Branch: ({ value, left, right }) => {
            const l = evaluate(left as Tree<number>)
            const r = evaluate(right as Tree<number>)
            return value === "add" ? l + r : l * r
        },
    })
}
```

### Collecting all leaf values

```ts
const leaves = tree.fold<number[]>(
    (acc, v) => acc,  // skip in fold — fold visits every node
    [],
)

// For leaves only, use match recursively:
function collectLeaves<T>(t: Tree<T>): T[] {
    return match(t, {
        Leaf:   ({ value }) => [value],
        Branch: ({ left, right }) => [
            ...collectLeaves(left),
            ...collectLeaves(right),
        ],
    })
}
```

### Transforming and measuring

```ts
const tree = Tree.Branch(
    10,
    Tree.Branch(5, Tree.Leaf(1), Tree.Leaf(3)),
    Tree.Leaf(20),
)

const stringified = tree.map(n => `(${n})`)
// Branch("(10)", Branch("(5)", Leaf("(1)"), Leaf("(3)")), Leaf("(20)"))

tree.depth()  // 2
tree.fold((acc, n) => Math.max(acc, n), 0)  // 20
```

---

## See also

- [`match`](../match.md) — pattern match on `Leaf` and `Branch`
- [`union`](../union.md) — how `Tree` is built with `.typed()` for recursive generic types
