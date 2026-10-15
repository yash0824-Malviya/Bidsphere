import { ecrSchemaResource as resource, listAllEcrSchemaRows as list } from './ecr-schema-erp-client.mjs';

const doctypes = ['Contract', 'Contract Request', 'Request for Quotation'];
const targets = [
  { dt: 'Contract', fieldname: 'custom_contract_request', fieldtype: 'Link', options: 'Contract Request', property: 'unique' },
  { dt: 'Request for Quotation', fieldname: 'contract_required', fieldtype: 'Select', property: 'allow_on_submit' },
];
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const withoutModified = value => Array.isArray(value) ? value.map(withoutModified) : value && typeof value === 'object'
  ? Object.fromEntries(Object.entries(value).filter(([key]) => !['modified', 'modified_by'].includes(key)).map(([key, entry]) => [key, withoutModified(entry)])) : value;

function existingField(snapshot, dt, fieldname) {
  const definition = snapshot.doctypes?.[dt];
  if (definition?.name !== dt) throw new Error(`Existing ${dt} DocType is required.`);
  const matches = [
    ...(definition.fields ?? []).filter(row => row.fieldname === fieldname).map(row => ({ ...row, source: 'native' })),
    ...(snapshot.customFields ?? []).filter(row => row.dt === dt && row.fieldname === fieldname).map(row => ({ ...row, source: 'custom' })),
  ];
  if (matches.length !== 1) throw new Error(`Expected exactly one existing ${dt}.${fieldname}; no field will be created or renamed.`);
  const field = matches[0];
  const setters = (snapshot.propertySetters ?? []).filter(row => row.doc_type === dt && row.field_name === fieldname);
  const seen = new Set();
  for (const setter of setters) {
    if (seen.has(setter.property)) throw new Error(`Ambiguous ${dt}.${fieldname}.${setter.property} overrides.`);
    seen.add(setter.property);
    field[setter.property] = setter.value;
  }
  return { field, setters };
}

/** No records are normalized/deleted. NULL remains valid for standalone Contracts. */
export function inspectContractRequestUniqueness(records) {
  if (!Array.isArray(records)) throw new Error('Complete Contract inventory is required before adding uniqueness.');
  const seen = new Map();
  let nullLinks = 0;
  for (const row of records) {
    const raw = row.custom_contract_request;
    if (raw == null) { nullLinks++; continue; }
    if (typeof raw !== 'string' || !raw.trim()) throw new Error(`Contract ${row.name} has a non-null blank or invalid request link; review it first. No records will be rewritten.`);
    const value = raw.trim();
    // Conservative collision check for the usual case/accent-insensitive MariaDB collation.
    // The database index remains the authoritative duplicate check.
    const key = value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
    if (seen.has(key)) throw new Error(`Contracts ${seen.get(key)} and ${row.name} reference the same Contract Request ${value}; no records will be deleted or rewritten.`);
    seen.set(key, row.name);
  }
  return { contractsScanned: records.length, linkedContracts: seen.size, standaloneNullLinks: nullLinks };
}

export function planRfqClmRestSchema(snapshot) {
  const requestLink = existingField(snapshot, 'Contract Request', 'custom_rfq').field;
  if (requestLink.fieldtype !== 'Link' || requestLink.options !== 'Request for Quotation' || Number(requestLink.unique) !== 1 || Number(requestLink.reqd)) {
    throw new Error('Existing optional, unique Contract Request.custom_rfq is required; this patch does not change it.');
  }
  const inventory = inspectContractRequestUniqueness(snapshot.records?.Contract);
  const operations = [];
  for (const target of targets) {
    const { field, setters } = existingField(snapshot, target.dt, target.fieldname);
    if (field.fieldtype !== target.fieldtype || (target.options && field.options !== target.options)) throw new Error(`${target.dt}.${target.fieldname} has an incompatible field definition.`);
    if (target.dt === 'Contract' && (Number(field.reqd) || Number(field.not_nullable) || String(field.default ?? '').trim())) {
      throw new Error('Contract.custom_contract_request must remain optional and nullable with no default for standalone Contracts.');
    }
    if (target.dt === 'Request for Quotation' && !['Yes', 'No'].every(value => String(field.options).split(/\r?\n/).includes(value))) throw new Error('Existing RFQ contract_required must support Yes and No.');
    if (Number(field[target.property]) === 1) continue;
    if (field.source !== 'custom') throw new Error(`${target.dt}.${target.fieldname} must be the existing Custom Field; this patch creates no Property Setters.`);
    if (setters.some(row => row.property === target.property)) throw new Error(`Existing ${target.dt}.${target.fieldname}.${target.property} override requires review; it will not be replaced.`);
    if (!field.name || !field.modified) throw new Error(`Complete Custom Field metadata is required for ${target.dt}.${target.fieldname}.`);
    operations.push({ kind: 'update-custom-field', doctype: target.dt, fieldname: target.fieldname, name: field.name, modified: field.modified, patch: { [target.property]: 1 } });
  }
  return { operations, inventory, recordMigration: false, workflowChanges: false, permissionChanges: false, newFields: [], newDoctypes: [], newRoles: [] };
}

