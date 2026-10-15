/** GET-only metadata audit. Does not attempt insert/save/submit or print credentials. */
import { writeFileSync } from 'node:fs';
import { createEcrSchemaErpClient, ecrSchemaResource as resource, listAllEcrSchemaRows as list } from '../scripts/ecr-schema-erp-client.mjs';
const client = createEcrSchemaErpClient();
const api = (method, ...args) => {
  if (method !== 'GET') throw new Error('Read-only probe');
  return client(method, ...args);
};
const attempt = async operation => { try { return { ok: true, data: await operation() }; } catch (error) { return { ok: false, status: error.status, error: error.message }; } };
const fields = ['fieldname', 'fieldtype', 'options', 'reqd', 'unique', 'read_only', 'allow_on_submit', 'permlevel'];
const relevant = new Set(['contract_required', 'custom_approval_data', 'custom_clm_state', 'workflow_state', 'custom_clm_data', 'custom_rfq', 'custom_contract_request']);
const metadata = await Promise.all(['Request for Quotation', 'Legal Document Review', 'Contract Request', 'Contract'].map(async doctype => {
  const [doc, custom, overrides, permissions] = await Promise.all([
    api('GET', resource('DocType', doctype)),
    list(api, 'Custom Field', fields, [['dt', '=', doctype]]),
    list(api, 'Property Setter', ['field_name', 'property', 'value'], [['doc_type', '=', doctype]]),
    Promise.all(['read', 'write', 'create', 'submit'].map(async ptype => {
      const docname = doctype === 'Request for Quotation' ? 'PUR-RFQ-2026-00095' : doctype === 'Legal Document Review' ? 'LDC2026-00026' : '';
      const query = new URLSearchParams({ doctype, docname, perm_type: ptype });
      return { ptype, ...await attempt(() => api('GET', `method/frappe.client.has_permission?${query}`)) };
    })),
  ]);
  return { doctype, is_submittable: doc.is_submittable,
    fields: [...doc.fields, ...custom].filter(row => relevant.has(row.fieldname)).map(row => Object.fromEntries(fields.map(key => [key, row[key] ?? null]))),
    property_setters: overrides.filter(row => relevant.has(row.field_name)), effective_permission_probes: permissions };
}));
const evidence = { checked_at: new Date().toISOString(), read_only: true, writes_tested: false, metadata };
writeFileSync('scratch/existing-clm-write-metadata.json', JSON.stringify(evidence, null, 2));
console.log(JSON.stringify(evidence, null, 2));
