import { ecrSchemaResource as resource, listAllEcrSchemaRows } from './ecr-schema-erp-client.mjs';

const condition = 'doc.custom_rfq and doc.custom_clm_data';
const role = 'System Manager'; // Existing gateway role on the managed CLM workflows; no role is added or granted.
export const RFQ_CLM_WORKFLOW_BRANCHES = Object.freeze([
  { name: 'BidSphere Contract Lifecycle', dt: 'Contract', field: 'custom_contract_status', states: ['Pending Legal', 'Pending Finance', 'Rejected'], edges: [
    ['Draft', 'Submit RFQ CLM Legal', 'Pending Legal'],
    ['Pending Legal', 'Approve RFQ CLM Legal', 'Approved'],
    ['Pending Legal', 'Return RFQ CLM Legal', 'Draft'],
    ['Pending Legal', 'Reject RFQ CLM Legal', 'Rejected'],
    ['Pending Signature', 'Submit RFQ CLM Finance', 'Pending Finance'],
    ['Pending Finance', 'Approve RFQ CLM Finance', 'Executed'],
    ['Pending Finance', 'Return RFQ CLM Finance', 'Draft'],
    ['Pending Finance', 'Reject RFQ CLM Finance', 'Rejected'],
  ] },
  { name: 'BidSphere Contract Request', dt: 'Contract Request', field: 'request_status', states: [], edges: [
    ['Draft', 'Convert RFQ Award Draft', 'Completed'],
  ] },
]);
const stable = value => JSON.stringify(value);
const rowContent = row => Object.fromEntries(Object.entries(row).filter(([key]) => !['name', 'creation', 'modified', 'modified_by', 'owner', 'parent', 'parenttype', 'parentfield', 'doctype', 'idx', 'docstatus'].includes(key)));
const sameContent = (a, b) => stable(rowContent(a)) === stable(rowContent(b));

/** Extend only the established CLM workflows; preserve every existing row. */
export function planRfqClmWorkflowSchema(snapshot) {
  const operations = [];
  for (const branch of RFQ_CLM_WORKFLOW_BRANCHES) {
    const active = (snapshot.workflows ?? []).filter(row => row.document_type === branch.dt && Number(row.is_active) === 1);
    if (!active.length) continue; // No workflow imposes transition validation; never activate one as a side effect.
    if (active.length !== 1 || active[0].name !== branch.name || active[0].workflow_state_field !== branch.field) throw new Error(`Existing active ${branch.dt} workflow requires manual review; it will not be replaced.`);
    const workflow = active[0];
    if (!workflow.states?.some(row => row.state === 'Draft' && String(row.doc_status) === '0' && row.allow_edit === role) || !workflow.transitions?.some(row => row.allowed === role)) throw new Error(`Existing ${branch.name} gateway permissions differ; no permission changes will be made.`);
    const states = structuredClone(workflow.states), transitions = structuredClone(workflow.transitions);
    for (const state of branch.states) {
      const found = states.filter(row => row.state === state);
      if (found.length > 1 || found.some(row => String(row.doc_status) !== '0' || row.allow_edit !== role || row.update_field || row.update_value)) throw new Error(`Existing ${branch.name} state ${state} conflicts with the RFQ branch; no row will be overwritten.`);
      if (!found.length) states.push({ state, doc_status: '0', allow_edit: role });
      if (!(snapshot.workflowStates ?? []).some(row => row.name === state) && !operations.some(row => row.kind === 'create-workflow-state' && row.document.workflow_state_name === state)) operations.push({ kind: 'create-workflow-state', document: { workflow_state_name: state, style: 'Primary' } });
    }
    for (const [state, action, next_state] of branch.edges) {
      if (!states.some(row => row.state === state) || !states.some(row => row.state === next_state)) throw new Error(`Missing existing ${branch.name} source/target state; no replacement workflow will be created.`);
      const desired = { state, action, next_state, allowed: role, allow_self_approval: 1, condition };
      const found = transitions.filter(row => row.state === state && row.action === action);
      if (found.length > 1 || found.some(row => Object.entries(desired).some(([key, value]) => key === 'allow_self_approval' ? Number(row[key]) !== value : row[key] !== value) || row.transition_tasks)) throw new Error(`Existing ${branch.name} action ${action} conflicts; no transition will be overwritten.`);
      if (!found.length) transitions.push(desired);
      if (!(snapshot.workflowActions ?? []).some(row => row.name === action) && !operations.some(row => row.kind === 'create-workflow-action' && row.document.workflow_action_name === action)) operations.push({ kind: 'create-workflow-action', document: { workflow_action_name: action } });
    }
    if (states.length !== workflow.states.length || transitions.length !== workflow.transitions.length) {
      // Frappe Workflow.on_update defaults empty state fields on saved records.
      // Refuse such a site instead of permitting an incidental record migration.
      if (!Array.isArray(snapshot.records?.[branch.dt]) || snapshot.records[branch.dt].some(row => !String(row[branch.field] ?? '').trim())) throw new Error(`Existing ${branch.dt} record inventory contains a blank workflow state; no records will be rewritten.`);
      const existingFields = [...(snapshot.doctypes?.[branch.dt]?.fields ?? []), ...(snapshot.customFields ?? []).filter(row => row.dt === branch.dt)];
      if (!existingFields.some(row => row.fieldname === branch.field)) throw new Error(`Existing ${branch.dt}.${branch.field} is required; this patch will not create a field.`);
      operations.push({ kind: 'append-workflow-rows', doctype: branch.dt, name: workflow.name, modified: workflow.modified, document: { ...structuredClone(workflow), states, transitions } });
    }
  }
  return { operations, recordMigration: false, existingRowsChanged: false, rfqWorkflowChanges: false, businessCaseWorkflowChanges: false, permissionChanges: false, newDoctypes: [], newRoles: [] };
}

