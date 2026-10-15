import { ecrSchemaResource as resource, listAllEcrSchemaRows } from './ecr-schema-erp-client.mjs';

export const CLM_DOCTYPES = Object.freeze(['Contract', 'Contract Request', 'Contract Clause', 'Contract Approval Matrix', 'Contract Renewal', 'Contract Amendment', 'Contract Risk', 'Contract Milestone', 'Contract Obligation', 'Contract Template']);
export const CLM_CONTRACT_STATES = Object.freeze(['Draft', 'Under Review', 'Negotiation', 'Pending Approval', 'Approved', 'Pending Signature', 'Executed', 'Active', 'Expired', 'Terminated', 'Closed']);
export const CLM_REQUEST_STATES = Object.freeze(['Draft', 'Pending Review', 'Under Legal Review', 'Pending Approval', 'Approved', 'Rejected', 'Completed', 'Cancelled']);
export const CLM_EXISTING_FIELDS = Object.freeze({
  Contract: { status: 'custom_contract_status', type: 'custom_contract_type', request: 'custom_contract_request', rfq: 'custom_rfq', quotation: 'custom_supplier_quotation', purchaseOrder: 'custom_purchase_order', project: 'custom_project', businessUnit: 'custom_business_unit', supplier: 'custom_supplier', value: 'custom_contract_value', currency: 'custom_currency', version: 'custom_current_version', locked: 'custom_final_version_locked', document: 'custom_contract_document', executedDocument: 'custom_executed_contract', approvalStatus: 'custom_approval_status', esignStatus: 'custom_esign_status' },
  'Contract Request': { status: 'request_status', type: 'contract_type', supplier: 'supplier', value: 'contract_value', owner: 'requester', approvalStatus: 'approval_status' },
  'Contract Approval Matrix': { type: 'contract_type', sequence: 'approval_sequence', minimum: 'minimum_contract_value', maximum: 'maximum_contract_value', risk: 'risk_level' },
  'Contract Obligation': { owner: 'owne', dueDate: 'due_date', reminder: 'reminder_days_before', escalation: 'escalation_days', status: 'status' },
});
const field = (dt, fieldname, label, fieldtype, options, aliases = [], labels = []) => ({ dt, fieldname, label, fieldtype, ...(options === undefined ? {} : { options }), aliases, equivalentLabels: labels });
const runtime = dt => ({ ...field(dt, 'custom_clm_data', 'CLM Runtime Data', 'Long Text', undefined, ['clm_data', 'custom_clm_runtime_data', 'clm_runtime_data'], ['CLM Data', 'Contract Lifecycle Data']), hidden: 1, read_only: 1, no_copy: 1 });
export const CLM_FIELD_MANIFEST = Object.freeze([
  ...['Contract', 'Contract Request', 'Contract Amendment', 'Contract Renewal'].map(runtime),
  field('Contract Request', 'custom_rfq', 'RFQ', 'Link', 'Request for Quotation', ['rfq', 'request_for_quotation']),
  field('Contract Request', 'custom_supplier_quotation', 'Supplier Quotation', 'Link', 'Supplier Quotation', ['supplier_quotation']),
  field('Contract Request', 'custom_purchase_order', 'Purchase Order', 'Link', 'Purchase Order', ['purchase_order', 'po']),
  field('Contract Request', 'custom_project', 'Project', 'Link', 'Project', ['project']),
  field('Contract Request', 'custom_business_unit', 'Business Unit', 'Data', undefined, ['business_unit']),
  field('Contract', 'custom_rfp', 'RFP', 'Link', 'RFP', ['rfp']),
  field('Contract', 'custom_rfp_response', 'RFP Response', 'Link', 'RFP Response', ['rfp_response']),
  field('Contract Approval Matrix', 'custom_conditions', 'CLM Rule Conditions', 'Long Text', undefined, ['clm_conditions', 'rule_conditions', 'conditions'], ['Rule Conditions']),
  field('Contract Approval Matrix', 'custom_approval_stages', 'Approval Stages', 'Long Text', undefined, ['approval_stages', 'custom_route_stages', 'route_stages']),
  field('Contract Obligation', 'custom_quantity', 'Quantity', 'Float', undefined, ['quantity', 'qty']),
  field('Contract Obligation', 'custom_frequency', 'Frequency', 'Select', '\nOne Time\nDaily\nWeekly\nMonthly\nQuarterly\nAnnually', ['frequency']),
  field('Contract Obligation', 'custom_start_date', 'Start Date', 'Date', undefined, ['start_date']),
  field('Contract Obligation', 'custom_end_date', 'End Date', 'Date', undefined, ['end_date']),
]);
const typeFields = [['Contract', 'custom_contract_type'], ['Contract Request', 'contract_type'], ['Contract Approval Matrix', 'contract_type'], ['Contract Template', 'custom_contract_type']];
const clean = value => String(value ?? '').trim();
const labelKey = value => clean(value).toLowerCase().replace(/[^a-z0-9]/g, '');
const choices = value => String(value ?? '').split(/\r?\n/);
export function appendClmSelectOptions(existing, additions) {
  const list = choices(existing);
  for (const option of additions) if (clean(option) && !list.includes(option)) list.push(option);
  return list.join('\n');
}
function allFields(snapshot, dt) {
  const fields = [ ...(snapshot.doctypes[dt]?.fields ?? []).map(row => ({ ...row, source: 'native' })), ...(snapshot.customFields ?? []).filter(row => row.dt === dt).map(row => ({ ...row, source: 'custom' })) ];
  return fields.map(row => {
    const overrides = (snapshot.propertySetters ?? []).filter(setter => setter.doc_type === dt && setter.field_name === row.fieldname);
    return Object.assign({}, row, ...overrides.map(setter => ({ [setter.property]: setter.value })));
  });
}
export function resolveClmField(snapshot, descriptor) {
  const names = new Set([descriptor.fieldname, ...descriptor.aliases]);
  const labels = new Set([descriptor.label, ...descriptor.equivalentLabels].map(labelKey));
  const matches = allFields(snapshot, descriptor.dt).filter(row => names.has(row.fieldname) || labels.has(labelKey(row.label)));
  if (matches.length > 1) throw new Error(`Multiple fields may represent ${descriptor.dt}.${descriptor.fieldname}; inspect equivalents before migration.`);
  if (!matches.length) return null;
  const found = matches[0];
  if (found.fieldtype !== descriptor.fieldtype) throw new Error(`${descriptor.dt}.${found.fieldname} already exists as ${found.fieldtype}; expected ${descriptor.fieldtype}. Reuse requires an explicit compatible mapping.`);
  if (descriptor.fieldtype === 'Link' && found.options !== descriptor.options) throw new Error(`${descriptor.dt}.${found.fieldname} points to ${found.options}, not ${descriptor.options}.`);
  return found;
}
function existingField(snapshot, dt, fieldname) {
  const matches = allFields(snapshot, dt).filter(row => row.fieldname === fieldname);
  if (matches.length !== 1) throw new Error(`Expected exactly one existing ${dt}.${fieldname} field.`);
  return matches[0];
}
function fieldChange(snapshot, operations, dt, found, property, value) {
  const setter = (snapshot.propertySetters ?? []).find(row => row.doc_type === dt && row.field_name === found.fieldname && row.property === property);
  if (setter) operations.push({ kind: 'update-property-setter', doctype: dt, name: setter.name, modified: setter.modified, patch: { value: String(value) } });
  else if (found.source === 'custom') operations.push({ kind: 'update-custom-field', doctype: dt, name: found.name, modified: found.modified, patch: { [property]: value } });
  else if (Number(snapshot.doctypes[dt].custom) === 1) operations.push({ kind: 'update-native-field', doctype: dt, fieldname: found.fieldname, patch: { [property]: value } });
  else operations.push({ kind: 'create-property-setter', doctype: dt, document: { doctype_or_field: 'DocField', doc_type: dt, field_name: found.fieldname, property, property_type: typeof value === 'number' ? 'Check' : 'Text', value: String(value) } });
}
/** The migration only extends existing schema. No record, permission, role or DocType creation. */
export function planClmSchema(snapshot, { includeWorkflows = true } = {}) {
  for (const dt of CLM_DOCTYPES) if (snapshot.doctypes?.[dt]?.name !== dt || !Array.isArray(snapshot.doctypes[dt].fields)) throw new Error(`Existing DocType ${dt} is required; this migration will not recreate it.`);
  const operations = [];
  const bindings = {};
  for (const descriptor of CLM_FIELD_MANIFEST) {
    const found = resolveClmField(snapshot, descriptor);
    bindings[descriptor.dt] ??= {};
    bindings[descriptor.dt][descriptor.fieldname] = found?.fieldname ?? descriptor.fieldname;
    if (!found) {
      const { aliases, equivalentLabels, ...definition } = descriptor;
      operations.push({ kind: 'create-custom-field', doctype: descriptor.dt, document: { ...definition, reqd: 0, default: '', insert_after: (snapshot.doctypes[descriptor.dt].fields ?? []).at(-1)?.fieldname, description: descriptor.fieldname === 'custom_clm_data' ? 'Server-managed CLM route, immutable version references, signature evidence and audit. Empty means an existing record has not entered the managed CLM lifecycle.' : undefined } });
    } else {
      if (descriptor.fieldname === 'custom_clm_data' && (Number(found.reqd ?? 0) || clean(found.default))) throw new Error(`${descriptor.dt}.${found.fieldname} must remain optional with no automatic lifecycle default.`);
      for (const property of ['hidden', 'read_only', 'no_copy']) if (descriptor[property] !== undefined && Number(found[property] ?? 0) !== descriptor[property]) fieldChange(snapshot, operations, descriptor.dt, found, property, descriptor[property]);
      if (descriptor.fieldtype === 'Select') {
        const next = appendClmSelectOptions(found.options, choices(descriptor.options));
        if (next !== found.options) fieldChange(snapshot, operations, descriptor.dt, found, 'options', next);
      }
    }
  }
  const union = [...new Set(typeFields.flatMap(([dt, fieldname]) => {
    const found = existingField(snapshot, dt, fieldname);
    if (found.fieldtype !== 'Select') throw new Error(`${dt}.${fieldname} must remain a Select.`);
    return choices(found.options).filter(option => clean(option) && option !== 'All');
  }))];
  for (const [dt, fieldname] of typeFields) {
    const found = existingField(snapshot, dt, fieldname);
    const next = appendClmSelectOptions(found.options, union);
    if (next !== found.options) fieldChange(snapshot, operations, dt, found, 'options', next);
  }
  const sequence = existingField(snapshot, 'Contract Approval Matrix', 'approval_sequence');
  if (sequence.fieldtype !== 'Select') throw new Error('Contract Approval Matrix.approval_sequence must remain a Select.');
  const nextSequence = appendClmSelectOptions(sequence.options, ['Hybrid']);
  if (nextSequence !== sequence.options) fieldChange(snapshot, operations, 'Contract Approval Matrix', sequence, 'options', nextSequence);
  const workflowPlan = includeWorkflows ? planClmWorkflows(snapshot, bindings) : [];
  operations.push(...workflowPlan);
  return { bindings, contractTypes: union, operations, recordMigration: false, permissionChanges: false, newDoctypes: [], newRoles: [] };
}

