import { expect, test } from 'vitest';
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { PDFDocument } from 'pdf-lib';
import { createEcrSchemaErpClient } from '../scripts/ecr-schema-erp-client.mjs';
import { clmErpRequest, clmResource } from '../api/clmErp';
import { canReadClm, clmSnapshotHash, parseClmData, toClmAggregate } from '../api/clmCore';
import { readClmPdf } from '../api/clmSignature';
import { resolveServerRole, type AccessPrincipal } from '../api/rbacAuth';
createEcrSchemaErpClient();
test('reads the real Contract, Legal readiness and locked PDF without signing or writing', async () => {
  const record = await clmErpRequest('GET', clmResource('Contract', 'CON-2026-00001'));
  const user = await clmErpRequest('GET', clmResource('User', String(record.custom_inteva_signatory)));
  const role = resolveServerRole({name:String(user.name),email:String(user.email || user.name),erpnext_roles:(user.roles as Array<{role:string}>).map(row=>row.role)});
  expect(role).toBe('legal'); expect(Number(user.enabled)).toBe(1);
  const principal = { typ:'internal', role, sub:String(user.name), email:String(user.name), iat:1, exp:Number.MAX_SAFE_INTEGER } as AccessPrincipal;
  expect(canReadClm(principal, 'Contract', record)).toBe(true);
  const data = parseClmData(record.custom_clm_data);
  expect(data.locked_hash).toBe(clmSnapshotHash('Contract',record));
  const bytes = await readClmPdf(record, data.locked_file as { file_id:string; file_url:string; hash:string });
  const pdf = await PDFDocument.load(bytes);
  expect(pdf.getPageCount()).toBeGreaterThan(0);
  const aggregate = toClmAggregate(principal,'Contract',record);
  const reread = await clmErpRequest('GET', clmResource('Contract',String(record.name)));
  expect(reread.modified).toBe(record.modified); expect(reread.custom_clm_data).toBe(record.custom_clm_data);
  const evidence = { checked_at:new Date().toISOString(), mode:'read-only live ERP data and local backend policy, not an authenticated browser action', contract:record.name, modified:record.modified,
    native_status:record.custom_contract_status, esign_status:record.custom_esign_status, phase:data.rfq_workflow,
    actions:aggregate.actions, signature_workflow:(aggregate as unknown as Record<string,unknown>).signature_workflow,
    signatures:data.signatures, locked_file:data.locked_file,
    pdf:{verified:true,pages:pdf.getPageCount(),sha256:createHash('sha256').update(bytes).digest('hex')}, record_unchanged:true };
  writeFileSync('scratch/contract-signature-readonly-evidence.json',JSON.stringify(evidence,null,2));
  console.log(JSON.stringify(evidence));
},60_000);
