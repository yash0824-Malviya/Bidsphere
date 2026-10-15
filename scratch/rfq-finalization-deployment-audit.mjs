import { writeFileSync, existsSync, readFileSync } from 'node:fs';
import { createEcrSchemaErpClient, ecrSchemaResource as resource, listAllEcrSchemaRows as list } from '../scripts/ecr-schema-erp-client.mjs';

const api = createEcrSchemaErpClient();
const attempt = async (action) => {
  try { return { ok: true, data: await action() }; }
  catch (error) { return { ok: false, status: error.status, error: error.message }; }
};
const names = ['Request for Quotation', 'Legal Document Review', 'Contract Request', 'Contract'];
const fieldNames = /clm|approval_data|contract|rfq|quotation|supplier|company|department|status|workflow|sq_name|rfq_name/i;
const [versions, endpoint, docs, customFields, propertySetters] = await Promise.all([
  attempt(() => api('GET', 'method/frappe.utils.change_log.get_versions')),
  attempt(() => api('GET', 'method/bidsphere_workflows.rfq_clm.decide')),
  Promise.all(names.map(async name => [name, await api('GET', resource('DocType', name))])),
  list(api, 'Custom Field', ['name','dt','fieldname','fieldtype','options','allow_on_submit','read_only','reqd','unique'], [['dt','in',names]]),
  list(api, 'Property Setter', ['name','doc_type','field_name','property','value'], [['doc_type','in',names]]),
]);
const schema = Object.fromEntries(docs.map(([name, doc]) => [name, {
  is_submittable: doc.is_submittable,
  fields: [...(doc.fields || []), ...customFields.filter(f => f.dt === name)].filter(f => fieldNames.test(f.fieldname || '')).map(f => ({fieldname:f.fieldname, fieldtype:f.fieldtype, options:f.options,allow_on_submit:f.allow_on_submit,read_only:f.read_only,reqd:f.reqd,unique:f.unique})),
  propertySetters: propertySetters.filter(s => s.doc_type === name),
}]));
const rfq = await api('GET', resource('Request for Quotation','PUR-RFQ-2026-00093'));
const award = await api('GET', resource('Legal Document Review','LDC2026-00024'));
const requests = await list(api,'Contract Request',['name','request_status','custom_rfq','custom_clm_data','modified'],[['custom_rfq','=',rfq.name]]);
const contracts = await list(api,'Contract',['name','status','custom_rfq','custom_clm_data','modified'],[['custom_rfq','=',rfq.name]]);
const deploymentEnvKeys = ['.env','.env.production','.env.demo'].filter(existsSync).map(path => ({path, deploymentVariableNames: readFileSync(path,'utf8').split(/\r?\n/).map(line => line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=/)?.[1]).filter(name => name && /SSH|BENCH|DEPLOY|SERVER_(USER|HOST)|PRIVATE_KEY/.test(name))}));
const evidence = { read_at:new Date().toISOString(),read_only:true,mutation_performed:false,versions,endpoint,schema,deploymentEnvKeys,rfq:{name:rfq.name,docstatus:rfq.docstatus,status:rfq.status,contract_required:rfq.contract_required,approval_data_present:typeof rfq.custom_approval_data==='string' && rfq.custom_approval_data.length>0},award:{name:award.name,docstatus:award.docstatus,status:award.status,rfq_name:award.rfq_name,sq_name:award.sq_name},requests:requests.map(r=>({name:r.name,status:r.request_status,rfq:r.custom_rfq,clm_data_present:!!r.custom_clm_data})),contracts:contracts.map(c=>({name:c.name,status:c.status,rfq:c.custom_rfq,clm_data_present:!!c.custom_clm_data}))};
writeFileSync('scratch/rfq-finalization-deployment-audit.json',JSON.stringify(evidence,null,2));
console.log(JSON.stringify(evidence,null,2));
