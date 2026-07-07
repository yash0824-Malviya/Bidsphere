/**
 * Provisions the Enterprise SLA Management module DocTypes on ERPNext:
 *
 *   • SLA Configuration — admin-defined rules (workflow/stage/role/priority →
 *     duration + reminder + escalation). ALL durations live here; nothing is
 *     hardcoded in the app.
 *   • SLA Timer — one running timer per (document, workflow stage). Stores the
 *     backend start_time + due_time so countdowns survive refresh/restart.
 *   • SLA Audit Log — Started / Reminder Sent / Breached / Escalated /
 *     Completed / Cancelled events.
 *
 * The script is idempotent: existing DocTypes are left in place (missing fields
 * are appended), missing ones are created.
 *
 * Usage: node scripts/setup-sla-module.mjs
 * Requires .env: ERPNEXT_URL (or VITE_ERPNEXT_URL), ERP_API_KEY, ERP_API_SECRET
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
).replace(/\/+$/, "");
const apiKey = process.env.ERP_API_KEY ?? process.env.VITE_API_KEY ?? "";
const apiSecret = process.env.ERP_API_SECRET ?? process.env.VITE_API_SECRET ?? "";

async function api(method, path, body) {
  const url = `${baseUrl}${path}`;
  const headers = {
    Authorization: `token ${apiKey}:${apiSecret}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  const opts = { method, headers };
  if (body) opts.body = JSON.stringify(body);

  const res = await fetch(url, opts);
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(
      json.exception || json._server_messages || JSON.stringify(json) || res.statusText
    );
  }
  return json.data;
}

const MODULE = "Buying";
const SYSTEM_MANAGER = "System Manager";
const PURCHASE_MANAGER = "Purchase Manager";
const PURCHASE_USER = "Purchase User";

const WORKFLOW_OPTIONS = [
  "Material Request",
  "Warehouse Review",
  "Material Issue",
  "Procurement Review",
  "RFQ Creation",
  "Supplier Response",
  "Reverse Auction",
  "AI Recommendation",
  "Legal Review",
  "Finance Review",
  "Purchase Order",
  "GRN",
  "Invoice",
  "Payment",
].join("\n");

const TIME_UNIT_OPTIONS = ["Minutes", "Hours", "Days"].join("\n");
const PRIORITY_OPTIONS = ["All", "Low", "Medium", "High", "Urgent"].join("\n");
const TIMER_STATUS_OPTIONS = [
  "Running",
  "Due Soon",
  "Breached",
  "Completed",
  "Cancelled",
].join("\n");
const AUDIT_EVENT_OPTIONS = [
  "Started",
  "Reminder Sent",
  "Breached",
  "Escalated",
  "Completed",
  "Cancelled",
].join("\n");

const PERMISSIONS = [
  { role: SYSTEM_MANAGER, read: 1, write: 1, create: 1, delete: 1 },
  { role: PURCHASE_MANAGER, read: 1, write: 1, create: 1, delete: 1 },
  { role: PURCHASE_USER, read: 1, write: 1, create: 1 },
];

/** Create a DocType if missing; otherwise append any fields that don't exist. */
async function ensureDocType(name, spec) {
  let existing = null;
  try {
    existing = await api(
      "GET",
      `/api/resource/DocType/${encodeURIComponent(name)}`
    );
  } catch {
    existing = null;
  }

  if (existing) {
    console.log(`✓ DocType exists: ${name}`);
    const fields = existing.fields || [];
    const have = new Set(fields.map((f) => f.fieldname));
    let changed = false;
    let insertAfter = fields.length ? fields[fields.length - 1].fieldname : undefined;
    for (const f of spec.fields) {
      if (have.has(f.fieldname)) {
        insertAfter = f.fieldname;
        continue;
      }
      fields.push({ ...f, insert_after: insertAfter });
      insertAfter = f.fieldname;
      changed = true;
      console.log(`  • adding field ${f.fieldname}`);
    }
    if (changed) {
      await api("PUT", `/api/resource/DocType/${encodeURIComponent(name)}`, {
        fields,
      });
      console.log(`  ✓ updated fields on ${name}`);
    }
    return;
  }

  console.log(`• Creating DocType: ${name}`);
  await api("POST", "/api/resource/DocType", {
    doctype: "DocType",
    name,
    module: MODULE,
    custom: 1,
    is_submittable: 0,
    autoname: spec.autoname,
    title_field: spec.title_field,
    track_changes: 1,
    fields: spec.fields,
    permissions: PERMISSIONS,
  });
  console.log(`✓ DocType created: ${name}`);
}

