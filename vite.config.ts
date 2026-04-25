import { defineConfig } from "vite";
import { resolve } from "path";
import dts from "vite-plugin-dts";

export default defineConfig({
    publicDir: false,
    build: {
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
            include: ["src"],
            tsconfigPath: "./tsconfig.build.json",
        }),
    ],
});
