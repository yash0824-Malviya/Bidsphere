import { describe, expect, it, vi } from 'vitest';
import { INITIAL_REQUEST_DEFERRED_FIELDS, INITIAL_REQUEST_MANDATORY_CONDITION, planRfqClmInitialRequestSchema, applyRfqClmInitialRequestSchemaPlan, verifyRfqClmInitialRequestSchema } from './rfq-clm-initial-request-schema.mjs';
import { runRfqClmInitialRequestSchema } from './setup-rfq-clm-initial-request.mjs';

const fixture = () => ({
  doctypes: {
    'Contract Request': { doctype: 'DocType', name: 'Contract Request', custom: 1, modified: 'before', permissions: [{ role: 'Existing Role', read: 1 }], fields: [
      ...Object.entries(INITIAL_REQUEST_DEFERRED_FIELDS).map(([fieldname, fieldtype]) => ({ fieldname, fieldtype, reqd: 1, default: null, mandatory_depends_on: null, description: 'existing description' })),
      ...['department', 'requester', 'request_date', 'company', 'contract_purpose', 'description'].map(fieldname => ({ fieldname, fieldtype: fieldname === 'department' ? 'Link' : 'Data', reqd: 1 })),
    ] },
    Contract: { name: 'Contract', custom: 0, fields: [{ fieldname: 'party_name', reqd: 1 }], permissions: [] },
    'Request for Quotation': { name: 'Request for Quotation', fields: [], permissions: [] },
  },
  customFields: [
    { dt: 'Contract Request', name: 'Contract Request-custom_rfq', fieldname: 'custom_rfq', fieldtype: 'Link', options: 'Request for Quotation', unique: 1 },
    { dt: 'Contract Request', name: 'Contract Request-custom_supplier_quotation', fieldname: 'custom_supplier_quotation', fieldtype: 'Link', options: 'Supplier Quotation' },
    { dt: 'Contract Request', name: 'Contract Request-custom_clm_data', fieldname: 'custom_clm_data', fieldtype: 'Long Text' },
  ],
  propertySetters: [], customPermissions: [{ name: 'original-permission' }], roles: [{ name: 'Original Role' }],
  workflows: [{ name: 'Original Workflow', states: [{ state: 'Draft' }], transitions: [] }],
  records: { Contract: [{ name: 'C-1', party_name: 'Original Supplier' }], 'Contract Request': [{ name: 'CR-1', supplier: 'Original Supplier' }], 'Request for Quotation': [{ name: 'RFQ-1', contract_required: 'Yes' }] },
});

const initialRecord = () => ({ custom_rfq: 'RFQ-1', custom_supplier_quotation: '', custom_clm_data: JSON.stringify({
  rfq_source: { rfq: 'RFQ-1', stage: 'rfq_created', contract_required: true },
  rfq_request_workflow: { version: 1, phase: 'procurement_team', assigned_role: 'procurement_team', status: 'Pending', current_stage: 'Procurement' },
  approvals: [{ role: 'procurement_team', stage: 0, status: 'Pending' }],
}) });
// Mirrors frappe.utils.eval's expression semantics using the fixed, code-owned condition only.
const deskMandatory = doc => new Function('doc', `return ${INITIAL_REQUEST_MANDATORY_CONDITION.slice(5)}`)(doc);

function apiFixture(state) {
  const writes = [];
  const api = vi.fn(async (method, path, body) => {
    if (method === 'POST') {
      writes.push(structuredClone({ method, path, body }));
      if (path !== 'method/frappe.client.save' || body.doc.doctype !== 'DocType' || body.doc.name !== 'Contract Request') throw new Error('Unexpected write');
      state.doctypes['Contract Request'] = { ...structuredClone(body.doc), modified: 'after', modified_by: 'gateway' };
      return structuredClone(state.doctypes['Contract Request']);
    }
    if (method !== 'GET') throw new Error('Unexpected method');
    const [, , dt, name] = new URL(path, 'https://erp.test/').pathname.split('/').map(decodeURIComponent);
    let value;
    if (dt === 'DocType') value = state.doctypes[name];
    else if (dt === 'Custom Field') value = state.customFields;
    else if (dt === 'Property Setter') value = state.propertySetters;
    else if (dt === 'Custom DocPerm') value = state.customPermissions;
    else if (dt === 'Role') value = state.roles;
    else if (dt === 'Workflow') value = name ? state.workflows.find(row => row.name === name) : state.workflows.map(row => ({ name: row.name }));
    else value = name ? state.records[dt].find(row => row.name === name) : state.records[dt].map(row => ({ name: row.name }));
    if (value === undefined) throw new Error(`Unexpected read ${path}`);
    return structuredClone(value);
  });
  return { api, writes };
}

