import { writeFileSync } from 'node:fs';
import { createEcrSchemaErpClient, ecrSchemaResource, listAllEcrSchemaRows } from '../scripts/ecr-schema-erp-client.mjs';

// Inspection only: this client is deliberately wrapped to permit GET requests only.
const client = createEcrSchemaErpClient();
const read = (path) => client('GET', path);
const list = (doctype, fields, filters = []) => listAllEcrSchemaRows((_method, path) => read(path), doctype, fields, filters);
const report = { inspectedAt: new Date().toISOString(), readOnly: true, doctypes: {}, workflows: [], customFields: [], propertySetters: [], notifications: [], serverScripts: [], errors: [] };
const primary = ['Contract', 'Contract Request', 'Contract Clause', 'Contract Approval Matrix', 'Contract Renewal', 'Contract Amendment', 'Contract Risk', 'Contract Milestone', 'Contract Obligation'];
let discovered = [];
try { discovered = (await list('DocType', ['name', 'module', 'custom', 'istable'], [['name', 'like', '%Contract%']])).filter(row => row.name.startsWith('Contract')); } catch (error) { report.errors.push(error.message); }
report.discoveredContractDoctypes = discovered;
const pending = [...new Set([...primary, ...discovered.map(row => row.name), 'SLA Configuration', 'SLA Log', 'SLA Escalation History', 'Version', 'Workflow Action', 'Workflow', 'Workflow State', 'Workflow Transition', 'Comment', 'ToDo', 'Notification Log'])];
const fieldKeys = ['fieldname', 'label', 'fieldtype', 'options', 'reqd', 'default', 'read_only', 'hidden', 'allow_on_submit', 'unique', 'in_list_view', 'depends_on', 'mandatory_depends_on', 'read_only_depends_on', 'fetch_from', 'description', 'permlevel'];
const slimField = field => Object.fromEntries(fieldKeys.filter(key => field[key] !== undefined).map(key => [key, field[key]]));
for (let cursor = 0; cursor < pending.length; cursor++) {
  const name = pending[cursor];
  try {
    const doc = await read(ecrSchemaResource('DocType', name));
    report.doctypes[name] = {
      name: doc.name, module: doc.module, custom: doc.custom, istable: doc.istable, autoname: doc.autoname,
      is_submittable: doc.is_submittable, track_changes: doc.track_changes, track_seen: doc.track_seen,
      title_field: doc.title_field, search_fields: doc.search_fields, sort_field: doc.sort_field,
      fields: (doc.fields ?? []).map(slimField), permissions: doc.permissions ?? [],
      states: doc.states ?? [], actions: doc.actions ?? [], links: doc.links ?? [],
    };
    for (const field of doc.fields ?? []) if (['Table', 'Table MultiSelect'].includes(field.fieldtype) && field.options && !pending.includes(field.options)) pending.push(field.options);
    if (!doc.istable) {
      try {
        const count = await read(`method/frappe.client.get_count?${new URLSearchParams({ doctype: name })}`);
        report.doctypes[name].recordCount = count;
      } catch (error) { report.doctypes[name].recordCountError = error.message; }
    }
  } catch (error) { report.doctypes[name] = { name, error: error.message, httpStatus: error.status }; }
}
for (const [key, doctype, field] of [['customFields', 'Custom Field', 'dt'], ['propertySetters', 'Property Setter', 'doc_type'], ['notifications', 'Notification', 'document_type'], ['serverScripts', 'Server Script', 'reference_doctype']]) {
  try { report[key] = await list(doctype, ['*'], [[field, 'in', pending]]); } catch (error) { report.errors.push(`${key}: ${error.message}`); }
}
try { report.customPermissions = await list('Custom DocPerm', ['*'], [['parent', 'in', pending]]); } catch (error) { report.errors.push(`customPermissions: ${error.message}`); }
try {
  const names = await list('DocType', ['name', 'module', 'custom', 'istable']);
  report.relatedExistingDoctypes = names.filter(row => /(?:^Version$|Approval|Signature|Workflow|Notification|^ToDo$|^Comment$|Negotiation|^SLA|Service Level|Business Unit|Award|Evaluation|^File$|^Communication$|^Issue$)/i.test(row.name));
} catch (error) { report.errors.push(`relatedExistingDoctypes: ${error.message}`); }
try {
  const roles = ['Administrator', 'Procurement Team', 'Procurement Manager', 'Legal', 'Finance Executive', 'Finance Manager', 'Engineering', 'Engineering Manager', 'Quality Manager', 'Program Manager', 'Supplier Portal User'];
  report.existingRequestedRoles = await list('Role', ['name', 'disabled'], [['name', 'in', roles]]);
  report.missingRequestedRoleRecords = roles.filter(name => !report.existingRequestedRoles.some(row => row.name === name));
  report.relatedExistingRoles = (await list('Role', ['name', 'disabled'])).filter(row => /legal|finance|engineer|supplier|purchase/i.test(row.name));
} catch (error) { report.errors.push(`roles: ${error.message}`); }
try {
  const rows = await list('Workflow', ['name', 'document_type', 'is_active', 'workflow_state_field'], [['document_type', 'in', pending]]);
  for (const row of rows) report.workflows.push(await read(ecrSchemaResource('Workflow', row.name)));
} catch (error) { report.errors.push(`workflows: ${error.message}`); }
writeFileSync(new URL('./clm-schema-audit.json', import.meta.url), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ path: 'scratch/clm-schema-audit.json', doctypes: Object.values(report.doctypes).map(doc => ({name: doc.name, fields: doc.fields?.length, count: doc.recordCount, error: doc.error})), workflows: report.workflows.map(workflow => ({name: workflow.name, document_type: workflow.document_type, is_active: workflow.is_active, workflow_state_field: workflow.workflow_state_field})), customFieldCount: report.customFields.length, propertySetterCount: report.propertySetters.length, notifications: report.notifications.map(row => row.name), serverScripts: report.serverScripts.map(row => row.name), errors: report.errors }, null, 2));
