import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { environment:'node',include:['scratch/verify-contract-pdf-redesign.check.ts'],testTimeout:60000 } });