async function main() {
  console.log(`Provisioning SLA module on ${baseUrl}...`);

  await ensureDocType("SLA Configuration", {
    autoname: "format:SLA-{#####}",
    title_field: "sla_name",
    fields: [
      { fieldname: "sla_name", label: "SLA Name", fieldtype: "Data", reqd: 1, in_list_view: 1 },
      { fieldname: "workflow", label: "Workflow", fieldtype: "Select", options: WORKFLOW_OPTIONS, reqd: 1, in_list_view: 1 },
      { fieldname: "stage", label: "Stage", fieldtype: "Data" },
      { fieldname: "role", label: "Responsible Role", fieldtype: "Data", in_list_view: 1 },
      { fieldname: "priority", label: "Priority", fieldtype: "Select", options: PRIORITY_OPTIONS, default: "All", in_list_view: 1 },
      { fieldname: "duration", label: "Duration", fieldtype: "Float", reqd: 1, in_list_view: 1 },
      { fieldname: "time_unit", label: "Time Unit", fieldtype: "Select", options: TIME_UNIT_OPTIONS, default: "Hours", reqd: 1, in_list_view: 1 },
      { fieldname: "reminder_before", label: "Reminder Before Expiry", fieldtype: "Float", default: 0 },
      { fieldname: "reminder_unit", label: "Reminder Unit", fieldtype: "Select", options: TIME_UNIT_OPTIONS, default: "Minutes" },
      { fieldname: "escalation_role", label: "Escalation Role", fieldtype: "Data" },
      { fieldname: "enabled", label: "Active", fieldtype: "Check", default: 1, in_list_view: 1 },
    ],
  });

  await ensureDocType("SLA Timer", {
    autoname: "format:SLAT-{#####}",
    title_field: "reference_name",
    fields: [
      { fieldname: "sla_configuration", label: "SLA Configuration", fieldtype: "Data" },
      { fieldname: "sla_name", label: "SLA Name", fieldtype: "Data", in_list_view: 1 },
      { fieldname: "workflow", label: "Workflow", fieldtype: "Data", in_list_view: 1 },
      { fieldname: "stage", label: "Stage", fieldtype: "Data" },
      { fieldname: "reference_doctype", label: "Reference DocType", fieldtype: "Data", in_list_view: 1 },
      { fieldname: "reference_name", label: "Reference Name", fieldtype: "Data", reqd: 1, in_list_view: 1 },
      { fieldname: "role", label: "Responsible Role", fieldtype: "Data", in_list_view: 1 },
      { fieldname: "priority", label: "Priority", fieldtype: "Data" },
      { fieldname: "assigned_to", label: "Assigned To", fieldtype: "Data" },
      { fieldname: "department", label: "Department", fieldtype: "Data" },
      { fieldname: "start_time", label: "Start Time", fieldtype: "Datetime", in_list_view: 1 },
      { fieldname: "due_time", label: "Due Time", fieldtype: "Datetime", in_list_view: 1 },
      { fieldname: "reminder_at", label: "Reminder At", fieldtype: "Datetime" },
      { fieldname: "completed_time", label: "Completed Time", fieldtype: "Datetime" },
      { fieldname: "duration_minutes", label: "Duration (Minutes)", fieldtype: "Float" },
      { fieldname: "resolution_minutes", label: "Resolution (Minutes)", fieldtype: "Float" },
      { fieldname: "sla_status", label: "SLA Status", fieldtype: "Select", options: TIMER_STATUS_OPTIONS, default: "Running", in_list_view: 1 },
      { fieldname: "escalation_role", label: "Escalation Role", fieldtype: "Data" },
      { fieldname: "reminder_sent", label: "Reminder Sent", fieldtype: "Check", default: 0 },
      { fieldname: "breach_notified", label: "Breach Notified", fieldtype: "Check", default: 0 },
      { fieldname: "escalated", label: "Escalated", fieldtype: "Check", default: 0 },
    ],
  });

  await ensureDocType("SLA Audit Log", {
    autoname: "format:SLAL-{#####}",
    title_field: "reference_name",
    fields: [
      { fieldname: "sla_timer", label: "SLA Timer", fieldtype: "Data", in_list_view: 1 },
      { fieldname: "reference_doctype", label: "Reference DocType", fieldtype: "Data" },
      { fieldname: "reference_name", label: "Reference Name", fieldtype: "Data", in_list_view: 1 },
      { fieldname: "workflow", label: "Workflow", fieldtype: "Data", in_list_view: 1 },
      { fieldname: "stage", label: "Stage", fieldtype: "Data" },
      { fieldname: "event", label: "Event", fieldtype: "Select", options: AUDIT_EVENT_OPTIONS, in_list_view: 1 },
      { fieldname: "event_time", label: "Event Time", fieldtype: "Datetime", in_list_view: 1 },
      { fieldname: "actor", label: "Actor", fieldtype: "Data" },
      { fieldname: "details", label: "Details", fieldtype: "Small Text" },
    ],
  });

  console.log("✅ SLA module provisioned.");
}

main().catch((err) => {
  console.error("❌ Failed:", err.message);
  process.exit(1);
});
