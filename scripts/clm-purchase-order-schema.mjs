import { ecrSchemaResource as resource, listAllEcrSchemaRows as list } from './ecr-schema-erp-client.mjs';

/** Optional links on the standard Purchase Order. Existing PO records stay untouched. */
export const CLM_PO_FIELDS = [
  { fieldname: 'custom_clm_contract', label: 'CLM Contract', fieldtype: 'Link', options: 'Contract' },
  { fieldname: 'custom_clm_rfq', label: 'CLM RFQ', fieldtype: 'Link', options: 'Request for Quotation' },
  { fieldname: 'custom_clm_award', label: 'CLM Award', fieldtype: 'Link', options: 'Legal Document Review' },
  { fieldname: 'custom_clm_creation_key', label: 'CLM Creation Key', fieldtype: 'Data', unique: 1, hidden: 1 },
].map(field => ({ dt: 'Purchase Order', read_only: 1, reqd: 0, ...field }));

export async function loadClmPoSchema(api) {
  const [schema, custom, setters] = await Promise.all([
    api('GET',resource('DocType','Purchase Order')),
    list(api,'Custom Field',['*'],[['dt','=','Purchase Order']]),
    list(api,'Property Setter',['*'],[['doc_type','=','Purchase Order']]),
  ]);
  return {schema,custom,setters};
}
export function planClmPoSchema(snapshot) {
  if (snapshot.schema?.name !== 'Purchase Order') throw new Error('The standard Purchase Order DocType is required.');
  const operations = [];
  for (const target of CLM_PO_FIELDS) {
    const fields = [...snapshot.schema.fields,...snapshot.custom].filter(row=>row.fieldname===target.fieldname);
    if (fields.length > 1) throw new Error(`Duplicate ${target.fieldname} definition; reconcile before applying.`);
    if (snapshot.setters.some(row=>row.field_name===target.fieldname)) throw new Error(`Existing ${target.fieldname} overrides need review.`);
    if (!fields.length) { operations.push(target); continue; }
    const field = fields[0];
    if (field.fieldtype!==target.fieldtype || (target.options && field.options!==target.options) || Number(field.reqd) || String(field.default || '').trim() || !Number(field.read_only) || target.unique && Number(field.unique)!==1) throw new Error(`Incompatible ${target.fieldname}; existing fields will not be renamed or replaced.`);
  }
  return { operations, recordMigration: false, workflowChanges: false, permissionChanges: false };
}
export async function applyClmPoSchema(api, snapshot) {
  const plan = planClmPoSchema(snapshot);
  const current = await loadClmPoSchema(api);
  if (JSON.stringify(current)!==JSON.stringify(snapshot)) throw new Error('PO schema changed since inspection. Run again before applying.');
  for (const field of plan.operations) await api('POST',resource('Custom Field'),{...field, insert_after:'supplier_name'});
  const after = await loadClmPoSchema(api);
  if (planClmPoSchema(after).operations.length) throw new Error('ERPNext did not persist the PO linkage fields.');
  return { ...plan, verified:true, created:plan.operations.map(row=>row.fieldname), after };
}
