import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertEcrStateReconciliationIsSafe,
  expectedEcrWorkflowDocstatus,
  reconcileApprovalTasks,
  reconciledEcrWorkflowState,
  reserveUniqueEcrNumber,
  validateCancelledEcrReconciliation,
  validateEcrDocstatusReconciliation,
  validateExistingEcrRows,
} from "./ecr-workflow-migration-policy.mjs";
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
function loadEnv() {
  const p = resolve(root, ".env"); if (!existsSync(p)) return;
  for (const line of readFileSync(p, "utf8").split("\n")) {
    const t = line.trim(); if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("="); if (eq <= 0) continue;
    const k = t.slice(0, eq).trim(), v = t.slice(eq + 1).trim();
    if (!process.env[k]) process.env[k] = v;
  }
}
loadEnv();
const BASE = (process.env.ERPNEXT_URL ?? process.env.VITE_ERPNEXT_URL ?? process.env.VITE_PROXY_TARGET ?? "").replace(/\/+$/, "");
const KEY = process.env.ERP_API_KEY ?? process.env.VITE_API_KEY ?? "";
const SEC = process.env.ERP_API_SECRET ?? process.env.VITE_API_SECRET ?? "";
if (!BASE||!KEY||!SEC) { console.error("Missing env"); process.exit(1); }
const WORKFLOW_SERVICE_ROLE = (
  process.env.ECR_WORKFLOW_SERVICE_ROLE ?? "BidSphere ECR Workflow Service"
).trim();
async function api(method, path, body) {
  const r = await fetch(`${BASE}${path}`, { method, headers: { Authorization:`token ${KEY}:${SEC}`, Accept:"application/json","Content-Type":"application/json" }, body:body?JSON.stringify(body):undefined });
  const t=await r.text(); let d; try{d=JSON.parse(t);}catch{d={raw:t};} if(!r.ok) throw new Error(`${method} ${path} -> ${r.status}: ${JSON.stringify(d).slice(0,400)}`);
  return d?.data??d?.message??d;
}

function isOptimisticConflict(error) {
  const message = String(error?.message ?? error ?? "");
  return (
    /TimestampMismatchError/i.test(message) ||
    /document has been modified/i.test(message) ||
    /please refresh/i.test(message) ||
    /->\s*(409|417)\b/.test(message)
  );
}
async function ensureWFState(s,style){try{await api("GET",`/api/resource/Workflow State/${encodeURIComponent(s)}`);}catch{await api("POST","/api/resource/Workflow State",{workflow_state_name:s,style});console.log(`  state: ${s}`);}}
async function ensureWFAction(a){try{await api("GET",`/api/resource/Workflow Action Master/${encodeURIComponent(a)}`);}catch{await api("POST","/api/resource/Workflow Action Master",{workflow_action_name:a});console.log(`  action: ${a}`);}}
async function wfExists(n){try{await api("GET",`/api/resource/Workflow/${encodeURIComponent(n)}`);return true;}catch{return false;}}

async function fetchActiveEcrWorkflowNames() {
  const query = new URLSearchParams({
    fields: JSON.stringify(["name"]),
    filters: JSON.stringify([
      ["document_type", "=", "Engineering Change Request"],
      ["is_active", "=", 1],
    ]),
    limit_page_length: "100",
  });
  const rows = await api("GET", `/api/resource/Workflow?${query}`);
  return (Array.isArray(rows) ? rows : []).map((row) => clean(row.name)).filter(Boolean);
}

async function ensureExclusiveWorkflowServiceRole() {
  const serviceUser = clean(await api("GET", "/api/method/frappe.auth.get_logged_user"));
  if (!serviceUser || serviceUser === "Guest") {
    throw new Error("ERP API credentials do not resolve to an authenticated workflow service user.");
  }
  if (serviceUser === "Administrator") {
    throw new Error(
      "Do not install or run the ECR workflow with Administrator API credentials. Configure a dedicated non-Administrator integration user with System Manager rights, then rerun.",
    );
  }
  try {
    await api("GET", `/api/resource/Role/${encodeURIComponent(WORKFLOW_SERVICE_ROLE)}`);
  } catch {
    await api("POST", "/api/resource/Role", {
      role_name: WORKFLOW_SERVICE_ROLE,
      desk_access: 0,
      is_custom: 1,
    });
    console.log(`  service role created: ${WORKFLOW_SERVICE_ROLE}`);
  }

  const query = new URLSearchParams({
    fields: JSON.stringify(["parent", "role"]),
    filters: JSON.stringify([["role", "=", WORKFLOW_SERVICE_ROLE]]),
    parent: "User",
    limit_page_length: "100",
  });
  const rows = await api("GET", `/api/resource/Has Role?${query}`);
  const holders = new Set((rows ?? []).map((row) => clean(row.parent)).filter(Boolean));
  const unexpected = [...holders].filter((user) => user !== serviceUser);
  if (unexpected.length > 0) {
    throw new Error(
      `${WORKFLOW_SERVICE_ROLE} must be exclusive to the ERP integration user; remove it from ${unexpected.join(", ")}.`,
    );
  }
  if (!holders.has(serviceUser)) {
    await api(
      "POST",
      "/api/method/frappe.core.doctype.user.user.add_role",
      { user: serviceUser, role: WORKFLOW_SERVICE_ROLE },
    );
    console.log(`  service role assigned to ERP integration user: ${serviceUser}`);
  }
  return serviceUser;
}

