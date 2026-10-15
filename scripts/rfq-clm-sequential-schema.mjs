import { ecrSchemaResource as resource, listAllEcrSchemaRows } from './ecr-schema-erp-client.mjs';
import { appendClmSelectOptions, applyClmSchemaPlan } from './clm-schema.mjs';

const dt = 'Contract';
const fieldname = 'custom_contract_status';
export const RFQ_CLM_SEQUENTIAL_STATUSES = Object.freeze(['Pending Legal', 'Pending Finance', 'Rejected']);

function statusField(snapshot) {
  if (snapshot.doctypes?.[dt]?.name !== dt) throw new Error('Existing Contract DocType is required; no DocType will be created.');
  const fields = [
    ...(snapshot.doctypes[dt].fields ?? []).filter(row => row.fieldname === fieldname).map(row => ({ ...row, source: 'native' })),
    ...(snapshot.customFields ?? []).filter(row => row.dt === dt && row.fieldname === fieldname).map(row => ({ ...row, source: 'custom' })),
  ];
  if (fields.length !== 1) throw new Error('Expected exactly one existing Contract.custom_contract_status; no duplicate field will be created.');
  if (fields[0].fieldtype !== 'Select') throw new Error('Contract.custom_contract_status must remain a Select.');
  const setters = (snapshot.propertySetters ?? []).filter(row => row.doc_type === dt && row.field_name === fieldname && row.property === 'options');
  if (setters.length > 1) throw new Error('Multiple Contract status option overrides exist; reconcile them first.');
  return { found: { ...fields[0], ...(setters[0] ? { options: setters[0].value } : {}) }, setter: setters[0] };
}

/** Append only absent RFQ-specific lifecycle labels. No document data or workflow edits. */
export function planRfqClmSequentialSchema(snapshot) {
  const { found, setter } = statusField(snapshot);
  const options = appendClmSelectOptions(found.options, RFQ_CLM_SEQUENTIAL_STATUSES);
  const operations = [];
  if (options !== found.options) {
    if (setter) operations.push({ kind: 'update-property-setter', doctype: dt, name: setter.name, modified: setter.modified, patch: { value: options } });
    else if (found.source === 'custom') operations.push({ kind: 'update-custom-field', doctype: dt, name: found.name, modified: found.modified, patch: { options } });
    else if (Number(snapshot.doctypes[dt].custom) === 1) operations.push({ kind: 'update-native-field', doctype: dt, fieldname, patch: { options } });
    else operations.push({ kind: 'create-property-setter', doctype: dt, document: { doctype_or_field: 'DocField', doc_type: dt, field_name: fieldname, property: 'options', property_type: 'Text', value: options } });
  }
  return { operations, recordMigration: false, workflowChanges: false, permissionChanges: false, defaultChanges: false, newDoctypes: [], newRoles: [] };
}

export async function loadRfqClmSequentialSchema(api) {
  const [doctype, customFields, propertySetters, customPermissions, roles, workflowNames, names] = await Promise.all([
    api('GET', resource('DocType', dt)),
    listAllEcrSchemaRows(api, 'Custom Field', ['*'], [['dt', '=', dt]]),
    listAllEcrSchemaRows(api, 'Property Setter', ['*'], [['doc_type', '=', dt]]),
    listAllEcrSchemaRows(api, 'Custom DocPerm', ['*'], [['parent', '=', dt]]),
    listAllEcrSchemaRows(api, 'Role', ['name']), listAllEcrSchemaRows(api, 'Workflow', ['name']), listAllEcrSchemaRows(api, dt, ['name']),
  ]);
  const workflows = await Promise.all(workflowNames.map(row => api('GET', resource('Workflow', row.name))));
  const records = [];
  for (let i = 0; i < names.length; i += 8) records.push(...await Promise.all(names.slice(i, i + 8).map(row => api('GET', resource(dt, row.name)))));
  return { doctypes: { [dt]: doctype }, customFields, propertySetters, customPermissions, roles, workflows, records: { [dt]: records } };
}

export function verifyRfqClmSequentialMigration(before, after, plan) {
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  for (const key of ['records', 'roles', 'workflows', 'customPermissions']) if (!same(before[key], after[key])) throw new Error(`${key} changed during the RFQ CLM status schema patch.`);
  const permissions = rows => (rows ?? []).map(({ modified, modified_by, ...row }) => row);
  if (!same(permissions(before.doctypes[dt].permissions), permissions(after.doctypes[dt].permissions))) throw new Error('Contract permissions changed.');
  const old = statusField(before).found, next = statusField(after).found;
  for (const key of ['fieldtype', 'reqd', 'default', 'read_only', 'hidden']) if (!same(old[key], next[key])) throw new Error(`Contract status ${key} changed.`);
  if (next.options !== appendClmSelectOptions(old.options, RFQ_CLM_SEQUENTIAL_STATUSES)) throw new Error('Existing Contract status options changed or new options were not persisted.');
  const unrelatedFields = rows => (rows ?? []).filter(row => row.fieldname !== fieldname).map(({ modified, modified_by, ...row }) => row);
  if (!same(unrelatedFields(before.customFields), unrelatedFields(after.customFields)) || !same(unrelatedFields(before.doctypes[dt].fields), unrelatedFields(after.doctypes[dt].fields))) throw new Error('Unrelated Contract fields changed.');
  const unrelatedSetters = rows => (rows ?? []).filter(row => row.field_name !== fieldname || row.property !== 'options');
  if (!same(unrelatedSetters(before.propertySetters), unrelatedSetters(after.propertySetters))) throw new Error('Unrelated Contract property setters changed.');
  if (planRfqClmSequentialSchema(after).operations.length) throw new Error('Contract status schema verification incomplete.');
  return { verified: true, operations: plan.operations.length, recordsPreserved: before.records?.[dt]?.length ?? 0, workflowsPreserved: true, permissionsPreserved: true, rolesPreserved: true, defaultsPreserved: true };
}

export const applyRfqClmSequentialSchemaPlan = applyClmSchemaPlan;
