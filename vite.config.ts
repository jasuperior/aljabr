import { defineConfig } from "vite";
import { resolve } from "path";
import dts from "vite-plugin-dts";

export default defineConfig(({ command }) => {
    if (command === "serve") {
        return {
            root: resolve(__dirname, "public"),
            publicDir: false,
            server: {
                fs: { allow: [resolve(__dirname)] },
            },
            resolve: {
                // Most-specific entries must come first — Vite uses prefix matching
                // and the first match wins.
                alias: [
                    { find: "aljabr/ui/jsx-dev-runtime", replacement: resolve(__dirname, "src/ui/jsx-dev-runtime.ts") },
                    { find: "aljabr/ui/jsx-runtime",     replacement: resolve(__dirname, "src/ui/jsx-runtime.ts") },
                    { find: "aljabr/ui/dom",             replacement: resolve(__dirname, "src/ui/dom/index.ts") },
                    { find: "aljabr/ui",                 replacement: resolve(__dirname, "src/ui/index.ts") },
                    { find: "aljabr/prelude",            replacement: resolve(__dirname, "src/prelude/index.ts") },
                    { find: "aljabr/signals",            replacement: resolve(__dirname, "src/signals/index.ts") },
                    { find: "aljabr/schema",             replacement: resolve(__dirname, "src/schema/index.ts") },
                    { find: "aljabr",                    replacement: resolve(__dirname, "src/main.ts") },
                ],
            },
        };
    }

    return {
        publicDir: false,
        build: {
            outDir: resolve(__dirname, "dist"),
            lib: {
                entry: {
                    index: resolve(__dirname, "src/main.ts"),
                    prelude: resolve(__dirname, "src/prelude/index.ts"),
                    schema: resolve(__dirname, "src/schema/index.ts"),
                    signals: resolve(__dirname, "src/signals/index.ts"),
                    ui: resolve(__dirname, "src/ui/index.ts"),
                    "ui-dom": resolve(__dirname, "src/ui/dom/index.ts"),
                    "ui-jsx-runtime": resolve(__dirname, "src/ui/jsx-runtime.ts"),
                    "ui-jsx-dev-runtime": resolve(__dirname, "src/ui/jsx-dev-runtime.ts"),
                },
                formats: ["es", "cjs"],
            },
        },
        plugins: [
            dts({
                include: [resolve(__dirname, "src")],
                tsconfigPath: resolve(__dirname, "tsconfig.build.json"),
            }),
        ],
    };
});
