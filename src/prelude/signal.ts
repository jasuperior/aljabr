import { union, Trait, type Variant } from "../union.ts";
import { match } from "../match.ts";

export abstract class Lifecycle<T> extends Trait<{ value: unknown }>() {
    isActive(): boolean {
        return match(this as unknown as Signal<T>, {
            Unset: () => false,
            Active: () => true,
            Disposed: () => false,
        });
    }

    get(): T | null {
        return match(this as unknown as Signal<T>, {
            Unset: () => null,
            Active: ({ value }) => value,
            Disposed: () => null,
        });
    }
}

export type Unset = Variant<"Unset", { value: null }, Lifecycle<never>>;
export type Active<T> = Variant<"Active", { value: T }, Lifecycle<T>>;
export type Disposed = Variant<"Disposed", { value: null }, Lifecycle<never>>;
export type Signal<T> = Unset | Active<T> | Disposed;

export const Signal = union([Lifecycle]).typed({
    Unset: () => ({ value: null }) as Unset,
    Active: <T>(value: T) => ({ value }) as Active<T>,
    Disposed: () => ({ value: null }) as Disposed,
});
