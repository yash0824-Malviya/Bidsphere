import { writeFileSync } from 'node:fs';
import { createEcrSchemaErpClient, ecrSchemaResource as resource, listAllEcrSchemaRows as list } from '../scripts/ecr-schema-erp-client.mjs';

const api = createEcrSchemaErpClient();
const rfqId = 'PUR-RFQ-2026-00094';
const attempt = async fn => {
  try { return { ok: true, data: await fn() }; }
  catch (error) { return { ok: false, status: error.status, error: error.message }; }
};
const parse = value => { try { return typeof value === 'string' ? JSON.parse(value) : value; } catch { return null; } };
const pick = (row, fields) => Object.fromEntries(fields.filter(field => row[field] !== undefined).map(field => [field, row[field]]));
const [versions, endpoint, rfq, awards, requests, contracts, contractCount] = await Promise.all([
  attempt(() => api('GET', 'method/frappe.utils.change_log.get_versions')),
  attempt(() => api('GET', 'method/bidsphere_workflows.rfq_clm.decide')),
  api('GET', resource('Request for Quotation', rfqId)),
  list(api, 'Legal Document Review', ['name'], [['rfq_name', '=', rfqId]]),
  list(api, 'Contract Request', ['name', 'request_status', 'custom_rfq'], [['custom_rfq', '=', rfqId]]),
  list(api, 'Contract', ['name', 'custom_contract_status', 'custom_rfq'], [['custom_rfq', '=', rfqId]]),
  attempt(() => api('GET', 'method/frappe.client.get_count?doctype=Contract')),
]);
const fullAwards = await Promise.all(awards.map(row => api('GET', resource('Legal Document Review', row.name))));
const fullContracts = await Promise.all(contracts.map(row => api('GET', resource('Contract', row.name))));
const decisionData = parse(rfq.custom_approval_data);
const evidence = {
  checked_at: new Date().toISOString(), read_only: true, mutation_performed: false,
  target_origin: new URL(process.env.ERPNEXT_URL ?? process.env.VITE_PROXY_TARGET ?? process.env.VITE_ERPNEXT_URL).origin,
  versions, endpoint,
  rfq: { ...pick(rfq, ['name','status','docstatus','contract_required','custom_selected_supplier','custom_selected_quotation']), approval_data: decisionData },
  awards: fullAwards.map(row => pick(row, ['name','rfq_name','sq_name','supplier','supplier_name','status','workflow_state','custom_clm_state'])),
  requests, contracts: fullContracts.map(row => ({ ...pick(row, ['name','custom_contract_status','custom_rfq','custom_award','custom_quotation','party_name','start_date','end_date']), clm_data: parse(row.custom_clm_data) })),
  total_contracts: contractCount,
};
writeFileSync('scratch/rfq94-clm-handoff-check-2026-09-23.json', JSON.stringify(evidence, null, 2));
console.log(JSON.stringify(evidence, null, 2));
