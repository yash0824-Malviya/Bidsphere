import { expect, test } from 'vitest';
import { writeFileSync } from 'node:fs';
import { createEcrSchemaErpClient } from '../scripts/ecr-schema-erp-client.mjs';
import { createClmDependencies, getClmFields } from '../api/clmErp';
import { getRfqClmSummary } from '../api/rfqClmCore';
import type { AccessPrincipal } from '../api/rbacAuth';

createEcrSchemaErpClient();
const denied = async () => { throw new Error('This diagnostic permits reads only.'); };
const deps = { ...createClmDependencies(), fields: getClmFields, create: denied, save: denied, notify: denied, decide: denied };

test('resolves real RFQ95 award into the initial Team request state without creating records', async () => {
  // Local policy evaluation over live GETs; not an impersonated browser session.
  const role = (role: AccessPrincipal['role']) => ({ typ: 'internal', sub: 'read-only-policy-probe', email: '', role } as AccessPrincipal);
  const team = await getRfqClmSummary(role('procurement_team'), 'PUR-RFQ-2026-00095', deps);
  const manager = await getRfqClmSummary(role('procurement'), 'PUR-RFQ-2026-00095', deps);
  expect(team).toMatchObject({ decision: 'Pending', contract_required: 'Yes', can_request: true, can_create: false, blocks_procurement: true, continuation_ready: false });
  expect(team.request).toBeUndefined(); expect(team.contract).toBeUndefined();
  expect(team.source?.award).toBe('LDC2026-00026');
  expect(team.prefill).toMatchObject({ supplier: '"Blue Ridge Manufacturing Inc"', custom_supplier_quotation: 'PUR-SQTN-2026-00270', contract_value: 30 });
  expect(manager.can_request).toBe(false); expect(manager.can_create).toBe(false);
  const pick = (summary: typeof team) => ({ rfq: summary.rfq, decision: summary.decision, contract_required: summary.contract_required,
    status: summary.status, can_request: summary.can_request, can_create: summary.can_create, reason: summary.reason,
    request: summary.request ?? null, contract: summary.contract ?? null, blocks_procurement: summary.blocks_procurement,
    source: summary.source, required_fields: summary.required_fields, prefill: summary.prefill });
  writeFileSync('scratch/rfq95-clm-summary-live-evidence.json', JSON.stringify({ checked_at: new Date().toISOString(), read_only: true,
    mutation_performed: false, mode: 'local server role-policy evaluation over live ERP reads', procurement_team: pick(team), procurement_manager: pick(manager) }, null, 2));
}, 60_000);
