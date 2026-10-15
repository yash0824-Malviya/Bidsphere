import { writeFileSync } from "node:fs";
import { createEcrSchemaErpClient, ecrSchemaResource as resource, listAllEcrSchemaRows } from "../scripts/ecr-schema-erp-client.mjs";
const api = createEcrSchemaErpClient();
try {
  const doctype = await api("GET", resource("DocType", "Engineering Change Request"));
  const [customFields, workflows, records] = await Promise.all([
    listAllEcrSchemaRows(api, "Custom Field", ["name", "fieldname", "fieldtype", "default", "reqd", "options"], [["dt", "=", "Engineering Change Request"]]),
    listAllEcrSchemaRows(api, "Workflow", ["name", "document_type", "is_active", "workflow_state_field"], [["document_type", "=", "Engineering Change Request"]]),
    listAllEcrSchemaRows(api, "Engineering Change Request", ["name", "select_pxfp", "docstatus", "modified"]),
  ]);
  const probe = new URLSearchParams({ fields: JSON.stringify(["name", "ecr_workflow_version", "rfq_required", "rfq_decision_reason"]), limit_page_length: "1" });
  let query;
  try { await api("GET", `${resource("Engineering Change Request")}?${probe}`); query = "passed"; } catch (error) { query = error.message; }
  const fields = (doctype.fields ?? []).map(({ fieldname, fieldtype, options, reqd, default: defaultValue, read_only, hidden, allow_on_submit }) => ({ fieldname, fieldtype, options, reqd, default: defaultValue, read_only, hidden, allow_on_submit }));
  writeFileSync(new URL("./ecr-schema-inspection.json", import.meta.url), JSON.stringify({ doctype, customFields, workflows, records, query }, null, 2));
  console.log(JSON.stringify({ customDocType: doctype.custom, fieldCount: fields.length, versionFields: fields.filter((f) => /version|workflow|business.case|rfq_required|rfq_decision_reason/.test(f.fieldname)), statuses: fields.filter((f) => ["status", "select_pxfp"].includes(f.fieldname)), customFields, workflows, existingRecords: records.length, query }, null, 2));
} catch (error) { console.error(error.message); process.exitCode = 1; }
