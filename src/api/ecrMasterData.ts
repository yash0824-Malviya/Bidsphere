import { apiGet } from "./erpnext";

export type ECRMasterKind =
  | "owner"
  | "department"
  | "plant"
  | "supplier"
  | "item";

export interface ECRMasterOption {
  value: string;
  label: string;
  description?: string;
}

interface MasterRow {
  name: string;
  email?: string;
  full_name?: string;
  enabled?: 0 | 1;
  department_name?: string;
  company?: string;
  floor_name?: string;
  warehouse?: string;
  supplier_name?: string;
  disabled?: 0 | 1;
  item_code?: string;
  item_name?: string;
  stock_uom?: string;
}

interface MasterSpec {
  doctype: string;
  fields: string[];
  searchFields: string[];
  displayFields: string[];
  filters: Array<[string, "=", string | number]>;
  orderBy: string;
}

const MASTER_SPECS: Record<ECRMasterKind, MasterSpec> = {
  owner: {
    doctype: "User",
    fields: ["name", "email", "full_name", "enabled"],
    searchFields: ["name", "email", "full_name"],
    displayFields: ["name", "email", "full_name"],
    filters: [["enabled", "=", 1]],
    orderBy: "full_name asc",
  },
  department: {
    doctype: "Department",
    fields: ["name", "department_name", "company"],
    searchFields: ["name", "department_name"],
    displayFields: ["name", "department_name"],
    filters: [],
    orderBy: "department_name asc",
  },
  plant: {
    doctype: "Plant Floor",
    fields: ["name", "floor_name", "company", "warehouse"],
    searchFields: ["name", "floor_name"],
    displayFields: ["name", "floor_name"],
    filters: [],
    orderBy: "floor_name asc",
  },
  supplier: {
    doctype: "Supplier",
    fields: ["name", "supplier_name", "disabled"],
    searchFields: ["name", "supplier_name"],
    displayFields: ["name", "supplier_name"],
    filters: [["disabled", "=", 0]],
    orderBy: "supplier_name asc",
  },
  item: {
    doctype: "Item",
    fields: ["name", "item_code", "item_name", "stock_uom", "disabled"],
    searchFields: ["name", "item_code", "item_name"],
    displayFields: ["name", "item_code", "item_name"],
    filters: [["disabled", "=", 0]],
    orderBy: "item_code asc",
  },
};

function optionFromRow(kind: ECRMasterKind, row: MasterRow): ECRMasterOption {
  switch (kind) {
    case "owner":
      return {
        value: row.name,
        label: row.email || row.name,
        description: row.full_name?.trim() || undefined,
      };
    case "department":
      return {
        value: row.name,
        label: row.department_name || row.name,
        description: [row.company, row.name !== row.department_name ? row.name : ""]
          .filter(Boolean)
          .join(" · ") || undefined,
      };
    case "plant":
      return {
        value: row.name,
        label: row.floor_name || row.name,
        description: [row.company, row.warehouse].filter(Boolean).join(" · ") || undefined,
      };
    case "supplier":
      return {
        value: row.name,
        label: row.supplier_name || row.name,
        description: row.name !== row.supplier_name ? row.name : undefined,
      };
    case "item":
      return {
        value: row.name,
        label: row.item_code || row.name,
        description: [row.item_name, row.stock_uom].filter(Boolean).join(" · ") || undefined,
      };
  }
}

async function listMasterRows(
  kind: ECRMasterKind,
  query: string,
  exact: boolean,
): Promise<MasterRow[]> {
  const spec = MASTER_SPECS[kind];
  const trimmed = query.trim();
  const candidates = trimmed.includes("@")
    ? [...new Set([trimmed, trimmed.toLowerCase()])]
    : [trimmed];
  const orFilters = trimmed
    ? spec.searchFields.flatMap((field) =>
        candidates.map((candidate) => [
          field,
          exact ? "=" : "like",
          exact ? candidate : `%${candidate}%`,
        ]),
      )
    : undefined;

  return apiGet<MasterRow[]>(`/api/resource/${encodeURIComponent(spec.doctype)}`, {
    params: {
      fields: JSON.stringify(spec.fields),
      filters: JSON.stringify(spec.filters),
      ...(orFilters ? { or_filters: JSON.stringify(orFilters) } : {}),
      limit_page_length: exact ? 50 : 20,
      order_by: spec.orderBy,
    },
  });
}