const CONTRACT_EDGES = [
  ['Draft', 'Submit', 'Under Review'], ['Draft', 'Negotiate', 'Negotiation'],
  ['Under Review', 'Route Approval', 'Pending Approval'], ['Under Review', 'Approve', 'Approved'], ['Under Review', 'Negotiate', 'Negotiation'], ['Under Review', 'Send Back', 'Draft'], ['Under Review', 'Reject', 'Draft'], ['Under Review', 'Approve Termination', 'Terminated'], ['Under Review', 'Return Termination', 'Active'],
  ['Pending Approval', 'Approve', 'Approved'], ['Pending Approval', 'Send Back', 'Draft'], ['Pending Approval', 'Reject', 'Draft'], ['Pending Approval', 'Negotiate', 'Negotiation'], ['Pending Approval', 'Approve Termination', 'Terminated'], ['Pending Approval', 'Return Termination', 'Active'],
  ['Negotiation', 'Submit Revision', 'Under Review'], ['Negotiation', 'Revise Draft', 'Draft'],
  ['Approved', 'Request Signature', 'Pending Signature'], ['Approved', 'Revise Draft', 'Draft'], ['Approved', 'Reopen', 'Negotiation'],
  ['Pending Signature', 'Redline', 'Negotiation'], ['Pending Signature', 'Revise Draft', 'Draft'], ['Pending Signature', 'Execute', 'Executed'],
  ['Executed', 'Activate', 'Active'], ['Active', 'Expire', 'Expired'], ['Active', 'Request Termination', 'Under Review'], ['Expired', 'Close', 'Closed'], ['Terminated', 'Close', 'Closed'],
];
const REQUEST_EDGES = [
  ['Draft', 'Submit', 'Pending Review'], ['Pending Review', 'Approve', 'Approved'], ['Pending Review', 'Send Back', 'Draft'], ['Pending Review', 'Reject', 'Rejected'],
  ['Approved', 'Create Contract', 'Completed'], ['Under Legal Review', 'Send Back', 'Draft'], ['Under Legal Review', 'Approve', 'Approved'], ['Under Legal Review', 'Reject', 'Rejected'],
  ['Pending Approval', 'Send Back', 'Draft'], ['Pending Approval', 'Approve', 'Approved'], ['Pending Approval', 'Reject', 'Rejected'],
];
export const CLM_WORKFLOWS = Object.freeze([
  { name: 'BidSphere Contract Lifecycle', document_type: 'Contract', workflow_state_field: 'custom_contract_status', states: CLM_CONTRACT_STATES, edges: CONTRACT_EDGES },
  { name: 'BidSphere Contract Request', document_type: 'Contract Request', workflow_state_field: 'request_status', states: CLM_REQUEST_STATES, edges: REQUEST_EDGES },
]);
export function clmWorkflowDocument(definition, runtimeField = 'custom_clm_data') {
  return { workflow_name: definition.name, document_type: definition.document_type, is_active: 1, override_status: 0, send_email_alert: 0, workflow_state_field: definition.workflow_state_field,
    states: definition.states.map(state => ({ state, doc_status: '0', allow_edit: 'System Manager' })),
    transitions: definition.edges.map(([state, action, next_state]) => ({ state, action, next_state, allowed: 'System Manager', allow_self_approval: 1, condition: `doc.${runtimeField}` })),
  };
}
const workflowShape = doc => ({ document_type: doc.document_type, is_active: Number(doc.is_active), override_status: Number(doc.override_status || 0), send_email_alert: Number(doc.send_email_alert || 0), workflow_state_field: doc.workflow_state_field,
  states: (doc.states ?? []).map(row => ({ state: row.state, doc_status: String(row.doc_status), allow_edit: row.allow_edit })),
  transitions: (doc.transitions ?? []).map(row => ({ state: row.state, action: row.action, next_state: row.next_state, allowed: row.allowed, allow_self_approval: Number(row.allow_self_approval || 0), condition: clean(row.condition) })),
});
export function planClmWorkflows(snapshot, bindings = {}) {
  const operations = [];
  for (const definition of CLM_WORKFLOWS) {
    const active = (snapshot.workflows ?? []).filter(row => row.document_type === definition.document_type && Number(row.is_active) === 1);
    if (active.some(row => row.name !== definition.name)) throw new Error(`Existing active ${definition.document_type} workflow must be preserved; integration requires manual review.`);
    const existing = (snapshot.workflows ?? []).find(row => row.name === definition.name);
    const runtimeField = bindings[definition.document_type]?.custom_clm_data ?? 'custom_clm_data';
    const expected = clmWorkflowDocument(definition, runtimeField);
    if (existing) {
      if (JSON.stringify(workflowShape(existing)) !== JSON.stringify(workflowShape(expected))) throw new Error(`Existing ${definition.name} differs from the managed workflow; refusing to overwrite it.`);
      continue;
    }
    const rows = snapshot.records?.[definition.document_type];
    if (!Array.isArray(rows)) throw new Error(`Record inventory required before activating ${definition.document_type} workflow.`);
    for (const row of rows) {
      let data; try { data = typeof row[runtimeField] === 'string' ? JSON.parse(row[runtimeField]) : row[runtimeField]; } catch { data = undefined; }
      if (data?.schema !== 1 || Number(row.docstatus) !== 0 || !definition.states.includes(row[definition.workflow_state_field])) throw new Error(`Legacy ${definition.document_type} ${row.name} would be affected by workflow activation; no records will be rewritten.`);
    }
    for (const state of definition.states) if (!(snapshot.workflowStates ?? []).some(row => row.name === state) && !operations.some(operation => operation.kind === 'create-workflow-state' && operation.document.workflow_state_name === state)) operations.push({ kind: 'create-workflow-state', document: { workflow_state_name: state, style: 'Primary' } });
    for (const action of new Set(definition.edges.map(edge => edge[1]))) if (!(snapshot.workflowActions ?? []).some(row => row.name === action) && !operations.some(operation => operation.kind === 'create-workflow-action' && operation.document.workflow_action_name === action)) operations.push({ kind: 'create-workflow-action', document: { workflow_action_name: action } });
    operations.push({ kind: 'create-workflow', doctype: definition.document_type, document: expected });
  }
  return operations;
}

