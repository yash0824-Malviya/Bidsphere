import { describe, expect, it, vi } from 'vitest';
import { applyRfqClmRestSchemaPlan, inspectContractRequestUniqueness, planRfqClmRestSchema, verifyRfqClmRestSchema } from './rfq-clm-rest-schema.mjs';
import { runRfqClmRestSchema } from './setup-rfq-clm-rest.mjs';

const fixture = () => ({
  doctypes: Object.fromEntries(['Contract', 'Contract Request', 'Request for Quotation'].map(name => [name, { name, fields: [], permissions: [{ role: 'Existing Role', read: 1, write: 1 }] }])),
  customFields: [
    { doctype: 'Custom Field', name: 'Contract-custom_contract_request', dt: 'Contract', fieldname: 'custom_contract_request', fieldtype: 'Link', options: 'Contract Request', unique: 0, reqd: 0, not_nullable: 0, default: '', modified: 'initial-contract' },
    { doctype: 'Custom Field', name: 'Request for Quotation-contract_required', dt: 'Request for Quotation', fieldname: 'contract_required', fieldtype: 'Select', options: 'Yes\nNo', reqd: 1, default: 'No', allow_on_submit: 0, modified: 'initial-rfq' },
    { doctype: 'Custom Field', name: 'Contract Request-custom_rfq', dt: 'Contract Request', fieldname: 'custom_rfq', fieldtype: 'Link', options: 'Request for Quotation', unique: 1, reqd: 0, modified: 'initial-request' },
    { doctype: 'Custom Field', name: 'Contract-unrelated', dt: 'Contract', fieldname: 'custom_unrelated', fieldtype: 'Data', default: 'keep', modified: 'initial-unrelated' },
  ],
  propertySetters: [], customPermissions: [{ name: 'keep-permission', parent: 'Contract', role: 'Existing Role', read: 1 }], roles: [{ name: 'Existing Role' }],
  workflows: [{ name: 'Existing CLM Workflow', states: [{ state: 'Draft' }], transitions: [] }],
  records: { Contract: [{ name: 'standalone-one', custom_contract_request: null }, { name: 'standalone-two', custom_contract_request: null }], 'Contract Request': [], 'Request for Quotation': [{ name: 'RFQ-1', docstatus: 1, contract_required: 'Yes', custom_approval_data: '{"keep":true}' }] },
});

function apiFixture(state) {
  const writes = [];
  const api = vi.fn(async (method, path, body) => {
    if (method === 'POST') {
      writes.push({ method, path, body: structuredClone(body) });
      if (path !== 'method/frappe.client.save' || body.doc.doctype !== 'Custom Field') throw new Error('Unexpected mutation');
      const index = state.customFields.findIndex(row => row.name === body.doc.name);
      state.customFields[index] = { ...structuredClone(body.doc), modified: `updated-${index}`, modified_by: 'test-gateway' };
      return structuredClone(state.customFields[index]);
    }
    if (method !== 'GET') throw new Error('Unexpected method');
    const url = new URL(path, 'https://example.test/');
    const [, , dt, name] = url.pathname.split('/').map(decodeURIComponent);
    let result;
    if (dt === 'DocType') result = state.doctypes[name];
    else if (dt === 'Custom Field') result = state.customFields;
    else if (dt === 'Property Setter') result = state.propertySetters;
    else if (dt === 'Custom DocPerm') result = state.customPermissions;
    else if (dt === 'Role') result = state.roles;
    else if (dt === 'Workflow') result = name ? state.workflows.find(row => row.name === name) : state.workflows.map(row => ({ name: row.name }));
    else result = name ? state.records[dt].find(row => row.name === name) : state.records[dt].map(row => ({ name: row.name }));
    if (result === undefined) throw new Error(`Unexpected GET ${path}`);
    return structuredClone(result);
  });
  return { api, writes };
}

