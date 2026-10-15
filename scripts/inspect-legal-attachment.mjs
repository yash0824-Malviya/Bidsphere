// Read-only ERP diagnostics. Never prints credentials or document contents.
import { loadEnv } from "vite";
const env = loadEnv("development", process.cwd(), "");
const base = (env.ERPNEXT_URL || env.VITE_ERPNEXT_URL || env.VITE_PROXY_TARGET || "").replace(/\/$/, "");
const key = env.ERP_API_KEY || env.VITE_API_KEY;
const secret = env.ERP_API_SECRET || env.VITE_API_SECRET;
if (!base || !key || !secret) throw new Error("ERPNext server credentials are not configured.");
async function get(doctype, name, params) {
  const path = `/api/resource/${encodeURIComponent(doctype)}${name ? `/${encodeURIComponent(name)}` : ""}`;
  const response = await fetch(base + path + (params ? `?${new URLSearchParams(params)}` : ""), {
    headers: { Authorization: `token ${key}:${secret}` }, signal: AbortSignal.timeout(15000),
  });
  const body = await response.json();
  if (!response.ok) { console.log({ doctype, name, status: response.status, exception: body.exception || body.exc_type }); return null; }
  return body.data;
}
const select = (object, fields) => Object.fromEntries(fields.map(field => [field, object?.[field] ?? null]));
const sq = await get("Supplier Quotation", "PUR-SQTN-2026-00243");
console.log("[SQ]", JSON.stringify(select(sq, ["name", "owner", "company", "supplier", "docstatus", "status", "workflow_state", "custom_status", "custom_legal_status", "custom_rfq_id", "rfq_no"]), null, 2));
const reviews = await get("Legal Document Review", null, { filters: JSON.stringify([["sq_name", "=", "PUR-SQTN-2026-00243"]]), fields: JSON.stringify(["name"]) });
for (const row of reviews || []) {
  const doc = await get("Legal Document Review", row.name);
  const fields = ["name", "owner", "company", "sq_name", "rfq_name", "procurement_manager", "review_status", "workflow_state", "current_owner", "next_approver", "approved_by", "esign_status", "esign_signed_by", "terms_file_url", "warranty_file_url", "insurance_file_url", "esign_signed_file_url"];
  console.log("[LEGAL REVIEW]", JSON.stringify(select(doc, fields), null, 2));
}
const files = await get("File", null, { filters: JSON.stringify([["file_name", "like", "%Inteva BidSphere Documentation%"]]), fields: JSON.stringify(["name", "file_name", "file_url", "is_private", "attached_to_doctype", "attached_to_name", "attached_to_field", "owner", "creation", "modified"]), limit_page_length: "100" });
console.log("[FILES]", JSON.stringify(files, null, 2));
for (const identity of ["legal@netlink.com", "procurement@netlink.com"]) {
  const user = await get("User", identity);
  console.log("[USER ROLES]", { name: identity, enabled: user?.enabled, roles: user?.roles?.map(row => row.role) });
}
for (const doctype of ["Legal Document Review", "Supplier Quotation", "File", "Contract", "Contract Review"]) {
  const meta = await get("DocType", doctype);
  if (meta) console.log("[DOCTYPE PERMISSIONS]", JSON.stringify({ doctype, permissions: meta.permissions?.map(row => select(row, ["role", "read", "write", "create", "submit", "if_owner", "permlevel"])) }, null, 2));
}
