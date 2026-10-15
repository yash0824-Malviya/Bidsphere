import assert from "node:assert/strict";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createServer } from "vite";
import { createEcrSchemaErpClient, ecrSchemaResource as resource, listAllEcrSchemaRows } from "../scripts/ecr-schema-erp-client.mjs";
import { assertEcrDataSchemaInstalled } from "../scripts/ecr-data-schema.mjs";
const api = createEcrSchemaErpClient();
const type = "Engineering Change Request";
const name = "ECR-2026-100010";
const directoryName = readdirSync(new URL("./", import.meta.url)).filter((entry) => entry.startsWith("ecr-persistence-")).sort().at(-1);
assert.ok(directoryName, "Run the capture/re-save verification first.");
const directory = new URL(`./${directoryName}/`, import.meta.url);
const submitted = JSON.parse(readFileSync(new URL("submitted-document.json", directory), "utf8"));
const response = JSON.parse(readFileSync(new URL("save-response.json", directory), "utf8"));
const server = await createServer({ configFile: false, server: { middlewareMode: true }, appType: "custom", logLevel: "error" });
try {
  const core = await server.ssrLoadModule("/api/ecrWorkflowCore.ts");
  const queues = await server.ssrLoadModule("/src/config/ecrQueues.ts");
  const history = await server.ssrLoadModule("/src/components/ecr/ecrDetailModel.ts");
  assert.equal(core.firstEcrWorkflowPersistenceMismatch(submitted, response), undefined);
  assertEcrDataSchemaInstalled(await api("GET", resource("DocType", type)));
  const deps = core.createDefaultEcrWorkflowDependencies();
  const before = await deps.loadEcr(name);
  assert.equal(before.select_pxfp, "Engineering Review");
  assert.equal(before.ecr_workflow_version, "extended_v1");
  const pending = before.approval_requirements.filter((row) => row.status === "Pending");
  assert.equal(pending.length, 1);
  assert.equal(pending[0].approval_role, "Engineering Manager");
  const filters = [["reference_doctype", "=", type], ["reference_name", "=", name], ["comment_type", "=", "Workflow"]];
  const comments = await listAllEcrSchemaRows(api, "Comment", ["name", "content"], filters);
  const after = await deps.loadEcr(name);
  assert.equal(core.firstEcrWorkflowPersistenceMismatch(submitted, after), undefined);
  assert.equal(after.select_pxfp, before.select_pxfp);
  assert.deepEqual(after.approval_requirements, before.approval_requirements);
  const rows = await listAllEcrSchemaRows(api, type, ["name", "select_pxfp", "ecr_workflow_version", "rfq_required", "rfq_decision_reason"]);
  const documents = [];
  for (const row of rows) documents.push(await deps.loadEcr(row.name));
  assert.equal(queues.getECRAssignedTo(after), "Engineering Manager");
  assert.equal(queues.isPendingApprovalForRole("engineering", after), true);
  const timeline = history.getECRApprovalTimeline(after.select_pxfp, after.approval_requirements, after);
  assert.equal(timeline.find((row) => row.stage === "Engineering Review")?.state, "current");
  const result = {
    ecr: name, schemaAndVersionQuery: "passed", payloadResponseAndRefetchComparison: "passed",
    stage: after.select_pxfp, version: after.ecr_workflow_version,
    assignedReviewer: queues.getECRAssignedTo(after), pendingTasks: pending.length,
    approvalHistoryStage: "Engineering Review (current)",
    submissionActivityExists: comments.some((row) => /^Submit ECR(?:\b|\n)/.test(row.content || "")),
    engineeringDashboardPending: queues.getECRQueueSummary("engineering", documents).pending,
    targetInEngineeringQueue: true, targetInDraftList: rows.some((row) => row.name === name && row.select_pxfp === "Draft"),
    workflowTransitionsReplayed: 0,
  };
  writeFileSync(new URL("recovery-verification.json", directory), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} finally { await server.close(); }
