import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { createEcrSchemaErpClient, ecrSchemaResource as resource } from "../scripts/ecr-schema-erp-client.mjs";
const api = createEcrSchemaErpClient();
const type = "Engineering Change Request";
const name = "ECR-2026-100010";
const before = await api("GET", resource(type, name));
assert.equal(before.name, name);
assert.equal(before.ecr_workflow_version, "extended_v1");
assert.ok(["Draft", "Engineering Review"].includes(before.select_pxfp), "Stop: ECR has advanced beyond this recovery scope.");
assert.equal(Number(before.docstatus), 0);
const directory = new URL(`./ecr-persistence-${new Date().toISOString().replace(/[:.]/g, "-")}/`, import.meta.url);
mkdirSync(directory, { recursive: true });
writeFileSync(new URL("submitted-document.json", directory), JSON.stringify(before, null, 2));
// Re-save only the currently persisted document and stage, using its optimistic lock.
const response = await api("POST", "method/frappe.client.save", { doc: before });
writeFileSync(new URL("save-response.json", directory), JSON.stringify(response, null, 2));
const persisted = await api("GET", resource(type, name));
writeFileSync(new URL("refetched-document.json", directory), JSON.stringify(persisted, null, 2));
const fields = ["ecr_business_case", "rfq_required", "rfq_decision_reason", "ecr_workflow_version"];
const encode = (value) => value === undefined ? { type: "undefined" } : { type: value === null ? "null" : typeof value, value };
const comparison = fields.map((field) => ({ field, submitted: encode(before[field]), response: encode(response[field]), persisted: encode(persisted[field]), strictResponseMatches: before[field] === response[field], meaningfulValueMatches: (before[field] ?? "") === (persisted[field] ?? "") }));
assert.equal(persisted.select_pxfp, before.select_pxfp);
assert.equal(persisted.ecr_workflow_version, before.ecr_workflow_version);
const fieldsToPreserve = ["approval_requirements", "product_impact", "material_impact", "manufacturing_impact", "tooling_impact", "quality_impact", "cost_impact", "supplier_impact", "delivery_impact", "customer_impact", "contract_impact", "suggested_supplier", "supplier_response_required", "supplier_response_type", "required_quantity", "quantity_uom", "engineering_notes", "affected_parts", "supplier_response_requirements"];
function content(value) {
  if (Array.isArray(value)) return value.map(content);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => !["modified", "modified_by"].includes(key)).map(([key, item]) => [key, content(item)]));
}
for (const field of fieldsToPreserve) assert.deepEqual(content(persisted[field]), content(before[field]), `Unexpected change in ${field}`);
const result = { ecr: name, stageBefore: before.select_pxfp, stageAfter: persisted.select_pxfp, comparison, firstStrictMismatch: comparison.find((row) => !row.strictResponseMatches)?.field ?? null, impactSupplierApprovalDataPreserved: true };
writeFileSync(new URL("comparison.json", directory), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
