import "./style.css";
import typescriptLogo from "./assets/typescript.svg";
import viteLogo from "./assets/vite.svg";
import heroImg from "./assets/hero.png";
import { setupCounter } from "./counter.ts";
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

let y = match(x, {
    KeyPress: [
        when(
            { key: pred((k): k is "Enter" => k === "Enter") },
            ({ key }) => key,
        ),
        when((v) => v.key.length > 0, ({ key }) => key),
        when(__, () => ""),
    ],
    [__]: () => "nil",
});
console.log(y);

document.querySelector<HTMLDivElement>("#app")!.innerHTML = `
<section id="center">
  <div class="hero">
    <img src="${heroImg}" class="base" width="170" height="179">
    <img src="${typescriptLogo}" class="framework" alt="TypeScript logo"/>
    <img src=${viteLogo} class="vite" alt="Vite logo" />
  </div>
  <div>
    <h1>Get started</h1>
    <p>Edit <code>src/main.ts</code> and save to test <code>HMR</code></p>
  </div>
  <button id="counter" type="button" class="counter"></button>
</section>

<div class="ticks"></div>

<section id="next-steps">
  <div id="docs">
    <svg class="icon" role="presentation" aria-hidden="true"><use href="/icons.svg#documentation-icon"></use></svg>
    <h2>Documentation</h2>
    <p>Your questions, answered</p>
    <ul>
      <li>
        <a href="https://vite.dev/" target="_blank">
          <img class="logo" src=${viteLogo} alt="" />
          Explore Vite
        </a>
      </li>
      <li>
        <a href="https://www.typescriptlang.org" target="_blank">
          <img class="button-icon" src="${typescriptLogo}" alt="">
          Learn more
        </a>
      </li>
    </ul>
  </div>
  <div id="social">
    <svg class="icon" role="presentation" aria-hidden="true"><use href="/icons.svg#social-icon"></use></svg>
    <h2>Connect with us</h2>
    <p>Join the Vite community</p>
    <ul>
      <li><a href="https://github.com/vitejs/vite" target="_blank"><svg class="button-icon" role="presentation" aria-hidden="true"><use href="/icons.svg#github-icon"></use></svg>GitHub</a></li>
      <li><a href="https://chat.vite.dev/" target="_blank"><svg class="button-icon" role="presentation" aria-hidden="true"><use href="/icons.svg#discord-icon"></use></svg>Discord</a></li>
      <li><a href="https://x.com/vite_js" target="_blank"><svg class="button-icon" role="presentation" aria-hidden="true"><use href="/icons.svg#x-icon"></use></svg>X.com</a></li>
      <li><a href="https://bsky.app/profile/vite.dev" target="_blank"><svg class="button-icon" role="presentation" aria-hidden="true"><use href="/icons.svg#bluesky-icon"></use></svg>Bluesky</a></li>
    </ul>
  </div>
</section>

<div class="ticks"></div>
<section id="spacer"></section>
`;

setupCounter(document.querySelector<HTMLButtonElement>("#counter")!);
