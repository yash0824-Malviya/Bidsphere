import { ecrSchemaResource as resource, listAllEcrSchemaRows } from './ecr-schema-erp-client.mjs';
import { appendClmSelectOptions, applyClmSchemaPlan } from './clm-schema.mjs';

export const RFQ_AWARD_CONTRACT_TYPES = Object.freeze(['Supply / Procurement Contract', 'Service Agreement', 'NDA', 'Master Service Agreement', 'Other']);
export const RFQ_AWARD_CONTRACT_TYPE_FIELDS = Object.freeze([
  ['Contract', 'custom_contract_type'],
  ['Contract Request', 'contract_type'],
  ['Contract Approval Matrix', 'contract_type'],
  ['Contract Template', 'custom_contract_type'],
]);
const doctypes = RFQ_AWARD_CONTRACT_TYPE_FIELDS.map(([dt]) => dt);

function existingTypeField(snapshot, dt, fieldname) {
  if (snapshot.doctypes?.[dt]?.name !== dt) throw new Error(`Existing ${dt} DocType is required; no new DocType will be created.`);
  const matches = [
    ...(snapshot.doctypes[dt].fields ?? []).filter(row => row.fieldname === fieldname).map(row => ({ ...row, source: 'native' })),
    ...(snapshot.customFields ?? []).filter(row => row.dt === dt && row.fieldname === fieldname).map(row => ({ ...row, source: 'custom' })),
  ];
  if (matches.length !== 1) throw new Error(`Expected exactly one existing ${dt}.${fieldname}; no duplicate field will be created.`);
  const setters = (snapshot.propertySetters ?? []).filter(row => row.doc_type === dt && row.field_name === fieldname && row.property === 'options');
  if (setters.length > 1) throw new Error(`Multiple options overrides exist for ${dt}.${fieldname}; reconcile them first.`);
  const found = { ...matches[0], ...(setters[0] ? { options: setters[0].value } : {}) };
  if (found.fieldtype !== 'Select') throw new Error(`${dt}.${fieldname} must remain a Select; this patch cannot change its type.`);
  return { found, setter: setters[0] };
}

/** Extend only existing Select options. Retain legacy types, defaults and saved records. */
export function planRfqAwardContractSchema(snapshot) {
  const operations = [];
  for (const [dt, fieldname] of RFQ_AWARD_CONTRACT_TYPE_FIELDS) {
    const { found, setter } = existingTypeField(snapshot, dt, fieldname);
    const options = appendClmSelectOptions(found.options, RFQ_AWARD_CONTRACT_TYPES);
    if (options === found.options) continue;
    if (setter) operations.push({ kind: 'update-property-setter', doctype: dt, name: setter.name, modified: setter.modified, patch: { value: options } });
    else if (found.source === 'custom') operations.push({ kind: 'update-custom-field', doctype: dt, name: found.name, modified: found.modified, patch: { options } });
    else if (Number(snapshot.doctypes[dt].custom) === 1) operations.push({ kind: 'update-native-field', doctype: dt, fieldname, patch: { options } });
    else operations.push({ kind: 'create-property-setter', doctype: dt, document: { doctype_or_field: 'DocField', doc_type: dt, field_name: fieldname, property: 'options', property_type: 'Text', value: options } });
  }
  return { contractTypes: [...RFQ_AWARD_CONTRACT_TYPES], operations, recordMigration: false, workflowChanges: false, permissionChanges: false, defaultChanges: false, newDoctypes: [], newRoles: [] };
}

export async function loadRfqAwardContractSchema(api) {
  const definitions = Object.fromEntries(await Promise.all(doctypes.map(async dt => [dt, await api('GET', resource('DocType', dt))])));
  const [customFields, propertySetters, customPermissions, roles, workflowRows] = await Promise.all([
    listAllEcrSchemaRows(api, 'Custom Field', ['*'], [['dt', 'in', doctypes]]),
    listAllEcrSchemaRows(api, 'Property Setter', ['*'], [['doc_type', 'in', doctypes]]),
    listAllEcrSchemaRows(api, 'Custom DocPerm', ['*'], [['parent', 'in', doctypes]]),
    listAllEcrSchemaRows(api, 'Role', ['name']),
    listAllEcrSchemaRows(api, 'Workflow', ['name']),
  ]);
  const workflows = await Promise.all(workflowRows.map(row => api('GET', resource('Workflow', row.name))));
  const records = {};
  for (const dt of doctypes) {
    const names = await listAllEcrSchemaRows(api, dt, ['name']);
    records[dt] = [];
    for (let i = 0; i < names.length; i += 8) records[dt].push(...await Promise.all(names.slice(i, i + 8).map(row => api('GET', resource(dt, row.name)))));
  }
  return { doctypes: definitions, customFields, propertySetters, customPermissions, roles, workflows, records };
}

export function verifyRfqAwardContractMigration(before, after, plan) {
  const stable = value => JSON.stringify(value);
  // Frappe saves native DocPerm child rows with their parent DocType and
  // refreshes modification metadata. Every actual permission remains compared.
  const permissions = rows => (rows ?? []).map(({ modified, modified_by, ...row }) => row);
  for (const key of ['records', 'roles', 'workflows', 'customPermissions']) if (stable(before[key]) !== stable(after[key])) throw new Error(`${key} changed during the contract-type schema patch.`);
  for (const [dt, fieldname] of RFQ_AWARD_CONTRACT_TYPE_FIELDS) {
    if (stable(permissions(before.doctypes[dt].permissions)) !== stable(permissions(after.doctypes[dt].permissions))) throw new Error(`${dt} permissions changed.`);
    const old = existingTypeField(before, dt, fieldname).found;
    const next = existingTypeField(after, dt, fieldname).found;
    for (const property of ['fieldtype', 'reqd', 'default', 'read_only', 'hidden']) if (stable(old[property]) !== stable(next[property])) throw new Error(`${dt}.${fieldname}.${property} changed.`);
    const expected = appendClmSelectOptions(old.options, RFQ_AWARD_CONTRACT_TYPES);
    if (next.options !== expected) throw new Error(`${dt}.${fieldname} legacy options changed or required options were not persisted.`);
  }
  if (planRfqAwardContractSchema(after).operations.length) throw new Error('Schema verification incomplete; second plan must be empty.');
  return { verified: true, operations: plan.operations.length, recordsPreserved: Object.values(before.records ?? {}).reduce((count, rows) => count + rows.length, 0), workflowsPreserved: before.workflows?.length ?? 0, permissionsPreserved: true, rolesPreserved: true, defaultsPreserved: true };
}

export const applyRfqAwardContractSchemaPlan = applyClmSchemaPlan;
