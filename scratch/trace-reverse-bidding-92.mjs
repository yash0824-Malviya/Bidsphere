import { writeFileSync } from 'node:fs';
import { createEcrSchemaErpClient, ecrSchemaResource as resource, listAllEcrSchemaRows as list } from '../scripts/ecr-schema-erp-client.mjs';
const api = createEcrSchemaErpClient();
const rfqId = 'PUR-RFQ-2026-00092';
const rfq = await api('GET', resource('Request for Quotation', rfqId));
const sqNames = await list(api, 'Supplier Quotation', ['name'], [['items.request_for_quotation', '=', rfqId]]);
const quotations = await Promise.all(sqNames.map(q => api('GET', resource('Supplier Quotation', q.name))));
const auctionNames = await list(api, 'Reverse Bidding', ['name'], [['rfq', '=', rfqId]]);
const auctions = await Promise.all(auctionNames.map(q => api('GET', resource('Reverse Bidding', q.name))));
const scoringNames = await list(api, 'Supplier Scoring Result', ['name', 'scored_at'], [['rfq', '=', rfqId]]);
scoringNames.sort((a,b) => String(b.scored_at).localeCompare(String(a.scored_at)));
const scoring = scoringNames[0] ? await api('GET', resource('Supplier Scoring Result', scoringNames[0].name)) : null;
const evidence = {rfq, quotations, auctions, scoring};
writeFileSync('scratch/reverse-bidding-92-source.json', JSON.stringify(evidence, null, 2));
console.log(JSON.stringify({rfq:rfq.name, rfq_status:rfq.status, quotations:quotations.map(q=>({name:q.name,supplier:q.supplier,supplier_name:q.supplier_name,docstatus:q.docstatus,status:q.status,total:q.grand_total,round:q.custom_rfq_round,rfq_no:q.rfq_no,items:q.items.map(i=>({item:i.item_code,qty:i.qty,rate:i.rate,rfq:i.request_for_quotation}))})),auctions:auctions.map(q=>({name:q.name,status:q.auction_status,suppliers:q.invited_suppliers})),scoring:scoring?.name},null,2));

