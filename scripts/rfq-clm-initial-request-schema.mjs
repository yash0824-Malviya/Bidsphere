import { loadRfqClmRestSchema } from './rfq-clm-rest-schema.mjs';

export const INITIAL_REQUEST_DEFERRED_FIELDS = Object.freeze({
  contract_type: 'Select', supplier: 'Link', contract_start_date: 'Date',
  contract_end_date: 'Date', contract_value: 'Currency', estimated_contract_value: 'Currency', currency: 'Select',
});
const dt = 'Contract Request';
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const stable = value => Array.isArray(value) ? value.map(stable) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().filter(key => !['modified', 'modified_by'].includes(key)).map(key => [key, stable(value[key])])) : value;

/** Desk-only condition. Frappe's REST mandatory validation does NOT evaluate this. */
export const INITIAL_REQUEST_MANDATORY_CONDITION = "eval:(function(){try{var d=JSON.parse(doc.custom_clm_data||'{}'),s=d.rfq_source,w=d.rfq_request_workflow,a=d.approvals;return !(doc.custom_rfq&&!doc.custom_supplier_quotation&&s&&s.rfq===doc.custom_rfq&&s.stage==='rfq_created'&&s.prepared!==true&&s.contract_required===true&&!s.award&&!s.quotation&&!s.legal_review&&w&&w.version===1&&w.phase==='procurement_team'&&w.assigned_role==='procurement_team'&&w.status==='Pending'&&w.current_stage==='Procurement'&&!d.contract&&Array.isArray(a)&&a.length===1&&a[0].role==='procurement_team'&&a[0].stage===0&&a[0].status==='Pending'&&!a[0].user);}catch(e){return true;}})()";

export const INITIAL_REQUEST_VALIDATION_NOTICE = 'Frappe 16 evaluates mandatory_depends_on only in Desk. The deferred fields become optional to direct ERP REST callers. Deploy the BidSphere gateway validation that keeps full standalone save/submit and award-to-Contract requirements before applying this change. This metadata does not provide conditional server validation.';

function effectiveField(snapshot, fieldname) {
  const matches = [
    ...(snapshot.doctypes?.[dt]?.fields ?? []).filter(row => row.fieldname === fieldname),
    ...(snapshot.customFields ?? []).filter(row => row.dt === dt && row.fieldname === fieldname),
  ];
  if (matches.length !== 1) throw new Error(`Expected exactly one existing ${dt}.${fieldname}; no duplicate field will be created.`);
  return Object.assign({}, matches[0], ...(snapshot.propertySetters ?? []).filter(row => row.doc_type === dt && row.field_name === fieldname).map(row => ({ [row.property]: row.value })));
}

