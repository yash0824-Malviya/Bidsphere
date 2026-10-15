import { readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { createEcrSchemaErpClient, ecrSchemaResource as resource, listAllEcrSchemaRows } from "../scripts/ecr-schema-erp-client.mjs";
const api = createEcrSchemaErpClient();
const directory = readdirSync(new URL("./", import.meta.url)).filter((name) => name.startsWith("ecr-schema-repair-")).sort().at(-1);
const before = JSON.parse(readFileSync(new URL(`./${directory}/before.json`, import.meta.url), "utf8"));
const after = await api("GET", resource("DocType", "Engineering Change Request"));
const changes = [];
function diff(old, value, path) {
  if (old && value && typeof old === "object" && typeof value === "object") {
    for (const key of new Set([...Object.keys(old), ...Object.keys(value)])) diff(old[key], value[key], `${path}.${key}`);
  } else if (old !== value) changes.push({ path, before: old, after: value });
}
diff(before.doctype.permissions, after.permissions, "permissions");
diff(before.doctype.autoname, after.autoname, "autoname");
diff(before.doctype.is_submittable, after.is_submittable, "is_submittable");
const extension = ["ecr_workflow_version", "ecr_business_case", "rfq_required", "rfq_decision_reason"];
const rows = await listAllEcrSchemaRows(api, "Engineering Change Request", ["name", "select_pxfp", "docstatus", "modified"]);
const records = [];
for (const row of rows) records.push(await api("GET", resource("Engineering Change Request", row.name)));
const normalize = (doc) => Object.fromEntries(Object.entries(doc).filter(([field]) => !extension.includes(field)));
const hash = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const workflows = [];
for (const old of before.workflows) workflows.push(await api("GET", resource("Workflow", old.name)));
console.log(JSON.stringify({ schemaMetadataChanges: changes, recordsUnchanged: before.recordFingerprint === hash(records.map(normalize)), recordMetadataUnchanged: JSON.stringify(rows) === JSON.stringify(before.recordMetadata), workflowsUnchanged: JSON.stringify(workflows) === JSON.stringify(before.workflows), versions: records.map((doc) => doc.ecr_workflow_version ?? null), extensionFields: after.fields.filter((field) => extension.includes(field.fieldname)).map(({ fieldname, fieldtype, reqd, default: defaultValue }) => ({fieldname, fieldtype, reqd, default: defaultValue})) }, null, 2));
