import { defineConfig } from "vitest/config";
export default defineConfig({ test: { environment: "node", include: ["scratch/contract-pdf-signed-qa.check.ts"] } });
