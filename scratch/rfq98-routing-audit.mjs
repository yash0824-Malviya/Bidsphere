import { writeFileSync } from 'node:fs';
import { createEcrSchemaErpClient, ecrSchemaResource as resource, listAllEcrSchemaRows as list } from '../scripts/ecr-schema-erp-client.mjs';
const api = createEcrSchemaErpClient();
const pick = (doc, fields) => Object.fromEntries(fields.map(key => [key, doc?.[key] ?? null]));
const rfq = await api('GET', resource('Request for Quotation', 'PUR-RFQ-2026-00098'));
const mrs = [...new Set((rfq.items || []).map(row => row.material_request).filter(Boolean))];
const materialRequests = await Promise.all(mrs.map(name => api('GET', resource('Material Request', name))));
const [requestSchema, rfqSchema, itemSchema, customFields, requests, contracts, awards] = await Promise.all([
  api('GET', resource('DocType', 'Contract Request')), api('GET', resource('DocType', 'Request for Quotation')), api('GET', resource('DocType', 'Request for Quotation Item')),
  list(api, 'Custom Field', ['*'], [['dt','in',['Request for Quotation','Request for Quotation Item']]]),
  list(api, 'Contract Request', ['name'], [['custom_rfq','=','PUR-RFQ-2026-00098']]),
  list(api, 'Contract', ['name'], [['custom_rfq','=','PUR-RFQ-2026-00098']]),
  list(api, 'Legal Document Review', ['name'], [['rfq_name','=','PUR-RFQ-2026-00098']]),
]);
const output = {
  checked_at: new Date().toISOString(), read_only: true,
  rfq: pick(rfq, ['name','modified','docstatus','status','company','owner','department','custom_department','contract_required','custom_approval_data','custom_target_pricing','custom_target_price_data','custom_rfq_creation_meta']),
  rfqAdditionalFields: Object.keys(rfq).filter(key => /target|depart|meta|request|creator/.test(key)).map(key => [key,rfq[key]]),
  items: (rfq.items || []).map(row => pick(row, ['name','idx','item_code','qty','uom','material_request','material_request_item',...Object.keys(row).filter(key => /target|price|show_to/.test(key))])),
  materialRequests: materialRequests.map(row => pick(row,['name','department','custom_department','company','owner','custom_requester','requested_by'])),
  requestFields: requestSchema.fields.filter(row => row.reqd || /department/.test(row.fieldname)).map(row => pick(row,['fieldname','fieldtype','reqd','options','default','mandatory_depends_on'])),
  rfqFields: [...rfqSchema.fields,...itemSchema.fields,...customFields].filter(row => /target|depart|meta|request|creator/.test(row.fieldname)).map(row => pick(row,['dt','fieldname','fieldtype','options','allow_on_submit','reqd'])), requests, contracts, awards,
};
writeFileSync('scratch/rfq98-routing-audit.json', JSON.stringify(output,null,2));
console.log(JSON.stringify(output,null,2));
