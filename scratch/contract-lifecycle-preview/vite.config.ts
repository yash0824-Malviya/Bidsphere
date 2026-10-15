import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
import tailwindcss from "tailwindcss";
import autoprefixer from "autoprefixer";
import theme from "../../tailwind.config.js";
const workspace = process.cwd(), fixture = resolve(workspace, "scratch/contract-lifecycle-preview");
export default defineConfig({ root: fixture, cacheDir: resolve(fixture, ".vite"), plugins: [react()], css: { postcss: { plugins: [tailwindcss({ ...theme, content: [resolve(workspace, "src/**/*.{ts,tsx}"), resolve(fixture, "*.{html,ts,tsx}")] }), autoprefixer()] } }, server: { host: "localhost", port: 5197, strictPort: true, fs: { allow: [workspace] } } });
