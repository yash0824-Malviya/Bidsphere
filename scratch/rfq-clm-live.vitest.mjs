import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['scratch/rfq-clm-live.check.ts'], testTimeout: 30000, maxWorkers: 1 } });