export async function loadClmSchema(api, { includeRecords = true } = {}) {
  const doctypes = {};
  for (const dt of CLM_DOCTYPES) doctypes[dt] = await api('GET', resource('DocType', dt));
  const [customFields, propertySetters, workflowRows, workflowStates, workflowActions, customPermissions] = await Promise.all([
    listAllEcrSchemaRows(api, 'Custom Field', ['*'], [['dt', 'in', CLM_DOCTYPES]]),
    listAllEcrSchemaRows(api, 'Property Setter', ['*'], [['doc_type', 'in', CLM_DOCTYPES]]),
    listAllEcrSchemaRows(api, 'Workflow', ['name'], [['document_type', 'in', CLM_DOCTYPES]]),
    listAllEcrSchemaRows(api, 'Workflow State', ['name']), listAllEcrSchemaRows(api, 'Workflow Action Master', ['name']),
    listAllEcrSchemaRows(api, 'Custom DocPerm', ['*'], [['parent', 'in', CLM_DOCTYPES]]),
  ]);
  const workflows = []; for (const row of workflowRows) workflows.push(await api('GET', resource('Workflow', row.name)));
  const snapshot = { doctypes, customFields, propertySetters, workflows, workflowStates, workflowActions, customPermissions, records: {} };
  if (includeRecords) for (const dt of CLM_DOCTYPES) {
    const records = []; for (const row of await listAllEcrSchemaRows(api, dt, ['name'])) records.push(await api('GET', resource(dt, row.name)));
    snapshot.records[dt] = records;
  }
  return snapshot;
}
/** Requires the caller to write its complete schema/record backup before invoking. */
export async function applyClmSchemaPlan(api, snapshot, plan) {
  const nativeUpdates = new Map();
  // Save native custom-DocType option changes before Custom Field creation can
  // invalidate their modified timestamps. Preserve every unrelated field/permission.
  for (const operation of plan.operations.filter(row => row.kind === 'update-native-field')) {
    if (!nativeUpdates.has(operation.doctype)) nativeUpdates.set(operation.doctype, structuredClone(snapshot.doctypes[operation.doctype]));
    const doc = nativeUpdates.get(operation.doctype);
    Object.assign(doc.fields.find(row => row.fieldname === operation.fieldname), operation.patch);
  }
  for (const doc of nativeUpdates.values()) await api('POST', 'method/frappe.client.save', { doc });
  for (const operation of plan.operations) {
    if (operation.kind === 'update-native-field') continue;
    if (operation.kind.startsWith('create-workflow')) continue;
    if (operation.kind === 'create-custom-field') await api('POST', resource('Custom Field'), operation.document);
    else if (operation.kind === 'update-custom-field') await api('PUT', resource('Custom Field', operation.name), { ...operation.patch, modified: operation.modified });
    else if (operation.kind === 'update-property-setter') await api('PUT', resource('Property Setter', operation.name), { ...operation.patch, modified: operation.modified });
    else if (operation.kind === 'create-property-setter') await api('POST', resource('Property Setter'), operation.document);
    else throw new Error(`Unsupported CLM migration operation ${operation.kind}.`);
  }
  // Activation is last. Failure while preparing optional fields cannot activate a partial workflow.
  const workflowTypes = { 'create-workflow-state': 'Workflow State', 'create-workflow-action': 'Workflow Action Master', 'create-workflow': 'Workflow' };
  for (const operation of plan.operations) if (workflowTypes[operation.kind]) await api('POST', resource(workflowTypes[operation.kind]), operation.document);
}
