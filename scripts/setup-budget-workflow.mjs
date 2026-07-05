/**
 * Provision ERPNext Budget Approval infrastructure:
 * - Finance Executive role
 * - Role permissions (Budget, Budget Account, Fiscal Year, Cost Center, Company)
 * - Budget Workflow (Draft → Submitted → Approved → Active | Rejected)
 * - finance.executive@netlink.com user
 *
 * Usage (from project root):
 *   node scripts/setup-budget-workflow.mjs
 *
 * Requires .env:
 *   ERPNEXT_URL or VITE_ERPNEXT_URL
 *   ERP_API_KEY, ERP_API_SECRET
 *   ROLE_USER_PASSWORD (default: Netlink@2026)
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

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

const baseUrl = (
  process.env.ERPNEXT_URL ??
  process.env.VITE_ERPNEXT_URL ??
  process.env.VITE_PROXY_TARGET ??
  ""
).replace(/\/$/, "");

const apiKey = process.env.ERP_API_KEY ?? process.env.VITE_API_KEY ?? "";
const apiSecret = process.env.ERP_API_SECRET ?? process.env.VITE_API_SECRET ?? "";
const password = process.env.ROLE_USER_PASSWORD ?? "Netlink@2026";

const FINANCE_EXECUTIVE = "Finance Executive";
const FINANCE_MANAGER = "Finance Manager";

/** Finance Executive: create, read, write, submit — no approve/cancel/delete submitted */
const EXECUTIVE_PERMS = [
  { parent: "Budget", read: 1, write: 1, create: 1, submit: 1, cancel: 0, delete: 0, amend: 0 },
  { parent: "Budget Account", read: 1, write: 0, create: 0, submit: 0 },
  { parent: "Fiscal Year", read: 1 },
  { parent: "Cost Center", read: 1 },
  { parent: "Company", read: 1 },
  { parent: "Monthly Distribution", read: 1 },
];

/** Finance Manager: full budget control including approve/reject/cancel */
const MANAGER_EXTRA = [
  { parent: "Budget", read: 1, write: 1, create: 1, submit: 1, cancel: 1, delete: 0, amend: 0 },
];

