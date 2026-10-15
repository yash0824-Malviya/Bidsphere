import { it, expect } from 'vitest';
import { readFile, writeFile } from 'node:fs/promises';
import { createEcrSchemaErpClient } from '../scripts/ecr-schema-erp-client.mjs';
import { createClmDependencies, clmErpRequest, clmResource } from '../api/clmErp';
import { parseClmData } from '../api/clmCore';
import { verifyPurchaseOrderContractLink, getPurchaseOrderContract } from '../api/clmPurchaseOrderLink';
import { readClmPdf } from '../api/clmSignature';
createEcrSchemaErpClient();
it('inspects the exact live procurement chain without mutations', async () => {
 const deps=createClmDependencies();
 const [rfq,award,contract,po,shipments,contracts,orders]=await Promise.all([
  deps.load('Request for Quotation','PUR-RFQ-2026-00104'),deps.load('Legal Document Review','LDC2026-00027'),deps.load('Contract','CON-2026-00001'),deps.load('Purchase Order','PUR-ORD-2026-00028'),
  deps.list('PO Shipment',[['po_name','=','PUR-ORD-2026-00028']]),
  deps.list('Contract',[['custom_rfq','=','PUR-RFQ-2026-00104']]),deps.list('Purchase Order',[['custom_clm_contract','=','CON-2026-00001']]),
 ]);
 const data=parseClmData(contract.custom_clm_data);
 const principal={typ:'supplier' as const,supplier:String(po.supplier),sub:String(po.supplier),iat:1,exp:Number.MAX_SAFE_INTEGER};
 const selected=(record:Record<string,unknown>,keys:string[])=>Object.fromEntries(keys.map(key=>[key,record[key]??null]));
 let result: unknown;
 try { result=await getPurchaseOrderContract(principal,String(po.name),deps); }
 catch(error) { result={error:(error as Error).message}; }
 const evidence={rfq:selected(rfq,['name','company','contract_required']),award:selected(award,['name','rfq_name','sq_name','supplier']),contract:selected(contract,['name','custom_rfq','custom_supplier_quotation','custom_supplier','party_name','custom_purchase_order','custom_contract_status','custom_current_version']),context:data.rfq_context,completion:data.procurement_completion,po:selected(po,['name','supplier','custom_clm_contract','custom_clm_rfq','custom_clm_award','custom_clm_creation_key']),contract_acceptance:data.supplier_po_acceptance??null,signatures:data.signatures,shipments,contract_ids:contracts.map(row=>row.name),po_ids:orders.map(row=>row.name),result};
 await writeFile('scratch/clm-link-relationship-inspected.json',JSON.stringify(evidence,null,2));
 if(process.env.CLM_LINK_VERIFY!=='1') await writeFile('scratch/clm-link-repair-before.json',JSON.stringify({contract,po,shipments},null,2));
 await verifyPurchaseOrderContractLink(po,contract,deps);
 expect(contracts.map(row=>row.name)).toEqual(['CON-2026-00001']);
 expect(orders.map(row=>row.name)).toEqual(['PUR-ORD-2026-00028']);
 await readClmPdf(contract,data.signatures.find(row=>row.party==='inteva')!);
 const supplier=data.signatures.find(row=>row.party==='supplier'); if(supplier) await readClmPdf(contract,supplier);
 if(process.env.CLM_LINK_VERIFY==='1') {
  expect((result as {error?:string}).error).toBeUndefined();
  const before=JSON.parse(await readFile('scratch/clm-link-repair-before.json','utf8'));
  const prior=parseClmData(before.contract.custom_clm_data);
  expect(data.signatures).toEqual(prior.signatures);
  expect(data.supplier_po_acceptance).toEqual(prior.supplier_po_acceptance);
  expect(data.audit.slice(0,prior.audit.length)).toEqual(prior.audit);
  expect(data.approvals).toEqual(prior.approvals);
 }
},120000);
