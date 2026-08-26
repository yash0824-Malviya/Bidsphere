/**
 * Repairs the live ECR Owner link target and seeds the documented demo master
 * records through their existing ERPNext DocTypes. Every operation is
 * idempotent: exact master records are reused and never duplicated.
 *
 * Usage: node scripts/setup-ecr-master-data.mjs
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function loadEnvFile() {
  const envPath = resolve(root, ".env");
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator <= 0) continue;
    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim();
    if (!process.env[key]) process.env[key] = value;
  }
}

loadEnvFile();

const baseUrl = (
  process.env.ERPNEXT_URL ??
  process.env.VITE_ERPNEXT_URL ??
  process.env.VITE_PROXY_TARGET ??
  ""
).replace(/\/+$/, "");
const apiKey = process.env.ERP_API_KEY ?? process.env.VITE_API_KEY ?? "";
const apiSecret = process.env.ERP_API_SECRET ?? process.env.VITE_API_SECRET ?? "";

if (!baseUrl || !apiKey || !apiSecret) {
  throw new Error("ERPNext URL and API credentials are required.");
}

async function api(method, path, body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      Accept: "application/json",
      Authorization: `token ${apiKey}:${apiSecret}`,
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let payload;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = { message: text };
  }
  if (!response.ok) {
    throw new Error(
      `${method} ${path} failed (${response.status}): ${payload.message ?? payload.exception ?? text}`,
    );
  }
  return payload.data ?? payload.message ?? payload;
}

async function list(doctype, fields, filters, limit = 50) {
  const params = new URLSearchParams({
    fields: JSON.stringify(fields),
    filters: JSON.stringify(filters),
    limit_page_length: String(limit),
  });
  return api(
    "GET",
    `/api/resource/${encodeURIComponent(doctype)}?${params.toString()}`,
  );
}

async function findOne(doctype, fields, filters) {
  const rows = await list(doctype, fields, filters, 2);
  return Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
}

async function ensureEcrOwnerTargetsUser() {
  const docField = await findOne(
    "DocField",
    ["name", "fieldname", "label", "fieldtype", "options"],
    [
      ["parent", "=", "Engineering Change Request"],
      ["fieldname", "=", "ecr_owner"],
    ],
  );
  if (docField) {
    if (docField.fieldtype !== "Link" || docField.options !== "User") {
      throw new Error("Engineering Change Request.ecr_owner exists with an incompatible definition.");
    }
    return { status: "existing", name: docField.name, fieldname: "ecr_owner", options: "User" };
  }

  const customField = await findOne(
    "Custom Field",
    ["name", "dt", "fieldname", "label", "fieldtype", "options"],
    [
      ["dt", "=", "Engineering Change Request"],
      ["fieldname", "=", "ecr_owner"],
    ],
  );
  if (customField) {
    if (customField.fieldtype !== "Link" || customField.options !== "User") {
      throw new Error("Engineering Change Request.ecr_owner custom field has an incompatible definition.");
    }
    return { status: "existing", name: customField.name, fieldname: "ecr_owner", options: "User" };
  }

  const created = await api("POST", "/api/resource/Custom Field", {
    dt: "Engineering Change Request",
    fieldname: "ecr_owner",
    label: "ECR Owner",
    fieldtype: "Link",
    options: "User",
    insert_after: "priority",
    reqd: 1,
    in_list_view: 1,
    in_standard_filter: 1,
  });
  return { status: "created", name: created.name, fieldname: "ecr_owner", options: "User" };
}

async function repairLegacyAmendedFrom() {
  const field = await findOne(
    "DocField",
    ["name", "fieldname", "label", "fieldtype", "options", "reqd", "read_only", "no_copy"],
    [
      ["parent", "=", "Engineering Change Request"],
      ["fieldname", "=", "amended_from"],
    ],
  );
  if (!field) return { status: "not-present" };
  const desired = {
    label: "Amended From",
    fieldtype: "Link",
    options: "Engineering Change Request",
    reqd: 0,
    read_only: 1,
    no_copy: 1,
  };
  const unchanged = Object.entries(desired).every(([key, value]) => field[key] === value);
  if (unchanged) return { status: "existing", name: field.name, ...desired };
  const updated = await api(
    "PUT",
    `/api/resource/DocField/${encodeURIComponent(field.name)}`,
    desired,
  );
  return { status: "updated", name: field.name, ...desired, modified: updated.modified };
}

async function alignWorkflowStateOptions() {
  const workflow = await api(
    "GET",
    `/api/resource/Workflow/${encodeURIComponent("ECR Approval Workflow")}`,
  );
  const states = [...new Set(
    (workflow.states ?? []).map((row) => String(row.state || "").trim()).filter(Boolean),
  )];
  if (states.length === 0) throw new Error("ECR Approval Workflow has no states.");

  const field = await findOne(
    "DocField",
    ["name", "fieldname", "fieldtype", "options"],
    [
      ["parent", "=", "Engineering Change Request"],
      ["fieldname", "=", "select_pxfp"],
    ],
  );
  if (!field || field.fieldtype !== "Select") {
    throw new Error("Engineering Change Request.select_pxfp Select field was not found.");
  }
  const options = states.join("\n");
  if (field.options === options) {
    return { status: "existing", name: field.name, stateCount: states.length };
  }
  await api("PUT", `/api/resource/DocField/${encodeURIComponent(field.name)}`, { options });
  return { status: "updated", name: field.name, stateCount: states.length };
}

async function ensureDepartment() {
  const existing = await findOne(
    "Department",
    ["name", "department_name", "company"],
    [
      ["department_name", "=", "Engineering"],
      ["company", "=", "Bidsphere"],
    ],
  );
  if (existing) return { status: "existing", ...existing };
  const created = await api("POST", "/api/resource/Department", {
    department_name: "Engineering",
    company: "Bidsphere",
    is_group: 0,
  });
  return { status: "created", ...created };
}

async function ensurePlant() {
  const existing = await findOne(
    "Plant Floor",
    ["name", "floor_name", "company", "warehouse"],
    [["floor_name", "=", "Main Plant"]],
  );
  if (existing) return { status: "existing", ...existing };
  const created = await api("POST", `/api/resource/${encodeURIComponent("Plant Floor")}`, {
    floor_name: "Main Plant",
    company: "Bidsphere",
  });
  return { status: "created", ...created };
}

async function ensureSupplier() {
  const existing = await findOne(
    "Supplier",
    ["name", "supplier_name", "supplier_type", "supplier_group", "disabled"],
    [["supplier_name", "=", "Apex Fasteners Ltd"]],
  );
  if (existing) return { status: "existing", ...existing };
  return {
    status: "missing",
    name: "Apex Fasteners Ltd",
    note: "Verification only: supplier master records are never created by this setup script.",
  };
}

async function ensureItem() {
  const existing = await findOne(
    "Item",
    ["name", "item_code", "item_name", "item_group", "stock_uom", "disabled"],
    [["item_code", "=", "LAT-4401"]],
  );
  if (existing) return { status: "existing", ...existing };
  return {
    status: "missing",
    name: "LAT-4401",
    note: "Verification only: Item master records are never created by this setup script.",
  };
}

async function main() {
  const owner = await findOne(
    "User",
    ["name", "email", "full_name", "enabled"],
    [["email", "=", "engineer@netlink.com"]],
  );
  if (!owner) {
    throw new Error("User 'engineer@netlink.com' does not exist; no user was created.");
  }

  const results = {
    ownerField: await ensureEcrOwnerTargetsUser(),
    legacyAmendedFrom: await repairLegacyAmendedFrom(),
    workflowStateOptions: await alignWorkflowStateOptions(),
    user: { status: "existing", ...owner },
    department: await ensureDepartment(),
    plant: await ensurePlant(),
    supplier: await ensureSupplier(),
    item: await ensureItem(),
  };

  console.log(JSON.stringify(results, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
