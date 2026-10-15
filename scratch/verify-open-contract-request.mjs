import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { createEcrSchemaErpClient, ecrSchemaResource, listAllEcrSchemaRows } from '../scripts/ecr-schema-erp-client.mjs';

const api = createEcrSchemaErpClient();
const requestId = 'CTRQ-2026-0002';
const rfqId = 'PUR-RFQ-2026-00099';
const [request, rfq, requests, contracts] = await Promise.all([
  api('GET', ecrSchemaResource('Contract Request', requestId)),
  api('GET', ecrSchemaResource('Request for Quotation', rfqId)),
  listAllEcrSchemaRows(api, 'Contract Request', ['name', 'custom_rfq']),
  listAllEcrSchemaRows(api, 'Contract', ['name'], [['custom_rfq', '=', rfqId]]),
]);
if (request.name !== requestId || request.custom_rfq !== rfqId) throw new Error('Request/RFQ linkage mismatch.');
const fingerprint = document => createHash('sha256').update(JSON.stringify(document)).digest('hex');
const snapshot = {
  request_id: request.name, rfq_id: rfq.name,
  request_fingerprint: fingerprint(request), rfq_fingerprint: fingerprint(rfq),
  requests, contracts, request_status: request.request_status,
  assignment: JSON.parse(request.custom_clm_data).rfq_request_workflow,
};
const prefix = 'scratch/open-contract-request-live';
if (process.argv.includes('--before')) {
  writeFileSync(`${prefix}-before.json`, JSON.stringify(snapshot, null, 2));
} else if (process.argv.includes('--after')) {
  const before = JSON.parse(readFileSync(`${prefix}-before.json`, 'utf8'));
  if (JSON.stringify(snapshot) !== JSON.stringify(before)) throw new Error('ERP records changed during navigation verification; inspect before claiming no mutations.');
  writeFileSync(`${prefix}-after.json`, JSON.stringify({ ...snapshot, unchanged: true, verified_at: new Date().toISOString() }, null, 2));
} else throw new Error('Specify --before or --after.');
console.log(JSON.stringify({ request_id: requestId, rfq_id: rfqId, request_count: requests.filter(row => row.custom_rfq === rfqId).length, contract_count: contracts.length, assignment: snapshot.assignment, unchanged: process.argv.includes('--after') }, null, 2));
