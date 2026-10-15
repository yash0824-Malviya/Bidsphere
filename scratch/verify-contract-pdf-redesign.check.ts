import { it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createEcrSchemaErpClient } from '../scripts/ecr-schema-erp-client.mjs';
import { clmErpRequest, clmResource } from '../api/clmErp';
import { parseClmData } from '../api/clmCore';
import { currentClmPdfEvidence, clmPdfEvidenceById } from '../api/clmPdfEvidence';
import { readClmPdf } from '../api/clmSignature';
import { PDFDocument } from 'pdf-lib';
createEcrSchemaErpClient();

it('verifies original and signed v1 artifacts remain unchanged and captures the authoritative current PDF read-only', async () => {
  const before = JSON.parse(await readFile('scratch/contract-pdf-before-redesign.json', 'utf8')).contract;
  const beforeData = parseClmData(before.custom_clm_data);
  const record = await clmErpRequest('GET', clmResource('Contract', 'CON-2026-00001'));
  const data = parseClmData(record.custom_clm_data);
  const preserved = [];
  for (const original of [beforeData.locked_file, ...beforeData.signatures] as Array<{file_id:string;file_url:string;hash:string}>) {
    const evidence = clmPdfEvidenceById(record, data, original.file_id, true);
    expect(evidence?.hash).toBe(original.hash);
    const bytes = await readClmPdf(record, evidence!);
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(original.hash);
    preserved.push({file_id:original.file_id,hash:original.hash,version:evidence!.version,unchanged:true});
  }
  const current = currentClmPdfEvidence(record, data);
  const bytes = current ? await readClmPdf(record, current) : undefined;
  await mkdir('tmp/pdfs/contract-redesign', {recursive:true});
  if (bytes) await writeFile(`tmp/pdfs/contract-redesign/CON-2026-00001-authoritative-v${current!.version}.pdf`, bytes);
  const after = await clmErpRequest('GET', clmResource('Contract', String(record.name)));
  expect(after.modified).toBe(record.modified);
  const output = {checked_at:new Date().toISOString(),mode:'GET-only ERPNext and private PDF verification',contract:record.name,version:record.custom_current_version,status:record.custom_contract_status,modified:record.modified,preserved,current:current || null,pages:bytes ? (await PDFDocument.load(bytes)).getPageCount() : null};
  await writeFile('scratch/contract-pdf-redesign-live-verification.json',JSON.stringify(output,null,2));
  console.log(JSON.stringify(output));
},60000);
