// Manual, read-only live-provider trace. Ordinary test runs never call the provider.
import { it, vi, expect } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolveAIRecommendation, type AIRequest } from '../src/api/ai';

it.skipIf(process.env.RUN_LIVE_AI_TRACE !== '1')('captures current ERP quotation inputs through the live Claude gateway', async () => {
  const source = JSON.parse(readFileSync('scratch/ai-score-rfq91-source.json', 'utf8'));
  const input: AIRequest = {
    rfq_name: source.rfq.name, rfq_title: source.rfq.name,
    items_requested: source.rfq.items.map((i: any) => ({ item: i.item_name || i.item_code, qty: i.qty, uom: i.uom })),
    quotations: [...source.quotes].reverse().map((q: any) => ({
      quotation_id: q.name, supplier_id: q.supplier, supplier_name: q.supplier_name,
      total_value: q.grand_total, price_status: 'submitted',
      items: q.items.map((i: any) => ({item: i.item_name || i.item_code, requested_qty:i.qty,unit_price:i.rate,total:i.amount,delivery_days:i.lead_time_days > 0 ? i.lead_time_days : undefined, notes:''})),
      payment_terms: q.terms || undefined, notes: q.notes || '',
      documents:{warranty_certificate:!!q.custom_warenty_certificate, terms_conditions:!!q.custom_terms__condition, insurance_certificate:!!q.custom_insurance_certificate},
    })),
  };
  const realFetch = globalThis.fetch;
  const exchanges: unknown[] = [];
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    body.evaluation_debug={enabled:true,evaluation_run_id:'baseline-rfq91-20260917'};
    const response = await realFetch(new URL(url,'http://localhost:5175'),{...init,body:JSON.stringify(body)});
    exchanges.push({request:body,response:await response.clone().json()});
    return response;
  });
  try {
    const parsed = await resolveAIRecommendation(input,{price:40,delivery:25,quality:20,reliability:15});
    writeFileSync('scratch/ai-score-baseline-live.json',JSON.stringify({input,exchanges,parsed},null,2));
    expect(parsed?.provider).toBe('claude');
  } finally { vi.unstubAllGlobals(); }
},120000);
