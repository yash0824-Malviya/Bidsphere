import { it, expect } from 'vitest';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createEcrSchemaErpClient } from '../scripts/ecr-schema-erp-client.mjs';
import { clmErpRequest, clmResource, createClmDependencies, listClmErp } from '../api/clmErp';
import { ClmError, parseClmData, repairRfqLegalSignatureHandoff, rfqClmLegalSigned, rfqClmFinanceApproved, pendingClmApprovals } from '../api/clmCore';
import { readClmPdf } from '../api/clmSignature';
import { rfqClmWorkflowView } from '../src/utils/rfqClmWorkflow';
import { clmRoleRecipients, notifyClmAction } from '../api/clmNotifications';
import { resolveServerRole } from '../api/rbacAuth';

createEcrSchemaErpClient();
it('explicit targeted Contract legal-to-Finance repair, with independently verified saved evidence', async () => {
  const name = 'CON-2026-00001';
  const apply = process.env.CLM_REPAIR_CONTRACT === name;
  const deps = createClmDependencies();
  const before = await deps.load('Contract', name), prior = parseClmData(before.custom_clm_data);
  expect(before.custom_rfq).toBe('PUR-RFQ-2026-00104');
  expect(rfqClmLegalSigned(before, prior)).toBe(true);
  const verify = async (record, evidence) => { const bytes = await readClmPdf(record, evidence); expect(createHash('sha256').update(bytes).digest('hex')).toBe(evidence.hash); };
  for (const evidence of [prior.locked_file, ...prior.signatures]) await verify(before, evidence);
  if (apply && prior.rfq_workflow?.phase === 'signature') await writeFile('scratch/contract-legal-finance-before.json', JSON.stringify(before, null, 2));
  const result = apply ? await repairRfqLegalSignatureHandoff(name, String(before.modified), deps, verify) : { changed: false, record: before, warnings: [] };
  const after = await clmErpRequest('GET', clmResource('Contract', name)), saved = parseClmData(after.custom_clm_data);
  if (process.env.CLM_RETRY_HANDOFF_NOTICE === name && rfqClmFinanceApproved(after,saved)) await notifyClmAction('Contract',after,'approve',pendingClmApprovals(saved));
  if (apply && !result.changed) await notifyClmAction('Contract', after, 'sign', pendingClmApprovals(saved));
  expect(saved.signatures).toEqual(prior.signatures); expect(saved.locked_file).toEqual(prior.locked_file); expect(saved.locked_hash).toBe(prior.locked_hash); expect(saved.versions).toEqual(prior.versions);
  for (const field of ['custom_current_version','contract_terms','custom_contract_value','custom_currency','start_date','end_date','custom_rfq','custom_supplier','party_name','custom_supplier_quotation','custom_contract_request','custom_inteva_signed_date','signed_by_company']) expect(after[field]).toEqual(before[field]);
  expect(saved.audit.slice(0, prior.audit.length)).toEqual(prior.audit);
  for (const evidence of [saved.locked_file, ...saved.signatures]) await verify(after, evidence);
  if (apply) {
    expect(after.custom_contract_status).toBe('Pending Finance'); expect(saved.rfq_workflow?.phase).toBe('finance_review');
    expect(saved.approvals.filter(row=>row.role==='finance')).toEqual([expect.objectContaining({ status:'Pending',stage:1 })]);
    expect(after.custom_executed_contract).toBe(prior.signatures.at(-1)?.file_url);
    const again = await repairRfqLegalSignatureHandoff(name, String(after.modified), deps, verify);
    expect(again.changed).toBe(false); expect(again.record.modified).toBe(after.modified);
  }
  const candidates = await clmRoleRecipients('finance');
  const financeUsers: string[] = [];
  for (const candidate of candidates) {
    let user;
    try { user = await deps.load('User', candidate); } catch(error) { if (error instanceof ClmError && error.status === 404) continue; throw error; }
    if (Number(user.enabled) && resolveServerRole({ name:String(user.name), email:String(user.email || user.name), erpnext_roles:Array.isArray(user.roles)?user.roles.map(row=>String(row.role)):[] }) === 'finance') financeUsers.push(candidate);
  }
  const notifications = await listClmErp('Notification Log', [['document_type','=','Contract'],['document_name','=',name]], ['name','for_user','subject']);
  const teamUsers = await clmRoleRecipients('procurement_team');
  if (process.env.CLM_EXPECT_STAGE === 'procurement') {
    const team = await deps.load('User','procurement.team@netlink.com');
    console.log(JSON.stringify({ teamUsers, notices:notifications, teamUser:{name:team.name,enabled:team.enabled,roles:team.roles.map(row=>row.role),role:resolveServerRole({name:team.name,email:team.email,erpnext_roles:team.roles.map(row=>row.role)})} }));
  }
  if (process.env.CLM_EXPECT_STAGE === 'procurement') {
    const original = JSON.parse(await readFile('scratch/contract-legal-finance-before.json','utf8'));
    const originalData = parseClmData(original.custom_clm_data);
    expect(saved.signatures).toEqual(originalData.signatures); expect(saved.locked_file).toEqual(originalData.locked_file); expect(saved.versions).toEqual(originalData.versions);
    for (const field of ['custom_current_version','contract_terms','custom_contract_value','custom_currency','start_date','end_date','custom_rfq','custom_supplier_quotation','custom_contract_request']) expect(after[field]).toEqual(original[field]);
    expect(rfqClmFinanceApproved(after,saved)).toBe(true);
    expect(saved.approvals.find(row=>row.role==='finance')).toMatchObject({ status:'Approved',by:'finance@netlink.com' });
    expect(saved.signatures.some(row=>row.party==='supplier')).toBe(false);
    expect(notifications.some(row=>row.for_user==='procurement.team@netlink.com' && /Finance Approved|Pending Procurement Finalization/.test(String(row.subject)))).toBe(true);
    expect(saved.audit.filter(row=>row.action==='finance_review_started')).toHaveLength(1);
  }
  const evidence = { mode:apply?'APPLIED':'READ ONLY', contract:name, changed:result.changed, status:after.custom_contract_status, workflow:rfqClmWorkflowView(after), modified:after.modified,
    signatures:saved.signatures.map(row=>({party:row.party,by:row.by,version:row.version,file_id:row.file_id,hash:row.hash,unchanged:true})),
    finance_approvals:saved.approvals.filter(row=>row.role==='finance'), finance_users:financeUsers, finance_notices:notifications.filter(row=>financeUsers.includes(String(row.for_user))),
    procurement_notices:notifications.filter(row=>teamUsers.includes(String(row.for_user)) && /Finance Approved|Pending Procurement Finalization/.test(String(row.subject))), warnings:result.warnings };
  await writeFile('scratch/contract-legal-finance-live-verification.json',JSON.stringify(evidence,null,2));
  console.log(JSON.stringify(evidence));
});
