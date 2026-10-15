import { defineConfig } from 'vitest/config';
export default defineConfig({test:{include:['scratch/rfq-clm-live-yes-no.check.ts'],maxWorkers:1}});
