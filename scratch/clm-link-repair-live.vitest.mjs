import { defineConfig } from 'vitest/config';
export default defineConfig({test:{include:['scratch/clm-link-repair-live.check.ts'],testTimeout:120000}});