/** Prepare a narrow, non-destructive metadata change; never invent supplier, type, dates or value. */
export function planRfqClmInitialRequestSchema(snapshot) {
  const definition = snapshot.doctypes?.[dt];
  if (definition?.name !== dt || Number(definition.custom) !== 1 || !Array.isArray(definition.fields) || !definition.modified) {
    throw new Error('The existing custom Contract Request DocType and full revision metadata are required; the standard Contract DocType is never changed.');
  }
  const rfq = effectiveField(snapshot, 'custom_rfq');
  if (rfq.fieldtype !== 'Link' || rfq.options !== 'Request for Quotation' || Number(rfq.unique) !== 1) throw new Error('The existing unique Contract Request.custom_rfq link is required for idempotency.');
  const quote = effectiveField(snapshot, 'custom_supplier_quotation');
  if (quote.fieldtype !== 'Link' || quote.options !== 'Supplier Quotation') throw new Error('The existing Supplier Quotation link is required.');
  if (effectiveField(snapshot, 'custom_clm_data').fieldtype !== 'Long Text') throw new Error('The existing CLM runtime field is required.');
  for (const fieldname of ['department', 'requester', 'request_date', 'company', 'contract_purpose', 'description']) {
    if (Number(effectiveField(snapshot, fieldname).reqd) !== 1) throw new Error(`${dt}.${fieldname} must remain mandatory.`);
  }
  const fieldPatches = [];
  for (const [fieldname, fieldtype] of Object.entries(INITIAL_REQUEST_DEFERRED_FIELDS)) {
    const field = effectiveField(snapshot, fieldname);
    if (field.fieldtype !== fieldtype || !definition.fields.some(row => row.fieldname === fieldname)) throw new Error(`${dt}.${fieldname} must remain its existing native ${fieldtype} field.`);
    if ((snapshot.propertySetters ?? []).some(row => row.doc_type === dt && row.field_name === fieldname && ['reqd', 'mandatory_depends_on'].includes(row.property))) throw new Error(`${dt}.${fieldname} has an existing mandatory override; review it separately.`);
    if (Number(field.reqd) === 0 && field.mandatory_depends_on === INITIAL_REQUEST_MANDATORY_CONDITION) continue;
    if (Number(field.reqd) !== 1 || field.mandatory_depends_on) throw new Error(`${dt}.${fieldname} has an unexpected mandatory rule; it will not be replaced.`);
    fieldPatches.push({ fieldname, patch: { reqd: 0, mandatory_depends_on: INITIAL_REQUEST_MANDATORY_CONDITION } });
  }
  return {
    operations: fieldPatches.length ? [{ kind: 'update-existing-custom-doctype', doctype: dt, name: dt, modified: definition.modified, fieldPatches }] : [],
    validationNotice: INITIAL_REQUEST_VALIDATION_NOTICE, conditionalServerValidation: false,
    gatewayValidationRequired: true, recordMigration: false, workflowChanges: false, permissionChanges: false,
    standardContractChanges: false, newFields: [], newDoctypes: [], newRoles: [],
  };
}

export const loadRfqClmInitialRequestSchema = loadRfqClmRestSchema;

function patchedDefinition(snapshot, plan) {
  const definition = structuredClone(snapshot.doctypes[dt]);
  for (const patch of plan.operations[0]?.fieldPatches ?? []) Object.assign(definition.fields.find(row => row.fieldname === patch.fieldname), patch.patch);
  return definition;
}

/** Caller must save a durable full backup. Requires explicit acknowledgement of REST semantics. */
export async function applyRfqClmInitialRequestSchemaPlan(api, before, plan, { gatewayValidationConfirmed = false } = {}) {
  if (!same(plan, planRfqClmInitialRequestSchema(before))) throw new Error('Refusing an altered initial Request prerequisite plan.');
  if (!gatewayValidationConfirmed) throw new Error(INITIAL_REQUEST_VALIDATION_NOTICE);
  const current = await loadRfqClmInitialRequestSchema(api);
  if (!same(current, before)) throw new Error('ERP metadata or records changed after the backup; review a fresh plan. Nothing was changed.');
  if (plan.operations.length) await api('POST', 'method/frappe.client.save', { doc: { ...patchedDefinition(before, plan), doctype: 'DocType' } });
}

export function verifyRfqClmInitialRequestSchema(before, after, plan) {
  if (!same(plan, planRfqClmInitialRequestSchema(before))) throw new Error('Refusing an altered initial Request prerequisite plan.');
  const expected = structuredClone(before);
  expected.doctypes[dt] = patchedDefinition(before, plan);
  if (!same(stable(expected), stable(after))) throw new Error('Unexpected metadata, workflow, permission or record change during initial Request schema update.');
  if (planRfqClmInitialRequestSchema(after).operations.length) throw new Error('Initial Request schema verification incomplete.');
  return { verified: true, fieldsChanged: plan.operations[0]?.fieldPatches.length ?? 0, recordsPreserved: true, workflowsPreserved: true, permissionsPreserved: true, standardContractPreserved: true, conditionalServerValidation: false };
}
