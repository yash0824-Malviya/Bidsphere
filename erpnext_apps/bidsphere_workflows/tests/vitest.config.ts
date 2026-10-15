import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { include: ["erpnext_apps/bidsphere_workflows/tests/*.test.ts", "erpnext_apps/bidsphere_workflows/tests/*.test.mjs"] },
});
