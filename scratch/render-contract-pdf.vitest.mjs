import { defineConfig } from "vitest/config";
export default defineConfig({ test: { environment: "node", include: ["scratch/render-contract-pdf.check.ts"], testTimeout: 30000 } });
