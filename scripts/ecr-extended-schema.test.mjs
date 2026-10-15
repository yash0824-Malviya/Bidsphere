import { test } from "vitest";
import assert from "node:assert/strict";
import { extendEcrDocType, extendEcrWorkflow } from "./ecr-extended-schema.mjs";
const role = "BidSphere ECR Workflow Service";
const legacyWorkflow = () => ({ document_type: "Engineering Change Request", workflow_state_field: "select_pxfp", states: [{ state: "Draft", doc_status: "0", allow_edit: role }, { state: "Closed", doc_status: "1", allow_edit: role }], transitions: [{ state: "Engineering Review", action: "Approve", next_state: "Procurement Review", allowed: role }] });
test("schema extension preserves fields and never defaults legacy workflow version", () => {
  const before = { fields: [{ fieldname: "select_pxfp", fieldtype: "Select", options: "Draft\nEngineering Review\nRFQ" }, { fieldname: "custom_existing", fieldtype: "Data" }] };
  const result = extendEcrDocType(before);
  assert.equal(before.fields.length, 2);
  assert.ok(result.fields.find((field) => field.fieldname === "custom_existing"));
  assert.equal(result.fields.find((field) => field.fieldname === "ecr_workflow_version").default, undefined);
  assert.deepEqual(extendEcrDocType(extendEcrDocType(result)), extendEcrDocType(result));
});
test("workflow merge preserves legacy transitions, isolates extended approval and is idempotent", () => {
  const before = legacyWorkflow();
  const result = extendEcrWorkflow(before, role);
  assert.equal(before.transitions.length, 1);
  assert.match(result.transitions[0].condition, /!= 'extended_v1'/);
  assert.ok(result.transitions.some((row) => row.next_state === "Technical Approved" && row.condition === "doc.ecr_workflow_version == 'extended_v1'"));
  assert.equal(result.states.find((row) => row.state === "Closed").doc_status, "1");
  assert.deepEqual(extendEcrWorkflow(result, role), result);
});
test("unsafe human workflow and incompatible submitted review state fail closed", () => {
  const unsafe = legacyWorkflow(); unsafe.transitions[0].allowed = "Engineer";
  assert.throws(() => extendEcrWorkflow(unsafe, role), /secured ECR workflow/);
  const incompatible = legacyWorkflow(); incompatible.states.push({ state: "Quality Review", doc_status: "1", allow_edit: role });
  assert.throws(() => extendEcrWorkflow(incompatible, role), /submitted document state/);
});
test("extends both persisted status fields used by trusted saves", () => {
  const result = extendEcrDocType({ fields: [
    { fieldname: "select_pxfp", fieldtype: "Select", options: "Draft\nEngineering Review" },
    { fieldname: "status", fieldtype: "Select", options: "Draft\nEngineering Review" },
  ] });
  for (const field of result.fields.filter((field) => ["status", "select_pxfp"].includes(field.fieldname))) {
    assert.ok(field.options.split("\n").includes("Technical Approved"));
    assert.ok(field.options.split("\n").includes("Procurement Decision"));
  }
});
