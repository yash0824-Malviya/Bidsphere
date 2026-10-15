import { test, expect } from 'vitest';
import { existsSync, writeFileSync } from 'node:fs';
import { createEcrSchemaErpClient } from '../scripts/ecr-schema-erp-client.mjs';
import { createClmDependencies, getClmFields } from '../api/clmErp';
import { ensureInitialRfqContractRequest, isInvalidatedPreawardRequest } from '../api/rfqInitialClmRequest';
import { parseClmData } from '../api/clmCore';
import { getRfqClmSummary } from '../api/rfqClmCore';
import { resolveServerRole, type AccessPrincipal } from '../api/rbacAuth';
import { rfqClmRequestWorkflowView } from '../src/utils/rfqClmWorkflow';
const api = createEcrSchemaErpClient();
test('invalidate the three existing pre-award test Requests without changing RFQ sourcing or creating replacement records', async () => {
  const deps = { ...createClmDependencies(), fields: getClmFields };
  const identity = await api('GET', 'method/frappe.auth.get_logged_user');
  const user = await deps.load('User', identity);
  const role = resolveServerRole({ name: user.name, email: user.email, erpnext_roles: user.roles.map((row: { role: string }) => row.role) });
  if (!role || !['admin', 'procurement', 'procurement_team'].includes(role) || user.enabled !== 1) throw new Error('Authorized integration identity required.');
  const principal = { typ: 'internal', sub: identity, email: user.email, role } as AccessPrincipal;
  const before = [];
  for (const name of ['CTRQ-2026-0001', 'CTRQ-2026-0002', 'CTRQ-2026-0003']) {
    const request = await deps.load('Contract Request', name);
    const rfq = await deps.load('Request for Quotation', String(request.custom_rfq));
    expect(await deps.list('Legal Document Review', [['rfq_name', '=', rfq.name]])).toHaveLength(0);
    expect(await deps.list('Contract', [['custom_rfq', '=', rfq.name]])).toHaveLength(0);
    before.push({ request, rfq });
  }
  const backup = 'scratch/rfq-award-live-cleanup-before.json';
  if (!existsSync(backup)) writeFileSync(backup, JSON.stringify(before, null, 2), { flag: 'wx', flush: true });
  const evidence = [];
  const withoutRevisions = (value: unknown): unknown => Array.isArray(value) ? value.map(withoutRevisions) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).filter(([key]) => !['modified', 'modified_by'].includes(key)).map(([key, entry]) => [key, withoutRevisions(entry)])) : value;
  const business = (record: Record<string, unknown>, omitted: string[]) => withoutRevisions(Object.fromEntries(Object.entries(record).filter(([key]) => !omitted.includes(key))));
  for (const { request, rfq } of before) {
    const result = await ensureInitialRfqContractRequest(principal, String(rfq.name), deps);
    expect(result.created).toBe(false); expect(result.request).toBeUndefined();
    const saved = await deps.load('Contract Request', String(request.name)), fresh = await deps.load('Request for Quotation', String(rfq.name));
    expect(isInvalidatedPreawardRequest(saved)).toBe(true);
    expect(rfqClmRequestWorkflowView(saved)).toBeUndefined();
    expect(business(saved, ['modified', 'modified_by', 'request_status', 'custom_clm_data'])).toEqual(business(request, ['modified', 'modified_by', 'request_status', 'custom_clm_data']));
    expect(business(fresh, ['modified', 'modified_by', 'custom_approval_data'])).toEqual(business(rfq, ['modified', 'modified_by', 'custom_approval_data']));
    const originalData = parseClmData(request.custom_clm_data), savedData = parseClmData(saved.custom_clm_data);
    expect(savedData.audit.slice(0, originalData.audit.length)).toEqual(originalData.audit);
    expect(savedData.rfq_request_draft).toEqual(originalData.rfq_request_draft);
    expect(await deps.list('Contract Request', [['custom_rfq', '=', rfq.name]])).toHaveLength(1);
    const summary = await getRfqClmSummary(principal, String(rfq.name), deps);
    expect(summary.request).toBeUndefined(); expect(summary.can_create).toBe(false); expect(summary.can_request).toBe(false);
    evidence.push({ rfq: rfq.name, rfq_docstatus: fresh.docstatus, rfq_status: fresh.status, request: saved.name, native_status: saved.request_status, workflow: savedData.rfq_request_workflow, audit_preserved: true, terms_preserved: true, active_request: false, contract_count: 0 });
    writeFileSync('scratch/rfq-award-live-cleanup-evidence.json', JSON.stringify({ checked_at: new Date().toISOString(), evidence }, null, 2));
  }
}, 180_000);
