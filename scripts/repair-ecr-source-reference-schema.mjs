/** Repair only optional ECR source-type metadata. Default --check is read only. */
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createEcrSchemaErpClient, ecrSchemaResource as resource, listAllEcrSchemaRows } from "./ecr-schema-erp-client.mjs";
import {
  ECR_SOURCE_FIELD,
  ECR_SOURCE_OPTIONAL_SETTINGS,
  applyEcrSourceReferenceSchemaPlan,
  assertEcrSourceReferenceSchemaApplied,
  ecrSourceSchemaSettings,
  loadEcrSourceReferenceSchema,
  planEcrSourceReferenceSchema,
} from "./ecr-source-reference-schema.mjs";

const ECR = "Engineering Change Request";
const hash = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const settings = (field) => field && Object.fromEntries(Object.keys(ECR_SOURCE_OPTIONAL_SETTINGS).map((key) => [key, field[key] ?? null]));

async function main() {
  const args = process.argv.slice(2);
  if (args.length > 1 || args.some((arg) => !["--check", "--apply"].includes(arg))) throw new Error("Use --check (default) or --apply.");
  const api = createEcrSchemaErpClient();
  const plan = planEcrSourceReferenceSchema(await loadEcrSourceReferenceSchema(api));
  const native = (schema) => schema.doctype.fields.find((field) => field.fieldname === ECR_SOURCE_FIELD);
  const duplicatePreservation = {
    customFieldsPreservedDueToDuplicate: plan.customFieldsPreservedDueToDuplicate,
    ...(plan.customFieldsPreservedDueToDuplicate.length ? {
      compatibilityNote: "Existing duplicate Custom Field definitions are preserved. The application sends explicit empty source fields for unreferenced items, preventing inherited defaults.",
    } : {}),
  };
  console.log(JSON.stringify({
    mode: args.includes("--apply") ? "apply" : "check",
    field: `ECR Affected Part.${ECR_SOURCE_FIELD}`,
    native: { changed: plan.nativeChanged, before: settings(native(plan.before)), after: settings(native(plan.after)) },
    customFields: plan.before.customFields.map((field, index) => ({ name: field.name, before: settings(field), after: settings(plan.after.customFields[index]) })),
    ...duplicatePreservation,
    changesRequired: plan.nativeChanged || plan.customChanges.length > 0,
    workflowChanges: false,
    recordMigration: false,
  }, null, 2));
  if (!args.includes("--apply")) return;

  const [rows, workflowRows, parentSchema] = await Promise.all([
    listAllEcrSchemaRows(api, ECR, ["name", "select_pxfp", "docstatus", "modified"]),
    listAllEcrSchemaRows(api, "Workflow", ["name", "document_type", "is_active", "modified"]),
    api("GET", resource("DocType", ECR)),
  ]);
  const records = [];
  for (const row of rows) records.push(await api("GET", resource(ECR, row.name)));
  const workflows = [];
  for (const row of workflowRows) workflows.push(await api("GET", resource("Workflow", row.name)));
  const backupDirectory = fileURLToPath(new URL(`../scratch/ecr-source-schema-repair-${new Date().toISOString().replace(/[:.]/g, "-")}/`, import.meta.url));
  mkdirSync(backupDirectory, { recursive: true });
  writeFileSync(`${backupDirectory}/before.json`, JSON.stringify({ schema: plan.before, parentSchema, workflows, recordMetadata: rows, recordFingerprint: hash(records) }, null, 2));

  await applyEcrSourceReferenceSchemaPlan(api, plan);
  assertEcrSourceReferenceSchemaApplied(plan, await loadEcrSourceReferenceSchema(api));
  const afterRows = await listAllEcrSchemaRows(api, ECR, ["name", "select_pxfp", "docstatus", "modified"]);
  if (hash(rows) !== hash(afterRows)) throw new Error("ECR metadata changed during repair; inspect before claiming verification.");
  const afterRecords = [];
  for (const row of afterRows) afterRecords.push(await api("GET", resource(ECR, row.name)));
  if (hash(records) !== hash(afterRecords)) throw new Error("ECR contents changed during repair; inspect before claiming verification.");
  const afterWorkflowRows = await listAllEcrSchemaRows(api, "Workflow", ["name", "document_type", "is_active", "modified"]);
  if (hash(workflowRows) !== hash(afterWorkflowRows)) throw new Error("Workflow metadata changed during repair.");
  const afterWorkflows = [];
  for (const row of afterWorkflowRows) afterWorkflows.push(await api("GET", resource("Workflow", row.name)));
  if (hash(workflows) !== hash(afterWorkflows)) throw new Error("Workflow definitions changed during repair.");
  const afterParentSchema = await api("GET", resource("DocType", ECR));
  if (hash(ecrSourceSchemaSettings(parentSchema)) !== hash(ecrSourceSchemaSettings(afterParentSchema))) throw new Error("Parent ECR schema changed during repair.");
  const result = {
    field: `ECR Affected Part.${ECR_SOURCE_FIELD}`,
    nativeChanged: plan.nativeChanged,
    customFieldsChanged: plan.customChanges.length,
    ...duplicatePreservation,
    verifiedRecordsUnchanged: records.length,
    verifiedWorkflowDocumentsUnchanged: workflows.length,
    otherSchemaAndPermissionsUnchanged: true,
  };
  writeFileSync(`${backupDirectory}/result.json`, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
