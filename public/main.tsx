/** @jsxImportSource aljabr/ui/dom */
import { Renderer } from "aljabr/ui";
import { DomHost } from "aljabr/ui/dom";
import { defer } from "aljabr/prelude";
import { signal } from "aljabr/signals";
import logo from "./logo-flat-sm-transparent.png";
import { Todo } from "./todo.tsx";
import { mountDiagram } from "./canvas.tsx";

// ---------------------------------------------------------------------------
// Tab state
// ---------------------------------------------------------------------------

type Tab = "todo" | "diagram";
const [activeTab, setActiveTab] = signal<Tab>("todo");

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

function TabButton({ value, label }: { value: Tab; label: string }) {
    return (
        <button
            class={() => `tab-btn${activeTab() === value ? " active" : ""}`}
            onClick={() => setActiveTab(value)}
        >
            {label}
        </button>
    );
}

function DiagramPanel() {
    return (
        <canvas
            width={800}
            height={500}
            class="diagram-canvas"
            mounted={(el) => {
                const dispose = mountDiagram(el as HTMLCanvasElement);
                defer(dispose);
            }}
        />
    );
}

function App() {
    return (
        <div class="app">
            <header class="header">
                <img src={logo} />
                <h1 class="title">
                    <span class="title-accent">aljabr</span> demo
                </h1>
                <p class="subtitle">union · match · signal</p>
            </header>

            <nav class="tabs">
                <TabButton value="todo" label="Todo" />
                <TabButton value="diagram" label="Canvas" />
            </nav>

            {() => activeTab() === "todo" ? <Todo /> : <DiagramPanel />}
        </div>
    );
}

// ---------------------------------------------------------------------------
// Mount
// ---------------------------------------------------------------------------

const { mount } = Renderer.create(DomHost);
mount(() => <App />, document.getElementById("root")!);
