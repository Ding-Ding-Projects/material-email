import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig({
  root: "src/renderer",
  base: "./",
  build: {
    outDir: resolve(import.meta.dirname, "dist/renderer"),
    emptyOutDir: true,
    sourcemap: true,
  },
});

