import { ecrSchemaResource as resource, listAllEcrSchemaRows } from './ecr-schema-erp-client.mjs';
import { resolveClmField, applyClmSchemaPlan } from './clm-schema.mjs';

export const RFQ_CONTRACT_DOCTYPES = ['Request for Quotation', 'Contract Request'];
const requirement = { dt: 'Request for Quotation', fieldname: 'contract_required', label: 'Does this RFQ require a Contract?', fieldtype: 'Select', aliases: ['custom_contract_required', 'requires_contract', 'custom_requires_contract'], equivalentLabels: ['Contract Required', 'Contract Requirement', 'Requires Contract'] };
const source = { dt: 'Contract Request', fieldname: 'custom_rfq', label: 'RFQ', fieldtype: 'Link', options: 'Request for Quotation', aliases: ['rfq', 'request_for_quotation'], equivalentLabels: ['Request for Quotation'] };
const clean = value => String(value ?? '').trim();

function setProperty(snapshot, operations, dt, found, property, value) {
  const setter = snapshot.propertySetters.find(row => row.doc_type === dt && row.field_name === found.fieldname && row.property === property);
  if (setter) operations.push({ kind: 'update-property-setter', doctype: dt, name: setter.name, modified: setter.modified, patch: { value: String(value) } });
  else if (found.source === 'custom') {
    // One save per field retains ERPNext's optimistic modified check.
    const pending = operations.find(row => row.kind === 'update-custom-field' && row.name === found.name);
    if (pending) pending.patch[property] = value;
    else operations.push({ kind: 'update-custom-field', doctype: dt, name: found.name, modified: found.modified, patch: { [property]: value } });
  }
  else operations.push({ kind: 'create-property-setter', doctype: dt, document: { doctype_or_field: 'DocField', doc_type: dt, field_name: found.fieldname, property, property_type: typeof value === 'number' ? 'Check' : 'Text', value: String(value) } });
}

/** No data updates, workflows, roles, permissions or new DocTypes. */
export function planRfqContractSchema(snapshot) {
  for (const dt of RFQ_CONTRACT_DOCTYPES) if (snapshot.doctypes?.[dt]?.name !== dt) throw new Error(`Existing ${dt} DocType is required.`);
  const operations = [];
  const found = resolveClmField(snapshot, requirement);
  if (!found) operations.push({ kind: 'create-custom-field', doctype: requirement.dt, document: {
    dt: requirement.dt, fieldname: requirement.fieldname, label: requirement.label, fieldtype: 'Select', options: 'Yes\nNo', default: 'No', reqd: 1,
    insert_after: 'message_for_supplier', description: 'Contract initiation is available after supplier selection. Existing RFQ workflow is unchanged.',
  } });
  else {
    const options = clean(found.options).split(/\r?\n/).map(clean).filter(Boolean);
    if (options.some(value => !['Yes', 'No'].includes(value))) throw new Error(`Existing ${found.fieldname} has incompatible values; no duplicate field will be created.`);
    for (const row of snapshot.records?.['Request for Quotation'] ?? []) if (clean(row[found.fieldname]) && !['Yes', 'No'].includes(row[found.fieldname])) throw new Error(`RFQ ${row.name} has an incompatible contract requirement; no records will be rewritten.`);
    if (!options.includes('Yes') || !options.includes('No')) setProperty(snapshot, operations, requirement.dt, found, 'options', 'Yes\nNo');
    if (found.default !== 'No') setProperty(snapshot, operations, requirement.dt, found, 'default', 'No');
    if (Number(found.reqd) !== 1) setProperty(snapshot, operations, requirement.dt, found, 'reqd', 1);
  }
  const link = resolveClmField(snapshot, source);
  if (!link) throw new Error('Existing Contract Request RFQ link is required; apply the existing CLM setup first.');
  if (Number(link.reqd)) throw new Error('Contract Request RFQ link must remain optional for standalone requests.');
  if (!Array.isArray(snapshot.records?.['Contract Request'])) throw new Error('Complete Contract Request inventory is required before adding uniqueness.');
  const seen = new Set(); let rawBlankCount = 0;
  for (const row of snapshot.records['Contract Request']) {
    const raw = row[link.fieldname]; const value = clean(raw);
    if (!value) { if (raw !== null && raw !== undefined) rawBlankCount++; continue; }
    // Frappe's normal MariaDB collation is case-insensitive.
    const key = value.toLowerCase();
    if (seen.has(key)) throw new Error(`Multiple Contract Requests reference RFQ ${value}; migration will not delete or rewrite them.`);
    seen.add(key);
  }
  if (Number(link.unique) !== 1) {
    if (rawBlankCount > 1) throw new Error('Existing blank RFQ link values need review before the unique index; no records will be rewritten.');
    setProperty(snapshot, operations, source.dt, link, 'unique', 1);
  }
  return { bindings: { contract_required: found?.fieldname ?? requirement.fieldname, request_rfq: link.fieldname }, operations, recordMigration: false, workflowChanges: false, permissionChanges: false, newDoctypes: [], newRoles: [] };
}

