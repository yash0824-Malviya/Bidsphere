import { describe, expect, it, vi } from 'vitest';
import { CLM_DOCTYPES, CLM_FIELD_MANIFEST, CLM_WORKFLOWS, appendClmSelectOptions, applyClmSchemaPlan, clmWorkflowDocument, planClmSchema, resolveClmField } from './clm-schema.mjs';

function schema() {
  const doctypes = Object.fromEntries(CLM_DOCTYPES.map(name => [name, { name, custom: name === 'Contract' || name === 'Contract Template' ? 0 : 1, fields: [{ fieldname: 'existing_notes', label: 'Existing Notes', fieldtype: 'Text' }], permissions: [{ role: 'System Manager', read: 1, write: 1 }] }]));
  doctypes.Contract.fields.push({ fieldname: 'status', fieldtype: 'Select', options: 'Unsigned\nActive\nInactive\nCancelled' });
  doctypes['Contract Request'].fields.push({ fieldname: 'contract_type', fieldtype: 'Select', options: 'Supplier Agreement\nTooling Agreement\nNDA' });
  doctypes['Contract Approval Matrix'].fields.push({ fieldname: 'contract_type', fieldtype: 'Select', options: 'All\nSupplier Agreement\nTooling Agreement\nNDA' }, { fieldname: 'approval_sequence', fieldtype: 'Select', options: 'Sequential\nParallel' });
  doctypes['Contract Obligation'].fields.push({ fieldname: 'owne', label: 'Owne', fieldtype: 'Link', options: 'User' });
  return { doctypes, customFields: [
    { name: 'Contract-custom_contract_type', dt: 'Contract', fieldname: 'custom_contract_type', fieldtype: 'Select', options: 'NDA\nSCA\nOther' },
    { name: 'Contract Template-custom_contract_type', dt: 'Contract Template', fieldname: 'custom_contract_type', fieldtype: 'Select', options: 'NDA\nSCA\nOther' },
  ], propertySetters: [], customPermissions: [{ parent: 'Contract', role: 'Procurement Manager', read: 1 }], workflows: [], workflowStates: [], workflowActions: [], records: Object.fromEntries(CLM_DOCTYPES.map(name => [name, []])) };
}
function simulate(before, plan) {
  const next = structuredClone(before);
  for (const op of plan.operations) {
    if (op.kind === 'create-custom-field') next.customFields.push({ ...op.document, name: `${op.document.dt}-${op.document.fieldname}` });
    else if (op.kind === 'update-custom-field') Object.assign(next.customFields.find(row => row.name === op.name), op.patch);
    else if (op.kind === 'update-native-field') Object.assign(next.doctypes[op.doctype].fields.find(row => row.fieldname === op.fieldname), op.patch);
    else if (op.kind === 'update-property-setter') Object.assign(next.propertySetters.find(row => row.name === op.name), op.patch);
    else if (op.kind === 'create-property-setter') next.propertySetters.push({ name: `setter-${next.propertySetters.length}`, ...op.document });
    else if (op.kind === 'create-workflow-state') next.workflowStates.push({ name: op.document.workflow_state_name });
    else if (op.kind === 'create-workflow-action') next.workflowActions.push({ name: op.document.workflow_action_name });
    else if (op.kind === 'create-workflow') next.workflows.push({ ...op.document, name: op.document.workflow_name });
    else throw new Error(op.kind);
  }
  return next;
}