const HUMAN_ECR_ROLES = ECR_HUMAN_ROLES;

const ECR_PERMISSION_FLAGS = [
  "read",
  "write",
  "create",
  "delete",
  "submit",
  "cancel",
  "amend",
  "print",
  "export",
  "report",
];

function permissionDiffers(existing, desired) {
  return ECR_PERMISSION_FLAGS.some(
    (field) => Number(existing?.[field] || 0) !== Number(desired[field] || 0),
  );
}

function serviceEcrPermission() {
  return {
    parent: "Engineering Change Request",
    role: WORKFLOW_SERVICE_ROLE,
    permlevel: 0,
    read: 1,
    write: 1,
    create: 1,
    delete: 0,
    submit: 1,
    cancel: 1,
    amend: 0,
    print: 0,
    export: 0,
    report: 0,
  };
}

function readOnlyEcrPermission(role) {
  return {
    parent: "Engineering Change Request",
    role,
    permlevel: 0,
    ...ECR_READ_ONLY_PERMISSION_FLAGS,
    print: 1,
    export: 1,
    report: 1,
  };
}

function directRfqServicePermission(parent, { write = 0, create = 0 } = {}) {
  return {
    parent,
    role: WORKFLOW_SERVICE_ROLE,
    permlevel: 0,
    read: 1,
    write,
    create,
    delete: 0,
    submit: 0,
    cancel: 0,
    amend: 0,
    print: 0,
    export: 0,
    report: 0,
  };
}

async function fetchServiceCustomPermissions(parent) {
  const query = new URLSearchParams({
    fields: JSON.stringify(["name", "parent", "role", "permlevel", ...ECR_PERMISSION_FLAGS]),
    filters: JSON.stringify([
      ["parent", "=", parent],
      ["role", "=", WORKFLOW_SERVICE_ROLE],
      ["permlevel", "=", 0],
    ]),
    limit_page_length: "20",
  });
  const rows = await api("GET", `/api/resource/Custom DocPerm?${query}`);
  return Array.isArray(rows) ? rows : [];
}

async function ensureDirectRfqServicePermissions() {
  const desiredRows = [
    directRfqServicePermission("Request for Quotation", { write: 1, create: 1 }),
    directRfqServicePermission("Supplier"),
    directRfqServicePermission("Plant Floor"),
    directRfqServicePermission("Item"),
  ];
  for (const desired of desiredRows) {
    const matching = await fetchServiceCustomPermissions(desired.parent);
    if (matching.length > 1) {
      throw new Error(
        `Duplicate ${WORKFLOW_SERVICE_ROLE} permissions exist for ${desired.parent}.`,
      );
    }
    if (matching.length === 0) {
      await api("POST", "/api/resource/Custom DocPerm", desired);
      console.log(`  direct RFQ permission created: ${desired.parent}`);
    } else if (permissionDiffers(matching[0], desired)) {
      await api(
        "PUT",
        `/api/resource/Custom DocPerm/${encodeURIComponent(matching[0].name)}`,
        desired,
      );
      console.log(`  direct RFQ permission updated: ${desired.parent}`);
    }
    const verified = await fetchServiceCustomPermissions(desired.parent);
    if (verified.length !== 1 || permissionDiffers(verified[0], desired)) {
      throw new Error(
        `${WORKFLOW_SERVICE_ROLE} does not have the required ${desired.parent} permission.`,
      );
    }
  }
}

async function fetchCustomEcrPermissions() {
  const query = new URLSearchParams({
    fields: JSON.stringify(["name", "role", "permlevel", ...ECR_PERMISSION_FLAGS]),
    filters: JSON.stringify([
      ["parent", "=", "Engineering Change Request"],
      ["permlevel", "=", 0],
    ]),
    limit_page_length: "200",
  });
  const rows = await api("GET", `/api/resource/Custom DocPerm?${query}`);
  return Array.isArray(rows) ? rows : [];
}