export async function loadRfqContractSchema(api) {
  const doctypes = Object.fromEntries(await Promise.all(RFQ_CONTRACT_DOCTYPES.map(async dt => [dt, await api('GET', resource('DocType', dt))])));
  const [customFields, propertySetters, customPermissions, workflowRows, roles] = await Promise.all([
    listAllEcrSchemaRows(api, 'Custom Field', ['*'], [['dt', 'in', RFQ_CONTRACT_DOCTYPES]]),
    listAllEcrSchemaRows(api, 'Property Setter', ['*'], [['doc_type', 'in', RFQ_CONTRACT_DOCTYPES]]),
    listAllEcrSchemaRows(api, 'Custom DocPerm', ['*'], [['parent', 'in', RFQ_CONTRACT_DOCTYPES]]),
    listAllEcrSchemaRows(api, 'Workflow', ['name']), listAllEcrSchemaRows(api, 'Role', ['name']),
  ]);
  const workflows = await Promise.all(workflowRows.map(row => api('GET', resource('Workflow', row.name))));
  const records = {};
  for (const dt of RFQ_CONTRACT_DOCTYPES) {
    const rows = await listAllEcrSchemaRows(api, dt, ['name']); records[dt] = [];
    for (let start = 0; start < rows.length; start += 8) records[dt].push(...await Promise.all(rows.slice(start, start + 8).map(row => api('GET', resource(dt, row.name)))));
  }
  return { doctypes, customFields, propertySetters, customPermissions, workflows, roles, records };
}

export function verifyRfqContractMigration(before, after, plan) {
  const stable = value => JSON.stringify(value);
  for (const key of ['roles', 'workflows', 'customPermissions']) if (stable(before[key]) !== stable(after[key])) throw new Error(`${key} changed during migration.`);
  for (const dt of RFQ_CONTRACT_DOCTYPES) {
    if (stable(before.doctypes[dt].permissions) !== stable(after.doctypes[dt].permissions)) throw new Error(`${dt} permissions changed.`);
    const normalize = rows => rows.map(row => {
      const copy = structuredClone(row);
      if (dt === 'Request for Quotation' && !resolveClmField(before, requirement)) {
        const field = plan.bindings.contract_required;
        if (copy[field] != null && copy[field] !== 'No' && copy[field] !== '') throw new Error(`${row.name} has an unexpected new requirement value.`);
        delete copy[field];
      }
      return copy;
    });
    if (stable(normalize(before.records[dt])) !== stable(normalize(after.records[dt]))) throw new Error(`${dt} records changed during migration.`);
  }
  if (planRfqContractSchema(after).operations.length) throw new Error('Schema verification incomplete; second plan must be empty.');
  return { verified: true, operations: plan.operations.length, recordsPreserved: Object.values(before.records).reduce((sum, rows) => sum + rows.length, 0), workflowsPreserved: before.workflows.length, permissionsPreserved: true, rolesPreserved: true, bindings: plan.bindings };
}

export const applyRfqContractSchemaPlan = applyClmSchemaPlan;
