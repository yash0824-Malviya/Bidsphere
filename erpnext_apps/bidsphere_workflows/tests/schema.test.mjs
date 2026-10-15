import { describe, expect, it } from 'vitest';
import { planRfqClmBranchSchema, verifyRfqClmBranchSchema } from '../../../scripts/setup-rfq-clm-branch.mjs';

const fixture = () => ({
  doctypes: { 'Request for Quotation': { name: 'Request for Quotation', fields: [], permissions: [] }, 'Contract Request': { name: 'Contract Request', fields: [], permissions: [] } },
  customFields: [
    { dt: 'Request for Quotation', name: 'RFQ-contract_required', fieldname: 'contract_required', fieldtype: 'Select', options: 'Yes\nNo', default: 'No', reqd: 1, allow_on_submit: 0, modified: 'r1' },
    { dt: 'Contract Request', name: 'CR-custom_rfq', fieldname: 'custom_rfq', fieldtype: 'Link', options: 'Request for Quotation', reqd: 0, unique: 1 },
  ],
  propertySetters: [], records: { 'Request for Quotation': [{ name: 'RFQ-OLD', contract_required: 'No' }], 'Contract Request': [] }, workflows: [], roles: [], customPermissions: [],
});

describe('RFQ CLM branch schema', () => {
  it('changes only allow_on_submit on the existing requirement', () => {
    const plan = planRfqClmBranchSchema(fixture());
    expect(plan.operations).toEqual([{ kind: 'update-custom-field', doctype: 'Request for Quotation', name: 'RFQ-contract_required', modified: 'r1', patch: { allow_on_submit: 1 } }]);
    expect(plan).toMatchObject({ recordMigration: false, permissionChanges: false, workflowChanges: false, newRoles: [], newDoctypes: [] });
  });
  it('is idempotent and preserves all records', () => {
    const before = fixture(); const after = structuredClone(before);
    after.customFields[0].allow_on_submit = 1;
    expect(planRfqClmBranchSchema(after).operations).toEqual([]);
    expect(verifyRfqClmBranchSchema(before, after)).toMatchObject({ verified: true, recordsPreserved: true });
    after.records['Request for Quotation'][0].contract_required = 'Yes';
    expect(() => verifyRfqClmBranchSchema(before, after)).toThrow(/records changed/);
  });
  it('reuses a current property override', () => {
    const snapshot = fixture();
    snapshot.propertySetters.push({ name: 'existing-override', modified: 'p1', doc_type: 'Request for Quotation', field_name: 'contract_required', property: 'allow_on_submit', value: '0' });
    expect(planRfqClmBranchSchema(snapshot).operations[0]).toMatchObject({ kind: 'update-property-setter', name: 'existing-override', modified: 'p1', patch: { value: '1' } });
  });
  it('does not create missing or duplicate fields', () => {
    const snapshot = fixture(); snapshot.customFields.shift();
    expect(() => planRfqClmBranchSchema(snapshot)).toThrow(/existing RFQ Contract schema/);
  });
});