async function fullRecords(api, dt) {
  const names = await list(api, dt, ['name']);
  const records = [];
  for (let start = 0; start < names.length; start += 8) records.push(...await Promise.all(names.slice(start, start + 8).map(row => api('GET', resource(dt, row.name)))));
  return records;
}

/** Captures complete affected definitions, records, workflow and permission metadata. */
export async function loadRfqClmRestSchema(api) {
  const [definitions, customFields, propertySetters, customPermissions, roles, workflowNames, recordEntries] = await Promise.all([
    Promise.all(doctypes.map(async dt => [dt, await api('GET', resource('DocType', dt))])),
    list(api, 'Custom Field', ['*'], [['dt', 'in', doctypes]]),
    list(api, 'Property Setter', ['*'], [['doc_type', 'in', doctypes]]),
    list(api, 'Custom DocPerm', ['*'], [['parent', 'in', doctypes]]),
    list(api, 'Role', ['name']),
    list(api, 'Workflow', ['name']),
    Promise.all(doctypes.map(async dt => [dt, await fullRecords(api, dt)])),
  ]);
  const workflows = await Promise.all(workflowNames.map(row => api('GET', resource('Workflow', row.name))));
  return { doctypes: Object.fromEntries(definitions), customFields, propertySetters, customPermissions, roles, workflows, records: Object.fromEntries(recordEntries) };
}

export function verifyRfqClmRestSchema(before, after, plan) {
  for (const key of ['records', 'roles', 'workflows', 'customPermissions', 'propertySetters', 'doctypes']) {
    if (!same(before[key], after[key])) throw new Error(`${key} changed during the REST CLM prerequisite update.`);
  }
  const expectedFields = structuredClone(before.customFields);
  for (const operation of plan.operations) Object.assign(expectedFields.find(row => row.name === operation.name), operation.patch);
  if (!same(withoutModified(expectedFields), withoutModified(after.customFields))) throw new Error('Unexpected Custom Field changes during the REST CLM prerequisite update.');
  if (planRfqClmRestSchema(after).operations.length) throw new Error('REST CLM schema verification incomplete.');
  return { verified: true, operations: plan.operations.length, recordsPreserved: Object.values(before.records).reduce((sum, rows) => sum + rows.length, 0), workflowsPreserved: true, permissionsPreserved: true, standaloneContractsRemainOptional: true };
}

/** The caller must durably save the complete backup before this function is invoked. */
export async function applyRfqClmRestSchemaPlan(api, before, plan) {
  if (!same(plan, planRfqClmRestSchema(before))) throw new Error('Refusing an altered REST CLM prerequisite plan.');
  // Re-read immediately before writes. Do not apply a reviewed plan to changed data/metadata.
  const current = await loadRfqClmRestSchema(api);
  if (!same(current, before)) throw new Error('ERP schema or records changed after the backup; rerun --check and review a fresh plan. Nothing was changed.');
  for (const operation of plan.operations) {
    const savedField = current.customFields.find(row => row.name === operation.name);
    // Standard Frappe CustomField.save validates and updates the database schema/cache.
    // No ignore_validate flags, workflow edits, or business document writes are used.
    await api('POST', 'method/frappe.client.save', { doc: { ...savedField, doctype: 'Custom Field', ...operation.patch } });
  }
}
