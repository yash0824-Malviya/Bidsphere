import { createEcrSchemaErpClient, ecrSchemaResource as resource, listAllEcrSchemaRows } from "../scripts/ecr-schema-erp-client.mjs";
const api = createEcrSchemaErpClient();
const ecr = await api("GET", resource("Engineering Change Request", "ECR-2026-100010"));
const schema = await api("GET", resource("DocType", "ECR Approval"));
const custom = await listAllEcrSchemaRows(api, "Custom Field", ["fieldname", "fieldtype", "options", "default"], [["dt", "=", "ECR Approval"]]);
const businessCase = ecr.ecr_business_case ? JSON.parse(ecr.ecr_business_case) : null;
const required = ["why_required", "problem_statement", "expected_benefits", "budget_impact", "business_risk", "financial_risk", "supplier_risk", "quality_risk"];
console.log(JSON.stringify({
  ecr: ecr.name, stage: ecr.select_pxfp, modified: ecr.modified, docstatus: ecr.docstatus,
  workflowVersion: ecr.ecr_workflow_version, costImpact: ecr.cost_impact, qualityImpact: ecr.quality_impact,
  owner: ecr.ecr_owner, approvalRows: ecr.approval_requirements,
  businessCase: businessCase && {
    name: businessCase.name, status: businessCase.status, finance_status: businessCase.finance_status,
    procurement_status: businessCase.procurement_status, quality_status: businessCase.quality_status,
    requiredContentPresent: Object.fromEntries(required.map((field) => [field, Boolean(String(businessCase[field] || "").trim())])),
    history: businessCase.history,
  },
  approvalStatusSchema: [...schema.fields, ...custom].filter((field) => field.fieldname === "status").map((field) => ({ fieldtype: field.fieldtype, options: field.options, default: field.default })),
}, null, 2));
