import { ecrSchemaResource as resource, listAllEcrSchemaRows } from './ecr-schema-erp-client.mjs';
import { applyClmSchemaPlan, resolveClmField } from './clm-schema.mjs';

export const RFQ_CLM_AWARD_STATE = Object.freeze({
  dt: 'Legal Document Review', fieldname: 'custom_clm_state', label: 'RFQ Contract Lifecycle State', fieldtype: 'Long Text',
  aliases: ['clm_state', 'custom_clm_data', 'clm_data', 'custom_contract_lifecycle_state', 'contract_lifecycle_state'],
  equivalentLabels: ['CLM State', 'CLM Runtime Data', 'Contract Lifecycle State', 'RFQ CLM State'],
});
const protectedProperties = { read_only: 1, hidden: 1, no_copy: 1, allow_on_submit: 1 };
const clean = value => String(value ?? '').trim();

function changeProperty(snapshot, operations, found, property, value) {
  const matches = (snapshot.propertySetters ?? []).filter(row => row.doc_type === RFQ_CLM_AWARD_STATE.dt && row.field_name === found.fieldname && row.property === property);
  if (matches.length > 1) throw new Error(`Multiple ${property} overrides exist for the award CLM state.`);
  if (matches.length) {
    const setter = matches[0];
    operations.push({ kind: 'update-property-setter', doctype: RFQ_CLM_AWARD_STATE.dt, name: setter.name, modified: setter.modified, patch: { value: String(value) } });
  } else if (found.source === 'custom') {
    const pending = operations.find(row => row.kind === 'update-custom-field' && row.name === found.name);
    if (pending) pending.patch[property] = value;
    else operations.push({ kind: 'update-custom-field', doctype: RFQ_CLM_AWARD_STATE.dt, name: found.name, modified: found.modified, patch: { [property]: value } });
  } else {
    operations.push({ kind: 'create-property-setter', doctype: RFQ_CLM_AWARD_STATE.dt, document: { doctype_or_field: 'DocField', doc_type: RFQ_CLM_AWARD_STATE.dt, field_name: found.fieldname, property, property_type: 'Check', value: String(value) } });
  }
}

/** One optional server-managed award field; never changes a workflow or existing record. */
export function planRfqClmLifecycleSchema(snapshot) {
  const dt = snapshot.doctypes?.[RFQ_CLM_AWARD_STATE.dt];
  if (dt?.name !== RFQ_CLM_AWARD_STATE.dt || !Array.isArray(dt.fields)) throw new Error('Existing Legal Document Review DocType is required; no DocType will be created.');
  const found = resolveClmField(snapshot, RFQ_CLM_AWARD_STATE);
  const operations = [];
  if (found && found.fieldname !== RFQ_CLM_AWARD_STATE.fieldname) throw new Error(`Equivalent award field ${found.fieldname} already exists. Map that field in the integration before proceeding; no duplicate field will be created.`);
  if (!found) {
    const { aliases, equivalentLabels, ...descriptor } = RFQ_CLM_AWARD_STATE;
    operations.push({ kind: 'create-custom-field', doctype: descriptor.dt, document: {
      ...descriptor, ...protectedProperties, reqd: 0, default: '', insert_after: dt.fields.at(-1)?.fieldname,
      description: 'Server-managed RFQ contract identity and lifecycle evidence. Empty preserves the existing award workflow. This field never replaces Legal, Finance, evaluation or award status.',
    } });
  } else {
    if (Number(found.reqd ?? 0) || clean(found.default)) throw new Error('Award CLM state must remain optional and default-empty; existing values will not be rewritten.');
    for (const [property, value] of Object.entries(protectedProperties)) if (Number(found[property] ?? 0) !== value) changeProperty(snapshot, operations, found, property, value);
  }
  return { operations, bindings: { award_state: found?.fieldname ?? RFQ_CLM_AWARD_STATE.fieldname }, recordMigration: false, workflowChanges: false, permissionChanges: false, newDoctypes: [], newRoles: [] };
}

export async function loadRfqClmLifecycleSchema(api) {
  const dt = RFQ_CLM_AWARD_STATE.dt;
  const [doctype, customFields, propertySetters, customPermissions, roles, workflowRows, recordRows] = await Promise.all([
    api('GET', resource('DocType', dt)),
    listAllEcrSchemaRows(api, 'Custom Field', ['*'], [['dt', '=', dt]]),
    listAllEcrSchemaRows(api, 'Property Setter', ['*'], [['doc_type', '=', dt]]),
    listAllEcrSchemaRows(api, 'Custom DocPerm', ['*'], [['parent', '=', dt]]),
    listAllEcrSchemaRows(api, 'Role', ['name']),
    listAllEcrSchemaRows(api, 'Workflow', ['name']),
    listAllEcrSchemaRows(api, dt, ['name']),
  ]);
  const workflows = await Promise.all(workflowRows.map(row => api('GET', resource('Workflow', row.name))));
  const records = [];
  for (let index = 0; index < recordRows.length; index += 8) records.push(...await Promise.all(recordRows.slice(index, index + 8).map(row => api('GET', resource(dt, row.name)))));
  return { doctypes: { [dt]: doctype }, customFields, propertySetters, customPermissions, roles, workflows, records: { [dt]: records } };
}

export function verifyRfqClmLifecycleMigration(before, after, plan) {
  const dt = RFQ_CLM_AWARD_STATE.dt;
  const stable = value => JSON.stringify(value);
  for (const key of ['roles', 'workflows', 'customPermissions']) if (stable(before[key]) !== stable(after[key])) throw new Error(`${key} changed during the award CLM schema patch.`);
  if (stable(before.doctypes[dt].permissions) !== stable(after.doctypes[dt].permissions)) throw new Error('Award permissions changed.');
  if (stable(before.doctypes[dt].fields) !== stable(after.doctypes[dt].fields)) throw new Error('Existing award DocType fields changed.');
  const fieldAdded = !resolveClmField(before, RFQ_CLM_AWARD_STATE);
  const normalize = rows => (rows ?? []).map(row => {
    const next = structuredClone(row);
    if (fieldAdded) {
      const value = next[RFQ_CLM_AWARD_STATE.fieldname];
      if (value != null && value !== '') throw new Error(`Existing award ${row.name} acquired lifecycle data during schema migration.`);
      delete next[RFQ_CLM_AWARD_STATE.fieldname];
    }
    return next;
  });
  if (stable(normalize(before.records?.[dt])) !== stable(normalize(after.records?.[dt]))) throw new Error('Existing award records changed.');
  const unrelatedFields = rows => (rows ?? []).filter(row => row.fieldname !== RFQ_CLM_AWARD_STATE.fieldname);
  if (stable(unrelatedFields(before.customFields)) !== stable(unrelatedFields(after.customFields))) throw new Error('Unrelated Custom Fields changed.');
  const unrelatedSetters = rows => (rows ?? []).filter(row => row.field_name !== RFQ_CLM_AWARD_STATE.fieldname);
  if (stable(unrelatedSetters(before.propertySetters)) !== stable(unrelatedSetters(after.propertySetters))) throw new Error('Unrelated Property Setters changed.');
  if (planRfqClmLifecycleSchema(after).operations.length) throw new Error('Award CLM schema verification incomplete; second plan must be empty.');
  return { verified: true, operations: plan.operations.length, recordsPreserved: before.records?.[dt]?.length ?? 0, workflowsPreserved: true, permissionsPreserved: true, rolesPreserved: true, bindings: plan.bindings };
}

export const applyRfqClmLifecycleSchemaPlan = applyClmSchemaPlan;
