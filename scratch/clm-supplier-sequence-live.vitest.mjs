import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['scratch/clm-supplier-sequence-live.check.ts'], testTimeout: 120000 } });