async function upsertCustomEcrPermissions(existingRows, desiredRows) {
  for (const desired of desiredRows) {
    const matching = existingRows.filter((row) => clean(row.role) === desired.role);
    if (matching.length > 1) {
      throw new Error(
        `Duplicate ${desired.role} permissions exist for Engineering Change Request.`,
      );
    }
    if (matching.length === 0) {
      await api("POST", "/api/resource/Custom DocPerm", desired);
      console.log(`  custom permission created: ${desired.role}`);
      continue;
    }
    if (permissionDiffers(matching[0], desired)) {
      await api(
        "PUT",
        `/api/resource/Custom DocPerm/${encodeURIComponent(matching[0].name)}`,
        desired,
      );
      console.log(`  custom permission updated: ${desired.role}`);
    } else {
      console.log(`  custom permission verified: ${desired.role}`);
    }
  }
}

async function assertRequiredEcrRolesExist() {
  const missing = [];
  for (const role of HUMAN_ECR_ROLES) {
    try {
      await api("GET", `/api/resource/Role/${encodeURIComponent(role)}`);
    } catch {
      missing.push(role);
    }
  }
  if (missing.length > 0) {
    throw new Error(
      `Missing required ECR roles: ${missing.join(", ")}. Run scripts/setup-ecr-roles.mjs first.`,
    );
  }
}

async function upsertStandardServicePermission() {
  const doctype = await api(
    "GET",
    `/api/resource/DocType/${encodeURIComponent("Engineering Change Request")}`,
  );
  const permissions = Array.isArray(doctype.permissions)
    ? doctype.permissions.map((row) => ({ ...row }))
    : [];
  const matching = permissions.filter(
    (row) => clean(row.role) === WORKFLOW_SERVICE_ROLE && Number(row.permlevel || 0) === 0,
  );
  if (matching.length > 1) {
    throw new Error(`Duplicate ${WORKFLOW_SERVICE_ROLE} standard ECR permissions exist.`);
  }
  const desired = serviceEcrPermission();
  if (matching.length === 0) {
    permissions.push(desired);
  } else if (permissionDiffers(matching[0], desired)) {
    Object.assign(matching[0], desired);
  } else {
    console.log(`  standard service permission verified: ${WORKFLOW_SERVICE_ROLE}`);
    return;
  }
  await api(
    "PUT",
    `/api/resource/DocType/${encodeURIComponent("Engineering Change Request")}`,
    { permissions, modified: doctype.modified },
  );
  console.log(`  standard service permission reconciled: ${WORKFLOW_SERVICE_ROLE}`);
}

/**
 * Grant the service identity its full rights without reducing any existing
 * human permission. This keeps the old workflow usable if a later preflight or
 * data-reconciliation step fails before the new workflow is installed.
 */
async function prepareEcrDocPermissions() {
  await assertRequiredEcrRolesExist();
  const customRows = await fetchCustomEcrPermissions();
  if (customRows.length > 0) {
    await upsertCustomEcrPermissions(customRows, [serviceEcrPermission()]);
  } else {
    await upsertStandardServicePermission();
  }
}

async function verifyExclusiveMutationPermissions(rows, source) {
  const mutationFields = ["write", "create", "delete", "submit", "cancel", "amend"];
  const serviceRows = rows.filter((row) => clean(row.role) === WORKFLOW_SERVICE_ROLE);
  if (serviceRows.length !== 1 || permissionDiffers(serviceRows[0], serviceEcrPermission())) {
    throw new Error(`Invalid ${source} workflow service permission posture.`);
  }
  const overprivileged = rows.filter(
    (row) => clean(row.role) !== WORKFLOW_SERVICE_ROLE &&
      mutationFields.some((field) => Number(row[field] || 0) !== 0),
  );
  if (overprivileged.length > 0) {
    throw new Error(
      `Non-service ${source} ECR mutation permissions remain for: ${overprivileged.map((row) => clean(row.role)).join(", ")}.`,
    );
  }
}

