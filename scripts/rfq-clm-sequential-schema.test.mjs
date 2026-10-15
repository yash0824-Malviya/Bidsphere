import { describe, it, expect } from 'vitest';
import { planRfqClmSequentialSchema as plan, verifyRfqClmSequentialMigration as verify } from './rfq-clm-sequential-schema.mjs';

const fixture = () => ({
  doctypes: { Contract: { name: 'Contract', custom: 0, fields: [{ fieldname: 'contract_terms', fieldtype: 'Text Editor' }], permissions: [{ role: 'Legal Manager', read: 1 }] } },
  customFields: [{ dt: 'Contract', name: 'Contract-custom_contract_status', fieldname: 'custom_contract_status', fieldtype: 'Select', options: 'Draft\nUnder Review\nApproved\nPending Signature\nExecuted\nRejected\nLegacy Status', default: 'Draft', reqd: 0, modified: 'stamp' }],
  propertySetters: [], customPermissions: [], roles: [{ name: 'Legal Manager' }], workflows: [{ name: 'Existing CLM' }], records: { Contract: [{ name: 'CON-OLD', custom_contract_status: 'Executed', modified: 'unchanged' }] },
});
const apply = (before, operations) => {
  const after = structuredClone(before);
  for (const op of operations) {
    if (op.kind === 'update-custom-field') Object.assign(after.customFields.find(row => row.name === op.name), op.patch);
    else if (op.kind === 'update-property-setter') Object.assign(after.propertySetters.find(row => row.name === op.name), op.patch);
    else if (op.kind === 'create-property-setter') after.propertySetters.push({ ...op.document, name: 'new' });
    else if (op.kind === 'update-native-field') Object.assign(after.doctypes.Contract.fields.find(row => row.fieldname === op.fieldname), op.patch);
    else throw new Error(op.kind);
  }
  return after;
};

describe('RFQ sequential CLM status options', () => {
  it('only appends absent labels while preserving legacy records, options and defaults', () => {
    const before = fixture(), copy = structuredClone(before), result = plan(before);
    expect(result.operations).toHaveLength(1);
    expect(result.operations[0]).toMatchObject({ kind: 'update-custom-field', patch: { options: before.customFields[0].options + '\nPending Legal\nPending Finance' } });
    expect(result).toMatchObject({ recordMigration: false, workflowChanges: false, permissionChanges: false, defaultChanges: false });
    expect(before).toEqual(copy);
    const after = apply(before, result.operations);
    expect(verify(before, after, result)).toMatchObject({ verified: true, recordsPreserved: 1 });
    expect(plan(after).operations).toEqual([]);
  });
  it('adds Rejected only when absent and handles existing option override', () => {
    const before = fixture();
    before.propertySetters.push({ name: 'override', doc_type: 'Contract', field_name: 'custom_contract_status', property: 'options', value: 'Draft\nOld Status', modified: 'setter-stamp' });
    const result = plan(before);
    expect(result.operations[0]).toMatchObject({ kind: 'update-property-setter', modified: 'setter-stamp', patch: { value: 'Draft\nOld Status\nPending Legal\nPending Finance\nRejected' } });
    expect(verify(before, apply(before, result.operations), result).verified).toBe(true);
  });
  it.each([0, 1])('extends native fields on custom=%s without creating duplicates', custom => {
    const before = fixture(); before.doctypes.Contract.custom = custom; before.doctypes.Contract.fields.push(before.customFields.pop());
    const result = plan(before);
    expect(result.operations[0].kind).toBe(custom ? 'update-native-field' : 'create-property-setter');
    expect(verify(before, apply(before, result.operations), result).verified).toBe(true);
  });
  it('rejects absent/ambiguous/non-Select existing fields', () => {
    const before = fixture(); before.customFields[0].fieldtype = 'Data'; expect(() => plan(before)).toThrow(/remain a Select/);
    before.customFields[0].fieldtype = 'Select'; before.customFields.push({ ...before.customFields[0] }); expect(() => plan(before)).toThrow(/exactly one/);
    before.customFields = []; expect(() => plan(before)).toThrow(/exactly one/);
  });
  it.each(['records', 'roles', 'workflows', 'customPermissions'])('detects unrelated %s changes', key => {
    const before = fixture(), result = plan(before), after = apply(before, result.operations); after[key] = ['changed'];
    expect(() => verify(before, after, result)).toThrow(new RegExp(`${key} changed`));
  });
  it('rejects removed legacy statuses, default changes and unrelated field changes', () => {
    const before = fixture(), result = plan(before), after = apply(before, result.operations);
    after.customFields[0].default = 'Pending Legal'; expect(() => verify(before, after, result)).toThrow(/default changed/);
    after.customFields[0].default = 'Draft'; after.doctypes.Contract.fields[0].fieldtype = 'Data'; expect(() => verify(before, after, result)).toThrow(/Unrelated Contract fields/);
    after.doctypes.Contract.fields[0].fieldtype = 'Text Editor'; after.customFields[0].options = 'Draft\nPending Legal\nPending Finance\nRejected'; expect(() => verify(before, after, result)).toThrow(/Existing Contract status options changed/);
  });
});
