import { writeFileSync } from 'node:fs';
import { createEcrSchemaErpClient, ecrSchemaResource as resource, listAllEcrSchemaRows } from '../scripts/ecr-schema-erp-client.mjs';
const api = createEcrSchemaErpClient();
const contract = await api('GET',resource('Contract','CON-2026-00001'));
const data = JSON.parse(contract.custom_clm_data);
const [rfq,award,quotation,schema,custom,orders] = await Promise.all([
  api('GET',resource('Request for Quotation',contract.custom_rfq)),
  api('GET',resource('Legal Document Review',data.rfq_context.award_id)),
  api('GET',resource('Supplier Quotation',contract.custom_supplier_quotation)),
  api('GET',resource('DocType','Purchase Order')),
  listAllEcrSchemaRows(api,'Custom Field',['fieldname','fieldtype','options'],[['dt','=','Purchase Order']]),
  listAllEcrSchemaRows(api,'Purchase Order',['name','docstatus','supplier','currency','grand_total'],[['Purchase Order Item','supplier_quotation','=',contract.custom_supplier_quotation]])
]);
writeFileSync('scratch/clm-po-live-before.json',JSON.stringify({contract,rfq,award,quotation,schema,custom,orders},null,2));
console.log(JSON.stringify({contract:contract.name,phase:data.rfq_workflow,rfq:rfq.name,award:{name:award.name,grand_total:award.grand_total,currency:award.currency},quotation:{name:quotation.name,grand_total:quotation.grand_total,currency:quotation.currency,conversion_rate:quotation.conversion_rate,items:quotation.items.map(({name,item_code,qty,uom,rate,amount,schedule_date,warehouse})=>({name,item_code,qty,uom,rate,amount,schedule_date,warehouse}))},poFields:[...schema.fields,...custom].filter(row=>/contract|award|rfq|quotation|remark|naming|payment|delivery|currency/i.test(row.fieldname)).map(({fieldname,fieldtype,options})=>({fieldname,fieldtype,options})),orders},null,2));
