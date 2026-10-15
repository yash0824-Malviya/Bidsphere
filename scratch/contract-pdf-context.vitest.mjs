import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['scratch/contract-pdf-context.check.ts'], maxWorkers: 1 } });
