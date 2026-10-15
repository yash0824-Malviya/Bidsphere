/** Read-only ERP metadata/record audit; sends GET only and never prints credentials. */
import { writeFileSync } from 'node:fs';
import { createEcrSchemaErpClient, ecrSchemaResource as resource, listAllEcrSchemaRows as list } from '../scripts/ecr-schema-erp-client.mjs';

const client = createEcrSchemaErpClient();
const api = (method, ...args) => {
  if (method !== 'GET') throw new Error('This probe only permits GET.');
  return client(method, ...args);
};
const attempt = async fn => { try { return { ok: true, data: await fn() }; } catch (error) { return { ok: false, status: error.status, error: error.message }; } };
const pick = (row, fields) => Object.fromEntries(fields.map(field => [field, row?.[field] ?? null]));
const parse = raw => { try { return typeof raw === 'string' ? JSON.parse(raw) : raw ?? null; } catch { return null; } };
const fieldKeys = ['fieldname', 'fieldtype', 'options', 'reqd', 'unique', 'default', 'read_only', 'allow_on_submit', 'set_only_once', 'permlevel'];
const [schema, workflows, methodProbes, rfq, awards, requests, contracts] = await Promise.all([
  Promise.all(['Contract Request', 'Contract'].map(async doctype => {
    const [doc, custom, overrides] = await Promise.all([
      api('GET', resource('DocType', doctype)),
      list(api, 'Custom Field', ['name', 'fieldname', 'fieldtype', 'options', 'reqd', 'unique', 'default', 'read_only', 'allow_on_submit', 'permlevel'], [['dt', '=', doctype]]),
      list(api, 'Property Setter', ['name', 'field_name', 'property', 'value', 'property_type'], [['doc_type', '=', doctype]]),
    ]);
    return { ...pick(doc, ['name', 'custom', 'module', 'autoname', 'naming_rule', 'allow_rename', 'is_submittable', 'track_changes', 'title_field']),
      fields: doc.fields.filter(field => !['Section Break', 'Column Break', 'Tab Break', 'HTML'].includes(field.fieldtype)).map(field => pick(field, fieldKeys)),
      custom_fields: custom.map(field => pick(field, fieldKeys)), overrides,
      permissions: doc.permissions?.map(row => pick(row, ['role', 'read', 'write', 'create', 'submit', 'cancel', 'delete', 'if_owner', 'permlevel'])),
    };
  })),
  attempt(async () => {
    const rows = await list(api, 'Workflow', ['name'], [['document_type', 'in', ['Contract Request', 'Contract']], ['is_active', '=', 1]]);
    return Promise.all(rows.map(async row => {
      const doc = await api('GET', resource('Workflow', row.name));
      return { ...pick(doc, ['name', 'document_type', 'workflow_state_field', 'is_active']),
        states: doc.states.map(state => pick(state, ['state', 'doc_status', 'allow_edit'])),
        transitions: doc.transitions.map(edge => pick(edge, ['state', 'action', 'next_state', 'allowed', 'condition'])) };
    }));
  }),
  Promise.all(['frappe.client.insert', 'frappe.client.save', 'frappe.client.get', 'frappe.utils.change_log.get_versions'].map(async method => ({ method, ...await attempt(() => api('GET', `method/${method}`)) }))),
  api('GET', resource('Request for Quotation', 'PUR-RFQ-2026-00095')),
  list(api, 'Legal Document Review', ['name', 'rfq_name', 'sq_name', 'supplier', 'grand_total', 'workflow_state', 'current_owner', 'next_approver', 'custom_clm_state'], [['rfq_name', '=', 'PUR-RFQ-2026-00095']]),
  list(api, 'Contract Request', ['name', 'modified', 'request_status', 'custom_rfq', 'custom_supplier_quotation', 'custom_clm_data'], [['custom_rfq', '=', 'PUR-RFQ-2026-00095']]),
  list(api, 'Contract', ['name', 'modified', 'custom_contract_status', 'custom_rfq', 'custom_contract_request', 'custom_supplier_quotation', 'custom_clm_data'], [['custom_rfq', '=', 'PUR-RFQ-2026-00095']]),
]);
const evidence = { checked_at: new Date().toISOString(), read_only: true, mutation_performed: false,
  target_origin: new URL(process.env.ERPNEXT_URL ?? process.env.VITE_PROXY_TARGET ?? process.env.VITE_ERPNEXT_URL).origin,
  schema, workflows, methodProbes,
  rfq: { ...pick(rfq, ['name', 'modified', 'docstatus', 'status', 'contract_required', 'company']), contract_decision: parse(rfq.custom_approval_data)?.contract_decision ?? null },
  awards, requests, contracts,
};
writeFileSync('scratch/existing-clm-rest-capabilities.json', JSON.stringify(evidence, null, 2));
console.log(JSON.stringify({ checked_at: evidence.checked_at, read_only: true, schema: schema.map(doc => ({
  name: doc.name, autoname: doc.autoname, naming_rule: doc.naming_rule, is_submittable: doc.is_submittable,
  required_fields: [...doc.fields, ...doc.custom_fields].filter(field => field.reqd).map(field => field.fieldname),
  unique_fields: [...doc.fields, ...doc.custom_fields].filter(field => field.unique).map(field => field.fieldname),
})), workflows, methodProbes, rfq: evidence.rfq, awards, request_count: requests.length, contract_count: contracts.length }, null, 2));
