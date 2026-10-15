import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { createEcrSchemaErpClient, ecrSchemaResource, listAllEcrSchemaRows } from '../scripts/ecr-schema-erp-client.mjs';
const api = createEcrSchemaErpClient();
const [request, rfq, requests, contracts] = await Promise.all([
  api('GET', ecrSchemaResource('Contract Request', 'CTRQ-2026-0002')),
  api('GET', ecrSchemaResource('Request for Quotation', 'PUR-RFQ-2026-00099')),
  listAllEcrSchemaRows(api, 'Contract Request', ['name', 'custom_rfq']),
  listAllEcrSchemaRows(api, 'Contract', ['name'], [['custom_rfq', '=', 'PUR-RFQ-2026-00099']]),
]);
const terms = ['contract_type','contract_purpose','description','contract_start_date','contract_end_date','contract_value','currency','estimated_contract_value'];
const mutable = new Set([...terms,'modified','modified_by','custom_clm_data']);
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const metadata = JSON.parse(request.custom_clm_data);
const snapshot = {
  request_id:request.name, rfq_id:rfq.name,
  rfq_fingerprint:hash(rfq),
  protected_request_fingerprint:hash(Object.fromEntries(Object.entries(request).filter(([key])=>!mutable.has(key)))),
  protected_metadata_fingerprint:hash(Object.fromEntries(Object.entries(metadata).filter(([key])=>!['rfq_request_draft','audit'].includes(key)))),
  requests, contracts, assignment:metadata.rfq_request_workflow,
  terms:Object.fromEntries(terms.map(key=>[key,request[key]??null])), draft:metadata.rfq_request_draft,
  audit:metadata.audit, request_modified:request.modified,
};
const prefix='scratch/request-working-page-live';
if(process.argv.includes('--before')) writeFileSync(`${prefix}-before.json`, JSON.stringify(snapshot,null,2));
else if(process.argv.includes('--after')) {
  const before=JSON.parse(readFileSync(`${prefix}-before.json`,'utf8'));
  for(const key of ['request_id','rfq_id','rfq_fingerprint','protected_request_fingerprint','protected_metadata_fingerprint','requests','contracts','assignment']) {
    if(JSON.stringify(before[key])!==JSON.stringify(snapshot[key])) throw new Error(`Unexpected change: ${key}`);
  }
  writeFileSync(`${prefix}-after.json`, JSON.stringify({...snapshot,verified_at:new Date().toISOString(),source_and_routing_preserved:true},null,2));
} else throw new Error('Use --before or --after.');
console.log(JSON.stringify({request:snapshot.request_id,rfq:snapshot.rfq_id,requests:requests.filter(row=>row.custom_rfq===rfq.name).length,contracts:contracts.length,assignment:snapshot.assignment,draft:snapshot.draft,audit_actions:metadata.audit.map(row=>row.action)},null,2));
