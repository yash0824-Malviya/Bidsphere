import { createServer } from 'vite';
import { writeFileSync } from 'node:fs';
import { createEcrSchemaErpClient } from '../scripts/ecr-schema-erp-client.mjs';

createEcrSchemaErpClient();
const server = await createServer({ server: { middlewareMode: true }, appType: 'custom' });
try {
  const erp = await server.ssrLoadModule('/api/clmErp.ts');
  const core = await server.ssrLoadModule('/api/rfqClmCore.ts');
  // Read-only service audit of the same summary used by the Procurement UI.
  // All write/notification methods are disabled; no user session is created.
  const forbidden = async () => { throw new Error('Read-only verification forbids writes'); };
  const deps = { ...erp.createClmDependencies(), create: forbidden, save: forbidden, notify: forbidden, sign: forbidden, lock: forbidden, fields: erp.getClmFields };
  const summary = await core.getRfqClmSummary({ typ: 'internal', role: 'procurement', sub: 'read-only-context-audit', iat: 0, exp: 0 }, 'PUR-RFQ-2026-00093', deps);
  const expected = { custom_rfq: 'PUR-RFQ-2026-00093', supplier: 'Apex Fasteners Ltd', custom_supplier_quotation: 'PUR-SQTN-2026-00263', company: 'Netlink', department: 'Production - NSGAI', contract_value: 2500, currency: 'USD', legal_review_required: 1 };
  for (const [key, value] of Object.entries(expected)) if (summary.prefill[key] !== value) throw new Error(`Unexpected ${key}: ${summary.prefill[key]}`);
  if (summary.prefill.contract_type !== undefined) throw new Error('Contract type must remain explicitly unselected');
  if (summary.source?.award !== 'LDC2026-00024' || !summary.can_create) throw new Error('Award is unavailable');
  if (summary.source_documents.length) throw new Error('Unexpected supporting document for audited RFQ93 sources');
  writeFileSync('scratch/rfq-award-live-context.json', JSON.stringify({ verified_at: new Date().toISOString(), mode: 'read-only', summary }, null, 2));
  console.log(JSON.stringify({ verified: true, rfq: summary.rfq.name, award: summary.source.award, context: expected, contractTypeBlank: true, excludedUnrelatedDocuments: true, sourceWarnings: summary.warnings, writes: 0 }, null, 2));
} finally { await server.close(); }