describe('initial RFQ Contract Request metadata prerequisites', () => {
  it('plans exactly seven deferred existing Request fields without affecting required department, actual Contract or any record', () => {
    const before = fixture(); const untouched = structuredClone(before); const plan = planRfqClmInitialRequestSchema(before);
    expect(plan.operations).toHaveLength(1);
    expect(plan.operations[0].fieldPatches.map(row => row.fieldname)).toEqual(Object.keys(INITIAL_REQUEST_DEFERRED_FIELDS));
    expect(plan.operations[0].fieldPatches).toHaveLength(7);
    expect(plan.operations[0].fieldPatches.some(row => row.fieldname === 'department')).toBe(false);
    expect(plan.operations[0].fieldPatches.every(row => Object.keys(row.patch).sort().join() === 'mandatory_depends_on,reqd')).toBe(true);
    expect(plan).toMatchObject({ conditionalServerValidation: false, gatewayValidationRequired: true, recordMigration: false, workflowChanges: false, permissionChanges: false, standardContractChanges: false, newFields: [], newDoctypes: [], newRoles: [] });
    expect(plan.validationNotice).toMatch(/direct ERP REST callers/); expect(before).toEqual(untouched);
  });

  it('makes fields optional in Desk only for the complete explicit initial Request marker', () => {
    expect(deskMandatory(initialRecord())).toBe(false);
  });

  it.each(['{}', 'null', '[]', '{broken', '', undefined])('keeps standalone or malformed runtime metadata mandatory (%s)', runtime => {
    expect(deskMandatory({ custom_clm_data: runtime })).toBe(true);
  });

  it.each(['stage', 'contract_required', 'rfq'])('does not exempt a Request with missing source %s', property => {
    const record = initialRecord(); const data = JSON.parse(record.custom_clm_data); delete data.rfq_source[property]; record.custom_clm_data = JSON.stringify(data);
    expect(deskMandatory(record)).toBe(true);
  });

  it.each(['award', 'quotation', 'legal_review'])('keeps award-linked Request %s mandatory', property => {
    const record = initialRecord(); const data = JSON.parse(record.custom_clm_data); data.rfq_source[property] = 'existing-award'; record.custom_clm_data = JSON.stringify(data);
    expect(deskMandatory(record)).toBe(true);
  });

  it('keeps quotation-linked, contract-linked, wrong-RFQ and legacy Requests mandatory', () => {
    const quote = initialRecord(); quote.custom_supplier_quotation = 'SQ-1'; expect(deskMandatory(quote)).toBe(true);
    const wrong = initialRecord(); wrong.custom_rfq = 'RFQ-2'; expect(deskMandatory(wrong)).toBe(true);
    const contract = initialRecord(); const data = JSON.parse(contract.custom_clm_data); data.contract = 'C-1'; contract.custom_clm_data = JSON.stringify(data); expect(deskMandatory(contract)).toBe(true);
    expect(deskMandatory({ custom_rfq: 'RFQ-1', custom_clm_data: '{}' })).toBe(true);
  });

  it('keeps a Procurement-prepared request mandatory even before links are populated', () => {
    const record = initialRecord(); const data = JSON.parse(record.custom_clm_data); data.rfq_source.prepared = true; record.custom_clm_data = JSON.stringify(data);
    expect(deskMandatory(record)).toBe(true);
  });

  it.each(['assigned_role', 'phase', 'status', 'current_stage', 'version'])('keeps wrong routing %s mandatory', property => {
    const record = initialRecord(); const data = JSON.parse(record.custom_clm_data); data.rfq_request_workflow[property] = 'wrong'; record.custom_clm_data = JSON.stringify(data);
    expect(deskMandatory(record)).toBe(true);
  });

  it.each([[], [{ role: 'procurement', stage: 0, status: 'Pending' }], [{ role: 'procurement_team', stage: 0, status: 'Approved' }], [{ role: 'procurement_team', stage: 0, status: 'Pending', user: 'manager' }]])('keeps invalid assignment evidence mandatory', approvals => {
    const record = initialRecord(); const data = JSON.parse(record.custom_clm_data); data.approvals = approvals; record.custom_clm_data = JSON.stringify(data);
    expect(deskMandatory(record)).toBe(true);
  });

  it.each(['department', 'requester', 'request_date', 'company', 'contract_purpose', 'description'])('refuses to weaken required %s', fieldname => {
    const state = fixture(); state.doctypes['Contract Request'].fields.find(row => row.fieldname === fieldname).reqd = 0;
    expect(() => planRfqClmInitialRequestSchema(state)).toThrow(/must remain mandatory/);
  });

  it('refuses custom-rule conflicts, duplicate fields, non-custom DocType and missing uniqueness', () => {
    const overridden = fixture(); overridden.propertySetters.push({ doc_type: 'Contract Request', field_name: 'supplier', property: 'reqd', value: '1' }); expect(() => planRfqClmInitialRequestSchema(overridden)).toThrow(/override/);
    const condition = fixture(); condition.doctypes['Contract Request'].fields[0].mandatory_depends_on = 'eval:1'; expect(() => planRfqClmInitialRequestSchema(condition)).toThrow(/unexpected mandatory/);
    const duplicate = fixture(); duplicate.customFields.push({ dt: 'Contract Request', fieldname: 'supplier' }); expect(() => planRfqClmInitialRequestSchema(duplicate)).toThrow(/exactly one/);
    const standard = fixture(); standard.doctypes['Contract Request'].custom = 0; expect(() => planRfqClmInitialRequestSchema(standard)).toThrow(/existing custom/);
    const unique = fixture(); unique.customFields[0].unique = 0; expect(() => planRfqClmInitialRequestSchema(unique)).toThrow(/unique/);
  });

  it('default check makes no mutations or backups', async () => {
    const { api, writes } = apiFixture(fixture()); const saveBackup = vi.fn();
    expect(await runRfqClmInitialRequestSchema(api, { saveBackup })).toMatchObject({ mode: 'check', applied: false, conditionalServerValidation: false });
    expect(writes).toEqual([]); expect(saveBackup).not.toHaveBeenCalled(); expect(api.mock.calls.every(([method]) => method === 'GET')).toBe(true);
  });

  it('requires explicit gateway validation acknowledgement and durable backup before any writes', async () => {
    const { api, writes } = apiFixture(fixture());
    await expect(runRfqClmInitialRequestSchema(api, { apply: true })).rejects.toThrow(/does not provide conditional server validation/);
    await expect(runRfqClmInitialRequestSchema(api, { apply: true, gatewayValidationConfirmed: true })).rejects.toThrow(/backup/);
    await expect(runRfqClmInitialRequestSchema(api, { apply: true, gatewayValidationConfirmed: true, saveBackup: async () => { throw new Error('disk full'); } })).rejects.toThrow('disk full');
    expect(writes).toEqual([]);
  });

  it('saves one revised existing DocType after backup, verifies preservation, and repeats as a no-op', async () => {
    const state = fixture(); const before = structuredClone(state); const { api, writes } = apiFixture(state); let backup;
    const result = await runRfqClmInitialRequestSchema(api, { apply: true, gatewayValidationConfirmed: true, saveBackup: async value => { expect(writes).toEqual([]); backup = structuredClone(value); } });
    expect(backup.snapshot).toEqual(before); expect(writes).toHaveLength(1);
    expect(result).toMatchObject({ applied: true, verified: true, fieldsChanged: 7, recordsPreserved: true, workflowsPreserved: true, permissionsPreserved: true, standardContractPreserved: true });
    expect(state.records).toEqual(before.records); expect(state.doctypes.Contract).toEqual(before.doctypes.Contract);
    const second = await runRfqClmInitialRequestSchema(api, { apply: true }); expect(second.applied).toBe(false); expect(second.operations).toEqual([]); expect(writes).toHaveLength(1);
  });

  it('rejects a changed snapshot or broader injected plan before mutations', async () => {
    const state = fixture(); const { api, writes } = apiFixture(state);
    await expect(runRfqClmInitialRequestSchema(api, { apply: true, gatewayValidationConfirmed: true, saveBackup: async () => { state.records.Contract[0].party_name = 'changed'; } })).rejects.toThrow(/changed after the backup/);
    expect(writes).toEqual([]);
    const before = fixture(); const plan = planRfqClmInitialRequestSchema(before); plan.operations[0].fieldPatches[0].patch.default = 'fake';
    await expect(applyRfqClmInitialRequestSchemaPlan(api, before, plan, { gatewayValidationConfirmed: true })).rejects.toThrow(/altered/);
    expect(writes).toEqual([]);
  });

  it('returns the real ERP failure without claiming successful apply', async () => {
    const state = fixture(); const { api: reads } = apiFixture(state); const api = vi.fn((method, ...rest) => method === 'POST' ? Promise.reject(new Error('ERP permission denied')) : reads(method, ...rest));
    await expect(runRfqClmInitialRequestSchema(api, { apply: true, gatewayValidationConfirmed: true, saveBackup: async () => {} })).rejects.toThrow('ERP permission denied');
  });

  it.each(['records', 'workflows', 'customPermissions', 'roles', 'customFields', 'propertySetters'])('post-verification rejects unexpected %s changes', key => {
    const before = fixture(); const plan = planRfqClmInitialRequestSchema(before); const after = structuredClone(before); after[key] = [];
    expect(() => verifyRfqClmInitialRequestSchema(before, after, plan)).toThrow(/Unexpected/);
  });
});
