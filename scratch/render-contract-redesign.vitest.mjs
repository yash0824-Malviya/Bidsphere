import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { environment: 'node', include: ['scratch/render-contract-redesign.check.ts'], testTimeout: 30000 } });
