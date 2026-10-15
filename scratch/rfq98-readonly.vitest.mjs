import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['scratch/rfq98-readonly.check.ts'], maxWorkers: 1 } });
