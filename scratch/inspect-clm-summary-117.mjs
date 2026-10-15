import { createClmDependencies, getClmFields } from '../api/clmErp.js';
import { getRfqClmSummary } from '../api/rfqClmCore.js';

async function run() {
  const deps = { ...createClmDependencies(), fields: getClmFields };
  const principal = { typ: 'internal', sub: 'Administrator', email: 'admin@example.com', role: 'admin' };
  const summary = await getRfqClmSummary(principal, 'PUR-RFQ-2026-00117', deps);
  console.log("=== RFQ CLM SUMMARY for PUR-RFQ-2026-00117 ===");
  console.log(JSON.stringify(summary, null, 2));
}

run().catch(console.error);
