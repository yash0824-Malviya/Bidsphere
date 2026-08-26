/**
 * Adds source-of-truth procurement references to ECR without creating any
 * Supplier, RFQ, PO, or Item records. Safe to run repeatedly.
 *
 * Usage: node scripts/setup-ecr-procurement-references.mjs
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const envPath = resolve(root, ".env");
if (existsSync(envPath)) {
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
  const payload = text ? JSON.parse(text) : {};
  if (!response.ok) {
    throw new Error(`${method} ${path} failed (${response.status}): ${payload.message ?? payload.exception ?? text}`);
  }
  return payload.data ?? payload.message ?? payload;
}

const doctypeMetaCache = new Map();

async function findField(dt, fieldname) {
  const params = new URLSearchParams({
    fields: JSON.stringify([
      "name",
      "dt",
      "fieldname",
      "fieldtype",
      "options",
      "default",
      "hidden",
      "unique",
      "no_copy",
      "insert_after",
    ]),
    filters: JSON.stringify([
      ["dt", "=", dt],
      ["fieldname", "=", fieldname],
    ]),
    limit_page_length: "2",
  });
  const rows = await api("GET", `/api/resource/${encodeURIComponent("Custom Field")}?${params}`);
  if (rows[0]) return { ...rows[0], source: "Custom Field" };

  let meta = doctypeMetaCache.get(dt);
  if (!meta) {
    meta = await api("GET", `/api/resource/DocType/${encodeURIComponent(dt)}`);
    doctypeMetaCache.set(dt, meta);
  }
  const standardField = (meta.fields ?? []).find((field) => field.fieldname === fieldname);
  return standardField ? { ...standardField, source: "DocField" } : null;
}

async function ensureField(definition) {
  const existing = await findField(definition.dt, definition.fieldname);
  if (existing) {
    if (
      existing.fieldtype !== definition.fieldtype ||
      String(existing.options ?? "") !== String(definition.options ?? "") ||
      (definition.default !== undefined &&
        String(existing.default ?? "") !== String(definition.default ?? "")) ||
      (definition.hidden !== undefined &&
        Number(existing.hidden ?? 0) !== Number(definition.hidden)) ||
      (definition.unique !== undefined &&
        Number(existing.unique ?? 0) !== Number(definition.unique)) ||
      (definition.no_copy !== undefined &&
        Number(existing.no_copy ?? 0) !== Number(definition.no_copy))
    ) {
      throw new Error(
        `${definition.dt}.${definition.fieldname} exists with an incompatible definition.`,
      );
    }
    return {
      status: "existing",
      name: existing.name,
      source: existing.source,
      fieldname: definition.fieldname,
    };
  }

  const created = await api("POST", "/api/resource/Custom Field", {
    in_standard_filter: 1,
    ...definition,
  });
  return { status: "created", name: created.name, fieldname: definition.fieldname };
}

const definitions = [
  {
    dt: "Engineering Change Request",
    fieldname: "procurement_reference_type",
    label: "Existing Procurement Reference Type",
    fieldtype: "Select",
    options: "None\nRFQ\nPurchase Order",
    default: "None",
    insert_after: "suggested_supplier",
  },
  {
    dt: "Engineering Change Request",
    fieldname: "existing_rfq_reference",
    label: "Existing RFQ Reference",
    fieldtype: "Link",
    options: "Request for Quotation",
    insert_after: "procurement_reference_type",
  },
  {
    dt: "Engineering Change Request",
    fieldname: "existing_purchase_order_reference",
    label: "Existing Purchase Order Reference",
    fieldtype: "Link",
    options: "Purchase Order",
    insert_after: "existing_rfq_reference",
  },
  {
    dt: "ECR Affected Part",
    fieldname: "source_reference_type",
    label: "Source Reference Type",
    fieldtype: "Select",
    options: "RFQ\nPurchase Order",
    insert_after: "technical_notes",
    hidden: 1,
  },
  {
    dt: "ECR Affected Part",
    fieldname: "source_document_reference",
    label: "Source Document Reference",
    fieldtype: "Data",
    options: "",
    insert_after: "source_reference_type",
    hidden: 1,
  },
  {
    dt: "ECR Affected Part",
    fieldname: "source_item_reference",
    label: "Source Item Row Reference",
    fieldtype: "Data",
    options: "",
    insert_after: "source_document_reference",
    hidden: 1,
  },
  {
    dt: "Purchase Requisition",
    fieldname: "custom_bidsphere_ecr_idempotency_key",
    label: "BidSphere ECR Idempotency Key",
    fieldtype: "Data",
    options: "",
    insert_after: "ecr_reference",
    hidden: 1,
    unique: 1,
    no_copy: 1,
  },
  {
    dt: "Request for Quotation",
    fieldname: "custom_ecr_reference",
    label: "ECR Reference",
    fieldtype: "Link",
    options: "Engineering Change Request",
    insert_after: "",
  },
  {
    dt: "Request for Quotation",
    fieldname: "custom_bidsphere_ecr_idempotency_key",
    label: "BidSphere ECR Idempotency Key",
    fieldtype: "Data",
    options: "",
    insert_after: "custom_ecr_reference",
    hidden: 1,
    unique: 1,
    no_copy: 1,
  },
  {
    dt: "Request for Quotation",
    fieldname: "custom_purchase_requisition_reference",
    label: "Purchase Requisition Reference",
    fieldtype: "Link",
    options: "Purchase Requisition",
    insert_after: "custom_bidsphere_ecr_idempotency_key",
  },
  {
    dt: "Request for Quotation",
    fieldname: "custom_bidsphere_pr_idempotency_key",
    label: "BidSphere PR Idempotency Key",
    fieldtype: "Data",
    options: "",
    insert_after: "custom_purchase_requisition_reference",
    hidden: 1,
    unique: 1,
    no_copy: 1,
  },
];

const results = [];
for (const definition of definitions) {
  results.push(await ensureField(definition));
}

console.log(JSON.stringify({
  results,
  note: "No Supplier, RFQ, Purchase Order, or Item records were created.",
}, null, 2));
