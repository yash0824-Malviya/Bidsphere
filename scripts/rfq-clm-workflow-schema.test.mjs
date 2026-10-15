import { describe, it, expect, vi } from 'vitest';
import { CLM_WORKFLOWS, clmWorkflowDocument } from './clm-schema.mjs';
import { planRfqClmWorkflowSchema as plan, verifyRfqClmWorkflowMigration as verify, applyRfqClmWorkflowSchemaPlan as applyRemote } from './rfq-clm-workflow-schema.mjs';

const fixture = () => ({
  workflows: [...CLM_WORKFLOWS.map(def => ({ name: def.name, modified: 'stamp', ...clmWorkflowDocument(def) })), { name: 'Existing RFQ', document_type: 'Request for Quotation', is_active: 1 }, { name: 'Business Case', document_type: 'Business Case', is_active: 1 }],
  workflowStates: [{ name: 'Rejected', style: 'Danger' }], workflowActions: [], roles: [{ name: 'System Manager' }], customPermissions: [],
  doctypes: { Contract: { name: 'Contract', fields: [], permissions: [] }, 'Contract Request': { name: 'Contract Request', fields: [{ fieldname: 'request_status', fieldtype: 'Select' }], permissions: [] } },
  customFields: [{ dt: 'Contract', fieldname: 'custom_contract_status', fieldtype: 'Select' }],
  records: { Contract: [{ name: 'C-OLD', custom_contract_status: 'Executed', custom_clm_data: 'existing signed evidence' }], 'Contract Request': [{ name: 'CR-OLD', request_status: 'Completed' }] },
});
const apply = (before, operations) => {
  const after = structuredClone(before);
  for (const op of operations) {
    if (op.kind === 'create-workflow-state') after.workflowStates.push({ name: op.document.workflow_state_name, ...op.document });
    else if (op.kind === 'create-workflow-action') after.workflowActions.push({ name: op.document.workflow_action_name, ...op.document });
    else if (op.kind === 'append-workflow-rows') after.workflows[after.workflows.findIndex(row => row.name === op.name)] = { ...structuredClone(op.document), modified: 'new-stamp' };
    else throw new Error(op.kind);
  }
  return after;
};