export async function loadRfqClmWorkflowSchema(api) {
  const [names, workflowStates, workflowActions, roles] = await Promise.all([
    listAllEcrSchemaRows(api, 'Workflow', ['name']), listAllEcrSchemaRows(api, 'Workflow State', ['*']), listAllEcrSchemaRows(api, 'Workflow Action Master', ['*']), listAllEcrSchemaRows(api, 'Role', ['name']),
  ]);
  const workflows = await Promise.all(names.map(row => api('GET', resource('Workflow', row.name))));
  const records = {}, doctypes = {};
  for (const dt of ['Contract', 'Contract Request']) {
    doctypes[dt] = await api('GET', resource('DocType', dt));
    const rows = await listAllEcrSchemaRows(api, dt, ['name']);
    records[dt] = [];
    for (let i = 0; i < rows.length; i += 8) records[dt].push(...await Promise.all(rows.slice(i, i + 8).map(row => api('GET', resource(dt, row.name)))));
  }
  const [customPermissions, customFields] = await Promise.all([
    listAllEcrSchemaRows(api, 'Custom DocPerm', ['*'], [['parent', 'in', ['Contract', 'Contract Request']]]),
    listAllEcrSchemaRows(api, 'Custom Field', ['*'], [['dt', 'in', ['Contract', 'Contract Request']]]),
  ]);
  return { workflows, workflowStates, workflowActions, roles, records, doctypes, customPermissions, customFields };
}

/** Caller must back up the complete snapshot first. No workflow is activated or replaced. */
export async function applyRfqClmWorkflowSchemaPlan(api, snapshot, plan) {
  for (const operation of plan.operations) {
    if (operation.kind === 'create-workflow-state') await api('POST', resource('Workflow State'), operation.document);
    else if (operation.kind === 'create-workflow-action') await api('POST', resource('Workflow Action Master'), operation.document);
    else if (operation.kind === 'append-workflow-rows') {
      const current = await api('GET', resource('Workflow', operation.name));
      if (current.modified !== operation.modified || stable(current.states) !== stable(snapshot.workflows.find(row => row.name === operation.name).states) || stable(current.transitions) !== stable(snapshot.workflows.find(row => row.name === operation.name).transitions)) throw new Error(`Workflow ${operation.name} changed after inspection; retry with a fresh snapshot.`);
      await api('POST', 'method/frappe.client.save', { doc: operation.document });
    } else throw new Error(`Unsupported RFQ CLM workflow operation ${operation.kind}.`);
  }
}

export function verifyRfqClmWorkflowMigration(before, after, plan) {
  for (const key of ['records', 'roles', 'customPermissions', 'customFields']) if (stable(before[key]) !== stable(after[key])) throw new Error(`${key} changed during the RFQ CLM workflow patch.`);
  for (const dt of ['Contract', 'Contract Request']) if (stable(before.doctypes?.[dt]) !== stable(after.doctypes?.[dt])) throw new Error(`${dt} schema or permissions changed during the workflow patch.`);
  const updates = plan.operations.filter(row => row.kind === 'append-workflow-rows');
  for (const original of before.workflows) {
    const next = after.workflows.find(row => row.name === original.name);
    const update = updates.find(row => row.name === original.name);
    if (!next || !update && stable(original) !== stable(next)) throw new Error(`Unrelated workflow ${original.name} changed.`);
    if (!update) continue;
    for (const [key, value] of Object.entries(rowContent(original))) if (!['states', 'transitions'].includes(key) && stable(value) !== stable(rowContent(next)[key])) throw new Error(`Existing ${original.name}.${key} changed.`);
    for (const field of ['states', 'transitions']) {
      if (next[field].length !== update.document[field].length) throw new Error(`Unexpected ${original.name}.${field} rows.`);
      for (let i = 0; i < original[field].length; i++) if (!sameContent(original[field][i], next[field][i])) throw new Error(`Existing ${original.name}.${field} row changed.`);
      for (let i = original[field].length; i < next[field].length; i++) if (Object.entries(update.document[field][i]).some(([key, value]) => String(next[field][i][key]) !== String(value))) throw new Error(`RFQ ${original.name}.${field} row was not persisted.`);
    }
  }
  if (before.workflows.length !== after.workflows.length) throw new Error('A Workflow was added or removed.');
  for (const key of ['workflowStates', 'workflowActions']) for (const original of before[key] ?? []) {
    if (stable(original) !== stable(after[key].find(row => row.name === original.name))) throw new Error(`Existing ${key} master changed.`);
  }
  if (planRfqClmWorkflowSchema(after).operations.length) throw new Error('RFQ CLM workflow verification incomplete.');
  return { verified: true, operations: plan.operations.length, recordsPreserved: Object.values(before.records ?? {}).reduce((n, rows) => n + rows.length, 0), existingWorkflowRowsPreserved: true, rolesPreserved: true, permissionsPreserved: true };
}
