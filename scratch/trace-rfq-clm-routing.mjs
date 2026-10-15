import { writeFileSync } from 'node:fs';
import { createEcrSchemaErpClient, ecrSchemaResource as resource, listAllEcrSchemaRows as list } from '../scripts/ecr-schema-erp-client.mjs';

const api = createEcrSchemaErpClient();
const attempt = async fn => { try { return { ok: true, data: await fn() }; } catch (e) { return { ok: false, status: e.status, error: e.message }; } };
const parse = value => { try { return typeof value === 'string' ? JSON.parse(value) : value; } catch { return null; } };
const pick = (row, keys) => Object.fromEntries(keys.map(key => [key, row?.[key] ?? null]));
async function trace(rfqId) {
  const [rfq, awards, requests, contracts] = await Promise.all([
    api('GET', resource('Request for Quotation', rfqId)),
    list(api, 'Legal Document Review', ['name'], [['rfq_name', '=', rfqId]]),
    list(api, 'Contract Request', ['name'], [['custom_rfq', '=', rfqId]]),
    list(api, 'Contract', ['name'], [['custom_rfq', '=', rfqId]]),
  ]);
  const [awardDocs, requestDocs, contractDocs] = await Promise.all([
    Promise.all(awards.map(row => api('GET', resource('Legal Document Review', row.name)))),
    Promise.all(requests.map(row => api('GET', resource('Contract Request', row.name)))),
    Promise.all(contracts.map(row => api('GET', resource('Contract', row.name)))),
  ]);
  return {
    rfq: { ...pick(rfq, ['name', 'modified', 'contract_required', 'status', 'docstatus', 'company']), contract_decision: parse(rfq.custom_approval_data)?.contract_decision ?? null },
    awards: awardDocs.map(row => ({ ...pick(row, ['name', 'rfq_name', 'sq_name', 'supplier', 'grand_total', 'workflow_state', 'current_owner', 'next_approver']), clm_state: parse(row.custom_clm_state) ?? null })),
    requests: requestDocs.map(row => { const data = parse(row.custom_clm_data); return {
      ...pick(row, ['name', 'custom_rfq', 'custom_supplier_quotation', 'supplier', 'requester', 'owner', 'request_status', 'approval_status', 'assigned_role', 'assigned_user', 'current_stage', 'status']),
      rfq_source: data?.rfq_source ?? null, rfq_request_workflow: data?.rfq_request_workflow ?? null,
      approvals: data?.approvals ?? null, audit: data?.audit ?? null, contract: data?.contract ?? null,
    }; }),
    contracts: contractDocs.map(row => pick(row, ['name', 'custom_rfq', 'custom_contract_request', 'custom_supplier_quotation', 'custom_contract_status'])),
  };
}
const [versions, endpoint, rfq93, rfq94, requestSchema, requestWorkflows, assignmentRules] = await Promise.all([
  attempt(() => api('GET', 'method/frappe.utils.change_log.get_versions')),
  attempt(() => api('GET', 'method/bidsphere_workflows.rfq_clm.decide')),
  attempt(() => trace('PUR-RFQ-2026-00093')),
  attempt(() => trace('PUR-RFQ-2026-00094')),
  attempt(async () => { const [doc, customFields] = await Promise.all([
    api('GET', resource('DocType', 'Contract Request')),
    list(api, 'Custom Field', ['fieldname', 'fieldtype', 'options', 'default', 'reqd', 'unique'], [['dt', '=', 'Contract Request']]),
  ]); return {
    name: doc.name, module: doc.module, custom: doc.custom,
    fields: doc.fields.filter(field => ['requester', 'request_status', 'approval_status', 'approver', 'owner', 'assigned_role', 'assigned_user', 'current_stage', 'status', 'workflow_stage', 'custom_clm_data', 'custom_rfq', 'custom_supplier_quotation'].includes(field.fieldname)).map(field => pick(field, ['fieldname', 'fieldtype', 'options', 'default', 'reqd'])),
    custom_fields: customFields.filter(field => ['custom_clm_data', 'custom_rfq', 'custom_supplier_quotation', 'assigned_role', 'assigned_user', 'current_stage', 'status', 'workflow_stage'].includes(field.fieldname)),
  }; }),
  attempt(async () => { const rows = await list(api, 'Workflow', ['name'], [['document_type', '=', 'Contract Request'], ['is_active', '=', 1]]); return Promise.all(rows.map(async row => {
    const doc = await api('GET', resource('Workflow', row.name)); return { ...pick(doc, ['name', 'document_type', 'workflow_state_field', 'is_active']),
      states: doc.states?.map(state => pick(state, ['state', 'doc_status', 'allow_edit', 'update_field', 'update_value'])),
      transitions: doc.transitions?.map(state => pick(state, ['state', 'action', 'next_state', 'allowed', 'condition'])) };
  })); }),
  attempt(() => list(api, 'Assignment Rule', ['name', 'document_type', 'disabled', 'assign_condition'], [['document_type', '=', 'Contract Request']])),
]);
const evidence = { checked_at: new Date().toISOString(), read_only: true, mutation_performed: false,
  target_origin: new URL(process.env.ERPNEXT_URL ?? process.env.VITE_PROXY_TARGET ?? process.env.VITE_ERPNEXT_URL).origin,
  versions, endpoint, rfq93, rfq94, requestSchema, requestWorkflows, assignmentRules };
writeFileSync('scratch/rfq-clm-routing-live-trace-2026-09-23.json', JSON.stringify(evidence, null, 2));
console.log(JSON.stringify(evidence, null, 2));
