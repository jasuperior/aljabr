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
