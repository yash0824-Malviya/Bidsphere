import { defineConfig } from 'vitest/config';

export default defineConfig({ test: { environment: 'node', include: ['erpnext_apps/bidsphere_workflows/tests/**/*.test.mjs'] } });