/** Lock down every non-service role only after the service-role workflow exists. */
async function lockDownEcrDocPermissions() {
  const customRows = await fetchCustomEcrPermissions();
  if (customRows.length > 0) {
    const humanRoles = [...new Set([
      ...HUMAN_ECR_ROLES,
      ...customRows.map((row) => clean(row.role)).filter(Boolean),
    ])].filter((role) => role !== WORKFLOW_SERVICE_ROLE);
    await upsertCustomEcrPermissions(customRows, [
      serviceEcrPermission(),
      ...humanRoles.map(readOnlyEcrPermission),
    ]);
    await verifyExclusiveMutationPermissions(
      await fetchCustomEcrPermissions(),
      "Custom DocPerm",
    );
    return;
  }

  const doctype = await api(
    "GET",
    `/api/resource/DocType/${encodeURIComponent("Engineering Change Request")}`,
  );
  const permissions = Array.isArray(doctype.permissions)
    ? doctype.permissions.map((row) => ({ ...row }))
    : [];
  const roles = [...new Set([
    WORKFLOW_SERVICE_ROLE,
    ...HUMAN_ECR_ROLES,
    ...permissions
      .filter((row) => Number(row.permlevel || 0) === 0)
      .map((row) => clean(row.role))
      .filter(Boolean),
  ])];
  for (const role of roles) {
    const matching = permissions.filter(
      (row) => clean(row.role) === role && Number(row.permlevel || 0) === 0,
    );
    if (matching.length > 1) throw new Error(`Duplicate ${role} standard ECR permissions exist.`);
    const desired = role === WORKFLOW_SERVICE_ROLE
      ? serviceEcrPermission()
      : readOnlyEcrPermission(role);
    if (matching.length === 0) permissions.push(desired);
    else Object.assign(matching[0], desired);
  }
  await api(
    "PUT",
    `/api/resource/DocType/${encodeURIComponent("Engineering Change Request")}`,
    { permissions, modified: doctype.modified },
  );
  const verified = await api(
    "GET",
    `/api/resource/DocType/${encodeURIComponent("Engineering Change Request")}`,
  );
  await verifyExclusiveMutationPermissions(
    (verified.permissions ?? []).filter((row) => Number(row.permlevel || 0) === 0),
    "standard DocPerm",
  );
}

async function fetchEcrDocShares() {
  const rows = [];
  const pageLength = 200;
  for (let start = 0; ; start += pageLength) {
    const query = new URLSearchParams({
      fields: JSON.stringify([
        "name",
        "user",
        "share_name",
        "read",
        "write",
        "share",
        "everyone",
        "modified",
      ]),
      filters: JSON.stringify([["share_doctype", "=", "Engineering Change Request"]]),
      limit_start: String(start),
      limit_page_length: String(pageLength),
      order_by: "name asc",
    });
    const page = await api("GET", `/api/resource/DocShare?${query}`);
    for (const row of page ?? []) rows.push(row);
    if (!Array.isArray(page) || page.length < pageLength) break;
  }
  return rows;
}

/** DocShare write/share grants override DocPerm and must not bypass BidSphere. */
async function lockDownEcrDocShares() {
  const writable = (await fetchEcrDocShares()).filter(
    (row) => Number(row.write || 0) === 1 || Number(row.share || 0) === 1,
  );
  for (const row of writable) {
    await api("PUT", `/api/resource/DocShare/${encodeURIComponent(row.name)}`, {
      read: 1,
      write: 0,
      share: 0,
      modified: row.modified,
    });
    console.log(
      `  direct ECR share downgraded: ${clean(row.share_name)} -> ${clean(row.user) || "Everyone"}`,
    );
  }
  const remaining = (await fetchEcrDocShares()).filter(
    (row) => Number(row.write || 0) === 1 || Number(row.share || 0) === 1,
  );
  if (remaining.length > 0) {
    throw new Error(
      `Writable ECR DocShare grants remain: ${remaining.map((row) => row.name).join(", ")}.`,
    );
  }
  console.log(`  ECR DocShare grants verified read-only: ${writable.length} updated`);
}

// `STATES` includes legacy values only so existing records can be validated and
// reconciled before the new workflow is activated. They are not live actions.
const STATES = [
  ["Draft",                   "Secondary", "0"],
  ["Engineering Review",      "Primary",   "0"],
  ["RFQ Pending",             "Warning",   "0"],
  ["Operations Review",       "Warning",   "1"],
  ["Quality Review",          "Warning",   "1"],
  ["Program Review",          "Warning",   "1"],
  ["Sent Back",               "Warning",   "1"],
  ["Approved",                "Success",   "1"],
  ["Procurement",             "Primary",   "1"],
  ["Purchase Requisition",    "Primary",   "1"],
  ["RFQ",                     "Primary",   "1"],
  ["Supplier Response",       "Warning",   "1"],
  ["Supplier Evaluation",     "Warning",   "1"],
  ["Supplier Selection",      "Success",   "1"],
  ["Implementation",          "Primary",   "1"],
  ["Validation",              "Warning",   "1"],
  ["Closed",                  "Success",   "1"],
  ["Rejected",                "Danger",    "0"],
  ["Cancelled",               "Danger",    "2"],
  // Legacy states remain representable during preflight and reconciliation.
  ["Submitted",               "Primary",   "1"],
  ["Engineering Manager Approval", "Primary", "1"],
  ["Engineering Manager Review", "Primary", "1"],
  ["EM Approval",             "Primary",   "1"],
  ["Needs Revision",          "Warning",   "1"],
  ["Under Review",            "Warning",   "1"],
  ["Cross-Functional Review", "Warning",   "1"],
  ["ECR Approved",            "Success",   "1"],
  ["Requisition Creation",    "Primary",   "1"],
  ["Procurement Review",      "Warning",   "0"],
  ["RFQ Created",             "Primary",   "1"],
  ["Supplier Selected",       "Success",   "1"],
];

