import {defineConfig} from 'vitest/config';
export default defineConfig({test:{include:['scratch/clm-po-live.check.ts'],testTimeout:120000}});
