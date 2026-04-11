import { union, Trait, type Variant } from "../union.ts";
import { match } from "../match.ts";

export abstract class Traversable<T> extends Trait<{ value: unknown }>() {
    map<U>(fn: (value: T) => U): Tree<U> {
        return match(this as unknown as Tree<T>, {
            Leaf: ({ value }) => Tree.Leaf(fn(value)),
            Branch: ({ value, left, right }) =>
                Tree.Branch(fn(value), left.map(fn), right.map(fn)),
        }) as Tree<U>;
    }

    fold<U>(fn: (acc: U, value: T) => U, initial: U): U {
        return match(this as unknown as Tree<T>, {
            Leaf: ({ value }) => fn(initial, value),
            Branch: ({ value, left, right }) => {
                const rootAcc = fn(initial, value);
                const leftAcc = left.fold(fn, rootAcc);
                return right.fold(fn, leftAcc);
            },
        });
    }

    depth(): number {
        return match(this as unknown as Tree<T>, {
            Leaf: () => 0,
            Branch: ({ left, right }) =>
                1 + Math.max(left.depth(), right.depth()),
        });
    }
}

export type Leaf<T> = Variant<"Leaf", { value: T }, Traversable<T>>;
export type Branch<T> = Variant<
    "Branch",
    { value: T; left: Tree<T>; right: Tree<T> },
    Traversable<T>
>;
export type Tree<T> = Leaf<T> | Branch<T>;

export const Tree = union([Traversable]).typed({
    Leaf: <T>(value: T) => ({ value }) as Leaf<T>,
    Branch: <T>(value: T, left: Tree<T>, right: Tree<T>) =>
        ({ value, left, right }) as Branch<T>,
});