describe('additive CLM schema migration', () => {
  it('reuses every existing DocType and field while adding only optional missing data', () => {
    const before = schema(); const copy = structuredClone(before); const plan = planClmSchema(before);
    expect(before).toEqual(copy);
    expect(plan.newDoctypes).toEqual([]); expect(plan.newRoles).toEqual([]); expect(plan.recordMigration).toBe(false); expect(plan.permissionChanges).toBe(false);
    const additions = plan.operations.filter(op => op.kind === 'create-custom-field');
    expect(additions).toHaveLength(17);
    for (const op of additions) expect(op.document).toMatchObject({ reqd: 0, default: '' });
    expect(additions.filter(op => op.document.fieldname === 'custom_clm_data')).toHaveLength(4);
    for (const op of additions.filter(op => op.document.fieldname === 'custom_clm_data')) expect(op.document).toMatchObject({ fieldtype: 'Long Text', hidden: 1, read_only: 1, no_copy: 1 });
    expect(plan.operations.some(op => op.fieldname === 'status' || op.fieldname === 'owne')).toBe(false);
    expect(plan.operations.some(op => op.document?.fieldname === 'custom_contract_type')).toBe(false);
  });

  it('is idempotent and preserves permissions, records, native status, and existing fields', () => {
    const before = schema(); const after = simulate(before, planClmSchema(before));
    expect(planClmSchema(after).operations).toEqual([]);
    expect(after.records).toEqual(before.records); expect(after.customPermissions).toEqual(before.customPermissions);
    for (const dt of CLM_DOCTYPES) expect(after.doctypes[dt].permissions).toEqual(before.doctypes[dt].permissions);
    expect(after.doctypes.Contract.fields).toEqual(before.doctypes.Contract.fields);
    expect(after.doctypes['Contract Obligation'].fields).toEqual(before.doctypes['Contract Obligation'].fields);
  });

  it('reuses equivalent field names and labels instead of creating duplicates', () => {
    const before = schema(); before.doctypes['Contract Request'].fields.push({ fieldname: 'rfq', label: 'Original RFQ', fieldtype: 'Link', options: 'Request for Quotation' });
    before.doctypes['Contract Obligation'].fields.push({ fieldname: 'existing_quantity', label: 'Quantity', fieldtype: 'Float' });
    const plan = planClmSchema(before);
    expect(plan.bindings['Contract Request'].custom_rfq).toBe('rfq'); expect(plan.bindings['Contract Obligation'].custom_quantity).toBe('existing_quantity');
    expect(plan.operations.some(op => op.document?.fieldname === 'custom_rfq')).toBe(false);
    expect(plan.operations.some(op => op.document?.fieldname === 'custom_quantity')).toBe(false);
  });

  it('fails closed on duplicate equivalents, wrong field types, or wrong linked masters', () => {
    const before = schema(); const descriptor = CLM_FIELD_MANIFEST.find(row => row.dt === 'Contract Request' && row.fieldname === 'custom_rfq');
    before.doctypes['Contract Request'].fields.push({ fieldname: 'rfq', label: 'RFQ', fieldtype: 'Link', options: 'Request for Quotation' }, { fieldname: 'custom_rfq', label: 'Old RFQ', fieldtype: 'Link', options: 'Request for Quotation' });
    expect(() => resolveClmField(before, descriptor)).toThrow('Multiple fields');
    before.doctypes['Contract Request'].fields.pop(); before.doctypes['Contract Request'].fields.at(-1).fieldtype = 'Data';
    expect(() => resolveClmField(before, descriptor)).toThrow('expected Link');
    Object.assign(before.doctypes['Contract Request'].fields.at(-1), { fieldtype: 'Link', options: 'RFP' });
    expect(() => resolveClmField(before, descriptor)).toThrow('not Request for Quotation');
  });

  it('refuses missing DocTypes and required/defaulted runtime fields instead of migrating data', () => {
    const absent = schema(); delete absent.doctypes['Contract Risk']; expect(() => planClmSchema(absent)).toThrow('will not recreate');
    const before = schema(); before.customFields.push({ name: 'Contract-custom_clm_data', dt: 'Contract', fieldname: 'custom_clm_data', fieldtype: 'Long Text', reqd: 1 });
    expect(() => planClmSchema(before)).toThrow('optional');
    Object.assign(before.customFields.at(-1), { reqd: 0, default: '{}' }); expect(() => planClmSchema(before)).toThrow('no automatic lifecycle default');
  });

  it('adds type choices and Hybrid without changing existing order, defaults, or matrix All semantics', () => {
    expect(appendClmSelectOptions('\nOld\nNDA', ['NDA', 'New'])).toBe('\nOld\nNDA\nNew');
    const before = schema(); const after = simulate(before, planClmSchema(before));
    expect(after.customFields.find(row => row.dt === 'Contract' && row.fieldname === 'custom_contract_type').options).toBe('NDA\nSCA\nOther\nSupplier Agreement\nTooling Agreement');
    expect(after.doctypes['Contract Approval Matrix'].fields.find(row => row.fieldname === 'contract_type').options).toBe('All\nSupplier Agreement\nTooling Agreement\nNDA\nSCA\nOther');
    expect(after.customFields.find(row => row.dt === 'Contract' && row.fieldname === 'custom_contract_type').options.split('\n')).not.toContain('All');
    expect(after.doctypes['Contract Approval Matrix'].fields.find(row => row.fieldname === 'approval_sequence').options).toBe('Sequential\nParallel\nHybrid');
  });

  it('updates an existing options Property Setter instead of fighting it or creating duplicates', () => {
    const before = schema(); before.propertySetters.push({ name: 'types', doc_type: 'Contract', field_name: 'custom_contract_type', property: 'options', value: 'NDA\nHistorical Choice' });
    const plan = planClmSchema(before); const op = plan.operations.find(row => row.kind === 'update-property-setter' && row.name === 'types');
    expect(op.patch.value).toContain('Historical Choice'); expect(op.patch.value).toContain('Tooling Agreement');
    expect(plan.operations.some(row => row.kind === 'update-custom-field' && row.name === 'Contract-custom_contract_type')).toBe(false);
    expect(planClmSchema(simulate(before, plan)).operations).toEqual([]);
  });

  it('does not activate over legacy records, submitted rows, unknown states, or an existing workflow', () => {
    const before = schema(); before.records.Contract.push({ name: 'OLD', docstatus: 0, custom_contract_status: 'Draft' });
    expect(() => planClmSchema(before)).toThrow('Legacy Contract OLD');
    before.records.Contract[0].custom_clm_data = '{"schema":1}'; before.records.Contract[0].docstatus = 1;
    expect(() => planClmSchema(before)).toThrow('Legacy Contract OLD');
    before.records.Contract = []; before.workflows.push({ name: 'Company Policy', document_type: 'Contract', is_active: 1 });
    expect(() => planClmSchema(before)).toThrow('must be preserved');
  });

  it('refuses to overwrite existing managed workflow edits', () => {
    const before = schema(); const doc = clmWorkflowDocument(CLM_WORKFLOWS[0]); doc.states[0].allow_edit = 'Procurement Manager'; before.workflows.push({ ...doc, name: doc.workflow_name });
    expect(() => planClmSchema(before)).toThrow('refusing to overwrite');
  });

  it('uses only the existing lifecycle fields and System Manager role in native workflows', () => {
    for (const def of CLM_WORKFLOWS) {
      const doc = clmWorkflowDocument(def);
      expect(doc.workflow_state_field).not.toBe('status');
      expect(doc.states.every(row => row.doc_status === '0' && row.allow_edit === 'System Manager')).toBe(true);
      expect(doc.transitions.every(row => row.allowed === 'System Manager')).toBe(true);
      expect(doc.transitions.every(row => row.condition === 'doc.custom_clm_data')).toBe(true);
      expect(doc.transitions.some(row => row.state === 'Executed' && row.next_state === 'Closed')).toBe(false);
      expect(doc.transitions.some(row => row.state === 'Closed')).toBe(false);
    }
  });

  it('writes only metadata and activates workflows last', async () => {
    const before = schema(); const plan = planClmSchema(before); const api = vi.fn().mockResolvedValue({});
    await applyClmSchemaPlan(api, before, plan);
    expect(api.mock.calls.every(([method, path]) => ['POST', 'PUT'].includes(method) && (/^resource\/(?:Custom%20Field|Property%20Setter|Workflow(?:%20State|%20Action%20Master)?)(?:\/|$)/.test(path) || path === 'method/frappe.client.save'))).toBe(true);
    const firstWorkflow = api.mock.calls.findIndex(([, path]) => path.startsWith('resource/Workflow'));
    expect(api.mock.calls.slice(firstWorkflow).every(([, path]) => path.startsWith('resource/Workflow'))).toBe(true);
    for (const [, path, body] of api.mock.calls.filter(([, path]) => path === 'method/frappe.client.save')) expect(body.doc.permissions).toEqual(before.doctypes[body.doc.name].permissions);
  });
});
