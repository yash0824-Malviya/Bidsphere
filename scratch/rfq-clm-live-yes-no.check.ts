import { test, expect } from 'vitest';
import { writeFileSync } from 'node:fs';
import { createEcrSchemaErpClient } from '../scripts/ecr-schema-erp-client.mjs';
import { createClmDependencies } from '../api/clmErp';
import { ensureInitialRfqContractRequestErp } from '../api/rfqClmErp';
import { routeSavedRfqInitialClmRequest } from '../api/rfqInitialClmRouting';
import { resolveServerRole, type AccessPrincipal } from '../api/rbacAuth';
import { rfqClmRequestWorkflowView } from '../src/utils/rfqClmWorkflow';
import { clmNow } from '../api/clmTime';
const api = createEcrSchemaErpClient();
test('real draft RFQ YES and NO run the same automatic post-save routing hook', async () => {
  const deps = createClmDependencies();
  const identity = await api('GET', 'method/frappe.auth.get_logged_user');
  if (typeof identity !== 'string' || identity === 'Guest') throw new Error('Authenticated ERP identity required.');
  const user = await deps.load('User', identity);
  const role = resolveServerRole({ name:String(user.name), email:String(user.email || ''), erpnext_roles:((user.roles || []) as Array<{role:string}>).map(row=>row.role) });
  if (user.name !== identity || user.enabled === 0 || !role || !['admin','procurement','procurement_team'].includes(role)) throw new Error('ERP integration identity cannot create RFQ requests.');
  const principal = { typ:'internal',sub:identity,email:String(user.email || ''),role } as AccessPrincipal;
  const supplier = await deps.load('Supplier', 'Bosch México');
  const department = await deps.load('Department', 'Production - NSGAI');
  expect(Number(supplier.disabled || 0)).toBe(0); expect(department.company).toBe('Netlink');
  const evidence:Record<string,unknown> = { checked_at:new Date().toISOString(), mode:'real ERP draft creation plus the same shared backend post-save hook; authenticated ERP integration identity, no forged browser session', actor:identity, cases:[] };
  const output = () => writeFileSync('scratch/rfq-clm-live-yes-no-evidence.json', JSON.stringify(evidence,null,2));
  process.env.RFQ_CLM_DEBUG = '1';
  for (const decision of ['Yes','No']) {
    const subject = `BidSphere CLM routing acceptance 2026-09-24 ${decision.toUpperCase()}`;
    const matches = await deps.list('Request for Quotation', [['subject','=',subject]]);
    if (matches.length > 1) throw new Error('Duplicate test RFQs already exist. Inspect before continuing.');
    const payload = { doctype:'Request for Quotation', naming_series:'PUR-RFQ-.YYYY.-', company:'Netlink', transaction_date:clmNow().slice(0,10), status:'Draft', subject, message_for_supplier:'Internal CLM routing acceptance draft. Do not submit or send to suppliers.', contract_required:decision, custom_department:String(department.name), custom_show_target_price_to_supplier:0, suppliers:[{supplier:supplier.name, supplier_name:supplier.supplier_name,send_email:0}], items:[{item_code:'AP001',item_name:'Brake Disc',qty:1,warehouse:'Stores - NSGAI',uom:'Nos',stock_uom:'Nos',conversion_factor:1,schedule_date:'2026-10-01',custom_target_price:0,custom_show_target_price_to_supplier:0}] };
    const saved = matches.length ? await deps.load('Request for Quotation', String(matches[0].name)) : await deps.create('Request for Quotation', payload);
    const item:Record<string,unknown> = { decision,rfq_id:saved.name,subject,rfq_saved:true };
    (evidence.cases as unknown[]).push(item); output();
    const beforeCount = (await deps.list('Contract Request')).length;
    const response = { data:saved };
    await routeSavedRfqInitialClmRequest({apiPath:'resource/Request for Quotation',method:'POST',body:payload}, response, principal, ensureInitialRfqContractRequestErp);
    const requests = await deps.list('Contract Request', [['custom_rfq','=',saved.name]]);
    const contracts = await deps.list('Contract', [['custom_rfq','=',saved.name]]);
    expect(requests).toHaveLength(decision === 'Yes' ? 1 : 0); expect(contracts).toHaveLength(0);
    const fresh = await deps.load('Request for Quotation', String(saved.name));
    expect(fresh.contract_required).toBe(decision); expect(Number(fresh.docstatus)).toBe(0); expect(fresh.status).toBe('Draft');
    const afterCount = (await deps.list('Contract Request')).length;
    if (decision === 'No') expect(afterCount).toBe(beforeCount);
    if (decision === 'Yes') {
      const request = await deps.load('Contract Request', String(requests[0].name));
      const view = rfqClmRequestWorkflowView(request);
      expect(view).toMatchObject({status:'Pending',stage:'Procurement',assignedRole:'procurement_team'});
      item.request_id=request.name; item.workflow=view;
      await routeSavedRfqInitialClmRequest({apiPath:`resource/Request for Quotation/${saved.name}`,method:'PUT',body:{}}, {data:fresh}, principal, ensureInitialRfqContractRequestErp);
      expect(await deps.list('Contract Request', [['custom_rfq','=',saved.name]])).toHaveLength(1);
      item.duplicate_retry_same_id=true;
    }
    Object.assign(item,{request_count:requests.length,contract_count:contracts.length,request_count_before:beforeCount,request_count_after:afterCount,rfq_status:fresh.status,docstatus:fresh.docstatus,passed:true}); output();
  }
  delete process.env.RFQ_CLM_DEBUG;
},120_000);

