export type ProcurementReadDoctype = "Request for Quotation" | "Purchase Order";

export const READ_ONLY_GENERIC_DOCUMENT_METHODS = [
  "method/frappe.client.get",
  "method/frappe.client.get_list",
  "method/frappe.client.get_value",
  "method/frappe.client.get_count",
] as const;

export function isReadOnlyGenericDocumentMethod(path: string): boolean {
  return (READ_ONLY_GENERIC_DOCUMENT_METHODS as readonly string[]).includes(path);
}

const SUPPLIER_SAFE_LIST_FIELDS: Record<ProcurementReadDoctype, readonly string[]> = {
  "Request for Quotation": [
    "name",
    "status",
    "modified",
    "docstatus",
    "company",
    "transaction_date",
    "message_for_supplier",
    "valid_till",
    "custom_valid_till",
    "custom_quote_valid_till",
    "quote_valid_till",
    "closing_date",
    "custom_closing_date",
    "custom_due_date",
    "due_date",
  ],
  "Purchase Order": [
    "name",
    "supplier",
    "supplier_name",
    "transaction_date",
    "schedule_date",
    "grand_total",
    "currency",
    "status",
    "per_received",
    "docstatus",
    "modified",
  ],
};

function parseFieldNames(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value !== "string" || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.map(String) : [value];
  } catch {
    return value.split(",").map((field) => field.trim()).filter(Boolean);
  }
}

export function supplierSafeProcurementFields(
  doctype: ProcurementReadDoctype,
  requested: unknown,
): string[] {
  const allowed = new Set(SUPPLIER_SAFE_LIST_FIELDS[doctype]);
  const requestedFields = parseFieldNames(requested);
  const safe = requestedFields.filter((field) => allowed.has(field));
  return safe.length > 0 ? [...new Set(safe)] : ["name"];
}

function canonicalSupplier(value: unknown): string {
  let result = String(value ?? "").trim();
  while (
    result.length >= 2 &&
    ((result.startsWith('"') && result.endsWith('"')) ||
      (result.startsWith("'") && result.endsWith("'")))
  ) {
    result = result.slice(1, -1).trim();
  }
  return result.toLocaleLowerCase();
}

function parseFilters(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value === "string" && value.trim()) {
    try {
      const parsed = JSON.parse(value) as unknown;
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function filterField(row: unknown[]): string {
  return String(row.length >= 4 ? row[1] : row[0] ?? "").trim();
}

/** Replace caller-controlled tenant/status filters with server-owned ones. */
export function supplierScopedProcurementFilters(
  doctype: ProcurementReadDoctype,
  supplier: string,
  existing: unknown,
): unknown[] {
  const controlled = new Set(["supplier", "docstatus", "status"]);
  const retained = parseFilters(existing).filter(
    (row) => !Array.isArray(row) || !controlled.has(filterField(row)),
  );
  if (doctype === "Request for Quotation") {
    return [
      ...retained,
      ["Request for Quotation Supplier", "supplier", "=", supplier],
      ["docstatus", "=", 1],
      ["status", "not in", ["Cancelled"]],
    ];
  }
  return [
    ...retained,
    ["supplier", "=", supplier],
    ["docstatus", "in", [0, 1]],
    ["status", "not in", ["Cancelled", "Closed"]],
  ];
}

export function supplierOwnsProcurementDocument(
  doctype: ProcurementReadDoctype,
  document: Record<string, unknown>,
  supplier: string,
): boolean {
  const expected = canonicalSupplier(supplier);
  if (!expected) return false;
  if (doctype === "Request for Quotation") {
    if (Number(document.docstatus) !== 1 || String(document.status || "").toLowerCase() === "cancelled") {
      return false;
    }
    const suppliers = Array.isArray(document.suppliers)
      ? document.suppliers as Array<Record<string, unknown>>
      : [];
    return suppliers.some((row) => canonicalSupplier(row.supplier) === expected);
  }
  return (
    [0, 1].includes(Number(document.docstatus)) &&
    !["cancelled", "closed"].includes(String(document.status || "").toLowerCase()) &&
    canonicalSupplier(document.supplier) === expected
  );
}

function truthyFlag(value: unknown): boolean {
  return value === true || value === 1 || value === "1" ||
    (typeof value === "string" && value.toLowerCase() === "true");
}

/** Remove internal trace data and any RFQ target price not explicitly shared. */
export function sanitizeSupplierProcurementDocument(
  doctype: ProcurementReadDoctype,
  document: Record<string, unknown>,
  supplier: string,
): Record<string, unknown> {
  if (doctype !== "Request for Quotation") return { ...document };

  const headerVisible = truthyFlag(document.custom_show_target_price_to_supplier) ||
    truthyFlag(document.show_target_price);
  const sourceItems = Array.isArray(document.items)
    ? document.items as Array<Record<string, unknown>>
    : [];
  const items = sourceItems.map((source) => {
    const item = { ...source };
    const visible = item.custom_show_target_price_to_supplier != null
      ? truthyFlag(item.custom_show_target_price_to_supplier)
      : item.show_target_price != null
        ? truthyFlag(item.show_target_price)
        : headerVisible;
    if (!visible) {
      delete item.custom_target_price;
      delete item.target_price;
    }
    item.custom_show_target_price_to_supplier = visible ? 1 : 0;
    item.show_target_price = visible;
    return item;
  });
  const anyVisible = items.some((item) => item.show_target_price === true);
  const suppliers = Array.isArray(document.suppliers)
    ? (document.suppliers as Array<Record<string, unknown>>).filter(
        (row) => canonicalSupplier(row.supplier) === canonicalSupplier(supplier),
      )
    : [];
  const sanitized = {
    ...document,
    items,
    suppliers,
    custom_show_target_price_to_supplier: anyVisible ? 1 : 0,
    show_target_price: anyVisible,
  };
  delete sanitized.custom_ecr_reference;
  delete sanitized.custom_purchase_requisition_reference;
  delete sanitized.custom_bidsphere_pr_idempotency_key;
  return sanitized;
}
