/**
 * setup-ecr-permissions.mjs
 * Reconciles DocType permissions for ECR-related roles on:
 *   - Engineering Change Request
 *   - Purchase Requisition
 * Also adds custom fields on Request for Quotation for traceability.
 * Human ECR roles are read-only in ERP. Creates and mutations are applied by
 * the exclusive workflow service identity after BidSphere authorizes them.
 * Usage: node scripts/setup-ecr-permissions.mjs
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ECR_HUMAN_ROLES,
  ECR_READ_ONLY_PERMISSION_FLAGS,
} from "./ecr-role-policy.mjs";
const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
function loadEnv() {
  const p = resolve(root, ".env");
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq <= 0) continue;
    const k = t.slice(0, eq).trim(), v = t.slice(eq + 1).trim();
    if (!process.env[k]) process.env[k] = v;
  }
}
loadEnv();
const BASE = (process.env.ERPNEXT_URL ?? process.env.VITE_ERPNEXT_URL ?? process.env.VITE_PROXY_TARGET ?? "").replace(/\/+$/, "");
const KEY = process.env.ERP_API_KEY ?? process.env.VITE_API_KEY ?? "";
const SEC = process.env.ERP_API_SECRET ?? process.env.VITE_API_SECRET ?? "";
if (!BASE || !KEY || !SEC) { console.error("Missing env vars"); process.exit(1); }

async function api(method, path, body) {
  const r = await fetch(`${BASE}${path}`, {
    method, headers: { Authorization: `token ${KEY}:${SEC}`, Accept: "application/json", "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const t = await r.text();
  let d; try { d = JSON.parse(t); } catch { d = { raw: t }; }
  if (!r.ok) throw new Error(`${method} ${path} -> ${r.status}: ${d?.exc_type ?? t.slice(0,200)}`);
  return d?.data ?? d?.message ?? d;
}

async function addDocTypePerm(dt, role, perms) {
  const dtDoc = await api("GET", `/api/resource/DocType/${encodeURIComponent(dt)}`);
  const currentPerms = dtDoc.permissions ?? [];
  const existingIndex = currentPerms.findIndex(p => p.role === role && Number(p.permlevel || 0) === 0);
  if (existingIndex >= 0) {
    const existing = currentPerms[existingIndex];
    const differs = Object.entries(perms).some(([key, value]) => Number(existing[key] || 0) !== Number(value || 0));
    if (!differs) {
      console.log(`  skip (current): ${role} on ${dt}`);
      return;
    }
    currentPerms[existingIndex] = { ...existing, ...perms };
  } else {
    currentPerms.push({ role, permlevel: 0, ...perms });
  }
  await api("PUT", `/api/resource/DocType/${encodeURIComponent(dt)}`, {
    permissions: currentPerms,
  });
  console.log(`  ✅ reconciled: ${role} on ${dt}`);
}

async function customFieldExists(dt, fieldname) {
  try {
    const r = await api("GET", `/api/resource/Custom Field?filters=[["dt","=","${dt}"],["fieldname","=","${fieldname}"]]&fields=["name"]`);
    return Array.isArray(r) && r.length > 0;
  } catch { return false; }
}

async function addCustomField(dt, fieldname, label, fieldtype, options, insertAfter, extras = {}) {
  if (await customFieldExists(dt, fieldname)) {
    console.log(`  skip custom field (exists): ${fieldname} on ${dt}`);
    return;
  }
  await api("POST", "/api/resource/Custom Field", {
    dt, fieldname, label, fieldtype, options: options ?? "", insert_after: insertAfter ?? "", ...extras,
  });
  console.log(`  ✅ added custom field: ${fieldname} on ${dt}`);
}

// ECR permission matrix — using actual role names that exist
const ECR_PERMS = ECR_HUMAN_ROLES.map((role) => ({
  role,
  ...ECR_READ_ONLY_PERMISSION_FLAGS,
  print: 1,
  export: 1,
  report: 1,
}));

// PR permission matrix
const PR_PERMS = [
  { role: "Engineer",            read:1, write:0, create:0, submit:0, delete:0, cancel:0, print:1, report:1 },
  { role: "Engineering Manager", read:1, write:0, create:0, submit:0, delete:0, cancel:0, print:1, report:1 },
  { role: "Purchase Manager",    read:1, write:1, create:1, submit:1, delete:0, cancel:1, print:1, export:1, report:1 },
  { role: "Purchase User",       read:1, write:1, create:1, submit:1, delete:0, cancel:0, print:1, export:1, report:1 },
  { role: "Finance Manager",     read:1, write:0, create:0, submit:0, delete:0, cancel:0, print:1, report:1 },
  { role: "Quality Manager",     read:1, write:0, create:0, submit:0, delete:0, cancel:0, print:1, report:1 },
  { role: "Operations Manager",  read:1, write:0, create:0, submit:0, delete:0, cancel:0, print:1, report:1 },
];

async function main() {
  console.log("\n=== BidSphere ECR Permissions & Custom Fields Setup ===\n");

  console.log("1. Adding missing permissions on Engineering Change Request...");
  for (const { role, ...perms } of ECR_PERMS) {
    await addDocTypePerm("Engineering Change Request", role, perms);
  }

  console.log("\n2. Adding missing permissions on Purchase Requisition...");
  for (const { role, ...perms } of PR_PERMS) {
    await addDocTypePerm("Purchase Requisition", role, perms);
  }

  console.log("\n3. Adding custom fields on Request for Quotation (traceability)...");
  await addCustomField("Request for Quotation", "custom_ecr_reference", "ECR Reference", "Link", "Engineering Change Request", "");
  await addCustomField("Request for Quotation", "custom_bidsphere_ecr_idempotency_key", "BidSphere ECR Idempotency Key", "Data", "", "custom_ecr_reference", { hidden: 1, unique: 1, no_copy: 1 });
  await addCustomField("Request for Quotation", "custom_purchase_requisition_reference", "Purchase Requisition Reference", "Link", "Purchase Requisition", "custom_bidsphere_ecr_idempotency_key");
  await addCustomField("Request for Quotation", "custom_bidsphere_pr_idempotency_key", "BidSphere PR Idempotency Key", "Data", "", "custom_purchase_requisition_reference", { hidden: 1, unique: 1, no_copy: 1 });

  console.log("\n=== Done ===\n");
}
main().catch(e => { console.error("Fatal:", e.message); process.exit(1); });
