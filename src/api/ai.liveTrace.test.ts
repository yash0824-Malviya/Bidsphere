/** Explicit manual integration probe. Normal test/build runs never call live services. */
import { it, expect, vi } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { resolveAIRecommendation, type AIRequest } from './ai';
import { getSupplierPerformance } from './supplierPerformance';
import { getScoringConfig } from './supplierScoring';
import { saveScoringResult, getLatestAnalysisSnapshot } from './supplierScoringResults';
import { scoringResultFromRecommendation } from '../utils/aiEvaluationResult';

const transport = vi.hoisted(() => ({api: null as null | ((method:string,path:string,body?:unknown)=>Promise<any>)}));
vi.mock('./erpnext', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./erpnext')>();
  const pathFor = (path:string,config?:any) => {
    const query = new URLSearchParams();
    for (const [key,value] of Object.entries(config?.params ?? {})) if(value !== undefined) query.set(key,typeof value === 'object' ? JSON.stringify(value) : String(value));
    return path.replace(/^\/api\//,'') + (query.size ? `?${query}` : '');
  };
  return {...actual, apiGet:(path:string,config?:any)=>transport.api!('GET',pathFor(path,config)),
    apiPost:(path:string,body:unknown)=>transport.api!('POST',pathFor(path),body)};
});

it.skipIf(process.env.RUN_LIVE_AI_TRACE !== '1')('traces current RFQ through configured Claude, ERP save/readback and frontend snapshot API', async () => {
  // Deployment client reads credentials internally; they are never captured in evidence.
  const clientModule = await import(/* @vite-ignore */ `${process.cwd().replaceAll('\\','/')}/scripts/ecr-schema-erp-client.mjs`);
  transport.api = clientModule.createEcrSchemaErpClient();
  const source = JSON.parse(readFileSync('scratch/ai-score-rfq91-source.json','utf8'));
  const rfq = await transport.api!('GET',`resource/Request%20for%20Quotation/${source.rfq.name}`);
  const quotes = await Promise.all(source.quotes.map((q:any)=>transport.api!('GET',`resource/Supplier%20Quotation/${q.name}`)));
  expect(quotes).toHaveLength(3);
  expect(quotes.every(q=>q.docstatus===1 && q.items.some((i:any)=>i.request_for_quotation===rfq.name))).toBe(true);
  const history = await getSupplierPerformance(quotes.map(q=>q.supplier));
  const config = await getScoringConfig();
  const input:AIRequest = {rfq_name:rfq.name,rfq_title:rfq.name,evaluation_run_id:randomUUID(),
    items_requested:rfq.items.map((i:any)=>({item:i.item_name||i.item_code,qty:i.qty,uom:i.uom})),
    quotations:quotes.map(q=>({quotation_id:q.name,supplier_id:q.supplier,supplier_name:q.supplier_name,
      total_value:q.grand_total,price_status:'submitted',payment_terms:q.terms||undefined,
      notes:[q.notes,q.custom_terms_note&&`Terms: ${q.custom_terms_note}`,q.custom_warranty_note&&`Warranty: ${q.custom_warranty_note}`,q.custom_insurance_note&&`Insurance: ${q.custom_insurance_note}`].filter(Boolean).join('\n'),
      documents:{warranty_certificate:!!q.custom_warenty_certificate,terms_conditions:!!(q.custom_terms__condition||q.terms),insurance_certificate:!!q.custom_insurance_certificate},
      historical_data:history[q.supplier],
      items:q.items.map((i:any)=>({item:i.item_name||i.item_code,requested_qty:i.qty,unit_price:i.rate,total:i.amount,delivery_days:i.lead_time_days>0?i.lead_time_days:undefined,notes:''})),
    })),
  };
  const realFetch = globalThis.fetch;
  const exchanges:any[]=[];
  vi.stubGlobal('fetch',async(url:any,init?:RequestInit)=>{
    if(url!== '/api/ai/claude') return realFetch(url,init);
    const response=await realFetch('http://localhost:5175/api/ai/claude',init);
    exchanges.push({request:JSON.parse(String(init?.body)),response:await response.clone().json()});
    return response;
  });
  const evidence:any={input,history,exchanges};
  try {
    const parsed=await resolveAIRecommendation(input,{price:config.price_weight,delivery:config.delivery_weight,quality:config.quality_weight,reliability:config.reliability_weight});
    evidence.parsed=parsed;
    expect(parsed?.provider).toBe('claude');
    const analysis=parsed!.recommendation;
    const scoring=scoringResultFromRecommendation(analysis,config);
    const snapshot={rfq_name:rfq.name,evaluation_run_id:input.evaluation_run_id,analysed_at:new Date().toISOString(),recommended_supplier:analysis.recommended_supplier,confidence_score:analysis.confidence_score,analysis,
      quotations_snapshot:quotes.map(q=>({quotation_id:q.name,supplier_id:q.supplier,supplier:q.supplier_name,grand_total:q.grand_total}))};
    evidence.persisted=await saveScoringResult(rfq.name,scoring,snapshot);
    evidence.api_response=await getLatestAnalysisSnapshot(rfq.name);
    expect(evidence.api_response.analysis.evaluation_run_id).toBe(input.evaluation_run_id);
    expect(evidence.api_response.analysis.supplier_analysis).toHaveLength(3);
  } finally {
    vi.unstubAllGlobals();
    writeFileSync('scratch/ai-score-current-verified.json',JSON.stringify(evidence,null,2));
  }
},180000);
