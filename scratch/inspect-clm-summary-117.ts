import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

for (const f of ['.env', '.env.local']) {
  const envPath = resolve(process.cwd(), f);
  if (!existsSync(envPath)) continue;
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq <= 0) continue;
    const k = t.slice(0, eq).trim();
    let v = t.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (!process.env[k]) process.env[k] = v;
  }
}
if (!process.env.ERPNEXT_URL && process.env.VITE_ERPNEXT_URL) {
  process.env.ERPNEXT_URL = process.env.VITE_ERPNEXT_URL;
}
if (!process.env.ERP_API_KEY && process.env.VITE_API_KEY) {
  process.env.ERP_API_KEY = process.env.VITE_API_KEY;
}
if (!process.env.ERP_API_SECRET && process.env.VITE_API_SECRET) {
  process.env.ERP_API_SECRET = process.env.VITE_API_SECRET;
}

import { createClmDependencies, getClmFields } from '../api/clmErp.js';
import { getRfqClmSummary } from '../api/rfqClmCore.js';

async function run() {
  const deps = { ...createClmDependencies(), fields: getClmFields };
  const principal = { typ: 'internal', sub: 'Administrator', email: 'admin@example.com', role: 'admin' as const };
  const summary = await getRfqClmSummary(principal, 'PUR-RFQ-2026-00117', deps);
  console.log("=== RFQ CLM SUMMARY for PUR-RFQ-2026-00117 ===");
  console.log(JSON.stringify(summary, null, 2));
}

run().catch(console.error);