async function api(method, path, body) {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      Authorization: `token ${apiKey}:${apiSecret}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }
  if (!res.ok) {
    const msg = data?.message ?? data?.exc ?? JSON.stringify(data);
    if (String(msg).includes("already exists") || String(msg).includes("Duplicate")) {
      return { skipped: true, data };
    }
    throw new Error(`${method} ${path} failed (${res.status}): ${JSON.stringify(data)}`);
  }
  return data?.data ?? data?.message ?? data;
}

async function ensureRole(roleName) {
  try {
    await api("GET", `/api/resource/Role/${encodeURIComponent(roleName)}`);
    console.log(`✓ Role exists: ${roleName}`);
  } catch {
    console.log(`• Creating role: ${roleName}`);
    await api("POST", "/api/resource/Role", {
      doctype: "Role",
      role_name: roleName,
      desk_access: 1,
    });
  }
}

async function ensureCustomDocPerm(role, parent, perms) {
  try {
    const filters = encodeURIComponent(
      JSON.stringify([["role", "=", role], ["parent", "=", parent]])
    );
    const existing = await api(
      "GET",
      `/api/resource/Custom DocPerm?filters=${filters}&limit_page_length=1`
    );
    const rows = Array.isArray(existing) ? existing : existing?.data ?? [];
    if (rows.length > 0) {
      const name = rows[0].name;
      await api("PUT", `/api/resource/Custom DocPerm/${encodeURIComponent(name)}`, {
        ...perms,
        role,
        parent,
      });
      console.log(`  ↻ Updated permission: ${role} → ${parent}`);
      return;
    }
  } catch {
    /* create fresh */
  }

  try {
    await api("POST", "/api/resource/Custom DocPerm", {
      doctype: "Custom DocPerm",
      role,
      parent,
      ...perms,
    });
    console.log(`  ✓ Permission: ${role} → ${parent}`);
  } catch (err) {
    console.warn(`  ⚠ Permission ${role}/${parent}:`, err.message);
  }
}

async function setupPermissions() {
  console.log("\n── Permissions: Finance Executive ──");
  for (const p of EXECUTIVE_PERMS) {
    const { parent, ...perms } = p;
    await ensureCustomDocPerm(FINANCE_EXECUTIVE, parent, perms);
  }

  console.log("\n── Permissions: Finance Manager (budget) ──");
  for (const p of MANAGER_EXTRA) {
    const { parent, ...perms } = p;
    await ensureCustomDocPerm(FINANCE_MANAGER, parent, perms);
  }
}

async function ensureWorkflow() {
  console.log("\n── Budget Workflow ──");
  const workflowName = "Budget Approval";

  const workflowPayload = {
    doctype: "Workflow",
    workflow_name: workflowName,
    document_type: "Budget",
    is_active: 1,
    override_status: 1,
    send_email_alert: 0,
    states: [
      { state: "Draft", doc_status: "0", allow_edit: FINANCE_EXECUTIVE, update_field: "workflow_state", update_value: "Draft" },
      { state: "Submitted", doc_status: "1", allow_edit: FINANCE_MANAGER, update_field: "workflow_state", update_value: "Submitted" },
      { state: "Approved", doc_status: "1", allow_edit: FINANCE_MANAGER, update_field: "workflow_state", update_value: "Approved" },
      { state: "Active", doc_status: "1", allow_edit: FINANCE_MANAGER, update_field: "workflow_state", update_value: "Active" },
      { state: "Rejected", doc_status: "1", allow_edit: FINANCE_MANAGER, update_field: "workflow_state", update_value: "Rejected" },
    ],
    transitions: [
      { state: "Draft", action: "Submit", next_state: "Submitted", allowed: FINANCE_EXECUTIVE },
      { state: "Submitted", action: "Approve", next_state: "Approved", allowed: FINANCE_MANAGER },
      { state: "Submitted", action: "Reject", next_state: "Rejected", allowed: FINANCE_MANAGER },
      { state: "Approved", action: "Activate", next_state: "Active", allowed: FINANCE_MANAGER },
      { state: "Submitted", action: "Cancel", next_state: "Draft", allowed: FINANCE_MANAGER },
    ],
  };

  try {
    await api("GET", `/api/resource/Workflow/${encodeURIComponent(workflowName)}`);
    console.log(`✓ Workflow exists: ${workflowName}`);
    await api("PUT", `/api/resource/Workflow/${encodeURIComponent(workflowName)}`, workflowPayload);
    console.log(`↻ Workflow updated: ${workflowName}`);
  } catch {
    try {
      await api("POST", "/api/resource/Workflow", workflowPayload);
      console.log(`✓ Workflow created: ${workflowName}`);
    } catch (err) {
      console.warn("⚠ Workflow setup failed — configure manually in ERPNext:", err.message);
      console.log(`
Manual workflow states:
  Draft → Submit (Finance Executive) → Submitted
  Submitted → Approve (Finance Manager) → Approved → Activate → Active
  Submitted → Reject (Finance Manager) → Rejected
`);
    }
  }
}

async function ensureUser(email, firstName, lastName, roles) {
  const roleRows = roles.map((role) => ({ role }));
  try {
    await api("GET", `/api/resource/User/${encodeURIComponent(email)}`);
    console.log(`• ${email} exists — updating roles`);
    await api("PUT", `/api/resource/User/${encodeURIComponent(email)}`, {
      new_password: password,
      roles: roleRows,
      enabled: 1,
    });
  } catch {
    console.log(`• Creating user: ${email}`);
    await api("POST", "/api/resource/User", {
      doctype: "User",
      email,
      first_name: firstName,
      last_name: lastName,
      send_welcome_email: 0,
      new_password: password,
      roles: roleRows,
      enabled: 1,
    });
  }
}

async function main() {
  if (!baseUrl || !apiKey || !apiSecret) {
    console.error("Missing ERPNEXT_URL and API credentials in .env");
    process.exit(1);
  }

  console.log(`Setting up Budget Approval on ${baseUrl}\n`);

  await ensureRole(FINANCE_EXECUTIVE);
  await setupPermissions();
  await ensureWorkflow();
  await ensureUser(
    "finance.executive@netlink.com",
    "Finance",
    "Executive",
    [FINANCE_EXECUTIVE]
  );

  console.log("\n✅ Budget Approval setup complete.");
  console.log("\nTest flow:");
  console.log("  1. Login as finance.executive@netlink.com → Create & Submit budget");
  console.log("  2. Login as finance@netlink.com → Approve/Reject in Budget Approval");
  console.log("  3. Procurement RFQ budget check reads approved ERPNext budgets");
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
