import { test, expect } from 'vitest';
import { writeFileSync } from 'node:fs';
import { createEcrSchemaErpClient } from '../scripts/ecr-schema-erp-client.mjs';
import { createClmDependencies, getClmFields } from '../api/clmErp';
import { getRfqClmSummary } from '../api/rfqClmCore';

createEcrSchemaErpClient(); // Load existing ERP environment without printing credentials.
const principal = { typ: 'internal' as const, role: 'procurement' as const, sub: 'procurement@netlink.com' };
const original = createClmDependencies();
const denied = async () => { throw new Error('Live verification is read-only.'); };
const deps = { ...original, fields: getClmFields, create: denied, save: denied, notify: denied };
test('real legacy RFQ reads No / Not Required through the new server service', async () => {
  const summary = await getRfqClmSummary(principal, 'PUR-RFQ-2026-00089', deps);
  expect(summary.contract_required).toBe('No'); expect(summary.status).toBe('Not Required'); expect(summary.can_create).toBe(false);
});
test('read-only eligibility dry run resolves the actual saved award and source references', async () => {
  // Only the in-memory opt-in is changed, never the live RFQ. All award, quote,
  // supplier, PO, schema and attachment data are fetched from ERPNext.
  const summary = await getRfqClmSummary(principal, 'PUR-RFQ-2026-00089', { ...deps, load: async (dt, name) => {
    const doc = await original.load(dt, name);
    return dt === 'Request for Quotation' ? { ...doc, contract_required: 'Yes' } : doc;
  } });
  writeFileSync('scratch/rfq-clm-live-award-verification.json', JSON.stringify({ mode: 'read-only eligibility dry run; opt-in in memory only', summary }, null, 2));
  expect(summary.reason).toBe(''); expect(summary.can_create).toBe(true);
  expect(summary.prefill.custom_supplier_quotation).toBe('PUR-SQTN-2026-00249');
  expect(summary.prefill.contract_value).toBe(2500);
  expect(summary.prefill.custom_purchase_order).toBe('PUR-ORD-2026-00027');
});
