import { defineConfig } from 'vitest/config';
export default defineConfig({test:{include:['scratch/rfq-submit-live.check.ts'],maxWorkers:1}});
