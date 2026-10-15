import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createEcrSchemaErpClient, ecrSchemaResource as resource } from '../scripts/ecr-schema-erp-client.mjs';

// GET-only verification; this script cannot create a signature or change a stage.
const api = createEcrSchemaErpClient();
const contract = await api('GET', resource('Contract', 'CON-2026-00001'));
const data = JSON.parse(contract.custom_clm_data || '{}');
const receipt = (data.signatures || []).find(row => row.party === 'inteva' && row.role === 'legal' && row.version === contract.custom_current_version);
if (!receipt) throw new Error('ERPNext has no persisted current-version Legal signature for CON-2026-00001.');
const file = await api('GET', resource('File', receipt.file_id));
if (Number(file.is_private) !== 1 || file.attached_to_doctype !== 'Contract' || file.attached_to_name !== contract.name || file.file_url !== receipt.file_url || !String(receipt.file_url).startsWith('/private/files/')) throw new Error('Signed file ownership or privacy does not match the Contract.');
const base = (process.env.ERPNEXT_URL ?? process.env.VITE_PROXY_TARGET ?? process.env.VITE_ERPNEXT_URL ?? '').replace(/\/+$/, '').replace(/\/api$/, '');
const key = process.env.ERP_API_KEY ?? process.env.VITE_API_KEY;
const secret = process.env.ERP_API_SECRET ?? process.env.VITE_API_SECRET;
const response = await fetch(`${base}${receipt.file_url}`, { headers: { Authorization: `token ${key}:${secret}` }, signal: AbortSignal.timeout(20000) });
if (!response.ok) throw new Error(`Signed private PDF read returned HTTP ${response.status}.`);
const bytes = Buffer.from(await response.arrayBuffer());
if (bytes.subarray(0, 4).toString() !== '%PDF') throw new Error('Signed artifact is not a PDF.');
const hash = createHash('sha256').update(bytes).digest('hex');
if (hash !== receipt.hash) throw new Error('Signed PDF hash does not match the persisted signature receipt.');
const audit = (data.audit || []).filter(row => row.action === 'e_signed' && row.signature_party === 'inteva' && row.role === 'legal');
if (!audit.length) throw new Error('Legal signature has no persisted e_signed audit entry.');
mkdirSync('tmp/pdfs', { recursive: true });
writeFileSync('tmp/pdfs/CON-2026-00001-legal-signed-verification.pdf', bytes);
const evidence = { checked_at: new Date().toISOString(), mode: 'read-only ERPNext verification', contract: contract.name, modified: contract.modified, signature: { status: 'Signed', full_legal_name: receipt.full_legal_name, email: receipt.by, role: receipt.role, signed_at: receipt.at, version: receipt.version, comment: receipt.signature_comment, file_id: receipt.file_id, hash, file_private: true, hash_matches: true }, audit, contract_status: contract.custom_contract_status, esign_status: contract.custom_esign_status, workflow_stage: data.rfq_workflow?.phase, supplier_signed: (data.signatures || []).some(row => row.party === 'supplier' && row.version === contract.custom_current_version), finance_approval_rows: (data.approvals || []).filter(row => row.role === 'finance'), locked_file_unchanged: data.locked_file?.hash === '42f8bd8f489c49a4efd088167e106ae068bf527b2d0f1841593de328d9c75cfe' };
writeFileSync('scratch/contract-signature-live-verification.json', JSON.stringify(evidence, null, 2));
console.log(JSON.stringify(evidence, null, 2));