export async function searchECRMasterOptions(
  kind: ECRMasterKind,
  query: string,
): Promise<ECRMasterOption[]> {
  const rows = await listMasterRows(kind, query, false);
  return rows.map((row) => optionFromRow(kind, row));
}

export async function resolveECRMasterReference(
  kind: ECRMasterKind,
  input: string,
): Promise<ECRMasterOption | null> {
  const value = input.trim();
  if (!value) return null;

  const spec = MASTER_SPECS[kind];
  const rows = await listMasterRows(kind, value, true);
  const lowered = value.toLowerCase();
  const canonical = rows.find((row) => row.name.toLowerCase() === lowered);
  if (canonical) return optionFromRow(kind, canonical);

  const displayMatches = rows.filter((row) =>
    spec.displayFields.some((field) => {
      const candidate = row[field as keyof MasterRow];
      return typeof candidate === "string" && candidate.trim().toLowerCase() === lowered;
    }),
  );
  return displayMatches.length === 1
    ? optionFromRow(kind, displayMatches[0])
    : null;
}

export function ecrMasterReferenceError(
  kind: ECRMasterKind,
  value: string,
  rowIndex?: number,
): string {
  switch (kind) {
    case "owner":
      return `ECR Owner '${value}' does not exist. Please select a valid user.`;
    case "department":
      return `Requesting Department '${value}' does not exist. Please select a valid department.`;
    case "plant":
      return `Plant '${value}' does not exist. Please select a valid plant.`;
    case "supplier":
      return `Suggested Supplier '${value}' does not exist. Please select a valid supplier.`;
    case "item":
      return `Row #${(rowIndex ?? 0) + 1}: Part/Item '${value}' does not exist. Please select a valid item.`;
  }
}

export interface ECRReferenceValidationInput {
  owner: string;
  department: string;
  plant: string;
  supplier?: string;
  parts: Array<{ partitem?: string }>;
}

export interface ECRReferenceValidationResult {
  errors: Record<string, string>;
  canonical: {
    owner?: string;
    department?: string;
    plant?: string;
    supplier?: string;
    parts: Array<string | undefined>;
  };
  validFields: string[];
}

export async function validateECRMasterReferences(
  input: ECRReferenceValidationInput,
): Promise<ECRReferenceValidationResult> {
  const checks: Array<{
    key: string;
    kind: ECRMasterKind;
    value: string;
    rowIndex?: number;
  }> = [
    { key: "ecr_owner", kind: "owner", value: input.owner },
    { key: "requesting_department", kind: "department", value: input.department },
    { key: "plant", kind: "plant", value: input.plant },
  ];

  if (input.supplier?.trim()) {
    checks.push({ key: "suggested_supplier", kind: "supplier", value: input.supplier });
  }
  input.parts.forEach((part, rowIndex) => {
    if (part.partitem?.trim()) {
      checks.push({
        key: `partitem.${rowIndex}`,
        kind: "item",
        value: part.partitem,
        rowIndex,
      });
    }
  });

  const settled = await Promise.allSettled(
    checks.map((check) => resolveECRMasterReference(check.kind, check.value)),
  );
  const errors: Record<string, string> = {};
  const validFields: string[] = [];
  const canonical: ECRReferenceValidationResult["canonical"] = {
    parts: input.parts.map(() => undefined),
  };

  settled.forEach((result, index) => {
    const check = checks[index];
    if (result.status === "rejected") {
      errors[check.key] = `Unable to validate ${check.kind} master data. Please try again.`;
      return;
    }
    if (!result.value) {
      errors[check.key] = ecrMasterReferenceError(
        check.kind,
        check.value,
        check.rowIndex,
      );
      return;
    }

    validFields.push(check.key);
    if (check.kind === "owner") canonical.owner = result.value.value;
    if (check.kind === "department") canonical.department = result.value.value;
    if (check.kind === "plant") canonical.plant = result.value.value;
    if (check.kind === "supplier") canonical.supplier = result.value.value;
    if (check.kind === "item" && check.rowIndex !== undefined) {
      canonical.parts[check.rowIndex] = result.value.value;
    }
  });

  return { errors, canonical, validFields };
}
