/** @jsxImportSource aljabr/ui/dom */
import { union, match, type Union, Ref, watchEffect } from "aljabr";
import { createRenderer } from "aljabr/ui";
import { domHost } from "aljabr/ui/dom";
import logo from "./logo-flat-sm-transparent.png";
import { signal } from "aljabr/signals";
// ---------------------------------------------------------------------------
// Domain — Task as a union
// ---------------------------------------------------------------------------

const Task = union({
    Active: (id: number, text: string) => ({ id, text }),
    Done: (id: number, text: string) => ({ id, text }),
});
type Task = Union<typeof Task>;
const { Active, Done } = Task;

function toggleTask(task: Task): Task {
    // console.log(task);
    return match(task, {
        Active: ({ id, text }) => Done(id, text),
        Done: ({ id, text }) => Active(id, text),
    });
}

function taskId(task: Task): number {
    return match(task, {
        Active: ({ id }) => id,
        Done: ({ id }) => id,
    });
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

type Filter = "all" | "active" | "done";
let nextId = 1;

const tasks = Ref.create<Task[]>([]);
const [input, setInput] = signal("");
const [filter, setFilter] = signal<Filter>("all");

function addTask() {
    const text = input()?.trim();
    if (!text) return;
    tasks.push(Active(nextId++, text));
    setInput("");
}
function find(task: Task) {
    return tasks.findIndex((t) => taskId(t) === taskId(task));
}
function toggle(task: Task) {
    return find(task).flatMap((idx) => tasks.set(idx, toggleTask(task)));
}

function remove(task: Task) {
    return find(task).map((idx) => tasks.splice(idx, 1));
}

// ---------------------------------------------------------------------------
// Reactive derived list
// ---------------------------------------------------------------------------

const visibleTasks = tasks.filter(
    (task) => {
        const f = filter();
        return match(task, {
            Active: () => f === "all" || f === "active",
            Done: () => f === "all" || f === "done",
        });
    },
    { key: taskId },
);

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

function TaskItem({ task }: { task: Task }) {
    return match(task, {
        Active: ({ text }) => (
            <li class="task-item">
                <button class="check" onClick={() => toggle(task)}>
                    <span class="check-icon"></span>
                </button>
                <span class="task-text">{text}</span>
                <button class="remove" onClick={() => remove(task)}>
                    ×
                </button>
            </li>
        ),
        Done: ({ text }) => (
            <li class="task-item done">
                <button class="check checked" onClick={() => toggle(task)}>
                    <span class="check-icon">✓</span>
                </button>
                <span class="task-text">{text}</span>
                <button class="remove" onClick={() => remove(task)}>
                    ×
                </button>
            </li>
        ),
    });
}

function FilterButton({ value, label }: { value: Filter; label: string }) {
    return (
        <button
            class={() => `filter-btn${filter() === value ? " selected" : ""}`}
            onClick={() => setFilter(value)}
        >
            {label}
        </button>
    );
}

const rows = visibleTasks.map((task) => <TaskItem task={task} />);

// ---------------------------------------------------------------------------
// Mount
// ---------------------------------------------------------------------------

const { mount } = createRenderer(domHost);

mount(
    () => (
        <div class="app">
            <header class="header">
                <img src={logo} />
                <h1 class="title">
                    <span class="title-accent">aljabr</span> todo
                </h1>
                <p class="subtitle">union · match · signal</p>
            </header>

            <div class="input-row">
                <input
                    type="text"
                    class="task-input"
                    placeholder="What needs to be done?"
                    value={() => input()}
                    onInput={(e: any) => setInput(e.target.value)}
                    onKeyDown={(e: any) => e.key === "Enter" && addTask()}
                />
                <button class="add-btn" onClick={addTask}>
                    Add
                </button>
            </div>

            <ul class="task-list">{rows}</ul>

            <footer class="footer">
                <span class="count">
                    {() => {
                        const total = tasks.length();
                        const done = tasks
                            .filter((t) =>
                                match(t, {
                                    Active: () => false,
                                    Done: () => true,
                                }),
                            )
                            .length();
                        return `${done}/${total} done`;
                    }}
                </span>
                <div class="filters">
                    <FilterButton value="all" label="All" />
                    <FilterButton value="active" label="Active" />
                    <FilterButton value="done" label="Done" />
                </div>
            </footer>
        </div>
    ),
    document.getElementById("root")!,
);

watchEffect(
    async () => {
        console.log(rows.get());
    },
    () => {
        console.log("done");
    },
);
// // const t!:Ref<Task[]>
// tasks.push(Task.Active(1, "hello"));
// console.log(Task.Active(1, "hello"));
