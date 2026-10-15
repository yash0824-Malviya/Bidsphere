import { defineConfig } from 'vitest/config';
export default defineConfig({test:{include:['scratch/clm-link-relationship-live.check.ts'],testTimeout:120000}});
