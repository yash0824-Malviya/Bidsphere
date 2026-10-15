import { describe, it, expect } from 'vitest';
import { planRfqAwardContractSchema, verifyRfqAwardContractMigration, RFQ_AWARD_CONTRACT_TYPES, RFQ_AWARD_CONTRACT_TYPE_FIELDS } from './rfq-award-contract-schema.mjs';

const fixture = () => {
  const doctypes = Object.fromEntries(RFQ_AWARD_CONTRACT_TYPE_FIELDS.map(([dt]) => [dt, { name: dt, custom: ['Contract Request', 'Contract Approval Matrix'].includes(dt) ? 1 : 0, fields: [], permissions: [{ role: 'Legal Manager', read: 1 }] }]));
  doctypes['Contract Request'].fields.push({ fieldname: 'contract_type', fieldtype: 'Select', options: 'Supplier Agreement\nNDA', reqd: 1 });
  doctypes['Contract Approval Matrix'].fields.push({ fieldname: 'contract_type', fieldtype: 'Select', options: 'All\nSupplier Agreement\nNDA', reqd: 1 });
  return { doctypes, customFields: ['Contract', 'Contract Template'].map(dt => ({ dt, name: `${dt}-custom_contract_type`, fieldname: 'custom_contract_type', fieldtype: 'Select', options: 'NDA\nLegacy Custom Type', default: 'NDA', modified: 'exact-stamp' })), propertySetters: [], roles: [{ name: 'Legal Manager' }], customPermissions: [], workflows: [{ name: 'Existing CLM' }], records: Object.fromEntries(RFQ_AWARD_CONTRACT_TYPE_FIELDS.map(([dt]) => [dt, [{ name: `${dt}-old`, modified: 'unchanged', contract_type: 'Legacy Custom Type' }]])) };
};
const applyFixture = (before, plan) => {
  const after = structuredClone(before);
  for (const operation of plan.operations) {
    if (operation.kind === 'update-custom-field') Object.assign(after.customFields.find(row => row.name === operation.name), operation.patch);
    else if (operation.kind === 'update-native-field') Object.assign(after.doctypes[operation.doctype].fields.find(row => row.fieldname === operation.fieldname), operation.patch);
    else if (operation.kind === 'update-property-setter') Object.assign(after.propertySetters.find(row => row.name === operation.name), operation.patch);
    else if (operation.kind === 'create-property-setter') after.propertySetters.push({ ...operation.document, name: 'new-options' });
    else throw new Error(operation.kind);
  }
  return after;
};

