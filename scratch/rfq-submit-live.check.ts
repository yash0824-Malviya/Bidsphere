import { test, expect } from 'vitest';
import { writeFileSync } from 'node:fs';
import { createEcrSchemaErpClient, ecrSchemaResource } from '../scripts/ecr-schema-erp-client.mjs';
import { createClmDependencies } from '../api/clmErp';
import { ensureInitialRfqContractRequestErp } from '../api/rfqClmErp';
import { routeSavedRfqInitialClmRequest } from '../api/rfqInitialClmRouting';
import { projectRfqRequestSubmission } from '../api/rfqRequestSubmissionProjection';
import { resolveServerRole, type AccessPrincipal } from '../api/rbacAuth';
import { parseClmData, canReadClm } from '../api/clmCore';
import { rfqClmRequestWorkflowView } from '../src/utils/rfqClmWorkflow';
import { clmNow } from '../api/clmTime';
const api = createEcrSchemaErpClient();
test('preserve RFQ99 draft-origin request and verify real submit-only Yes/No routing', async () => {
  const deps = createClmDependencies();
  const identity = await api('GET','method/frappe.auth.get_logged_user');
  if(typeof identity !== 'string' || identity === 'Guest') throw new Error('Authenticated ERP identity required.');
  const user = await deps.load('User',identity);
  const role = resolveServerRole({name:String(user.name),email:String(user.email||''),erpnext_roles:(user.roles as Array<{role:string}>).map(r=>r.role)});
  if(!role || !['admin','procurement','procurement_team'].includes(role) || user.name !== identity || user.enabled === 0) throw new Error('ERP integration identity is not authorized.');
  const principal = {typ:'internal',sub:identity,email:String(user.email||''),role} as AccessPrincipal;
  const evidence:Record<string,unknown> = {checked_at:new Date().toISOString(),mode:'Real ERP persistence and actual native RFQ submission; same shared gateway routing hook; actual integration identity. Browser role checks reported separately.',cases:[]};
  const output=()=>writeFileSync('scratch/rfq-submit-live-evidence.json',JSON.stringify(evidence,null,2));
  const oldRfq=await deps.load('Request for Quotation','PUR-RFQ-2026-00099');
  const oldRequest=await deps.load('Contract Request','CTRQ-2026-0002');
  expect(oldRfq.docstatus).toBe(0);expect(oldRequest.custom_rfq).toBe(oldRfq.name);
  await ensureInitialRfqContractRequestErp(principal,String(oldRfq.name));
  const held=await deps.load('Contract Request',String(oldRequest.name));
  const heldRfq=await deps.load('Request for Quotation',String(oldRfq.name));
  expect(held.request_status).toBe('Draft');expect(heldRfq.docstatus).toBe(0);expect(heldRfq.status).toBe('Draft');
  const oldData=parseClmData(oldRequest.custom_clm_data), heldData=parseClmData(held.custom_clm_data);
  expect(heldData.rfq_request_draft).toEqual(oldData.rfq_request_draft);expect(heldData.audit.slice(0,oldData.audit.length)).toEqual(oldData.audit);
  expect(rfqClmRequestWorkflowView(held)).toBeUndefined();
  const business=(r:Record<string,unknown>,omit:string[])=>Object.fromEntries(Object.entries(r).filter(([k])=>!omit.includes(k)));
  expect(business(held,['modified','modified_by','custom_clm_data','request_status'])).toEqual(business(oldRequest,['modified','modified_by','custom_clm_data','request_status']));
  evidence.corrected={rfq:heldRfq.name,rfq_status:heldRfq.status,request:held.name,native_request_status:held.request_status,workflow:heldData.rfq_request_workflow,terms_and_history_preserved:true,active_pending:false};output();
  for(const decision of ['Yes','No']) {
    const subject=`BidSphere submit-only CLM acceptance 2026-09-24 ${decision}`;
    const existing=await deps.list('Request for Quotation',[['subject','=',subject]]);
    if(existing.length>1)throw new Error('Duplicate diagnostic RFQs.');
    const payload={doctype:'Request for Quotation',naming_series:'PUR-RFQ-.YYYY.-',company:'Netlink',transaction_date:clmNow().slice(0,10),status:'Draft',subject,message_for_supplier:'Internal submission routing acceptance. No supplier email or commercial award.',contract_required:decision,custom_department:'Production - NSGAI',custom_show_target_price_to_supplier:0,suppliers:[{supplier:'Bosch México',send_email:0}],items:[{item_code:'AP001',item_name:'Brake Disc',qty:1,warehouse:'Stores - NSGAI',uom:'Nos',stock_uom:'Nos',conversion_factor:1,schedule_date:'2026-10-01',custom_target_price:0,custom_show_target_price_to_supplier:0}]};
    let rfq=existing.length?await deps.load('Request for Quotation',String(existing[0].name)):await deps.create('Request for Quotation',payload);
    const item:Record<string,unknown>={decision,rfq:rfq.name};(evidence.cases as unknown[]).push(item);output();
    if(Number(rfq.docstatus)===0) {
      await routeSavedRfqInitialClmRequest({apiPath:'resource/Request for Quotation',method:'POST',body:payload},{data:rfq},principal,ensureInitialRfqContractRequestErp);
      expect(await deps.list('Contract Request',[['custom_rfq','=',rfq.name]])).toHaveLength(0);
      const saved=await api('PUT',ecrSchemaResource('Request for Quotation',String(rfq.name)),{modified:rfq.modified,subject});
      await routeSavedRfqInitialClmRequest({apiPath:`resource/Request for Quotation/${rfq.name}`,method:'PUT',body:{subject}},{data:saved},principal,ensureInitialRfqContractRequestErp);
      expect(await deps.list('Contract Request',[['custom_rfq','=',rfq.name]])).toHaveLength(0);
      item.draft_request_count=0;output();
      rfq=await deps.load('Request for Quotation',String(rfq.name));
    }
    const input={docstatus:1,modified:rfq.modified};
    const submitted=await api('PUT',ecrSchemaResource('Request for Quotation',String(rfq.name)),input);
    expect(Number(submitted.docstatus)).toBe(1);
    await routeSavedRfqInitialClmRequest({apiPath:`resource/Request for Quotation/${rfq.name}`,method:'PUT',body:input,previousRfq:rfq},{data:submitted},principal,ensureInitialRfqContractRequestErp);
    const requests=await deps.list('Contract Request',[['custom_rfq','=',rfq.name]]);
    expect(requests).toHaveLength(decision==='Yes'?1:0);
    expect(await deps.list('Contract',[['custom_rfq','=',rfq.name]])).toHaveLength(0);
    if(decision==='Yes') {
      const request=await deps.load('Contract Request',String(requests[0].name));
      const projected=await projectRfqRequestSubmission(request,deps.load);
      expect(rfqClmRequestWorkflowView(projected)).toMatchObject({assignedRole:'procurement_team',status:'Pending',stage:'Procurement',supplier:'',award:''});
      expect(canReadClm({...principal,role:'procurement_team'} as AccessPrincipal,'Contract Request',projected)).toBe(true);
      expect(canReadClm({...principal,role:'procurement'} as AccessPrincipal,'Contract Request',projected)).toBe(false);
      const fresh=await deps.load('Request for Quotation',String(rfq.name));
      await routeSavedRfqInitialClmRequest({apiPath:`resource/Request for Quotation/${rfq.name}`,method:'PUT',body:{docstatus:1,modified:fresh.modified},previousRfq:fresh},{data:fresh},principal,ensureInitialRfqContractRequestErp);
      const repeated=await deps.list('Contract Request',[['custom_rfq','=',rfq.name]]);expect(repeated).toHaveLength(1);expect(repeated[0].name).toBe(request.name);
      item.request=request.name;item.workflow=rfqClmRequestWorkflowView(projected);item.same_id_on_submit_replay=true;
    }
    const final=await deps.load('Request for Quotation',String(rfq.name));
    Object.assign(item,{docstatus:final.docstatus,rfq_status:final.status,request_count:requests.length,contract_count:0,passed:true});output();
  }
},180_000);
