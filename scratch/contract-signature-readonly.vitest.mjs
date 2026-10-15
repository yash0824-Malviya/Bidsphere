import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['scratch/contract-signature-readonly.check.ts'], maxWorkers: 1 } });