describe('RFQ award contract type schema', () => {
  it('extends existing fields with exactly the five RFQ choices without defaults or data migration', () => {
    const before = fixture(); const copy = structuredClone(before); const plan = planRfqAwardContractSchema(before);
    expect(plan.operations).toHaveLength(4);
    expect(plan.contractTypes).toEqual(['Supply / Procurement Contract', 'Service Agreement', 'NDA', 'Master Service Agreement', 'Other']);
    expect(plan.operations.every(row => Object.keys(row.patch).join() === 'options')).toBe(true);
    expect(plan).toMatchObject({ recordMigration: false, workflowChanges: false, permissionChanges: false, defaultChanges: false, newDoctypes: [], newRoles: [] });
    expect(before).toEqual(copy);
    const after = applyFixture(before, plan);
    expect(verifyRfqAwardContractMigration(before, after, plan)).toMatchObject({ verified: true, recordsPreserved: 4, defaultsPreserved: true });
    expect(planRfqAwardContractSchema(after).operations).toEqual([]);
  });
  it('retains legacy options and the approval matrix All option in original order', () => {
    const before = fixture(); const after = applyFixture(before, planRfqAwardContractSchema(before));
    expect(after.customFields[0].options.startsWith('NDA\nLegacy Custom Type\n')).toBe(true);
    expect(after.doctypes['Contract Approval Matrix'].fields[0].options.startsWith('All\nSupplier Agreement\nNDA\n')).toBe(true);
    expect(after.customFields[0].options.split('\n').filter(value => value === 'NDA')).toHaveLength(1);
  });
  it('updates an existing property setter rather than ineffective underlying field options', () => {
    const before = fixture(); before.propertySetters.push({ name: 'override', doc_type: 'Contract', field_name: 'custom_contract_type', property: 'options', value: 'NDA\nHistorical Type', modified: 'override-stamp' });
    const plan = planRfqAwardContractSchema(before); const operation = plan.operations.find(row => row.doctype === 'Contract');
    expect(operation).toMatchObject({ kind: 'update-property-setter', name: 'override', modified: 'override-stamp' });
    expect(operation.patch.value).toContain('Historical Type');
    expect(planRfqAwardContractSchema(applyFixture(before, plan)).operations).toEqual([]);
  });
  it('uses a property setter for a standard native field', () => {
    const before = fixture(); const existing = before.customFields.shift(); before.doctypes.Contract.fields.push(existing);
    const plan = planRfqAwardContractSchema(before);
    expect(plan.operations.find(row => row.doctype === 'Contract')).toMatchObject({ kind: 'create-property-setter', document: { doc_type: 'Contract', field_name: 'custom_contract_type', property: 'options' } });
    expect(verifyRfqAwardContractMigration(before, applyFixture(before, plan), plan).verified).toBe(true);
  });
  it('does nothing when all required choices already exist', () => {
    const before = fixture(); for (const field of [...before.customFields, ...Object.values(before.doctypes).flatMap(dt => dt.fields)]) field.options += '\n' + RFQ_AWARD_CONTRACT_TYPES.join('\n');
    expect(planRfqAwardContractSchema(before).operations).toEqual([]);
  });
  it('rejects missing, duplicate or non-Select type fields', () => {
    const before = fixture(); before.customFields[0].fieldtype = 'Data'; expect(() => planRfqAwardContractSchema(before)).toThrow(/remain a Select/);
    before.customFields[0].fieldtype = 'Select'; before.customFields.push({ ...before.customFields[0] }); expect(() => planRfqAwardContractSchema(before)).toThrow(/exactly one/);
    before.customFields = []; expect(() => planRfqAwardContractSchema(before)).toThrow(/exactly one/);
  });
  it('refuses ambiguous option overrides', () => {
    const before = fixture(); const setter = { name: 'override', doc_type: 'Contract', field_name: 'custom_contract_type', property: 'options', value: 'NDA' }; before.propertySetters.push(setter, { ...setter, name: 'duplicate' });
    expect(() => planRfqAwardContractSchema(before)).toThrow(/Multiple options overrides/);
  });
  it.each(['records', 'roles', 'workflows', 'customPermissions'])('detects unrelated %s changes', key => {
    const before = fixture(); const plan = planRfqAwardContractSchema(before); const after = applyFixture(before, plan); after[key] = { unexpected: true };
    expect(() => verifyRfqAwardContractMigration(before, after, plan)).toThrow(new RegExp(`${key} changed`));
  });
  it('detects default changes and removed legacy choices', () => {
    const before = fixture(); const plan = planRfqAwardContractSchema(before); const after = applyFixture(before, plan); after.customFields[0].default = '';
    expect(() => verifyRfqAwardContractMigration(before, after, plan)).toThrow(/default changed/);
    after.customFields[0].default = 'NDA'; after.customFields[0].options = RFQ_AWARD_CONTRACT_TYPES.join('\n');
    expect(() => verifyRfqAwardContractMigration(before, after, plan)).toThrow(/legacy options changed/);
  });
  it('accepts Frappe permission-child timestamps while rejecting an actual RBAC change', () => {
    const before = fixture(); const plan = planRfqAwardContractSchema(before); const after = applyFixture(before, plan);
    after.doctypes['Contract Request'].permissions[0].modified = 'new schema timestamp';
    after.doctypes['Contract Request'].permissions[0].modified_by = 'Administrator';
    expect(verifyRfqAwardContractMigration(before, after, plan).permissionsPreserved).toBe(true);
    after.doctypes['Contract Request'].permissions[0].write = 1;
    expect(() => verifyRfqAwardContractMigration(before, after, plan)).toThrow(/permissions changed/);
  });
});