const WF_STATES = [
  { state:"Draft",                  doc_status:"0", style:"Secondary",  allow_edit:"Engineer" },
  { state:"Engineering Review",     doc_status:"0", style:"Primary",    allow_edit:"Engineering Manager" },
  { state:"Procurement Review",     doc_status:"0", style:"Primary",    allow_edit:"Procurement Team" },
  { state:"RFQ Pending",            doc_status:"0", style:"Warning",    allow_edit:"Procurement Manager" },
  { state:"RFQ",                    doc_status:"1", style:"Primary",    allow_edit:"Procurement Manager" },
  // Historical non-actionable states remain representable but are not part of
  // the five-stage progress model and have no transitions.
  { state:"Sent Back",              doc_status:"1", style:"Warning",    allow_edit:"System Manager" },
  { state:"Closed",                 doc_status:"1", style:"Success",    allow_edit:"System Manager" },
  { state:"Rejected",               doc_status:"0", style:"Danger",     allow_edit:"System Manager" },
  { state:"Cancelled",              doc_status:"2", style:"Danger",     allow_edit:"System Manager" },
];

const WF_TRANSITIONS = [
  { state:"Draft",              action:"Submit ECR", next_state:"Engineering Review", allowed:"Engineer" },
  { state:"Engineering Review", action:"Send Back",  next_state:"Draft",              allowed:"Engineering Manager" },
  { state:"Engineering Review", action:"Reject",     next_state:"Rejected",           allowed:"Engineering Manager" },
  { state:"Engineering Review", action:"Approve",    next_state:"Procurement Review", allowed:"Engineering Manager" },
  { state:"Procurement Review", action:"Send Back",  next_state:"Draft",              allowed:"Procurement Team" },
  { state:"Procurement Review", action:"Reject",     next_state:"Rejected",           allowed:"Procurement Team" },
  { state:"Procurement Review", action:"Approve",    next_state:"RFQ Pending",        allowed:"Procurement Team" },
  { state:"RFQ Pending",        action:"Create RFQ", next_state:"RFQ",                allowed:"Procurement Manager" },
];

const ACTIONS = [...new Set(WF_TRANSITIONS.map(t=>t.action))];

