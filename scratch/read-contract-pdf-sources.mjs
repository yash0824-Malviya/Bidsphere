import { writeFileSync } from 'node:fs';
import { createEcrSchemaErpClient, ecrSchemaResource as resource } from '../scripts/ecr-schema-erp-client.mjs';

// Acceptance fixture: GET-only reads of one Contract and its exact stored links.
const api = createEcrSchemaErpClient();
const records = [];
const read = async (doctype, name) => {
  if (!name) return undefined;
  const existing = records.find(row => row.doctype === doctype && row.record.name === name);
  if (existing) return existing.record;
  const record = await api('GET', resource(doctype, name));
  if (record.name !== name) throw new Error(`Unexpected ${doctype} source identity`);
  records.push({ doctype, record });
  return record;
};
const contract = await read('Contract', 'CON-2026-00001');
const data = JSON.parse(contract.custom_clm_data || '{}');
const rfq = await read('Request for Quotation', contract.custom_rfq);
const quotation = await read('Supplier Quotation', contract.custom_supplier_quotation);
const awardId = data.rfq_context?.award_id || data.rfq_source?.award || data.rfq_source?.legal_review;
if (awardId && awardId !== quotation?.name) await read('Legal Document Review', awardId);
await read('Supplier', contract.custom_supplier || contract.party_name);
await read('Contract Request', contract.custom_contract_request);
for (const row of [...(data.source_documents || []), ...(data.supplier_documents || [])]) {
  if (row.source_doctype === 'Material Request Item') {
    for (const item of rfq?.items || []) if (item.material_request_item === row.source_name) await read('Material Request', item.material_request);
  }
  if (row.file_id) await read('File', row.file_id);
}
writeFileSync('scratch/contract-pdf-source.json', JSON.stringify({ checked_at: new Date().toISOString(), mode: 'read-only ERPNext Contract PDF source capture', contract, records }, null, 2));
console.log(JSON.stringify({ contract: contract.name, status: contract.custom_contract_status, rfq: rfq?.name, award: awardId, quotation: quotation?.name, value: contract.custom_contract_value, currency: contract.custom_currency, items: (quotation?.items || []).map(({ item_name, qty, uom }) => ({ item: item_name, qty, uom })), signatures: (data.signatures || []).map(({ party, at, version }) => ({ party, at, version })), source_document_count: (data.source_documents || []).length, reads: records.length, output: 'scratch/contract-pdf-source.json' }, null, 2));
