import { defineConfig } from 'vitest/config';
export default defineConfig({ test:{include:['scratch/rfq98-create-request.check.ts'],maxWorkers:1} });
