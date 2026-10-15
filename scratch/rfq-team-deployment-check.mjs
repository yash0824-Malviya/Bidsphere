import { writeFileSync } from 'node:fs';
import { createEcrSchemaErpClient, ecrSchemaResource as resource, listAllEcrSchemaRows as list } from '../scripts/ecr-schema-erp-client.mjs';

const api = createEcrSchemaErpClient();
const attempt = async action => {
  try { return { ok: true, data: await action() }; }
  catch (error) { return { ok: false, status: error.status, error: error.message }; }
};
const [versions, endpoint, rfq, award, requests, contracts] = await Promise.all([
  attempt(() => api('GET', 'method/frappe.utils.change_log.get_versions')),
  attempt(() => api('GET', 'method/bidsphere_workflows.rfq_clm.decide')),
  api('GET', resource('Request for Quotation', 'PUR-RFQ-2026-00093')),
  api('GET', resource('Legal Document Review', 'LDC2026-00024')),
  list(api, 'Contract Request', ['name', 'request_status', 'custom_rfq'], [['custom_rfq', '=', 'PUR-RFQ-2026-00093']]),
  list(api, 'Contract', ['name', 'custom_contract_status', 'custom_rfq'], [['custom_rfq', '=', 'PUR-RFQ-2026-00093']]),
]);
const evidence = {
  checked_at: new Date().toISOString(), read_only: true, mutation_performed: false,
  versions, endpoint,
  rfq: { name: rfq.name, status: rfq.status, docstatus: rfq.docstatus, contract_required: rfq.contract_required, saved_decision_present: !!rfq.custom_approval_data },
  award: { name: award.name, rfq: award.rfq_name, quotation: award.sq_name },
  requests, contracts,
};
writeFileSync('scratch/rfq-team-deployment-check-2026-09-22.json', JSON.stringify(evidence, null, 2));
console.log(JSON.stringify(evidence, null, 2));
