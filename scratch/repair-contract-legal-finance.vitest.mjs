import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['scratch/repair-contract-legal-finance.check.ts'], environment: 'node', testTimeout: 60000 } });
