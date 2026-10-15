import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['scratch/rfq-award-live-cleanup.check.ts'], maxWorkers: 1 } });