describe('REST-only RFQ CLM schema prerequisites', () => {
  it('plans exactly the existing request-link uniqueness and submitted RFQ decision editability', () => {
    const before = fixture(); const untouched = structuredClone(before); const plan = planRfqClmRestSchema(before);
    expect(plan.operations.map(({ fieldname, patch }) => ({ fieldname, patch }))).toEqual([
      { fieldname: 'custom_contract_request', patch: { unique: 1 } },
      { fieldname: 'contract_required', patch: { allow_on_submit: 1 } },
    ]);
    expect(plan).toMatchObject({ recordMigration: false, workflowChanges: false, permissionChanges: false, newFields: [], newDoctypes: [], newRoles: [], inventory: { contractsScanned: 2, standaloneNullLinks: 2 } });
    expect(before).toEqual(untouched);
  });

  it('allows multiple NULL standalone links without making the field required', () => {
    const before = fixture(); before.records.Contract.push({ name: 'linked', custom_contract_request: 'CTRQ-1' });
    expect(planRfqClmRestSchema(before).inventory).toEqual({ contractsScanned: 3, linkedContracts: 1, standaloneNullLinks: 2 });
    expect(before.customFields[0]).toMatchObject({ reqd: 0, not_nullable: 0, default: '' });
  });

  it.each(['CTRQ-1', 'ctrq-1', ' CTRQ-1 '])('rejects existing duplicate links (%s) without deleting data', duplicate => {
    const before = fixture(); before.records.Contract = [{ name: 'one', custom_contract_request: 'CTRQ-1' }, { name: 'two', custom_contract_request: duplicate }];
    expect(() => planRfqClmRestSchema(before)).toThrow(/same Contract Request/);
    expect(before.records.Contract).toHaveLength(2);
  });

  it.each(['', ' ', 123])('rejects a raw non-null blank/invalid existing link (%s) rather than normalizing records', value => {
    expect(() => inspectContractRequestUniqueness([{ name: 'old', custom_contract_request: value }])).toThrow(/No records will be rewritten/);
  });

  it.each(['reqd', 'not_nullable', 'default'])('rejects %s that could break standalone Contracts', property => {
    const before = fixture(); before.customFields[0][property] = property === 'default' ? 'CTRQ-1' : 1;
    expect(() => planRfqClmRestSchema(before)).toThrow(/optional and nullable/);
  });

  it('requires the existing unique optional Request RFQ source link', () => {
    const before = fixture(); before.customFields[2].unique = 0;
    expect(() => planRfqClmRestSchema(before)).toThrow(/optional, unique/);
  });

  it('refuses missing, duplicate or incompatible source fields', () => {
    const missing = fixture(); missing.customFields.shift(); expect(() => planRfqClmRestSchema(missing)).toThrow(/exactly one existing/);
    const duplicate = fixture(); duplicate.customFields.push({ ...duplicate.customFields[0] }); expect(() => planRfqClmRestSchema(duplicate)).toThrow(/exactly one existing/);
    const wrong = fixture(); wrong.customFields[0].options = 'Supplier'; expect(() => planRfqClmRestSchema(wrong)).toThrow(/incompatible/);
  });

  it('refuses a conflicting existing Property Setter instead of adding another field/override', () => {
    const before = fixture(); before.propertySetters.push({ name: 'existing', doc_type: 'Contract', field_name: 'custom_contract_request', property: 'unique', value: '0' });
    expect(() => planRfqClmRestSchema(before)).toThrow(/override requires review/);
  });

  it('performs GET only during --check and no backup/writes', async () => {
    const { api, writes } = apiFixture(fixture()); const backup = vi.fn();
    const result = await runRfqClmRestSchema(api, { saveBackup: backup });
    expect(result).toMatchObject({ mode: 'check', applied: false }); expect(result.operations).toHaveLength(2);
    expect(writes).toEqual([]); expect(backup).not.toHaveBeenCalled(); expect(api.mock.calls.every(([method]) => method === 'GET')).toBe(true);
  });

  it('writes a complete before-backup first, changes only those two properties, and is idempotent', async () => {
    const state = fixture(); const before = structuredClone(state); const { api, writes } = apiFixture(state); let backup;
    const result = await runRfqClmRestSchema(api, { apply: true, saveBackup: async value => { expect(writes).toEqual([]); backup = structuredClone(value); } });
    expect(backup.snapshot).toEqual(before); expect(backup.plan.operations).toHaveLength(2);
    expect(writes).toHaveLength(2);
    expect(writes[0].body.doc).toEqual({ ...before.customFields[0], unique: 1 });
    expect(writes[1].body.doc).toEqual({ ...before.customFields[1], allow_on_submit: 1 });
    expect(result).toMatchObject({ applied: true, verified: true, recordsPreserved: 3, standaloneContractsRemainOptional: true });
    expect(state.records).toEqual(before.records); expect(state.workflows).toEqual(before.workflows);
    const repeated = await runRfqClmRestSchema(api, { apply: true, saveBackup: async () => { throw new Error('No backup needed for no-op'); } });
    expect(repeated.operations).toEqual([]); expect(repeated.applied).toBe(false); expect(writes).toHaveLength(2);
  });

  it('does not write if the backup is missing or fails', async () => {
    const { api, writes } = apiFixture(fixture());
    await expect(runRfqClmRestSchema(api, { apply: true })).rejects.toThrow(/backup is required/);
    await expect(runRfqClmRestSchema(api, { apply: true, saveBackup: async () => { throw new Error('disk full'); } })).rejects.toThrow('disk full');
    expect(writes).toEqual([]);
  });

  it('refuses concurrent metadata/record changes after backup before any write', async () => {
    const state = fixture(); const { api, writes } = apiFixture(state);
    await expect(runRfqClmRestSchema(api, { apply: true, saveBackup: async () => { state.records.Contract.push({ name: 'new', custom_contract_request: 'CTRQ-new' }); } })).rejects.toThrow(/changed after the backup/);
    expect(writes).toEqual([]);
  });

  it('does not permit an injected broader plan', async () => {
    const state = fixture(); const { api, writes } = apiFixture(state); const plan = planRfqClmRestSchema(state); plan.operations[0].patch.reqd = 1;
    await expect(applyRfqClmRestSchemaPlan(api, state, plan)).rejects.toThrow(/altered/);
    expect(writes).toEqual([]); expect(api).not.toHaveBeenCalled();
  });

  it('stops on the actual Frappe index error, without applying the next RFQ change', async () => {
    const state = fixture(); const { api: readApi, writes } = apiFixture(state);
    const api = vi.fn((method, ...args) => { if (method === 'POST') throw new Error('Existing non-unique values'); return readApi(method, ...args); });
    await expect(runRfqClmRestSchema(api, { apply: true, saveBackup: async () => {} })).rejects.toThrow('Existing non-unique values');
    expect(api.mock.calls.filter(([method]) => method === 'POST')).toHaveLength(1); expect(writes).toEqual([]);
    expect(state.customFields[1].allow_on_submit).toBe(0);
  });

  it.each(['records', 'roles', 'workflows', 'customPermissions', 'propertySetters', 'doctypes'])('verification rejects unrelated %s changes', key => {
    const before = fixture(); const plan = planRfqClmRestSchema(before); const after = structuredClone(before); after[key] = { unexpected: true };
    expect(() => verifyRfqClmRestSchema(before, after, plan)).toThrow(new RegExp(`${key} changed`));
  });

  it('verification catches unrelated Custom Field edits', () => {
    const before = fixture(); const plan = planRfqClmRestSchema(before); const after = structuredClone(before);
    for (const operation of plan.operations) Object.assign(after.customFields.find(row => row.name === operation.name), operation.patch);
    after.customFields[3].default = 'changed';
    expect(() => verifyRfqClmRestSchema(before, after, plan)).toThrow(/Unexpected Custom Field/);
  });
});
