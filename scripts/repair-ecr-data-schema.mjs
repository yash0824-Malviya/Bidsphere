/** Additive ECR data schema repair. Default --check is read only. */
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { EXTENDED_ECR_FIELDS } from "./ecr-extended-schema.mjs";
import { extendEcrDataSchema, assertEcrDataSchemaInstalled, ecrPermissionSettings } from "./ecr-data-schema.mjs";
import { createEcrSchemaErpClient, ecrSchemaResource as resource, listAllEcrSchemaRows } from "./ecr-schema-erp-client.mjs";

const ECR = "Engineering Change Request";
const extensionFields = EXTENDED_ECR_FIELDS.map((field) => field.fieldname);
const hash = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const baselineDocument = (document) => Object.fromEntries(Object.entries(document).filter(([field]) => !extensionFields.includes(field)));

async function main() {
  const args = process.argv.slice(2);
  if (args.length > 1 || args.some((arg) => !["--check", "--apply"].includes(arg))) throw new Error("Use --check (default) or --apply.");
  const api = createEcrSchemaErpClient();
  const doctype = await api("GET", resource("DocType", ECR));
  const [customFields, workflowRows, rows] = await Promise.all([
    listAllEcrSchemaRows(api, "Custom Field", ["name", "fieldname"], [["dt", "=", ECR]]),
    listAllEcrSchemaRows(api, "Workflow", ["name", "document_type", "is_active", "modified"]),
    listAllEcrSchemaRows(api, ECR, ["name", "select_pxfp", "docstatus", "modified"]),
  ]);
  const next = extendEcrDataSchema(doctype, customFields);
  const missingFields = extensionFields.filter((name) => !doctype.fields.some((field) => field.fieldname === name));
  const optionChanges = next.fields.filter((field) => ["status", "select_pxfp"].includes(field.fieldname)).map((field) => ({ field: field.fieldname, added: field.options.split("\n").filter((value) => !String(doctype.fields.find((old) => old.fieldname === field.fieldname)?.options ?? "").split("\n").includes(value)) }));
  const changesRequired = JSON.stringify(next) !== JSON.stringify(doctype);
  console.log(JSON.stringify({ mode: args.includes("--apply") ? "apply" : "check", missingFields, optionChanges, changesRequired, existingRecords: rows.length, activeEcrWorkflows: workflowRows.filter((workflow) => workflow.document_type === ECR && Number(workflow.is_active) === 1).length, workflowChanges: false, recordMigration: false }, null, 2));
  if (!args.includes("--apply")) return;

  const records = [];
  for (const row of rows) records.push(await api("GET", resource(ECR, row.name)));
  const workflows = [];
  for (const row of workflowRows) workflows.push(await api("GET", resource("Workflow", row.name)));
  const backupDirectory = fileURLToPath(new URL(`../scratch/ecr-schema-repair-${new Date().toISOString().replace(/[:.]/g, "-")}/`, import.meta.url));
  mkdirSync(backupDirectory, { recursive: true });
  writeFileSync(`${backupDirectory}/before.json`, JSON.stringify({ doctype, workflows, recordFingerprint: hash(records.map(baselineDocument)), recordMetadata: rows }, null, 2));
  if (changesRequired) {
    // The only mutation this repair performs is saving this one DocType.
    // Existing fields, permissions, naming rules and workflow documents are preserved.
    await api("POST", "method/frappe.client.save", { doc: next });
  }
  const installed = await api("GET", resource("DocType", ECR));
  assertEcrDataSchemaInstalled(installed);
  if (hash(ecrPermissionSettings(installed.permissions)) !== hash(ecrPermissionSettings(doctype.permissions)) || installed.autoname !== doctype.autoname || installed.is_submittable !== doctype.is_submittable) throw new Error("ECR permissions or naming/submission metadata changed unexpectedly. Inspect the saved schema backup.");
  const afterRows = await listAllEcrSchemaRows(api, ECR, ["name", "select_pxfp", "docstatus", "modified"]);
  if (hash(rows) !== hash(afterRows)) throw new Error("ECR records changed during the repair; inspect before claiming verification.");
  const afterRecords = [];
  for (const row of afterRows) afterRecords.push(await api("GET", resource(ECR, row.name)));
  if (hash(records.map(baselineDocument)) !== hash(afterRecords.map(baselineDocument))) throw new Error("Existing ECR document contents changed during repair; inspect before claiming verification.");
  for (let index = 0; index < records.length; index += 1) {
    if ((records[index].ecr_workflow_version || "") !== (afterRecords[index].ecr_workflow_version || "")) throw new Error("An existing workflow version changed unexpectedly.");
  }
  const afterWorkflows = [];
  for (const row of workflowRows) afterWorkflows.push(await api("GET", resource("Workflow", row.name)));
  if (hash(workflows) !== hash(afterWorkflows)) throw new Error("Workflow configuration changed during repair; inspect before claiming verification.");
  const query = new URLSearchParams({ fields: JSON.stringify(["name", ...extensionFields]), limit_page_length: "20" });
  await api("GET", `${resource(ECR)}?${query}`);
  const result = { installedFields: extensionFields, verifiedRecordsUnchanged: afterRows.length, verifiedWorkflowDocumentsUnchanged: workflows.length, permissionsUnchanged: true, versionQuery: "passed", legacyVersionsPreserved: true };
  writeFileSync(`${backupDirectory}/result.json`, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; });
