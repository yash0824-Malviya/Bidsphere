import { writeFileSync } from 'node:fs';
import { createEcrSchemaErpClient, ecrSchemaResource as resource, listAllEcrSchemaRows as list } from '../scripts/ecr-schema-erp-client.mjs';
const api = createEcrSchemaErpClient();
const rfq = await api('GET', resource('Request for Quotation', 'PUR-RFQ-2026-00093'));
const award = await api('GET', resource('Legal Document Review', 'LDC2026-00024'));
const quotation = await api('GET', resource('Supplier Quotation', 'PUR-SQTN-2026-00263'));
const supplier = await api('GET', resource('Supplier', quotation.supplier));
const names = ['Contract', 'Contract Request', 'Contract Approval Matrix', 'Contract Template', 'Request for Quotation', 'Legal Document Review', 'Supplier Quotation'];
const doctypes = Object.fromEntries(await Promise.all(names.map(async dt => [dt, await api('GET', resource('DocType',dt))])));
const [customFields, propertySetters] = await Promise.all([
  list(api, 'Custom Field', ['*'], [['dt','in',names]]),
  list(api, 'Property Setter', ['*'], [['doc_type','in',names]]),
]);
const documents=[];
for (const [dt,doc] of [['Request for Quotation',rfq],['Legal Document Review',award],['Supplier Quotation',quotation],['Supplier',supplier]]) {
  documents.push(...await list(api, 'File', ['name','file_name','file_url','attached_to_doctype','attached_to_name','attached_to_field','is_private','content_hash'], [['attached_to_doctype','=',dt],['attached_to_name','=',doc.name],['is_folder','=',0]]));
}
const existingRequests=await list(api,'Contract Request',['*'],[['custom_rfq','=',rfq.name]]);
const versions=await api('GET','method/frappe.utils.change_log.get_versions');
let endpoint;
try { endpoint=await api('GET','method/bidsphere_workflows.rfq_clm.decide'); }
catch (error) { endpoint={status:error.status,error:error.message}; }
const pick=(record)=>Object.fromEntries(Object.entries(record).filter(([key])=>!/password|secret|token|key$/i.test(key)));
const evidence={at:new Date().toISOString(),rfq:pick(rfq),award:pick(award),quotation:pick(quotation),supplier:pick(supplier),documents,existingRequests,doctypes,customFields,propertySetters,versions,endpoint};
writeFileSync('scratch/rfq93-award-schema-audit.json', JSON.stringify(evidence,null,2));
console.log(JSON.stringify({rfq:{name:rfq.name,company:rfq.company,department:rfq.department,contract_required:rfq.contract_required},award:{name:award.name,supplier:award.supplier,sq_name:award.sq_name},quotation:{name:quotation.name,supplier:quotation.supplier,grand_total:quotation.grand_total,currency:quotation.currency},documents,existingRequests:existingRequests.map(({name})=>name),versions,endpoint},null,2));
