import { writeFileSync } from 'node:fs';
import { createEcrSchemaErpClient, ecrSchemaResource } from '../scripts/ecr-schema-erp-client.mjs';

const api = createEcrSchemaErpClient();
const attempt = async action => {
  try { return { ok: true, result: await action() }; }
  catch (error) { return { ok: false, status: error.status, error: error.message }; }
};
const rows = [
  ['Request for Quotation', 'PUR-RFQ-2026-00093', ['read', 'write']],
  ['Legal Document Review', 'LDC2026-00024', ['read', 'write']],
  ['Contract Request', '', ['read', 'create', 'write']],
  ['Contract', '', ['read', 'create', 'write']],
  ['File', '', ['read', 'create']],
];
const identity = await attempt(() => api('GET', 'method/frappe.auth.get_logged_user'));
const installed = await attempt(() => api('GET', ecrSchemaResource('Installed Applications', 'Installed Applications')));
const permissions = [];
for (const [doctype, docname, types] of rows) for (const perm_type of types) {
  const args = new URLSearchParams({ doctype, docname, perm_type });
  permissions.push({ doctype, docname: docname || null, permission: perm_type,
    ...await attempt(() => api('GET', 'method/frappe.client.has_permission?' + args)) });
}
const evidence = { checked_at: new Date().toISOString(), read_only: true, identity,
  installed: installed.ok ? { ok: true, apps: (installed.result.installed_applications || []).map(app => ({ app_name: app.app_name, app_version: app.app_version })) } : installed,
  permissions,
  limits: 'Checks the configured ERP service identity only; app actor RBAC remains independently enforced. No records, roles or permissions were changed.' };
writeFileSync('scratch/rfq-extension-permission-audit.json', JSON.stringify(evidence, null, 2));
console.log(JSON.stringify(evidence, null, 2));
