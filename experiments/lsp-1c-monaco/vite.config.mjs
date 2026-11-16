import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

// Builds the probe page with the repository's pinned monaco-editor. Output goes to
// PROBE_OUT (run.sh sets it to a scratch directory); nothing under src/ is touched.
export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  base: "./",
  build: { rollupOptions: { input: { index: fileURLToPath(new URL("./index.html", import.meta.url)), f3: fileURLToPath(new URL("./f3.html", import.meta.url)), f3product: fileURLToPath(new URL("./f3product.html", import.meta.url)), refs: fileURLToPath(new URL("./refs.html", import.meta.url)), buffer: fileURLToPath(new URL("./buffer.html", import.meta.url)) } }, outDir: process.env.PROBE_OUT ?? "dist", emptyOutDir: true, target: "es2022" },
  worker: { format: "es" },
});
