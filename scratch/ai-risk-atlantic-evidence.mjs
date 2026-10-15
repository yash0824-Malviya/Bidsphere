import { writeFileSync } from 'node:fs';
import { createEcrSchemaErpClient, ecrSchemaResource, listAllEcrSchemaRows } from '../scripts/ecr-schema-erp-client.mjs';

const api = createEcrSchemaErpClient();
const supplier = '"Atlantic Precision Manufacturing."';
const fields = ['name', 'supplier', 'docstatus', 'status'];
const sources = await Promise.all(['Purchase Order', 'Purchase Receipt', 'Purchase Invoice'].map(async doctype => {
  const rows = await listAllEcrSchemaRows(api, doctype, fields, [['supplier', '=', supplier], ['docstatus', '=', 1]]);
  const documents = await Promise.all(rows.map(row => api('GET', ecrSchemaResource(doctype, row.name))));
  const mapped = documents.map(doc => ({
    name: doc.name, supplier: doc.supplier, status: doc.status, docstatus: doc.docstatus,
    creation: doc.creation, modified: doc.modified, transaction_date: doc.transaction_date,
    posting_date: doc.posting_date, schedule_date: doc.schedule_date, due_date: doc.due_date,
    per_received: doc.per_received, is_return: doc.is_return, grand_total: doc.grand_total,
    items: (doc.items ?? []).map(item => ({
      name: item.name, item_code: item.item_code, qty: item.qty, received_qty: item.received_qty,
      rejected_qty: item.rejected_qty, schedule_date: item.schedule_date,
      purchase_order: item.purchase_order, purchase_order_item: item.purchase_order_item,
      purchase_receipt: item.purchase_receipt,
    })),
  }));
  return [doctype, mapped];
}));
const quotation = await api('GET', ecrSchemaResource('Supplier Quotation', 'PUR-SQTN-2026-00265'));
const evidence = { checked_at: new Date().toISOString(), read_only: true, supplier, sources: Object.fromEntries(sources), quotation: {
  name: quotation.name, supplier: quotation.supplier, supplier_name: quotation.supplier_name,
  modified: quotation.modified, status: quotation.status, docstatus: quotation.docstatus,
  grand_total: quotation.grand_total, lead_time_days: quotation.lead_time_days,
  payment_terms_template: quotation.payment_terms_template,
  items: (quotation.items ?? []).map(item => ({ item_code: item.item_code, qty: item.qty, rate: item.rate, amount: item.amount, schedule_date: item.schedule_date, request_for_quotation: item.request_for_quotation })),
} };
writeFileSync(new URL('./ai-risk-atlantic-evidence.json', import.meta.url), JSON.stringify(evidence, null, 2));
console.log(JSON.stringify(evidence, null, 2));
