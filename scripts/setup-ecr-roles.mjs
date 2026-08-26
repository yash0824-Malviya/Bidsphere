/**
 * Creates BidSphere ECR-required ERPNext Roles and DocType Permissions.
 * Roles: canonical human ECR roles (including Procurement Team) plus the workflow service role.
 * Usage: node scripts/setup-ecr-roles.mjs
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

function loadEnvFile() {
  const envPath = resolve(root, ".env");
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (!process.env[key]) process.env[key] = value;
  }
}
loadEnvFile();

const baseUrl = (process.env.ERPNEXT_URL ?? process.env.VITE_ERPNEXT_URL ?? process.env.VITE_PROXY_TARGET ?? "").replace(/\/+$/, "");
const apiKey = process.env.ERP_API_KEY ?? process.env.VITE_API_KEY ?? "";
const apiSecret = process.env.ERP_API_SECRET ?? process.env.VITE_API_SECRET ?? "";

if (!baseUrl || !apiKey || !apiSecret) { console.error("Missing env vars"); process.exit(1); }
const WORKFLOW_SERVICE_ROLE = (
  process.env.ECR_WORKFLOW_SERVICE_ROLE ?? "BidSphere ECR Workflow Service"
).trim();

async function api(method, path, body) {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { Authorization: `token ${apiKey}:${apiSecret}`, Accept: "application/json", "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { data = { raw: text }; }
  if (!res.ok) { const msg = data?.exc_type ?? data?._server_messages ?? text; throw new Error(`${method} ${path} -> ${res.status}: ${msg}`); }
  return data?.data ?? data?.message ?? data;
}

async function roleExists(name) {
  try { await api("GET", `/api/resource/Role/${encodeURIComponent(name)}`); return true; } catch { return false; }
}

async function createRole(name) {
  if (await roleExists(name)) { console.log(`  skip (exists): ${name}`); return; }
  await api("POST", "/api/resource/Role", { role_name: name, is_custom: 1 });
  console.log(`  created: ${name}`);
}

const ECR_ROLES = [...ECR_HUMAN_ROLES, WORKFLOW_SERVICE_ROLE];

const READ_ONLY_ECR_PERMS = {
  ...ECR_READ_ONLY_PERMISSION_FLAGS,
  print: 1,
  email: 1,
  report: 1,
  export: 1,
};

const ECR_PERMISSIONS = [
  {
    role: WORKFLOW_SERVICE_ROLE,
    perms: {
      read: 1,
      write: 1,
      create: 1,
      delete: 0,
      submit: 1,
      cancel: 1,
      amend: 0,
      print: 0,
      email: 0,
      report: 0,
      export: 0,
    },
  },
  ...ECR_HUMAN_ROLES.map((role) => ({ role, perms: READ_ONLY_ECR_PERMS })),
];

const PR_PERMISSIONS = [
  { role: "Engineer", perms: { read:1,print:1,report:1 } },
  { role: "Engineering Manager", perms: { read:1,print:1,report:1 } },
  { role: "Procurement Manager", perms: { read:1,write:1,create:1,print:1,report:1,export:1 } },
  { role: "Procurement User", perms: { read:1,write:1,create:1,submit:1,print:1,report:1,export:1 } },
  { role: "Finance Manager", perms: { read:1,print:1,report:1 } },
  { role: "System Manager", perms: { read:1,write:1,create:1,delete:1,submit:1,cancel:1,print:1,email:1,report:1,export:1 } },
];

async function setDocTypePerm(doctype, role, perms) {
  const query = new URLSearchParams({
    filters: JSON.stringify([
      ["parent", "=", doctype],
      ["role", "=", role],
      ["permlevel", "=", 0],
    ]),
    fields: JSON.stringify(["name", "read", "write", "create", "delete", "submit", "cancel", "amend", "print", "email", "report", "export"]),
    limit_page_length: "2",
  });
  const existing = await api("GET", `/api/resource/Custom DocPerm?${query}`);
  if (Array.isArray(existing) && existing.length > 1) {
    throw new Error(`Duplicate ${role} permissions exist on ${doctype}.`);
  }
  const desired = {
    parent: doctype, parenttype: "DocType", parentfield: "permissions", role, permlevel: 0,
    read: perms.read||0, write: perms.write||0, create: perms.create||0, delete: perms.delete||0,
    submit: perms.submit||0, cancel: perms.cancel||0, amend: perms.amend||0, print: perms.print||0,
    email: perms.email||0, report: perms.report||0, export: perms.export||0,
  };
  const current = Array.isArray(existing) ? existing[0] : undefined;
  const flags = ["read", "write", "create", "delete", "submit", "cancel", "amend", "print", "email", "report", "export"];
  if (current && flags.every((field) => Number(current[field] || 0) === Number(desired[field] || 0))) {
    console.log(`  verified perm: ${role} on ${doctype}`);
    return;
  }
  await api(
    current ? "PUT" : "POST",
    current
      ? `/api/resource/Custom DocPerm/${encodeURIComponent(current.name)}`
      : "/api/resource/Custom DocPerm",
    desired,
  );
  console.log(`  ${current ? "updated" : "set"} perm: ${role} on ${doctype}`);
}

async function doctypeExists(name) {
  try { await api("GET", `/api/resource/DocType/${encodeURIComponent(name)}`); return true; } catch { return false; }
}

async function main() {
  console.log("\n=== BidSphere ECR Role Setup ===");
  console.log("\n1. Creating roles...");
  for (const r of ECR_ROLES) await createRole(r);

  console.log("\n2. Setting ECR DocType permissions...");
  if (await doctypeExists("Engineering Change Request")) {
    for (const { role, perms } of ECR_PERMISSIONS) await setDocTypePerm("Engineering Change Request", role, perms);
  } else { console.log("  DocType not yet created - run setup-ecr-doctype.mjs first, then re-run this."); }

  console.log("\n3. Setting PR DocType permissions...");
  if (await doctypeExists("Purchase Requisition")) {
    for (const { role, perms } of PR_PERMISSIONS) await setDocTypePerm("Purchase Requisition", role, perms);
  } else { console.log("  DocType not yet created - run setup-purchase-requisition-doctype.mjs first, then re-run this."); }

  console.log("\n=== Done ===\n");
}

main().catch(err => { console.error("Fatal:", err.message); process.exit(1); });
