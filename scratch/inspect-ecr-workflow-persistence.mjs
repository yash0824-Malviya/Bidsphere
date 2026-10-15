import { createEcrSchemaErpClient, ecrSchemaResource as resource, listAllEcrSchemaRows } from "../scripts/ecr-schema-erp-client.mjs";
const api = createEcrSchemaErpClient();
const type = "Engineering Change Request";
const rows = await listAllEcrSchemaRows(api, type, ["name", "ecr_number"], [["ecr_number", "=", "ECR-2026-100010"]]);
const ecr = await api("GET", resource(type, rows[0]?.name || "ECR-2026-100010"));
const schema = await api("GET", resource("DocType", type));
const custom = await listAllEcrSchemaRows(api, "Custom Field", ["fieldname", "fieldtype", "default", "reqd"], [["dt", "=", type]]);
const fields = ["ecr_workflow_version", "select_pxfp", "status", "ecr_business_case", "rfq_required", "rfq_decision_reason", "product_impact", "material_impact", "manufacturing_impact", "tooling_impact", "quality_impact", "cost_impact", "supplier_impact", "delivery_impact", "customer_impact", "contract_impact", "supplier_response_required", "suggested_supplier", "supplier_response_type", "required_quantity", "quantity_uom"];
const encode = (value) => value === undefined ? { type: "undefined" } : { type: value === null ? "null" : typeof value, value };
const [workflows, comments] = await Promise.all([
  listAllEcrSchemaRows(api, "Workflow", ["name", "is_active"], [["document_type", "=", type]]),
  listAllEcrSchemaRows(api, "Comment", ["name", "comment_type", "content", "creation"], [["reference_doctype", "=", type], ["reference_name", "=", ecr.name], ["comment_type", "=", "Workflow"]]),
]);
console.log(JSON.stringify({ name: ecr.name, ecrNumber: ecr.ecr_number, modified: ecr.modified, docstatus: ecr.docstatus,
  data: Object.fromEntries(fields.map((field) => [field, encode(ecr[field])])),
  schema: [...schema.fields, ...custom].filter((field) => fields.includes(field.fieldname)).map((field) => ({ fieldname: field.fieldname, fieldtype: field.fieldtype, reqd: field.reqd, default: field.default, options: field.fieldname === "select_pxfp" ? field.options : undefined })),
  approvalRequirements: ecr.approval_requirements, workflowComments: comments, workflows,
}, null, 2));
