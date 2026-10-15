import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['scratch/rfq95-clm-summary.check.ts'], maxWorkers: 1 } });
