// Read-only diagnostics. Credentials remain server-side and are never printed.
import { loadEnv } from "vite";

const env = loadEnv("development", process.cwd(), "");
const base = (env.ERPNEXT_URL || env.VITE_ERPNEXT_URL || env.VITE_PROXY_TARGET || "").replace(/\/$/, "");
const key = env.ERP_API_KEY || env.VITE_API_KEY;
const secret = env.ERP_API_SECRET || env.VITE_API_SECRET;
if (!base || !key || !secret) throw new Error("ERPNext server credentials are not configured.");
const name = process.argv[2] || "MAT-MR-2026-00102";
const paths = [
  `/api/resource/Material Request/${encodeURIComponent(name)}`,
  `/api/resource/Workflow?${new URLSearchParams({filters: JSON.stringify([["document_type", "=", "Material Request"]]), fields: JSON.stringify(["name", "is_active", "workflow_state_field"])})}`,
  "/api/resource/Custom Field/Material Request-custom_bidsphere_status",
  "/api/resource/Workflow/Material Requisition Approval",
  "/api/method/frappe.auth.get_logged_user",
];
const selectedPaths = process.argv.includes("--workflow-only")
  ? paths.filter(path => path.endsWith("/Workflow/Material Requisition Approval"))
  : paths;
for (const path of selectedPaths) {
  try {
    const response = await fetch(base + path, { headers: { Authorization: `token ${key}:${secret}` }, signal: AbortSignal.timeout(15000) });
    const body = await response.json();
    if (body.data?.doctype === "Workflow") {
      const workflow = body.data;
      body.data = {
        name: workflow.name, is_active: workflow.is_active,
        workflow_state_field: workflow.workflow_state_field,
        states: workflow.states.map(({ state, doc_status, allow_edit }) => ({ state, doc_status, allow_edit })),
        transitions: workflow.transitions.map(({ state, action, next_state, allowed, condition }) => ({ state, action, next_state, allowed, condition })),
      };
    }
    console.log(JSON.stringify({ path, status: response.status, body }, null, 2));
    if (!response.ok) process.exitCode = 1;
  } catch (error) {
    console.error({ path, message: error.message, cause: error.cause?.code });
    process.exitCode = 1;
  }
}