describe('RFQ-only native CLM workflow branches', () => {
  it('preserves every existing row and appends only RFQ-scoped edges on the two CLM workflows', () => {
    const before = fixture(), copy = structuredClone(before), result = plan(before);
    expect(before).toEqual(copy);
    expect(result.operations.filter(op => op.kind === 'append-workflow-rows').map(op => op.doctype)).toEqual(['Contract', 'Contract Request']);
    expect(result.operations.filter(op => op.kind === 'create-workflow-state').map(op => op.document.workflow_state_name)).toEqual(['Pending Legal', 'Pending Finance']);
    const after = apply(before, result.operations);
    for (let i = 0; i < 2; i++) {
      expect(after.workflows[i].states.slice(0, before.workflows[i].states.length)).toEqual(before.workflows[i].states);
      expect(after.workflows[i].transitions.slice(0, before.workflows[i].transitions.length)).toEqual(before.workflows[i].transitions);
      expect(after.workflows[i].transitions.slice(before.workflows[i].transitions.length).every(row => row.condition === 'doc.custom_rfq and doc.custom_clm_data' && row.allowed === 'System Manager')).toBe(true);
    }
    expect(verify(before, after, result)).toMatchObject({ verified: true, recordsPreserved: 2, existingWorkflowRowsPreserved: true });
    expect(plan(after).operations).toEqual([]);
  });
  it('permits every new native state transition and leaves the standalone routes intact', () => {
    const before = fixture(), after = apply(before, plan(before).operations);
    const contract = after.workflows[0], request = after.workflows[1];
    const canTransition = (workflow, from, to, rfq) => workflow.transitions.some(row => row.state === from && row.next_state === to && (!row.condition.includes('doc.custom_rfq') || rfq));
    for (const [from, to] of [['Draft', 'Pending Legal'], ['Pending Legal', 'Approved'], ['Approved', 'Pending Signature'], ['Pending Signature', 'Pending Finance'], ['Pending Finance', 'Executed'], ['Executed', 'Active'], ['Pending Legal', 'Draft'], ['Pending Legal', 'Rejected'], ['Pending Finance', 'Draft'], ['Pending Finance', 'Rejected']]) expect(canTransition(contract, from, to, true)).toBe(true);
    expect(canTransition(request, 'Draft', 'Completed', true)).toBe(true);
    expect(canTransition(request, 'Draft', 'Completed', false)).toBe(false);
    expect(canTransition(contract, 'Draft', 'Pending Legal', false)).toBe(false);
    expect(canTransition(contract, 'Pending Signature', 'Pending Finance', false)).toBe(false);
    expect(canTransition(contract, 'Draft', 'Under Review', false)).toBe(true);
    expect(canTransition(contract, 'Pending Signature', 'Executed', false)).toBe(true);
  });
  it('does not activate or create an absent Workflow', () => {
    const before = fixture(); before.workflows.slice(0, 2).forEach(row => { row.is_active = 0; });
    expect(plan(before).operations).toEqual([]);
  });
  it('refuses a different active workflow, permission change or conflicting existing branch', () => {
    const before = fixture(); before.workflows[0].name = 'User Custom Workflow'; expect(() => plan(before)).toThrow(/manual review/);
    before.workflows[0].name = CLM_WORKFLOWS[0].name; before.workflows[0].states[0].allow_edit = 'Other'; expect(() => plan(before)).toThrow(/permissions differ/);
    before.workflows[0].states[0].allow_edit = 'System Manager'; before.workflows[0].states.push({ state: 'Pending Legal', doc_status: '1', allow_edit: 'System Manager' }); expect(() => plan(before)).toThrow(/conflicts/);
  });
  it('refuses records that native Workflow.on_update would silently default', () => {
    const before = fixture(); delete before.records.Contract[0].custom_contract_status;
    expect(() => plan(before)).toThrow(/blank workflow state/);
  });
  it('refuses a missing existing state field that Workflow.on_update would otherwise create', () => {
    const before = fixture(); before.customFields = [];
    expect(() => plan(before)).toThrow(/will not create a field/);
  });
  it.each(['records', 'roles', 'customPermissions', 'customFields'])('detects an unexpected %s mutation', key => {
    const before = fixture(), result = plan(before), after = apply(before, result.operations); after[key] = ['unexpected'];
    expect(() => verify(before, after, result)).toThrow(new RegExp(`${key} changed`));
  });
  it('detects modified RFQ workflow, old CLM transitions and state update effects', () => {
    const before = fixture(), result = plan(before), after = apply(before, result.operations);
    after.workflows[2].is_active = 0; expect(() => verify(before, after, result)).toThrow(/Unrelated workflow/);
    after.workflows[2].is_active = 1; after.workflows[0].transitions[0].allowed = 'Other'; expect(() => verify(before, after, result)).toThrow(/row changed/);
    after.workflows[0].transitions[0].allowed = 'System Manager'; after.workflows[0].states[0].update_field = 'unrelated'; expect(() => verify(before, after, result)).toThrow(/row changed/);
  });
  it('rechecks the existing Workflow revision before saving append-only rows', async () => {
    const before = fixture(), result = plan(before);
    const api = vi.fn(async (method, path) => method === 'GET' ? { ...before.workflows.find(row => path.endsWith(encodeURIComponent(row.name))), modified: 'concurrently-updated' } : {});
    await expect(applyRemote(api, before, result)).rejects.toThrow(/changed after inspection/);
    expect(api.mock.calls.some(([method, path]) => method === 'POST' && path === 'method/frappe.client.save')).toBe(false);
  });
});
