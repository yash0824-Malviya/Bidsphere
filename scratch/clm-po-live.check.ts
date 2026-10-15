import {it,expect} from 'vitest';
import {readFile,writeFile} from 'node:fs/promises';
import {createEcrSchemaErpClient} from '../scripts/ecr-schema-erp-client.mjs';
import {getClmPurchaseOrder} from '../api/clmPurchaseOrder';
import {createClmPurchaseOrderDependencies} from '../api/clmPurchaseOrderErp';
import {parseClmData,rfqClmFinanceApproved,clmSnapshotHash} from '../api/clmCore';
createEcrSchemaErpClient();
it('read-only ERP CLM PO context and saved linkage verification',async()=>{
  const deps=createClmPurchaseOrderDependencies();
  const result=await getClmPurchaseOrder({typ:'internal',role:'procurement_team',sub:'procurement.team@netlink.com',email:'procurement.team@netlink.com',iat:1,exp:9999999999},'CON-2026-00001',deps);
  expect(result).toMatchObject({contract:'CON-2026-00001',rfq:'PUR-RFQ-2026-00104',award:'LDC2026-00027',quotation:'PUR-SQTN-2026-00273',award_value:4500,currency:'USD'});
  const contract=await deps.load('Contract',result.contract),data=parseClmData(contract.custom_clm_data);
  const baseline=JSON.parse(await readFile('scratch/clm-po-live-before.json','utf8'));
  const before=parseClmData(baseline.contract.custom_clm_data);
  for(const key of ['signatures','versions','locked_hash','locked_file','approvals']) expect(data[key]).toEqual(before[key]);
  expect(clmSnapshotHash('Contract',contract)).toBe(before.locked_hash);
  expect(rfqClmFinanceApproved(contract,data)).toBe(true);
  const orders=await deps.list('Purchase Order',[['custom_clm_contract','=',result.contract]]);
  if(process.env.CLM_PO_EXPECT==='completed'){
    expect(result.completed).toBe(true);expect(orders).toHaveLength(1);expect(result.purchase_order?.docstatus).toBe(1);
    expect(result.purchase_order).toMatchObject({custom_clm_contract:result.contract,custom_clm_rfq:result.rfq,custom_clm_award:result.award,currency:'USD',grand_total:4500});
    expect(data.procurement_completion).toMatchObject({purchase_order:result.purchase_order?.name,role:'procurement_team'});
    for(const action of ['purchase_order_creation_initiated','purchase_order_created','purchase_order_linked','procurement_finalized','completed']) expect(data.audit.filter(row=>row.action===action)).toHaveLength(1);
    const rfq=await deps.load('Request for Quotation',result.rfq),award=await deps.load('Legal Document Review',result.award);
    expect(JSON.parse(String(rfq.custom_approval_data)).contract_decision.clm.procurement_completion.purchase_order).toBe(result.purchase_order?.name);
    expect(JSON.parse(String(award.custom_clm_state)).procurement_completion.purchase_order).toBe(result.purchase_order?.name);
    expect(rfq.status).toBe(baseline.rfq.status);expect(rfq.docstatus).toBe(baseline.rfq.docstatus);
    for(const field of ['supplier','sq_name','grand_total','review_status','finance_status']) expect(award[field]).toEqual(baseline.award[field]);
  }
  const evidence={mode:'READ ONLY',checked_at:new Date().toISOString(),contract:result.contract,rfq:result.rfq,award:result.award,quotation:result.quotation,value:result.award_value,currency:result.currency,payload:result.payload,completed:result.completed,orders:orders.map(row=>({name:row.name,docstatus:row.docstatus})),phase:data.rfq_workflow?.phase,procurement_order:data.procurement_order,completion:data.procurement_completion,signature_integrity:'unchanged; file byte hashes verified',audit:data.audit.slice(before.audit.length)};
  await writeFile('scratch/clm-po-live-verification.json',JSON.stringify(evidence,null,2));
  console.log(JSON.stringify(evidence));
},120000);
