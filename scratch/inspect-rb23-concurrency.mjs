import {writeFileSync} from 'node:fs';
import {createEcrSchemaErpClient,ecrSchemaResource as resource,listAllEcrSchemaRows as list} from '../scripts/ecr-schema-erp-client.mjs';
const api=createEcrSchemaErpClient();
const doc=await api('GET',resource('Reverse Bidding','RB-2026-00023'));
const schemas=await Promise.all(['Reverse Bidding','Reverse Bid Item','Reverse Bids','Reverse Bidding Supplier'].map(async name=>{const d=await api('GET',resource('DocType',name));return {name,istable:d.istable,autoname:d.autoname,fields:d.fields.map(f=>({fieldname:f.fieldname,fieldtype:f.fieldtype,options:f.options}))};}));
const scripts=await list(api,'Server Script',['name','script_type','reference_doctype','doctype_event','disabled'],[['reference_doctype','in',['Reverse Bidding','Reverse Bid Item','Reverse Bids','Reverse Bidding Supplier']]]).catch(e=>({error:e.message}));
const versions=await api('GET','method/frappe.utils.change_log.get_versions').catch(e=>({error:e.message}));
writeFileSync('scratch/rb23-concurrency-before.json',JSON.stringify({doc,schemas,scripts,versions},null,2));
console.log(JSON.stringify({name:doc.name,modified:doc.modified,status:doc.auction_status,start:doc.start_date_time,end:doc.end_date_time,lowest:doc.lowest_bid,suppliers:doc.invited_suppliers.map(r=>({name:r.name,supplier:r.supplier,current_bid:r.current_bid,modified:r.modified})),items:doc.bid_items.map(r=>({name:r.name,supplier:r.supplier,item:r.item_code,item_name:r.item_name,rate:r.current_rate,modified:r.modified,creation:r.creation})),history:doc.bid_history,scripts,versions},null,2));
