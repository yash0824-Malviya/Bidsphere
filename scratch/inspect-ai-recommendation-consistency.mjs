import { writeFileSync } from 'node:fs';
import { createEcrSchemaErpClient, ecrSchemaResource as resource } from '../scripts/ecr-schema-erp-client.mjs';
const api = createEcrSchemaErpClient();
const query = new URLSearchParams({ fields: JSON.stringify(['name','rfq','creation','modified','recommended_supplier']), order_by: 'creation desc', limit_page_length: '35' });
const records = await api('GET', `${resource('Supplier Scoring Result')}?${query}`);
const evaluations = [];
for (const row of records) {
  const doc = await api('GET', resource('Supplier Scoring Result', row.name));
  let snapshot = {}; try { snapshot = JSON.parse(doc.analysis_snapshot || '{}'); } catch {}
  const analysis = snapshot.analysis || snapshot;
  const suppliers = analysis.supplier_analysis || [];
  evaluations.push({ name:doc.name, rfq:doc.rfq, modified:doc.modified, creation:doc.creation, recommended_supplier:doc.recommended_supplier,
    snapshot_keys: Object.keys(snapshot), analysis_keys:Object.keys(analysis), suppliers: suppliers.map(s => ({quotation_id:s.quotation_id,supplier_id:s.supplier_id,name:s.name,score:s.score,risk:s.risk,verdict:s.verdict,grand_total:s.grand_total,evaluation_run_id:s.evaluation_run_id})) });
  if (suppliers.some(s => /atlantic/i.test(s.name||s.supplier_id||'')) && suppliers.some(s => /blue ridge/i.test(s.name||s.supplier_id||'')) && suppliers.some(s => /femsa/i.test(s.name||s.supplier_id||''))) {
    writeFileSync(`scratch/ai-recommendation-${doc.rfq}-${doc.name}.json`, JSON.stringify({checked_at:new Date().toISOString(),read_only:true,document:doc,snapshot},null,2));
  }
}
writeFileSync('scratch/ai-recommendation-recent-evaluations.json', JSON.stringify(evaluations,null,2));
console.log(JSON.stringify(evaluations.filter(e => e.suppliers.some(s=>/atlantic/i.test(s.name||s.supplier_id||''))),null,2));