const ECR_DOCTYPE_NAME = "Engineering Change Request";
const ECR_SUBMITTED_PARENT_FIELDS = [
  "select_pxfp",
  "status",
  "approval_requirements",
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
const ECR_AFFECTED_PART_FIELDS = [
  "partitem",
  "part_description",
  "current_revision",
  "new_revision",
  "quantity",
  "uom",
  "change_required",
  "technical_notes",
  "current_supplier",
  "proposed_supplier",
  "plant",
  "source_reference_type",
  "source_document_reference",
  "source_item_reference",
];
const ECR_SUPPLIER_REQUIREMENT_FIELDS = [
  "item_code",
  "description",
  "quantity",
  "uom",
  "technical_requirement",
  "revision",
  "plant",
];
function clean(value) {
  return String(value ?? "").trim();
}

function sameTaskRows(left, right) {
  const comparable = (rows) => rows.map((row) => ({
    name: clean(row.name),
    department: clean(row.department),
    approval_role: clean(row.approval_role),
    approver: clean(row.approver),
    required: Number(row.required || 0),
    status: clean(row.status),
    approval_date: clean(row.approval_date),
    comments: clean(row.comments),
  }));
  return JSON.stringify(comparable(left)) === JSON.stringify(comparable(right));
}

async function requireDocFields(fieldnames, doctype = ECR_DOCTYPE_NAME) {
  const meta = await api("GET", `/api/resource/DocType/${encodeURIComponent(doctype)}`);
  const fields = new Map((meta.fields ?? []).map((field) => [field.fieldname, field]));
  const missing = fieldnames.filter((fieldname) => !fields.get(fieldname)?.name);
  if (missing.length > 0) {
    throw new Error(
      `Missing ${missing.map((fieldname) => `${doctype}.${fieldname}`).join(", ")}. ` +
      "Run scripts/setup-ecr-doctype.mjs before installing the workflow.",
    );
  }
  return Object.fromEntries(fieldnames.map((fieldname) => [fieldname, fields.get(fieldname)]));
}

function validateApprovalTaskFields(fields) {
  const mutableFields = [
    "department",
    "approval_role",
    "approver",
    "required",
    "status",
    "approval_date",
    "comments",
  ];
  const blocked = mutableFields.filter(
    (fieldname) => Number(fields[fieldname].allow_on_submit || 0) !== 1,
  );
  if (blocked.length > 0) {
    throw new Error(
      `Invalid ECR Approval schema: submitted updates are disabled for ${blocked.join(", ")}. ` +
      "Run scripts/setup-ecr-doctype.mjs before installing the workflow.",
    );
  }
}

function validateSubmittedMutableFields(fields, doctype, fieldnames) {
  const blocked = fieldnames.filter(
    (fieldname) => Number(fields[fieldname]?.allow_on_submit || 0) !== 1,
  );
  if (blocked.length > 0) {
    throw new Error(
      `Invalid ${doctype} schema: submitted updates are disabled for ${blocked.join(", ")}. ` +
      "Run scripts/setup-ecr-doctype.mjs before installing the workflow.",
    );
  }
}

function validatePlantMasterField(field, doctype) {
  if (field.fieldtype !== "Link" || clean(field.options) !== "Plant Floor") {
    throw new Error(
      `Invalid ${doctype}.plant schema: it must link to Plant Floor. ` +
      "Run scripts/setup-ecr-doctype.mjs before installing the workflow.",
    );
  }
}

function validateWorkflowDocFields(fields) {
  const problems = [];
  if (fields.approval_requirements.fieldtype !== "Table" || fields.approval_requirements.options !== "ECR Approval") {
    problems.push("approval_requirements must be an ECR Approval Table field");
  }
  if (fields.ecr_number.fieldtype !== "Data" || Number(fields.ecr_number.unique || 0) !== 1 || Number(fields.ecr_number.read_only || 0) !== 1) {
    problems.push("ecr_number must be a unique, read-only Data field");
  }
  const configuredStates = new Set(
    clean(fields.select_pxfp.options).split("\n").map(clean).filter(Boolean),
  );
  const missingStates = WF_STATES
    .map((state) => state.state)
    .filter((state) => !configuredStates.has(state));
  if (fields.select_pxfp.fieldtype !== "Select" || Number(fields.select_pxfp.read_only || 0) !== 1) {
    problems.push("select_pxfp must be a read-only Select field");
  }
  if (missingStates.length > 0) {
    problems.push(`select_pxfp is missing workflow states: ${missingStates.join(", ")}`);
  }
  if (problems.length > 0) {
    throw new Error(
      `Invalid ${ECR_DOCTYPE_NAME} workflow schema: ${problems.join("; ")}. ` +
      "Run scripts/setup-ecr-doctype.mjs before installing the workflow.",
    );
  }
}

async function setAllowOnSubmit(field, enabled) {
  const next = enabled ? 1 : 0;
  if (Number(field.allow_on_submit || 0) === next) return;
  await api("PUT", `/api/resource/DocField/${encodeURIComponent(field.name)}`, {
    allow_on_submit: next,
  });
  field.allow_on_submit = next;
  console.log(`  submitted update ${enabled ? "enabled" : "disabled"}: ${field.fieldname}`);
}

async function fetchAllEcrRows() {
  const rows = [];
  const pageLength = 200;
  for (let start = 0; ; start += pageLength) {
    const query = new URLSearchParams({
      fields: JSON.stringify(["name", "ecr_number", "select_pxfp", "status", "docstatus", "rfq"]),
      limit_start: String(start),
      limit_page_length: String(pageLength),
      order_by: "name asc",
    });
    const page = await api("GET", `/api/resource/${encodeURIComponent(ECR_DOCTYPE_NAME)}?${query}`);
    for (const row of page ?? []) rows.push(row);
    if (!Array.isArray(page) || page.length < pageLength) break;
  }
  return rows;
}

async function preflightCancelledEcrs(rows) {
  const cancelled = [];
  for (const row of rows) {
    if (Number(row.docstatus || 0) !== 2) continue;
    cancelled.push(await api(
      "GET",
      `/api/resource/${encodeURIComponent(ECR_DOCTYPE_NAME)}/${encodeURIComponent(row.name)}`,
    ));
  }
  validateCancelledEcrReconciliation(cancelled);
}

async function validateEcrAutoname() {
  const meta = await api(
    "GET",
    `/api/resource/DocType/${encodeURIComponent(ECR_DOCTYPE_NAME)}`,
  );
  if (clean(meta.autoname) !== ECR_AUTONAME_PATTERN) {
    throw new Error(
      `Invalid ${ECR_DOCTYPE_NAME} autoname '${clean(meta.autoname)}'; expected '${ECR_AUTONAME_PATTERN}'. ` +
      "Run scripts/setup-ecr-doctype.mjs before installing the workflow.",
    );
  }
}

async function reconcileExistingEcrs() {
  const rows = await fetchAllEcrRows();
  validateExistingEcrRows(
    rows,
    STATES.map(([state]) => state),
  );
  validateEcrDocstatusReconciliation(rows);
  const names = rows.map((row) => clean(row.name)).filter(Boolean);
  const usedNumbers = new Set(
    rows.map((row) => clean(row.ecr_number).toUpperCase()).filter(Boolean),
  );
  let updated = 0;

  for (const name of names) {
    let didUpdate = false;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      // Fresh-read every attempt so concurrent workflow transitions cannot be
      // overwritten with a task list computed from an earlier stage snapshot.
      const doc = await api(
        "GET",
        `/api/resource/${encodeURIComponent(ECR_DOCTYPE_NAME)}/${encodeURIComponent(name)}`,
      );
      const targetState = reconciledEcrWorkflowState(doc);
      const nextRows = reconcileApprovalTasks(doc, targetState);
      const patch = {};
      if (!clean(doc.ecr_number)) {
        patch.ecr_number = reserveUniqueEcrNumber(doc.name, usedNumbers);
      }
      if (!sameTaskRows(doc.approval_requirements ?? [], nextRows)) {
        patch.approval_requirements = nextRows;
      }
      if (clean(doc.select_pxfp) !== targetState) {
        patch.select_pxfp = targetState;
      }
      const hasStatusField = Object.prototype.hasOwnProperty.call(doc, "status");
      if (hasStatusField && clean(doc.status) !== targetState) {
        patch.status = targetState;
      }
      if (Object.keys(patch).length > 0) {
        // Echo the exact Frappe optimistic-lock timestamp.
        patch.modified = doc.modified;
        try {
          await api(
            "PUT",
            `/api/resource/${encodeURIComponent(ECR_DOCTYPE_NAME)}/${encodeURIComponent(doc.name)}`,
            patch,
          );
        } catch (error) {
          if (attempt < 3 && isOptimisticConflict(error)) {
            console.warn(`  concurrent update detected for ${name}; retrying from a fresh document`);
            continue;
          }
          throw error;
        }
        didUpdate = true;
      }

      const verified = await api(
        "GET",
        `/api/resource/${encodeURIComponent(ECR_DOCTYPE_NAME)}/${encodeURIComponent(name)}`,
      );
      const expectedState = reconciledEcrWorkflowState(verified);
      const expectedRows = reconcileApprovalTasks(verified, expectedState);
      const tasksMatch = sameTaskRows(verified.approval_requirements ?? [], expectedRows);
      const stateMatches = clean(verified.select_pxfp) === expectedState;
      const statusMatches = !hasStatusField || clean(verified.status) === expectedState;
      const expectedDocstatus = expectedEcrWorkflowDocstatus(
        verified,
        expectedState,
      );
      const docstatusMatches = expectedDocstatus === undefined ||
        Number(verified.docstatus) === expectedDocstatus;
      if (tasksMatch && stateMatches && statusMatches && docstatusMatches && clean(verified.ecr_number)) {
        if (didUpdate) {
          console.log(`  reconciled: ${clean(verified.ecr_number) || name} (${clean(verified.select_pxfp) || "Draft"})`);
          updated += 1;
        }
        break;
      }
      if (attempt === 3) {
        throw new Error(`Could not reconcile ${name} after 3 fresh-read attempts.`);
      }
    }
  }
  console.log(`  ECR records reconciled: ${updated}/${names.length}`);
}

