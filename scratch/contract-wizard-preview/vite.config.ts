import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve, dirname } from "node:path";
import tailwindcss from "tailwindcss";
import autoprefixer from "autoprefixer";
import theme from "../../tailwind.config.js";

const workspace = process.cwd();
const fixture = resolve(workspace, "scratch/contract-wizard-preview");
const replacements = new Map([
  [resolve(workspace, "src/api/clm"), resolve(fixture, "apiStub.ts")],
  [resolve(workspace, "src/api/legalDocsStorage"), resolve(fixture, "uploadStub.ts")],
  [resolve(workspace, "src/store/authStore"), resolve(fixture, "authStub.ts")],
]);

export default defineConfig({
  root: fixture,
  cacheDir: resolve(fixture, ".vite"),
  plugins: [{ name: "isolated-contract-ui-stubs", enforce: "pre", resolveId(source, importer) {
    if (!importer || !source.startsWith(".")) return;
    const resolved = resolve(dirname(importer.split("?")[0]), source).replace(/\.(?:tsx?|jsx?)$/, "");
    return replacements.get(resolved);
  } }, react()],
  css: { postcss: { plugins: [tailwindcss({ ...theme, content: [resolve(workspace, "src/**/*.{ts,tsx}"), resolve(fixture, "*.{html,ts,tsx}")] }), autoprefixer()] } },
  server: { host: "localhost", port: 5187, strictPort: true, fs: { allow: [workspace] } },
});
