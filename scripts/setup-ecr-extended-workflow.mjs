/** Usage: node scripts/setup-ecr-extended-workflow.mjs [--check | --apply] */
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { appendSelectOptions, extendEcrDocType, extendEcrWorkflow, EXTENDED_ECR_STATES } from "./ecr-extended-schema.mjs";

const args = process.argv.slice(2);
if (args.some((arg) => !["--check", "--apply"].includes(arg)) || args.length > 1) throw new Error("Use --check (read only, default) or --apply.");
const apply = args.includes("--apply");
const envPath = fileURLToPath(new URL("../.env", import.meta.url));
if (existsSync(envPath)) for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
  const match = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
  if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, "$2");
}
const base = (process.env.ERPNEXT_URL ?? process.env.VITE_PROXY_TARGET ?? process.env.VITE_ERPNEXT_URL ?? "").replace(/\/+$/, "").replace(/\/api$/, "");
const key = process.env.ERP_API_KEY ?? process.env.VITE_API_KEY;
const secret = process.env.ERP_API_SECRET ?? process.env.VITE_API_SECRET;
const serviceRole = process.env.ECR_WORKFLOW_SERVICE_ROLE ?? "BidSphere ECR Workflow Service";
if (!base || !key || !secret) throw new Error("Missing ERPNext URL or API credentials.");
async function api(method, path, body) {
  const response = await fetch(`${base}/api/${path}`, {
    method, headers: { Authorization: `token ${key}:${secret}`, "Content-Type": "application/json", Accept: "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) throw new Error(`ERP ${method} ${path.split("?")[0]} returned ${response.status}.`);
  const payload = await response.json();
  return payload.data ?? payload.message;
}
const resource = (type, name) => `resource/${encodeURIComponent(type)}${name ? `/${encodeURIComponent(name)}` : ""}`;
const active = await api("GET", `${resource("Workflow")}?${new URLSearchParams({ fields: JSON.stringify(["name"]), filters: JSON.stringify([["document_type", "=", "Engineering Change Request"], ["is_active", "=", 1]]), limit_page_length: "100" })}`);
if (!Array.isArray(active) || active.length !== 1) throw new Error(`Expected one active secured ECR workflow; found ${Array.isArray(active) ? active.length : "an invalid response"}. Run the existing ECR setup first.`);
const [doctype, approval, workflow, currentUser] = await Promise.all([
  api("GET", resource("DocType", "Engineering Change Request")),
  api("GET", resource("DocType", "ECR Approval")),
  api("GET", resource("Workflow", active[0].name)),
  api("GET", "method/frappe.auth.get_logged_user"),
]);
if (!currentUser || ["Guest", "Administrator"].includes(currentUser)) throw new Error("Use the dedicated ECR integration user, not Guest or Administrator.");
const holders = await api("GET", `${resource("Has Role")}?${new URLSearchParams({ fields: JSON.stringify(["parent"]), filters: JSON.stringify([["role", "=", serviceRole]]), parent: "User", limit_page_length: "100" })}`);
if (!Array.isArray(holders) || !holders.length || holders.some((row) => row.parent !== currentUser)) throw new Error("The workflow service role must belong exclusively to this integration user.");
const nextDoc = extendEcrDocType(doctype);
const nextWorkflow = extendEcrWorkflow(workflow, serviceRole);
const nextApproval = structuredClone(approval);
const roleField = nextApproval.fields?.find((field) => field.fieldname === "approval_role");
if (roleField?.fieldtype === "Select") roleField.options = appendSelectOptions(roleField.options, ["Engineer", "Finance Manager", "Procurement Manager", "Quality Manager", "Program Manager"]);
const changed = JSON.stringify(doctype) !== JSON.stringify(nextDoc) || JSON.stringify(workflow) !== JSON.stringify(nextWorkflow) || JSON.stringify(approval) !== JSON.stringify(nextApproval);
console.log(changed ? "Extended ECR schema requires additive updates. Existing ECR data will be preserved." : "Extended ECR schema is current.");
if (apply && changed) {
  // The original active workflow remains usable if schema preparation fails.
  await api("POST", "method/frappe.client.save", { doc: nextDoc });
  if (JSON.stringify(approval) !== JSON.stringify(nextApproval)) await api("POST", "method/frappe.client.save", { doc: nextApproval });
  for (const state of EXTENDED_ECR_STATES) {
    const found = await api("GET", `${resource("Workflow State")}?${new URLSearchParams({ filters: JSON.stringify([["name", "=", state]]), limit_page_length: "1" })}`);
    if (!found?.length) await api("POST", resource("Workflow State"), { workflow_state_name: state, style: "Primary" });
  }
  for (const action of new Set(nextWorkflow.transitions.map((row) => row.action))) {
    const found = await api("GET", `${resource("Workflow Action Master")}?${new URLSearchParams({ filters: JSON.stringify([["name", "=", action]]), limit_page_length: "1" })}`);
    if (!found?.length) await api("POST", resource("Workflow Action Master"), { workflow_action_name: action });
  }
  await api("POST", "method/frappe.client.save", { doc: nextWorkflow });
  const savedDoc = await api("GET", resource("DocType", doctype.name));
  const savedWorkflow = await api("GET", resource("Workflow", workflow.name));
  if (JSON.stringify(extendEcrDocType(savedDoc)) !== JSON.stringify(savedDoc) || JSON.stringify(extendEcrWorkflow(savedWorkflow, serviceRole)) !== JSON.stringify(savedWorkflow)) throw new Error("Schema readback differs from the expected configuration; inspect before deploying.");
  console.log("Extended ECR schema applied and verified. No ECR records were migrated.");
} else if (changed) console.log("Review docs/ecr-extended-workflow.md, then run with --apply to install.");
