import { createEcrSchemaErpClient, ecrSchemaResource as resource, listAllEcrSchemaRows } from "../scripts/ecr-schema-erp-client.mjs";
const api = createEcrSchemaErpClient();
const ECR = "Engineering Change Request";
const id = "ECR-2026-100010";
const rows = await listAllEcrSchemaRows(api, ECR, ["name", "ecr_number"], [["ecr_number", "=", id]]);
const document = await api("GET", resource(ECR, rows[0]?.name || id));
const schema = await api("GET", resource("DocType", ECR));
const childType = schema.fields.find((field) => field.fieldname === "affected_parts")?.options;
const childSchema = await api("GET", resource("DocType", childType));
const customFields = await listAllEcrSchemaRows(api, "Custom Field", ["fieldname", "fieldtype", "default", "options", "reqd"], [["dt", "=", childType]]);
console.log(JSON.stringify({
  ecr: document.ecr_number || document.name,
  status: document.select_pxfp,
  version: document.ecr_workflow_version,
  supplierRequired: document.supplier_response_required,
  supplierSelected: Boolean(document.suggested_supplier),
  supplierImpact: document.supplier_impact,
  referenceType: document.procurement_reference_type,
  rfqReference: document.existing_rfq_reference,
  poReference: document.existing_purchase_order_reference,
  responseType: document.supplier_response_type,
  requiredQuantity: document.required_quantity,
  quantityUom: document.quantity_uom,
  affectedParts: document.affected_parts?.map((part) => Object.fromEntries(["source_reference_type", "source_document_reference", "source_item_reference", "quantity", "uom"].map((field) => [field, part[field]]))),
  sourceFieldSchema: [...childSchema.fields, ...customFields].filter((field) => field.fieldname?.startsWith("source_")).map((field) => ({ fieldname:field.fieldname, fieldtype:field.fieldtype, default:field.default, options:field.options, reqd:field.reqd })),
}, null, 2));
