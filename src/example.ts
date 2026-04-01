
import { __, union, getTag, when, pred, type Union } from "./union.ts";
import { match } from "./match.ts";

// --- Define your behaviors ---

class BaseEvent {
    name!: string;
    timestamp?: number = Date.now();

    log() {
        console.log(`[${this.timestamp}] ${getTag(this as any)} fired.`);
    }
}

class Monad {
    // A simple mapping method as an example
    map<T>(fn: (val: this) => T): T {
        return fn(this);
    }
}

// --- Define the Union ---

// export const WebEvent = union({
//     PageLoad: { name: "Loading " },
//     KeyPress: (key: string) => ({ key }),
//     Click: (x: number, y: number) => ({ x, y }),

//     impl: [Monad, BaseEvent], // Pass as many as you want!
// });
export const WebEvent = union({
    PageLoad: { name: "jhkjh" },
    KeyPress: (key: string) => ({ key, name: "hkjh" }),
    Click: (x: number, y: number) => ({ x, y, name: "" }),

    impl: [Monad, BaseEvent], // Pass as many as you want!
});
WebEvent.KeyPress("Enter");

export type WebEvent<T extends keyof typeof WebEvent | never = never> = Union<
    typeof WebEvent,
    T
>;

let x = WebEvent.PageLoad() as WebEvent;
// x.log
let y = match(x, {
    KeyPress: [
        when(
            { key: pred((k): k is "Enter" => k === "Enter") },
            ({ key }) => key,
        ),
        when(
            (v) => v.key.length > 0,
            ({ key }) => key,
        ),
        when(__, () => ""),
    ],
    // Click: ()=> "",
    // PageLoad: ()=> ""
    [__]: () => "nil",
});
console.log(y);
