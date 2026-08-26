/**
 * Creates BidSphere Engineering Change Request DocTypes in ERPNext.
 * DocTypes created (skipped if exist):
 *   - ECR Affected Part (child)
 *   - ECR Supplier Response Requirement (child)
 *   - ECR Approval (child)
 *   - Engineering Change Request (parent)
 * Also adds custom fields on Request for Quotation for ECR traceability.
 * Usage: node scripts/setup-ecr-doctype.mjs
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ECR_AUTONAME_PATTERN,
  ensureEcrNamingSeriesCounter,
} from "./ecr-naming-series.mjs";
import {
  ECR_HUMAN_ROLES,
  ECR_READ_ONLY_PERMISSION_FLAGS,
} from "./ecr-role-policy.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

function loadEnvFile() {
  const envPath = resolve(root, ".env");
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (!process.env[key]) process.env[key] = value;
  }
}
loadEnvFile();

const baseUrl = (process.env.ERPNEXT_URL ?? process.env.VITE_ERPNEXT_URL ?? process.env.VITE_PROXY_TARGET ?? "").replace(/\/+$/, "");
const apiKey = process.env.ERP_API_KEY ?? process.env.VITE_API_KEY ?? "";
const apiSecret = process.env.ERP_API_SECRET ?? process.env.VITE_API_SECRET ?? "";

if (!baseUrl || !apiKey || !apiSecret) { console.error("Missing env vars"); process.exit(1); }

async function api(method, path, body) {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { Authorization: `token ${apiKey}:${apiSecret}`, Accept: "application/json", "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { data = { raw: text }; }
  if (!res.ok) { const msg = data?.exc_type ?? data?._server_messages ?? text; throw new Error(`${method} ${path} -> ${res.status}: ${msg}`); }
  return data?.data ?? data?.message ?? data;
}

async function doctypeExists(name) {
  try { await api("GET", `/api/resource/DocType/${encodeURIComponent(name)}`); return true; } catch { return false; }
}

async function fetchEcrNamesForNamingSeries() {
  const rows = [];
  const pageLength = 200;
  for (let start = 0; ; start += pageLength) {
    const query = new URLSearchParams({
      fields: JSON.stringify(["name"]),
      limit_start: String(start),
      limit_page_length: String(pageLength),
      order_by: "name asc",
    });
    const page = await api(
      "GET",
      `/api/resource/Engineering Change Request?${query}`,
    );
    for (const row of page ?? []) rows.push(row);
    if (!Array.isArray(page) || page.length < pageLength) break;
  }
  return rows;
}

async function createDocType(spec) {
  if (await doctypeExists(spec.name)) {
    if (spec.name === "Engineering Change Request") {
      await reconcileExistingDocTypeFields(spec, {
        ...Object.fromEntries(
          ECR_SUBMITTED_MUTABLE_FIELDS.map((fieldname) => [
            fieldname,
            ["allow_on_submit"],
          ]),
        ),
        ecr_number: ["label", "fieldtype", "read_only", "unique", "in_list_view"],
        plant: ["label", "fieldtype", "options", "reqd", "in_list_view", "allow_on_submit"],
        bidsphere_create_idempotency_key: [
          "label",
          "fieldtype",
          "hidden",
          "unique",
          "no_copy",
          "read_only",
        ],
        ecr_type: ["label", "fieldtype", "options", "default", "in_list_view"],
        chnage_description: ["label", "fieldtype", "reqd"],
        select_pxfp: [
          "label",
          "fieldtype",
          "options",
          "default",
          "read_only",
          "in_list_view",
          "reqd",
          "allow_on_submit",
        ],
        approval_requirements: ["label", "fieldtype", "options", "allow_on_submit"],
        supplier_response_type: ["label", "fieldtype", "options"],
        validation_status: ["label", "fieldtype", "options", "default"],
      }, ["naming_rule", "autoname"]);
    } else if (spec.name === "ECR Approval") {
      await reconcileExistingDocTypeFields(
        spec,
        Object.fromEntries(
          spec.fields.map((field) => [
            field.fieldname,
            ["label", "fieldtype", "options", "in_list_view", "reqd", "default", "allow_on_submit"],
          ]),
        ),
      );
    } else if (
      spec.name === "ECR Affected Part" ||
      spec.name === "ECR Supplier Response Requirement"
    ) {
      await reconcileExistingDocTypeFields(
        spec,
        Object.fromEntries(
          spec.fields.map((field) => [
            field.fieldname,
            field.fieldname === "plant"
              ? ["fieldtype", "options", "allow_on_submit"]
              : ["allow_on_submit"],
          ]),
        ),
      );
    } else {
      console.log(`  skip (exists): ${spec.name}`);
    }
    return;
  }
  await api("POST", "/api/resource/DocType", spec);
  console.log(`  created: ${spec.name}`);
}

async function reconcileExistingDocTypeFields(
  spec,
  managedProperties,
  managedDocTypeProperties = [],
) {
  const existing = await api(
    "GET",
    `/api/resource/DocType/${encodeURIComponent(spec.name)}`,
  );
  const desiredByName = new Map(
    spec.fields
      .filter((field) => managedProperties[field.fieldname])
      .map((field) => [field.fieldname, field]),
  );
  const fields = Array.isArray(existing.fields)
    ? existing.fields.map((field) => ({ ...field }))
    : [];
  let changed = false;

  for (const property of managedDocTypeProperties) {
    const next = spec[property] ?? "";
    if (String(existing[property] ?? "") !== String(next)) {
      existing[property] = next;
      changed = true;
      console.log(`  updating ${spec.name}.${property}: ${next}`);
    }
  }

  for (const [fieldname, properties] of Object.entries(managedProperties)) {
    const desired = desiredByName.get(fieldname);
    if (!desired) throw new Error(`Missing canonical field specification: ${fieldname}`);
    const current = fields.find((field) => field.fieldname === fieldname);
    if (!current) {
      fields.push({ ...desired, idx: fields.length + 1 });
      changed = true;
      console.log(`  adding required field: ${fieldname}`);
      continue;
    }
    for (const property of properties) {
      const next = desired[property] ?? 0;
      if (String(current[property] ?? 0) !== String(next)) {
        current[property] = next;
        changed = true;
      }
    }
  }

  // The deployed ECR API contract contains this historical fieldname typo.
  // A prior setup script created a second, correctly-spelled required field,
  // which makes otherwise valid app payloads fail on those partial installs.
  if (spec.name === "Engineering Change Request") {
    const incompatibleAlias = fields.find(
      (field) => field.fieldname === "change_description",
    );
    if (incompatibleAlias && Number(incompatibleAlias.reqd || 0) !== 0) {
      incompatibleAlias.reqd = 0;
      changed = true;
      console.log("  disabling obsolete required alias: change_description");
    }
  }

  if (!changed) {
    console.log(`  verified workflow fields: ${spec.name}`);
    return;
  }
  await api(
    "PUT",
    `/api/resource/DocType/${encodeURIComponent(spec.name)}`,
    {
      fields,
      modified: existing.modified,
      ...Object.fromEntries(
        managedDocTypeProperties.map((property) => [property, existing[property]]),
      ),
    },
  );
  console.log(`  upgraded workflow fields: ${spec.name}`);
}

async function customFieldExists(dt, fieldname) {
  try {
    const r = await api("GET", `/api/resource/Custom Field?filters=[["dt","=","${dt}"],["fieldname","=","${fieldname}"]]&fields=["name"]`);
    return Array.isArray(r) && r.length > 0;
  } catch { return false; }
}

async function addCustomField(dt, fieldname, label, fieldtype, options, insertAfter, extras = {}) {
  if (await customFieldExists(dt, fieldname)) { console.log(`  skip custom field (exists): ${fieldname} on ${dt}`); return; }
  await api("POST", "/api/resource/Custom Field", {
    dt, fieldname, label, fieldtype,
    options: options ?? "",
    insert_after: insertAfter ?? "",
    in_list_view: 0, in_standard_filter: 1,
    ...extras,
  });
  console.log(`  added custom field: ${fieldname} on ${dt}`);
}

// The first workflow transition submits the ECR. These fields remain editable
// only through the secured Sent Back or downstream traceability API paths.
const ECR_SUBMITTED_MUTABLE_FIELDS = [
  "ecr_title",
  "ecr_type",
  "priority",
  "requesting_department",
  "plant",
  "program",
  "project",
  "target_implementation_date",
  "chnage_description",
  "reason_for_change",
  "business_justification",
  "current_state",
  "proposed_state",
  "affected_parts",
  "product_impact",
  "material_impact",
  "manufacturing_impact",
  "tooling_impact",
  "quality_impact",
  "cost_impact",
  "supplier_impact",
  "delivery_impact",
  "customer_impact",
  "contract_impact",
  "supplier_response_required",
  "supplier_response_type",
  "suggested_supplier",
  "procurement_reference_type",
  "existing_rfq_reference",
  "existing_purchase_order_reference",
  "required_quantity",
  "quantity_uom",
  "supplier_response_requirements",
  "engineering_notes",
  "engineering_drawing",
  "3d_cad_file",
  "specification",
  "supporting_documents",
  "implementation_notes",
  "implementation_date",
  "validation_status",
  "validation_notes",
  "validation_documents",
  "purchase_requisition",
  "rfq",
  "supplier_quotation",
  "selected_supplier",
  "purchase_order",
];

// --- ECR Affected Part child DocType ---
const ECR_AFFECTED_PART = {
  name: "ECR Affected Part",
  module: "Manufacturing",
  istable: 1,
  is_submittable: 0,
  fields: [
    { fieldname: "partitem", label: "Part / Item", fieldtype: "Link", options: "Item", in_list_view: 1 },
    { fieldname: "part_description", label: "Part Description", fieldtype: "Data", in_list_view: 1 },
    { fieldname: "current_revision", label: "Current Revision", fieldtype: "Data", in_list_view: 1 },
    { fieldname: "new_revision", label: "New Revision", fieldtype: "Data", in_list_view: 1 },
    { fieldname: "quantity", label: "Quantity", fieldtype: "Float", in_list_view: 1 },
    { fieldname: "uom", label: "UOM", fieldtype: "Link", options: "UOM", in_list_view: 1 },
    { fieldname: "change_required", label: "Change Required", fieldtype: "Small Text" },
    { fieldname: "technical_notes", label: "Technical Notes", fieldtype: "Small Text" },
    { fieldname: "current_supplier", label: "Current Supplier", fieldtype: "Link", options: "Supplier" },
    { fieldname: "proposed_supplier", label: "Proposed Supplier", fieldtype: "Link", options: "Supplier" },
    { fieldname: "plant", label: "Plant", fieldtype: "Link", options: "Plant Floor" },
    { fieldname: "source_reference_type", label: "Source Reference Type", fieldtype: "Select", options: "RFQ\nPurchase Order", hidden: 1 },
    { fieldname: "source_document_reference", label: "Source Document Reference", fieldtype: "Data", hidden: 1 },
    { fieldname: "source_item_reference", label: "Source Item Row Reference", fieldtype: "Data", hidden: 1 },
  ],
};

// --- ECR Supplier Response Requirement child DocType ---
const ECR_SUPPLIER_RESPONSE_REQ = {
  name: "ECR Supplier Response Requirement",
  module: "Manufacturing",
  istable: 1,
  is_submittable: 0,
  fields: [
    { fieldname: "item_code", label: "Item / Part", fieldtype: "Link", options: "Item", in_list_view: 1 },
    { fieldname: "description", label: "Description", fieldtype: "Data", in_list_view: 1 },
    { fieldname: "quantity", label: "Quantity", fieldtype: "Float", in_list_view: 1, reqd: 1 },
    { fieldname: "uom", label: "UOM", fieldtype: "Link", options: "UOM", in_list_view: 1, reqd: 1 },
    { fieldname: "technical_requirement", label: "Technical Requirement", fieldtype: "Small Text" },
    { fieldname: "revision", label: "Revision", fieldtype: "Data" },
    { fieldname: "plant", label: "Plant", fieldtype: "Link", options: "Plant Floor" },
  ],
};

// --- ECR Approval child DocType ---
const ECR_APPROVAL = {
  name: "ECR Approval",
  module: "Manufacturing",
  istable: 1,
  is_submittable: 0,
  fields: [
    { fieldname: "department", label: "Department", fieldtype: "Data", in_list_view: 1, allow_on_submit: 1 },
    { fieldname: "approval_role", label: "Approval Role", fieldtype: "Data", in_list_view: 1, reqd: 1, allow_on_submit: 1 },
    { fieldname: "approver", label: "Approver", fieldtype: "Data", in_list_view: 1, allow_on_submit: 1 },
    { fieldname: "required", label: "Required", fieldtype: "Check", in_list_view: 1, allow_on_submit: 1 },
    { fieldname: "status", label: "Status", fieldtype: "Select",
      options: "Pending\nApproved\nCompleted\nRejected\nSent Back", in_list_view: 1, default: "Pending", allow_on_submit: 1 },
    { fieldname: "approval_date", label: "Approval Date", fieldtype: "Datetime", in_list_view: 1, allow_on_submit: 1 },
    { fieldname: "comments", label: "Comments", fieldtype: "Small Text", allow_on_submit: 1 },
  ],
};

// --- Engineering Change Request parent DocType ---
const ECR_DOCTYPE = {
  name: "Engineering Change Request",
  module: "Manufacturing",
  naming_rule: "Expression (old style)",
  // The separate literal `1` plus a five-digit atomic series yields the
  // disjoint 100001+ band (ECR-2026-100001, ...). Frappe requires the dot
  // before the hash token for old-style naming expressions.
  autoname: ECR_AUTONAME_PATTERN,
  is_submittable: 1,
  track_changes: 1,
  track_seen: 1,
  fields: [
    // Basic Information section
    { fieldname: "section_basic", label: "Basic Information", fieldtype: "Section Break" },
    { fieldname: "ecr_title", label: "ECR Title", fieldtype: "Data", reqd: 1, in_list_view: 1, bold: 1 },
    { fieldname: "ecr_number", label: "ECR Number", fieldtype: "Data", read_only: 1, unique: 1, in_list_view: 1 },
    { fieldname: "bidsphere_create_idempotency_key", label: "Create Idempotency Key", fieldtype: "Data", hidden: 1, unique: 1, no_copy: 1, read_only: 1 },
    { fieldname: "col_1", fieldtype: "Column Break" },
    { fieldname: "status", label: "Status", fieldtype: "Select",
      options: "Draft\nSubmitted\nEngineering Review\nOperations Review\nQuality Review\nProgram Review\nECR Approved\nRequisition Creation\nProcurement Review\nRFQ Pending\nRFQ\nRFQ Created\nSupplier Response\nSupplier Evaluation\nSupplier Selected\nImplementation\nValidation\nClosed\nRejected\nCancelled",
      default: "Draft", in_list_view: 1, reqd: 1, allow_on_submit: 1 },
    { fieldname: "select_pxfp", label: "Workflow Status", fieldtype: "Select",
      options: "Draft\nEngineering Review\nProcurement Review\nRFQ Pending\nRFQ\nOperations Review\nQuality Review\nProgram Review\nSent Back\nApproved\nProcurement\nPurchase Requisition\nSupplier Response\nSupplier Evaluation\nSupplier Selection\nImplementation\nValidation\nClosed\nRejected\nCancelled\nSubmitted\nNeeds Revision\nUnder Review\nCross-Functional Review\nECR Approved\nRequisition Creation\nRFQ Created\nSupplier Selected",
      default: "Draft", read_only: 1, in_list_view: 1, reqd: 1, allow_on_submit: 1 },
    // Row 2
    { fieldname: "section_basic2", fieldtype: "Section Break" },
    { fieldname: "ecr_type", label: "ECR Type", fieldtype: "Select",
      options: "\nPart Change\nDesign Change\nMaterial Change\nProcess Change\nTooling Change\nSupplier Change\nQuality Change\nPackaging Change\nCost Change\nOther\nRegulatory\nCost Reduction\nQuality Issue",
      default: "Part Change", in_list_view: 1 },
    { fieldname: "priority", label: "Priority", fieldtype: "Select",
      options: "\nLow\nMedium\nHigh\nCritical", default: "Medium", in_list_view: 1 },
    { fieldname: "col_2", fieldtype: "Column Break" },
    { fieldname: "ecr_owner", label: "ECR Owner", fieldtype: "Link", options: "User", reqd: 1, in_list_view: 1 },
    { fieldname: "requesting_department", label: "Requesting Department", fieldtype: "Link", options: "Department", reqd: 1, in_list_view: 1 },
    // Row 3
    { fieldname: "section_basic3", fieldtype: "Section Break" },
    { fieldname: "plant", label: "Plant", fieldtype: "Link", options: "Plant Floor", reqd: 1, in_list_view: 1 },
    { fieldname: "program", label: "Program", fieldtype: "Data" },
    { fieldname: "col_3", fieldtype: "Column Break" },
    { fieldname: "project", label: "Project", fieldtype: "Link", options: "Project" },
    { fieldname: "target_implementation_date", label: "Target Implementation Date", fieldtype: "Date", reqd: 1, in_list_view: 1 },

    // Change Details section
    { fieldname: "section_change", label: "Change Details", fieldtype: "Section Break" },
    { fieldname: "chnage_description", label: "Change Description", fieldtype: "Long Text", reqd: 1 },
    { fieldname: "reason_for_change", label: "Reason for Change", fieldtype: "Long Text", reqd: 1 },
    { fieldname: "col_4", fieldtype: "Column Break" },
    { fieldname: "business_justification", label: "Business Justification", fieldtype: "Long Text" },
    { fieldname: "current_state", label: "Current State", fieldtype: "Long Text" },
    { fieldname: "proposed_state", label: "Proposed State", fieldtype: "Long Text" },

    // Affected Parts section
    { fieldname: "section_affected", label: "Affected Parts", fieldtype: "Section Break" },
    { fieldname: "affected_parts", label: "Affected Parts", fieldtype: "Table", options: "ECR Affected Part" },

    // Impact Assessment section
    { fieldname: "section_impact", label: "Impact Assessment", fieldtype: "Section Break" },
    { fieldname: "product_impact", label: "Product Impact", fieldtype: "Check" },
    { fieldname: "material_impact", label: "Material Impact", fieldtype: "Check" },
    { fieldname: "manufacturing_impact", label: "Manufacturing Impact", fieldtype: "Check" },
    { fieldname: "tooling_impact", label: "Tooling Impact", fieldtype: "Check" },
    { fieldname: "col_5", fieldtype: "Column Break" },
    { fieldname: "quality_impact", label: "Quality Impact", fieldtype: "Check" },
    { fieldname: "cost_impact", label: "Cost Impact", fieldtype: "Check" },
    { fieldname: "supplier_impact", label: "Supplier Impact", fieldtype: "Check" },
    { fieldname: "delivery_impact", label: "Delivery Impact", fieldtype: "Check" },
    { fieldname: "col_6", fieldtype: "Column Break" },
    { fieldname: "customer_impact", label: "Customer Impact", fieldtype: "Check" },
    { fieldname: "contract_impact", label: "Contract Impact", fieldtype: "Check" },

    // Supplier Requirement section
    { fieldname: "section_supplier", label: "Supplier Requirement", fieldtype: "Section Break" },
    { fieldname: "supplier_response_required", label: "Supplier Response Required", fieldtype: "Select",
      options: "\nYes\nNo", in_list_view: 1 },
    { fieldname: "supplier_response_type", label: "Supplier Response Type", fieldtype: "Select",
      options: "\nQuotation\nFeasibility\nTooling\nCapacity\nLead Time\nQuality Validation\nTechnical Compliance\nCommercial + Technical\nFull Response\nNew Part Quotation\nTooling Quotation\nFeasibility Study\nPrototype\nPPAP Submission" },
    { fieldname: "col_7", fieldtype: "Column Break" },
    { fieldname: "suggested_supplier", label: "Suggested Supplier", fieldtype: "Link", options: "Supplier" },
    { fieldname: "procurement_reference_type", label: "Existing Procurement Reference Type", fieldtype: "Select", options: "None\nRFQ\nPurchase Order", default: "None" },
    { fieldname: "existing_rfq_reference", label: "Existing RFQ Reference", fieldtype: "Link", options: "Request for Quotation" },
    { fieldname: "existing_purchase_order_reference", label: "Existing Purchase Order Reference", fieldtype: "Link", options: "Purchase Order" },
    { fieldname: "required_quantity", label: "Required Quantity", fieldtype: "Float" },
    { fieldname: "quantity_uom", label: "Quantity UOM", fieldtype: "Link", options: "UOM" },
    { fieldname: "supplier_response_requirements", label: "Supplier Response Requirements",
      fieldtype: "Table", options: "ECR Supplier Response Requirement" },

    // Engineering Documents section
    { fieldname: "section_docs", label: "Engineering Documents", fieldtype: "Section Break" },
    { fieldname: "engineering_drawing", label: "Engineering Drawing", fieldtype: "Attach" },
    { fieldname: "3d_cad_file", label: "3D CAD File", fieldtype: "Attach" },
    { fieldname: "col_8", fieldtype: "Column Break" },
    { fieldname: "specification", label: "Specification Document", fieldtype: "Attach" },
    { fieldname: "supporting_documents", label: "Supporting Documents", fieldtype: "Attach Multiple" },
    { fieldname: "engineering_notes", label: "Engineering Notes", fieldtype: "Long Text" },

    // Approval section
    { fieldname: "section_approval", label: "Approval Matrix", fieldtype: "Section Break" },
    { fieldname: "approval_requirements", label: "Approval Requirements", fieldtype: "Table", options: "ECR Approval", allow_on_submit: 1 },

    // Procurement Integration section
    { fieldname: "section_procurement", label: "Procurement Integration", fieldtype: "Section Break" },
    { fieldname: "purchase_requisition", label: "Purchase Requisition", fieldtype: "Link", options: "Purchase Requisition", read_only: 1 },
    { fieldname: "rfq", label: "RFQ", fieldtype: "Link", options: "Request for Quotation", read_only: 1 },
    { fieldname: "col_9", fieldtype: "Column Break" },
    { fieldname: "supplier_quotation", label: "Supplier Quotation", fieldtype: "Link", options: "Supplier Quotation", read_only: 1 },
    { fieldname: "selected_supplier", label: "Selected Supplier", fieldtype: "Link", options: "Supplier", read_only: 1 },
    { fieldname: "purchase_order", label: "Purchase Order", fieldtype: "Link", options: "Purchase Order", read_only: 1 },

    // Implementation & Validation section
    { fieldname: "section_impl", label: "Implementation & Validation", fieldtype: "Section Break" },
    { fieldname: "implementation_notes", label: "Implementation Notes", fieldtype: "Long Text" },
    { fieldname: "implementation_date", label: "Implementation Date", fieldtype: "Date" },
    { fieldname: "col_10", fieldtype: "Column Break" },
    { fieldname: "validation_status", label: "Validation Status", fieldtype: "Select",
      options: "\nNot Started\nPending\nIn Progress\nPassed\nFailed", default: "Not Started" },
    { fieldname: "validation_notes", label: "Validation Notes", fieldtype: "Long Text" },
    { fieldname: "validation_documents", label: "Validation Documents", fieldtype: "Attach Multiple" },
  ],
  permissions: ECR_HUMAN_ROLES.map((role) => ({
    role,
    ...ECR_READ_ONLY_PERMISSION_FLAGS,
    print: 1,
    export: 1,
    report: 1,
  })),
};

for (const field of ECR_AFFECTED_PART.fields) field.allow_on_submit = 1;
for (const field of ECR_SUPPLIER_RESPONSE_REQ.fields) field.allow_on_submit = 1;
for (const field of ECR_DOCTYPE.fields) {
  if (ECR_SUBMITTED_MUTABLE_FIELDS.includes(field.fieldname)) {
    field.allow_on_submit = 1;
  }
}

async function main() {
  console.log("\n=== BidSphere ECR DocType Setup ===");

  console.log("\n1. Creating ECR Affected Part (child)...");
  await createDocType(ECR_AFFECTED_PART);

  console.log("\n2. Creating ECR Supplier Response Requirement (child)...");
  await createDocType(ECR_SUPPLIER_RESPONSE_REQ);

  console.log("\n3. Creating ECR Approval (child)...");
  await createDocType(ECR_APPROVAL);

  console.log("\n4. Creating Engineering Change Request (parent)...");
  await createDocType(ECR_DOCTYPE);
  console.log("   Seeding the atomic ECR naming-series counter...");
  const naming = await ensureEcrNamingSeriesCounter({
    api,
    loadRows: fetchEcrNamesForNamingSeries,
    year: new Date().getFullYear(),
  });
  console.log(`   naming series verified: ${naming.prefix} (${naming.current})`);

  console.log("\n5. Adding the Purchase Requisition idempotency field...");
  await addCustomField("Purchase Requisition", "custom_bidsphere_ecr_idempotency_key", "BidSphere ECR Idempotency Key", "Data", "", "ecr_reference", { hidden: 1, unique: 1, no_copy: 1 });

  console.log("\n6. Adding custom fields on Request for Quotation (traceability)...");
  await addCustomField("Request for Quotation", "custom_ecr_reference", "ECR Reference", "Link", "Engineering Change Request", "");
  await addCustomField("Request for Quotation", "custom_bidsphere_ecr_idempotency_key", "BidSphere ECR Idempotency Key", "Data", "", "custom_ecr_reference", { hidden: 1, unique: 1, no_copy: 1 });
  await addCustomField("Request for Quotation", "custom_purchase_requisition_reference", "Purchase Requisition Reference", "Link", "Purchase Requisition", "custom_bidsphere_ecr_idempotency_key");
  await addCustomField("Request for Quotation", "custom_bidsphere_pr_idempotency_key", "BidSphere PR Idempotency Key", "Data", "", "custom_purchase_requisition_reference", { hidden: 1, unique: 1, no_copy: 1 });

  console.log("\n=== Done ===\n");
}

main().catch(err => { console.error("Fatal:", err.message); process.exit(1); });
