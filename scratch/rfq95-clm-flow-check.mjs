import { writeFileSync } from 'node:fs';
import { createEcrSchemaErpClient, ecrSchemaResource as resource, listAllEcrSchemaRows as list } from '../scripts/ecr-schema-erp-client.mjs';

const api = createEcrSchemaErpClient();
const rfqId = 'PUR-RFQ-2026-00095';
const attempt = async fn => {
  try { return { ok: true, data: await fn() }; }
  catch (error) { return { ok: false, status: error.status, error: error.message }; }
};
const parse = value => { try { return typeof value === 'string' ? JSON.parse(value) : value; } catch { return null; } };
const pick = (row, fields) => Object.fromEntries(fields.map(field => [field, row?.[field] ?? null]));
const [versions, endpoint, rfq, awards, requests, contracts, count] = await Promise.all([
  attempt(() => api('GET', 'method/frappe.utils.change_log.get_versions')),
  attempt(() => api('GET', 'method/bidsphere_workflows.rfq_clm.decide')),
  api('GET', resource('Request for Quotation', rfqId)),
  list(api, 'Legal Document Review', ['name'], [['rfq_name', '=', rfqId]]),
  list(api, 'Contract Request', ['name'], [['custom_rfq', '=', rfqId]]),
  list(api, 'Contract', ['name'], [['custom_rfq', '=', rfqId]]),
  attempt(() => api('GET', 'method/frappe.client.get_count?doctype=Contract')),
]);
const [awardDocs, requestDocs, contractDocs] = await Promise.all([
  Promise.all(awards.map(row => api('GET', resource('Legal Document Review', row.name)))),
  Promise.all(requests.map(row => api('GET', resource('Contract Request', row.name)))),
  Promise.all(contracts.map(row => api('GET', resource('Contract', row.name)))),
]);
const approval = parse(rfq.custom_approval_data);
const evidence = {
  checked_at: new Date().toISOString(), read_only: true, mutation_performed: false,
  target_origin: new URL(process.env.ERPNEXT_URL ?? process.env.VITE_PROXY_TARGET ?? process.env.VITE_ERPNEXT_URL).origin,
  versions, endpoint,
  rfq: { ...pick(rfq, ['name', 'modified', 'status', 'docstatus', 'contract_required', 'custom_selected_supplier', 'custom_selected_quotation', 'custom_active_rfq_round']),
    selected_supplier: approval?.selected_supplier ?? null, selected_quotation: approval?.supplier_quotation ?? null,
    contract_decision: approval?.contract_decision ?? null },
  awards: awardDocs.map(row => ({ ...pick(row, ['name', 'rfq_name', 'sq_name', 'supplier', 'grand_total', 'workflow_state', 'current_owner', 'next_approver']), clm_state: parse(row.custom_clm_state) ?? null })),
  requests: requestDocs.map(row => ({ ...pick(row, ['name', 'custom_rfq', 'custom_supplier_quotation', 'supplier', 'request_status', 'approval_status']),
    rfq_source: parse(row.custom_clm_data)?.rfq_source ?? null,
    rfq_request_workflow: parse(row.custom_clm_data)?.rfq_request_workflow ?? null,
    approvals: parse(row.custom_clm_data)?.approvals ?? null })),
  contracts: contractDocs.map(row => ({ ...pick(row, ['name', 'custom_rfq', 'custom_contract_request', 'custom_supplier_quotation', 'custom_contract_status', 'custom_supplier', 'custom_contract_value', 'start_date', 'end_date']),
    rfq_source: parse(row.custom_clm_data)?.rfq_source ?? null })),
  total_contracts: count,
};
writeFileSync('scratch/rfq95-clm-flow-live-evidence.json', JSON.stringify(evidence, null, 2));
console.log(JSON.stringify(evidence, null, 2));