async function main() {
  const WF_NAME = "ECR Approval Workflow";
  console.log(`\n=== ECR Workflow Setup ===\n`);
  // Fail before changing workflow metadata when the canonical ECR schema has
  // not been installed, avoiding a half-applied clean-environment migration.
  const requiredFields = await requireDocFields([
    "ecr_number",
    ...ECR_SUBMITTED_PARENT_FIELDS,
  ]);
  validateWorkflowDocFields(requiredFields);
  await validateEcrAutoname();
  validateSubmittedMutableFields(
    requiredFields,
    ECR_DOCTYPE_NAME,
    ECR_SUBMITTED_PARENT_FIELDS,
  );
  validatePlantMasterField(requiredFields.plant, ECR_DOCTYPE_NAME);
  const affectedPartFields = await requireDocFields(
    ECR_AFFECTED_PART_FIELDS,
    "ECR Affected Part",
  );
  validateSubmittedMutableFields(
    affectedPartFields,
    "ECR Affected Part",
    ECR_AFFECTED_PART_FIELDS,
  );
  validatePlantMasterField(affectedPartFields.plant, "ECR Affected Part");
  const supplierRequirementFields = await requireDocFields(
    ECR_SUPPLIER_REQUIREMENT_FIELDS,
    "ECR Supplier Response Requirement",
  );
  validateSubmittedMutableFields(
    supplierRequirementFields,
    "ECR Supplier Response Requirement",
    ECR_SUPPLIER_REQUIREMENT_FIELDS,
  );
  validatePlantMasterField(
    supplierRequirementFields.plant,
    "ECR Supplier Response Requirement",
  );
  const requiredTaskFields = await requireDocFields([
    "department",
    "approval_role",
    "approver",
    "required",
    "status",
    "approval_date",
    "comments",
  ], "ECR Approval");
  validateApprovalTaskFields(requiredTaskFields);
  console.log("Validating existing ECR states and public-number routing...");
  const existingRows = await fetchAllEcrRows();
  validateExistingEcrRows(
    existingRows,
    STATES.map(([state]) => state),
  );
  validateEcrDocstatusReconciliation(existingRows);
  await preflightCancelledEcrs(existingRows);
  const activeEcrWorkflows = await fetchActiveEcrWorkflowNames();
  assertEcrStateReconciliationIsSafe(existingRows, activeEcrWorkflows);
  const naming = await ensureEcrNamingSeriesCounter({
    api,
    loadRows: fetchAllEcrRows,
    year: new Date().getFullYear(),
  });
  console.log(`  naming series verified: ${naming.prefix} (${naming.current})`);
  await ensureExclusiveWorkflowServiceRole();
  await prepareEcrDocPermissions();
  await ensureDirectRfqServicePermissions();
  console.log("States..."); for(const [s,style] of STATES) await ensureWFState(s,style);
  console.log("Actions..."); for(const a of ACTIONS) await ensureWFAction(a);
  console.log("Enabling submitted-document task and number reconciliation...");
  await setAllowOnSubmit(requiredFields.approval_requirements, true);
  const originalNumberAllowOnSubmit = Number(requiredFields.ecr_number.allow_on_submit || 0) === 1;
  await setAllowOnSubmit(requiredFields.ecr_number, true);
  try {
    console.log("Reconciling business numbers and current-stage approval tasks...");
    await reconcileExistingEcrs();
  } finally {
    // Business numbers stay immutable after backfill. Approval tasks remain
    // writable because later reviews update them on submitted ECR documents.
    await setAllowOnSubmit(requiredFields.ecr_number, originalNumberAllowOnSubmit);
  }
  // Activate the service-role-only workflow only after every existing ECR is
  // verified. A failed schema/backfill step therefore leaves the prior active
  // workflow intact instead of locking users into a half-applied migration.
  const exists = await wfExists(WF_NAME);
  console.log(exists ? "Updating existing sequential workflow..." : "Creating sequential workflow...");
  const payload = {
    workflow_name: WF_NAME, document_type: "Engineering Change Request",
    workflow_state_field: "select_pxfp", is_active: 1, override_status: 0, send_email_alert: 0,
    // Human roles never execute Frappe workflow transitions directly. The
    // integration identity applies them only after the BidSphere endpoint has
    // authorized the signed-in actor, stage, task, and required decision data.
    states: WF_STATES.map((s,i)=>({...s,allow_edit:WORKFLOW_SERVICE_ROLE,idx:i+1})),
    transitions: WF_TRANSITIONS.map((t,i)=>({
      ...t,
      allowed:WORKFLOW_SERVICE_ROLE,
      idx:i+1,
      condition:t.condition ?? "",
      allow_self_approval:1,
    })),
  };
  await api(exists ? "PUT" : "POST", exists ? `/api/resource/Workflow/${encodeURIComponent(WF_NAME)}` : "/api/resource/Workflow", payload);
  console.log(`✅ ${exists ? "Updated" : "Created"}: ${WF_NAME}`);
  console.log("Restricting direct ERP ECR mutation permissions to the workflow service...");
  await lockDownEcrDocPermissions();
  await lockDownEcrDocShares();
  console.log("\n=== Done ===\n");
}
main().catch(e=>{console.error("Fatal:",e.message);process.exit(1);});
