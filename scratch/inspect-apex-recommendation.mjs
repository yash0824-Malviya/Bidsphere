import { writeFileSync } from 'node:fs';
import { createEcrSchemaErpClient, ecrSchemaResource as resource } from '../scripts/ecr-schema-erp-client.mjs';
const api = createEcrSchemaErpClient();
const parse = value => { try { return typeof value === 'string' ? JSON.parse(value) : value; } catch { return null; } };
const query = new URLSearchParams({ fields: JSON.stringify(['name', 'rfq', 'scored_at']), order_by: 'scored_at desc, creation desc', limit_page_length: '12' });
const recent = await api('GET', `${resource('Supplier Scoring Result')}?${query}`);
const evaluations = await Promise.all(recent.map(async item => {
  const result = await api('GET', resource('Supplier Scoring Result', item.name));
  const snapshot = parse(result.analysis_snapshot), analysis = snapshot?.analysis ?? snapshot;
  return { result: result.name, rfq: result.rfq, scored_at: result.scored_at,
    suppliers: (analysis?.supplier_analysis ?? []).map(row => ({
      name: row.name, supplier_id: row.supplier_id, quotation_id: row.quotation_id ?? row.supplier_quotation_id,
      rank: row.rank, score: row.score?.overall, risk: row.risk, verdict: row.verdict,
      evaluation_status: row.evaluation_status ?? null, quote_price_status: row.quote_price_status ?? null,
    })) };
}));
const evidence = { checked_at: new Date().toISOString(), read_only: true, mutation_performed: false,
  evaluations, matching_rfqs: [...new Set(evaluations.filter(row =>
    row.suppliers.some(s => /apex/i.test(s.name) && s.score === 88) &&
    row.suppliers.some(s => /blue ridge/i.test(s.name) && s.score === 85) &&
    row.suppliers.some(s => /redwood/i.test(s.name) && s.score === 81)).map(row => row.rfq))] };
writeFileSync('scratch/apex-live-evaluation-evidence.json', JSON.stringify(evidence, null, 2));
console.log(JSON.stringify(evidence, null, 2));
