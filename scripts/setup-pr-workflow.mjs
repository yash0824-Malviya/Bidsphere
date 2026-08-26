import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
function loadEnv() {
  const p = resolve(root, ".env"); if (!existsSync(p)) return;
  for (const line of readFileSync(p, "utf8").split("\n")) {
    const t = line.trim(); if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("="); if (eq <= 0) continue;
    const k = t.slice(0, eq).trim(), v = t.slice(eq + 1).trim();
    if (!process.env[k]) process.env[k] = v;
  }
}
loadEnv();
const BASE = (process.env.ERPNEXT_URL ?? process.env.VITE_ERPNEXT_URL ?? process.env.VITE_PROXY_TARGET ?? "").replace(/\/+$/, "");
const KEY = process.env.ERP_API_KEY ?? process.env.VITE_API_KEY ?? "";
const SEC = process.env.ERP_API_SECRET ?? process.env.VITE_API_SECRET ?? "";
if (!BASE||!KEY||!SEC) { console.error("Missing env"); process.exit(1); }
async function api(method, path, body) {
  const r = await fetch(`${BASE}${path}`, { method, headers: { Authorization:`token ${KEY}:${SEC}`, Accept:"application/json","Content-Type":"application/json" }, body:body?JSON.stringify(body):undefined });
  const t=await r.text(); let d; try{d=JSON.parse(t);}catch{d={raw:t};} if(!r.ok) throw new Error(`${method} ${path} -> ${r.status}: ${JSON.stringify(d).slice(0,400)}`);
  return d?.data??d?.message??d;
}
async function ensureWFState(s,style){try{await api("GET",`/api/resource/Workflow State/${encodeURIComponent(s)}`);}catch{await api("POST","/api/resource/Workflow State",{workflow_state_name:s,style});console.log(`  state: ${s}`);}}
async function ensureWFAction(a){try{await api("GET",`/api/resource/Workflow Action Master/${encodeURIComponent(a)}`);}catch{await api("POST","/api/resource/Workflow Action Master",{workflow_action_name:a});console.log(`  action: ${a}`);}}
async function wfExists(n){try{await api("GET",`/api/resource/Workflow/${encodeURIComponent(n)}`);return true;}catch{return false;}}

// PR: same rules: no 1->0 transitions, no 0->2 transitions
// "Send Back" goes to "Needs Revision" (doc_status=1), not Draft
const STATES = [
  ["Draft",         "Secondary","0"],["Submitted",   "Primary","1"],["Needs Revision","Warning","1"],
  ["Under Review",  "Warning",  "1"],["Approved",    "Success","1"],["Rejected",      "Danger", "2"],
  ["RFQ Created",   "Primary",  "1"],["Closed",      "Success","1"],["Cancelled",     "Danger", "2"],
];
const WF_STATES = [
  { state:"Draft",          doc_status:"0", style:"Secondary", allow_edit:"Purchase User" },
  { state:"Submitted",      doc_status:"1", style:"Primary",   allow_edit:"Purchase Manager" },
  { state:"Needs Revision", doc_status:"1", style:"Warning",   allow_edit:"Purchase User" },
  { state:"Under Review",   doc_status:"1", style:"Warning",   allow_edit:"Purchase Manager" },
  { state:"Approved",       doc_status:"1", style:"Success",   allow_edit:"Purchase Manager" },
  { state:"Rejected",       doc_status:"2", style:"Danger",    allow_edit:"System Manager" },
  { state:"RFQ Created",    doc_status:"1", style:"Primary",   allow_edit:"Purchase Manager" },
  { state:"Closed",         doc_status:"1", style:"Success",   allow_edit:"System Manager" },
  { state:"Cancelled",      doc_status:"2", style:"Danger",    allow_edit:"System Manager" },
];
const WF_TRANSITIONS = [
  { state:"Draft",          action:"Submit Requisition",  next_state:"Submitted",      allowed:"Purchase User" },
  { state:"Submitted",      action:"Start Review",        next_state:"Under Review",   allowed:"Purchase Manager" },
  { state:"Under Review",   action:"Approve Requisition", next_state:"Approved",       allowed:"Purchase Manager" },
  { state:"Under Review",   action:"Send Back",           next_state:"Needs Revision", allowed:"Purchase Manager" },
  { state:"Under Review",   action:"Reject Requisition",  next_state:"Rejected",       allowed:"Purchase Manager" },
  { state:"Needs Revision", action:"Re-Submit after Revision", next_state:"Submitted", allowed:"Purchase User" },
  { state:"Approved",       action:"Mark RFQ Created",    next_state:"RFQ Created",    allowed:"Purchase Manager" },
  { state:"RFQ Created",    action:"Close Requisition",   next_state:"Closed",         allowed:"Purchase Manager" },
  { state:"Submitted",      action:"Cancel Requisition",  next_state:"Cancelled",      allowed:"Purchase User" },
];
const ACTIONS = [...new Set(WF_TRANSITIONS.map(t=>t.action))];

async function main() {
  const WF_NAME = "Purchase Requisition Approval Workflow";
  console.log(`\n=== PR Workflow Setup ===\n`);
  if (await wfExists(WF_NAME)) { console.log(`✅ Already exists.`); return; }
  console.log("States..."); for(const [s,style] of STATES) await ensureWFState(s,style);
  console.log("Actions..."); for(const a of ACTIONS) await ensureWFAction(a);
  console.log("Creating...");
  await api("POST", "/api/resource/Workflow", {
    workflow_name: WF_NAME, document_type: "Purchase Requisition",
    workflow_state_field: "status", is_active: 1, override_status: 0, send_email_alert: 0,
    states: WF_STATES.map((s,i)=>({...s,idx:i+1})),
    transitions: WF_TRANSITIONS.map((t,i)=>({...t,idx:i+1,condition:"",allow_self_approval:1})),
  });
  console.log(`✅ Created: ${WF_NAME}\n=== Done ===\n`);
}
main().catch(e=>{console.error("Fatal:",e.message);process.exit(1);});
