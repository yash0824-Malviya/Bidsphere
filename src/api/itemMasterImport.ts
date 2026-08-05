/**
 * Enterprise Item Master import (Excel / CSV → ERPNext Item DocType).
 *
 * Primary purpose: create NEW Item Master records.
 * Existing codes support Skip / Update / Overwrite modes.
 * ERPNext Item remains the single source of truth.
 */
import * as XLSX from "xlsx";
import type { AxiosError } from "axios";

import {
  apiGet,
  apiPost,
  apiPut,
  buildListConfig,
  buildResourceUrl,
  withSilent,
} from "./erpnext";
import {
  listItemCodes,
  persistItemProcurementFields,
  type CreateItemMasterInput,
} from "./itemMaster";
import {
  ITEM_LIFECYCLE_STATUS_FIELD,
  ITEM_PROCUREMENT_CATEGORY_FIELD,
  ITEM_PROCUREMENT_TYPE_FIELD,
  normalizeItemLifecycleStatus,
  type ItemLifecycleStatus,
} from "../types/itemMaster";
import type { MaterialRequestProcurementType } from "../types/materialRequestWorkflow";
import { matchErpLabel } from "../utils/erpLabelMatch";
import {
  PROCUREMENT_CATEGORY_MASTER,
  isProcurementCategory,
  normalizeProcurementCategoryValue,
  procurementCategoryBelongsToType,
  procurementTypeForCategory,
} from "../config/procurementCategory";
import { isHsnMandatoryError } from "./inventory";
import {
  isValidImportUom,
  normalizeToEnterpriseUom,
} from "../config/uomMaster";

const ITEM_DOCTYPE = "Item";
const LOG_TAG = "[ItemMasterImport]";
export const ITEM_IMPORT_MAX_ROWS = 5000;

export const ITEM_IMPORT_HEADERS = [
  "Item Code",
  "Item Name",
  "Description",
  "Procurement Type",
  "Procurement Category",
  "Item Group",
  "UOM",
  "Item Type",
  "Reorder Level",
  "Default Warehouse",
  "Stock Item",
  "Brand",
  "Manufacturer",
  "Status",
] as const;

/** How to handle Item Codes that already exist in ERPNext. */
export type ItemImportExistingMode = "skip" | "update" | "overwrite";

export const ITEM_IMPORT_EXISTING_MODES: ItemImportExistingMode[] = [
  "skip",
  "update",
  "overwrite",
];

/**
 * Row outcomes:
 * - created — new ERP Item
 * - updated — existing Item patched / overwritten
 * - skipped — duplicate / skip-existing mode
 * - failed — validation or system error
 */
export type ItemImportOutcome = "created" | "updated" | "skipped" | "failed";

export interface ItemImportParsedRow {
  rowNumber: number;
  item_code: string;
  item_name: string;
  description: string;
  procurement_type: string;
  procurement_category: string;
  item_group: string;
  stock_uom: string;
  item_type: string;
  reorder_level: string;
  default_warehouse: string;
  stock_item: string;
  brand: string;
  manufacturer: string;
  status: string;
  raw: Record<string, string>;
}

export interface ItemImportPayload extends CreateItemMasterInput {
  /** True when Item Group must be created in ERP before write. */
  ensure_item_group?: boolean;
  /** True when Procurement Category must be added to ERP Select options. */
  ensure_procurement_category?: boolean;
  /** True when UOM must be created in ERP before write. */
  ensure_uom?: boolean;
  /** True when Brand must be created in ERP before write. */
  ensure_brand?: boolean;
  /** True when Manufacturer must be created in ERP before write. */
  ensure_manufacturer?: boolean;
}

export interface ItemImportRowResult {
  rowNumber: number;
  outcome: ItemImportOutcome;
  item_code: string;
  item_name: string;
  error?: string;
  suggestion?: string;
  raw: Record<string, string>;
}

export interface ItemImportMasterStats {
  categoriesCreated: number;
  itemGroupsCreated: number;
  brandsCreated: number;
  manufacturersCreated: number;
  uomsCreated: number;
  /** Unique names created (for audit / UI detail). */
  categoryNames: string[];
  itemGroupNames: string[];
  brandNames: string[];
  manufacturerNames: string[];
  uomNames: string[];
}

export interface ItemImportSummary {
  fileName: string;
  importedBy: string;
  importedAt: string;
  existingMode: ItemImportExistingMode;
  totalRows: number;
  created: number;
  updated: number;
  skipped: number;
  failed: number;
  masters: ItemImportMasterStats;
  /** @deprecated use `created` — kept for callers expecting legacy field */
  imported: number;
  /** @deprecated validation failures now count as `failed` */
  needsReview: number;
  results: ItemImportRowResult[];
}

export interface ItemImportProgress {
  processed: number;
  total: number;
  created: number;
  updated: number;
  skipped: number;
  failed: number;
  masters: ItemImportMasterStats;
  currentItemCode?: string;
}

export interface ItemImportOptions {
  rows: ItemImportParsedRow[];
  fileName: string;
  importedBy: string;
  /** Default: skip */
  existingMode?: ItemImportExistingMode;
  /**
   * Auto-create missing Item Groups, Procurement Categories, Brands,
   * Manufacturers. Default true (always recommended for enterprise import).
   */
  autoCreateMasters?: boolean;
  /** Auto-create missing UOMs. Default true. */
  autoCreateUom?: boolean;
  context?: ItemImportContext;
  concurrency?: number;
  onProgress?: (progress: ItemImportProgress) => void;
}

export interface ItemImportContext {
  existingCodes: Set<string>;
  procurementTypes: string[];
  procurementCategories: string[];
  itemGroups: string[];
  warehouses: string[];
  uoms: string[];
  brands: string[];
  manufacturers: string[];
  masters: ItemImportMasterStats;
}

function emptyMasterStats(): ItemImportMasterStats {
  return {
    categoriesCreated: 0,
    itemGroupsCreated: 0,
    brandsCreated: 0,
    manufacturersCreated: 0,
    uomsCreated: 0,
    categoryNames: [],
    itemGroupNames: [],
    brandNames: [],
    manufacturerNames: [],
    uomNames: [],
  };
}

function trackMasterCreated(
  stats: ItemImportMasterStats,
  kind: keyof Pick<
    ItemImportMasterStats,
    | "categoriesCreated"
    | "itemGroupsCreated"
    | "brandsCreated"
    | "manufacturersCreated"
    | "uomsCreated"
  >,
  name: string,
  namesKey: keyof Pick<
    ItemImportMasterStats,
    | "categoryNames"
    | "itemGroupNames"
    | "brandNames"
    | "manufacturerNames"
    | "uomNames"
  >,
): void {
  const list = stats[namesKey] as string[];
  if (list.some((n) => n.toLowerCase() === name.toLowerCase())) return;
  list.push(name);
  stats[kind] = list.length;
}

export function itemImportOutcomeLabel(outcome: ItemImportOutcome): string {
  switch (outcome) {
    case "created":
      return "Created";
    case "updated":
      return "Updated";
    case "skipped":
      return "Skipped";
    case "failed":
      return "Failed";
  }
}

export function itemImportExistingModeLabel(mode: ItemImportExistingMode): string {
  switch (mode) {
    case "skip":
      return "Skip Existing";
    case "update":
      return "Update Existing";
    case "overwrite":
      return "Overwrite Existing";
  }
}

const HEADER_ALIASES: Record<
  string,
  keyof Omit<ItemImportParsedRow, "rowNumber" | "raw">
> = {
  "item code": "item_code",
  item_code: "item_code",
  itemcode: "item_code",
  "item name": "item_name",
  item_name: "item_name",
  itemname: "item_name",
  description: "description",
  "procurement type": "procurement_type",
  procurement_type: "procurement_type",
  "request type": "procurement_type",
  "procurement category": "procurement_category",
  procurement_category: "procurement_category",
  category: "procurement_category",
  "item group": "item_group",
  item_group: "item_group",
  uom: "stock_uom",
  "stock uom": "stock_uom",
  stock_uom: "stock_uom",
  "item type": "item_type",
  item_type: "item_type",
  "reorder level": "reorder_level",
  reorder_level: "reorder_level",
  "safety stock": "reorder_level",
  "default warehouse": "default_warehouse",
  default_warehouse: "default_warehouse",
  warehouse: "default_warehouse",
  "stock item": "stock_item",
  stock_item: "stock_item",
  "is stock item": "stock_item",
  brand: "brand",
  manufacturer: "manufacturer",
  status: "status",
  "item status": "status",
  "lifecycle status": "status",
};

function cellString(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return String(value).trim();
}

function normalizeHeader(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function errorMessage(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  const axiosErr = err as AxiosError<{ message?: string; exception?: string }>;
  const data = axiosErr?.response?.data;
  if (data && typeof data === "object") {
    const msg =
      (typeof data.message === "string" && data.message) ||
      (typeof data.exception === "string" && data.exception) ||
      "";
    if (msg) return msg;
    try {
      return JSON.stringify(data);
    } catch {
      /* fall through */
    }
  }
  return String(err ?? "Unknown error");
}

function isDuplicateItemError(err: unknown): boolean {
  const msg = errorMessage(err);
  return /duplicate|already exists|DuplicateEntryError/i.test(msg);
}

function parseStockItemFlag(
  stockItemRaw: string,
  itemTypeRaw: string,
): boolean {
  const stock = stockItemRaw.trim().toLowerCase();
  if (stock) {
    if (["0", "no", "n", "false", "non-stock", "non stock"].includes(stock)) {
      return false;
    }
    if (["1", "yes", "y", "true", "stock"].includes(stock)) {
      return true;
    }
  }
  const type = itemTypeRaw.trim().toLowerCase();
  if (
    type === "non-stock" ||
    type === "non stock" ||
    type === "service" ||
    type === "nonstock"
  ) {
    return false;
  }
  return true;
}

/** Export current Item Master rows to Excel. */
export function downloadItemMasterExport(
  rows: Array<{
    item_code: string;
    item_name: string;
    procurement_type?: string;
    procurement_category?: string;
    item_group?: string;
    stock_uom?: string;
    description?: string;
    reorder_level?: number;
    default_warehouse?: string;
    warehouse?: string;
    current_stock?: number;
    available_qty?: number;
    lifecycle_status?: string;
    brand?: string;
    manufacturer?: string;
    is_stock_item?: boolean;
  }>,
  fileName = `Item_Master_Export_${new Date().toISOString().slice(0, 10)}.xlsx`,
): void {
  const data = rows.map((r) => ({
    "Item Code": r.item_code,
    "Item Name": r.item_name,
    Description: r.description || "",
    "Procurement Type": r.procurement_type || "",
    "Procurement Category": r.procurement_category || "",
    "Item Group": r.item_group || "",
    UOM: r.stock_uom || "",
    "Item Type": r.is_stock_item === false ? "Non-Stock" : "Stock",
    "Reorder Level": r.reorder_level ?? "",
    "Default Warehouse": r.default_warehouse || r.warehouse || "",
    "Stock Item": r.is_stock_item === false ? "No" : "Yes",
    Brand: r.brand || "",
    Manufacturer: r.manufacturer || "",
    Status: r.lifecycle_status || "",
    "Current Stock": r.current_stock ?? "",
    "Available Qty": r.available_qty ?? "",
  }));
  const sheet = XLSX.utils.json_to_sheet(
    data.length
      ? data
      : [
          {
            "Item Code": "",
            "Item Name": "",
            Description: "",
            "Procurement Type": "",
            "Procurement Category": "",
            "Item Group": "",
            UOM: "",
            "Item Type": "",
            "Reorder Level": "",
            "Default Warehouse": "",
            "Stock Item": "",
            Brand: "",
            Manufacturer: "",
            Status: "",
          },
        ],
  );
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, "Item Master");
  const buffer = XLSX.write(book, { bookType: "xlsx", type: "array" });
  downloadBlob(
    new Blob([buffer], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
    fileName,
  );
}

/** Download a sample Excel template for Item Master import. */
export function downloadItemImportTemplate(): void {
  const sample = [
    {
      "Item Code": "AB001",
      "Item Name": "Bumper",
      Description: "Front bumper assembly",
      "Procurement Type": "Direct",
      "Procurement Category": "Production",
      "Item Group": "Auto Parts",
      UOM: "Nos",
      "Item Type": "Stock",
      "Reorder Level": 10,
      "Default Warehouse": "",
      "Stock Item": "Yes",
      Brand: "",
      Manufacturer: "",
      Status: "Active",
    },
    {
      "Item Code": "HK001",
      "Item Name": "Hand Wash",
      Description: "Liquid hand wash",
      "Procurement Type": "Indirect",
      "Procurement Category": "Housekeeping",
      "Item Group": "Housekeeping",
      UOM: "Ltr",
      "Item Type": "Stock",
      "Reorder Level": 5,
      "Default Warehouse": "",
      "Stock Item": "Yes",
      Brand: "",
      Manufacturer: "",
      Status: "Active",
    },
  ];
  const sheet = XLSX.utils.json_to_sheet(sample, {
    header: [...ITEM_IMPORT_HEADERS],
  });
  sheet["!cols"] = ITEM_IMPORT_HEADERS.map((h) => ({
    wch: Math.max(14, h.length + 2),
  }));
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, "Items");
  const buffer = XLSX.write(book, { bookType: "xlsx", type: "array" });
  downloadBlob(
    new Blob([buffer], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
    "BidSphere_Item_Master_Import_Template.xlsx",
  );
}

/** Export Failed / Skipped rows with issue + suggestion. */
export function downloadItemImportErrorReport(
  results: ItemImportRowResult[],
  fileName = "Item_Master_Import_Errors.xlsx",
): void {
  const issueRows = results.filter((r) => r.outcome !== "created" && r.outcome !== "updated");
  const rows = issueRows.map((r) => ({
    "Row #": r.rowNumber,
    Outcome: itemImportOutcomeLabel(r.outcome),
    "Item Code": r.item_code,
    "Item Name": r.item_name,
    Issue: r.error ?? "",
    Suggestion: r.suggestion ?? "",
    ...r.raw,
  }));
  const sheet = XLSX.utils.json_to_sheet(
    rows.length
      ? rows
      : [
          {
            "Row #": "",
            Outcome: "",
            "Item Code": "",
            "Item Name": "",
            Issue: "No rows with issues",
            Suggestion: "",
          },
        ],
  );
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, "Issues");
  const buffer = XLSX.write(book, { bookType: "xlsx", type: "array" });
  downloadBlob(
    new Blob([buffer], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
    fileName,
  );
}

type ValidationFail = {
  ok: false;
  outcome: "skipped" | "failed";
  error: string;
  suggestion: string;
};

type ValidationOk = {
  ok: true;
  action: "create" | "update";
  input: ItemImportPayload;
};

function failed(error: string, suggestion: string): ValidationFail {
  return { ok: false, outcome: "failed", error, suggestion };
}

function skipped(error: string, suggestion: string): ValidationFail {
  return { ok: false, outcome: "skipped", error, suggestion };
}

function mapSheetRows(matrix: unknown[][]): ItemImportParsedRow[] {
  if (matrix.length < 2) return [];
  const headerCells = (matrix[0] ?? []).map((c) => cellString(c));
  const columnMap: Array<{
    index: number;
    key: keyof Omit<ItemImportParsedRow, "rowNumber" | "raw">;
  }> = [];

  headerCells.forEach((header, index) => {
    const key = HEADER_ALIASES[normalizeHeader(header)];
    if (key) columnMap.push({ index, key });
  });

  if (!columnMap.some((c) => c.key === "item_code")) {
    throw new Error(
      'Import file must include an "Item Code" column. Download the sample template and try again.',
    );
  }
  if (!columnMap.some((c) => c.key === "item_name")) {
    throw new Error(
      'Import file must include an "Item Name" column. Download the sample template and try again.',
    );
  }

  const rows: ItemImportParsedRow[] = [];
  for (let i = 1; i < matrix.length; i++) {
    const cells = matrix[i] ?? [];
    const isEmpty = cells.every((c) => !cellString(c));
    if (isEmpty) continue;

    const raw: Record<string, string> = {};
    headerCells.forEach((h, idx) => {
      if (h) raw[h] = cellString(cells[idx]);
    });

    const parsed: ItemImportParsedRow = {
      rowNumber: i + 1,
      item_code: "",
      item_name: "",
      description: "",
      procurement_type: "",
      procurement_category: "",
      item_group: "",
      stock_uom: "",
      item_type: "",
      reorder_level: "",
      default_warehouse: "",
      stock_item: "",
      brand: "",
      manufacturer: "",
      status: "Active",
      raw,
    };

    for (const col of columnMap) {
      parsed[col.key] = cellString(cells[col.index]);
    }
    if (!parsed.status) parsed.status = "Active";
    rows.push(parsed);
  }
  return rows;
}

/** Parse Excel (.xlsx) or CSV into normalized import rows. */
export async function parseItemImportFile(
  file: File,
): Promise<ItemImportParsedRow[]> {
  const lower = file.name.toLowerCase();
  if (!/\.(xlsx|xls|csv)$/i.test(lower)) {
    throw new Error("Unsupported file type. Upload an .xlsx or .csv file.");
  }

  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: "array", raw: false });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw new Error("The file has no worksheets.");
  const sheet = workbook.Sheets[sheetName];
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    defval: "",
    blankrows: false,
  });
  return mapSheetRows(matrix);
}

export function validateItemImportRow(
  row: ItemImportParsedRow,
  ctx: {
    codesInFile: Set<string>;
    existingCodes: Set<string>;
    procurementTypes: readonly string[];
    procurementCategories: readonly string[];
    itemGroups: readonly string[];
    warehouses: readonly string[];
    uoms: readonly string[];
    brands?: readonly string[];
    manufacturers?: readonly string[];
    existingMode: ItemImportExistingMode;
    /** Always auto-create Category / Item Group / Brand / Manufacturer when true. */
    autoCreateMasters: boolean;
    autoCreateUom: boolean;
  },
): ValidationOk | ValidationFail {
  const code = row.item_code.trim();
  const name = row.item_name.trim();
  if (!code) {
    return failed(
      "Item Code is required.",
      "Enter a unique Item Code in the Excel row and re-import.",
    );
  }
  if (!name) {
    return failed(
      "Item Name is required.",
      "Enter an Item Name in the Excel row and re-import.",
    );
  }

  const codeKey = code.toLowerCase();
  if (ctx.codesInFile.has(codeKey)) {
    return skipped(
      `Duplicate Item Code "${code}" in the import file.`,
      "Keep only one row for this Item Code in the Excel file.",
    );
  }

  const existsInErp = ctx.existingCodes.has(codeKey);
  if (existsInErp && ctx.existingMode === "skip") {
    return skipped(
      `Item Code "${code}" already exists in ERPNext Item Master.`,
      'Choose "Update Existing" or "Overwrite Existing" to modify this item, or use a new Item Code.',
    );
  }

  const typeRaw = row.procurement_type.trim();
  if (!typeRaw) {
    return failed(
      "Procurement Type is required.",
      'Set Procurement Type to "Direct" or "Indirect".',
    );
  }
  const typeCandidates =
    ctx.procurementTypes.length > 0
      ? ctx.procurementTypes
      : ["Direct", "Indirect"];
  const typeMatch = matchErpLabel(typeRaw, typeCandidates);
  if (!typeMatch.ok) {
    return failed(
      `Invalid Procurement Type "${typeRaw}".`,
      'Use "Direct" or "Indirect".',
    );
  }
  const typeNorm = typeMatch.value as MaterialRequestProcurementType;
  if (typeNorm !== "Direct" && typeNorm !== "Indirect") {
    return failed(
      `Invalid Procurement Type "${typeRaw}".`,
      'Use "Direct" or "Indirect".',
    );
  }

  const categoryRaw = row.procurement_category.trim();
  if (!categoryRaw) {
    return failed(
      "Procurement Category is required.",
      "Enter a Procurement Category for the selected Procurement Type.",
    );
  }

  // Prefer typed master / legacy migration; otherwise keep Excel label.
  const migratedCategory =
    normalizeProcurementCategoryValue(categoryRaw) || categoryRaw;
  const typedCanonical =
    isProcurementCategory(migratedCategory)
      ? migratedCategory
      : PROCUREMENT_CATEGORY_MASTER.find(
          (c) => c.toLowerCase() === migratedCategory.toLowerCase(),
        ) ?? "";

  let category = typedCanonical || migratedCategory;
  let ensureCategory = false;

  if (ctx.procurementCategories.length > 0) {
    const categoryMatch = matchErpLabel(category, ctx.procurementCategories);
    if (categoryMatch.ok) {
      category = categoryMatch.value;
    } else {
      // Missing category → always auto-create (never fail the row for this).
      ensureCategory = true;
      if (typedCanonical) category = typedCanonical;
    }
  } else {
    ensureCategory = true;
    if (typedCanonical) category = typedCanonical;
  }

  // Known typed categories must match the selected Procurement Type.
  if (
    typedCanonical &&
    !procurementCategoryBelongsToType(category, typeNorm)
  ) {
    const categoryType = procurementTypeForCategory(category);
    return failed(
      `Procurement Category "${category}" is not valid for ${typeNorm} items.`,
      categoryType
        ? `Change Procurement Type to ${categoryType}, or pick a ${typeNorm} category.`
        : `Select a category that belongs to Procurement Type ${typeNorm}.`,
    );
  }

  const itemGroupRaw = row.item_group.trim();
  if (!itemGroupRaw) {
    return failed(
      "Item Group is required.",
      "Enter an Item Group (missing groups are created automatically in ERPNext).",
    );
  }
  let itemGroup = itemGroupRaw;
  let ensureGroup = false;
  if (ctx.itemGroups.length > 0) {
    const groupMatch = matchErpLabel(itemGroupRaw, ctx.itemGroups);
    if (groupMatch.ok) {
      itemGroup = groupMatch.value;
    } else {
      // Missing Item Group → always auto-create.
      ensureGroup = true;
    }
  } else {
    ensureGroup = true;
  }

  const uomRaw = row.stock_uom.trim();
  if (!uomRaw) {
    return failed(
      "UOM is required.",
      "Enter a Unit of Measure from the enterprise UOM master (e.g. Nos, Kg, Ltr).",
    );
  }
  // Only enterprise master values (and aliases) are accepted on import.
  const enterpriseUom = normalizeToEnterpriseUom(uomRaw);
  if (!enterpriseUom || !isValidImportUom(uomRaw)) {
    return failed(
      `UOM "${uomRaw}" is not a valid enterprise UOM.`,
      "Use a UOM from the BidSphere master (Nos, Kg, Ltr, Mtr, Box, …).",
    );
  }
  let uom = enterpriseUom;
  let ensureUom = false;
  if (ctx.uoms.length > 0) {
    const uomMatch = matchErpLabel(enterpriseUom, ctx.uoms);
    if (uomMatch.ok) {
      uom = uomMatch.value;
    } else if (ctx.autoCreateUom) {
      uom = enterpriseUom;
      ensureUom = true;
    } else {
      return failed(
        `UOM "${enterpriseUom}" does not exist in ERPNext.`,
        "Run scripts/setup-uom-master.mjs, or enable Auto-create UOM.",
      );
    }
  } else if (ctx.autoCreateUom) {
    ensureUom = true;
  }

  if (
    row.status.trim() &&
    !["active", "inactive", "obsolete"].includes(
      row.status.trim().toLowerCase(),
    )
  ) {
    return failed(
      `Invalid Status "${row.status}".`,
      "Use Active, Inactive, or Obsolete.",
    );
  }
  const status = normalizeItemLifecycleStatus(row.status || "Active");

  const warehouseRaw = row.default_warehouse.trim();
  let warehouse = warehouseRaw;
  if (warehouseRaw && ctx.warehouses.length > 0) {
    const whMatch = matchErpLabel(warehouseRaw, ctx.warehouses);
    if (!whMatch.ok) {
      return failed(
        `Default Warehouse "${warehouseRaw}" does not exist.`,
        "Enter an existing Warehouse name from ERPNext, or leave blank.",
      );
    }
    warehouse = whMatch.value;
  }

  const brandRaw = row.brand.trim();
  let brand = brandRaw || undefined;
  let ensureBrand = false;
  if (brandRaw) {
    const brandList = ctx.brands ?? [];
    if (brandList.length > 0) {
      const brandMatch = matchErpLabel(brandRaw, brandList);
      if (brandMatch.ok) {
        brand = brandMatch.value;
      } else {
        ensureBrand = true;
      }
    } else {
      ensureBrand = true;
    }
  }

  const manufacturerRaw = row.manufacturer.trim();
  let manufacturer = manufacturerRaw || undefined;
  let ensureManufacturer = false;
  if (manufacturerRaw) {
    const mfrList = ctx.manufacturers ?? [];
    if (mfrList.length > 0) {
      const mfrMatch = matchErpLabel(manufacturerRaw, mfrList);
      if (mfrMatch.ok) {
        manufacturer = mfrMatch.value;
      } else {
        ensureManufacturer = true;
      }
    } else {
      ensureManufacturer = true;
    }
  }

  const reorder = Number(row.reorder_level);
  const input: ItemImportPayload = {
    item_code: code,
    item_name: name,
    procurement_type: typeNorm,
    procurement_category: category,
    item_group: itemGroup,
    stock_uom: uom,
    description: row.description.trim() || undefined,
    reorder_level: Number.isFinite(reorder) && reorder > 0 ? reorder : 0,
    default_warehouse: warehouse || undefined,
    lifecycle_status: status as ItemLifecycleStatus,
    is_stock_item: parseStockItemFlag(row.stock_item, row.item_type),
    brand,
    manufacturer,
    ensure_item_group: ensureGroup,
    ensure_procurement_category: ensureCategory,
    ensure_uom: ensureUom,
    ensure_brand: ensureBrand,
    ensure_manufacturer: ensureManufacturer,
  };

  return {
    ok: true,
    action: existsInErp ? "update" : "create",
    input,
  };
}

function parseSelectOptions(options: string | null | undefined): string[] {
  return String(options ?? "")
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
}

async function fetchItemCustomFieldOptions(
  fieldname: string,
): Promise<string[]> {
  try {
    const name = `${ITEM_DOCTYPE}-${fieldname}`;
    const doc = await apiGet<{ options?: string }>(
      buildResourceUrl("Custom Field", name),
      withSilent(),
    );
    const fromDoc = parseSelectOptions(doc?.options);
    if (fromDoc.length > 0) return fromDoc;
  } catch {
    /* fall through */
  }

  try {
    const rows = await apiGet<Array<{ options?: string }>>(
      buildResourceUrl("Custom Field"),
      {
        ...buildListConfig({
          fields: ["name", "fieldname", "options", "dt"],
          filters: [
            ["dt", "=", ITEM_DOCTYPE],
            ["fieldname", "=", fieldname],
          ],
          limit_page_length: 5,
        }),
        ...withSilent(),
      },
    );
    for (const row of rows ?? []) {
      const opts = parseSelectOptions(row.options);
      if (opts.length > 0) return opts;
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(
      `${LOG_TAG} could not load Custom Field options for ${fieldname}`,
      err,
    );
  }
  return [];
}

/** Serialize concurrent ensure-* calls for the same master name. */
const ensureLocks = new Map<string, Promise<string>>();

async function withEnsureLock(
  key: string,
  work: () => Promise<string>,
): Promise<string> {
  const existing = ensureLocks.get(key);
  if (existing) return existing;
  const promise = work().finally(() => {
    ensureLocks.delete(key);
  });
  ensureLocks.set(key, promise);
  return promise;
}

async function ensureItemGroupExists(
  name: string,
  ctx: ItemImportContext,
): Promise<string> {
  const match = matchErpLabel(name, ctx.itemGroups);
  if (match.ok) return match.value;

  return withEnsureLock(`item-group:${name.toLowerCase()}`, async () => {
    const again = matchErpLabel(name, ctx.itemGroups);
    if (again.ok) return again.value;

    let created = false;
    try {
      await apiPost(
        buildResourceUrl("Item Group"),
        {
          doctype: "Item Group",
          item_group_name: name,
          parent_item_group: "All Item Groups",
          is_group: 0,
        },
        withSilent(),
      );
      created = true;
    } catch (err) {
      if (!isDuplicateItemError(err)) {
        throw new Error(
          `Could not create Item Group "${name}": ${errorMessage(err)}`,
        );
      }
    }
    if (!ctx.itemGroups.some((g) => g.toLowerCase() === name.toLowerCase())) {
      ctx.itemGroups.push(name);
    }
    if (created) {
      trackMasterCreated(
        ctx.masters,
        "itemGroupsCreated",
        name,
        "itemGroupNames",
      );
    }
    return name;
  });
}

async function ensureProcurementCategoryExists(
  category: string,
  procurementType: MaterialRequestProcurementType,
  ctx: ItemImportContext,
): Promise<string> {
  const match = matchErpLabel(category, ctx.procurementCategories);
  if (match.ok) return match.value;

  return withEnsureLock(`proc-cat:${category.toLowerCase()}`, async () => {
    const again = matchErpLabel(category, ctx.procurementCategories);
    if (again.ok) return again.value;

    const fieldName = `${ITEM_DOCTYPE}-${ITEM_PROCUREMENT_CATEGORY_FIELD}`;
    // Keep typed master order, then append new categories.
    const masterOrder = [...PROCUREMENT_CATEGORY_MASTER];
    const options = [
      ...masterOrder.filter((c) =>
        ctx.procurementCategories.some(
          (e) => e.toLowerCase() === c.toLowerCase(),
        ),
      ),
      ...ctx.procurementCategories.filter(
        (c) =>
          !masterOrder.some((m) => m.toLowerCase() === c.toLowerCase()),
      ),
    ];
    if (!options.some((o) => o.toLowerCase() === category.toLowerCase())) {
      options.push(category);
    }
    try {
      await apiPut(
        buildResourceUrl("Custom Field", fieldName),
        { options: options.join("\n") },
        withSilent(),
      );
    } catch (err) {
      throw new Error(
        `Could not add Procurement Category "${category}" (${procurementType}) to ERP Select options: ${errorMessage(err)}`,
      );
    }
    ctx.procurementCategories = options;
    trackMasterCreated(
      ctx.masters,
      "categoriesCreated",
      category,
      "categoryNames",
    );
    // eslint-disable-next-line no-console
    console.info(
      `${LOG_TAG} created Procurement Category "${category}" for ${procurementType}`,
    );
    return category;
  });
}

async function ensureUomExists(
  name: string,
  ctx: ItemImportContext,
): Promise<string> {
  const match = matchErpLabel(name, ctx.uoms);
  if (match.ok) return match.value;

  return withEnsureLock(`uom:${name.toLowerCase()}`, async () => {
    const again = matchErpLabel(name, ctx.uoms);
    if (again.ok) return again.value;

    let created = false;
    try {
      await apiPost(
        buildResourceUrl("UOM"),
        { doctype: "UOM", uom_name: name },
        withSilent(),
      );
      created = true;
    } catch (err) {
      if (!isDuplicateItemError(err)) {
        throw new Error(
          `Could not create UOM "${name}": ${errorMessage(err)}`,
        );
      }
    }
    if (!ctx.uoms.some((u) => u.toLowerCase() === name.toLowerCase())) {
      ctx.uoms.push(name);
    }
    if (created) {
      trackMasterCreated(ctx.masters, "uomsCreated", name, "uomNames");
    }
    return name;
  });
}

async function ensureBrandExists(
  name: string,
  ctx: ItemImportContext,
): Promise<string> {
  const match = matchErpLabel(name, ctx.brands);
  if (match.ok) return match.value;

  return withEnsureLock(`brand:${name.toLowerCase()}`, async () => {
    const again = matchErpLabel(name, ctx.brands);
    if (again.ok) return again.value;

    let created = false;
    try {
      await apiPost(
        buildResourceUrl("Brand"),
        { doctype: "Brand", brand: name },
        withSilent(),
      );
      created = true;
    } catch (err) {
      if (!isDuplicateItemError(err)) {
        // Some sites use `name` as the only field.
        try {
          await apiPost(
            buildResourceUrl("Brand"),
            { doctype: "Brand", name },
            withSilent(),
          );
          created = true;
        } catch (err2) {
          if (!isDuplicateItemError(err2)) {
            throw new Error(
              `Could not create Brand "${name}": ${errorMessage(err2)}`,
            );
          }
        }
      }
    }
    if (!ctx.brands.some((b) => b.toLowerCase() === name.toLowerCase())) {
      ctx.brands.push(name);
    }
    if (created) {
      trackMasterCreated(ctx.masters, "brandsCreated", name, "brandNames");
    }
    return name;
  });
}

async function ensureManufacturerExists(
  name: string,
  ctx: ItemImportContext,
): Promise<string> {
  const match = matchErpLabel(name, ctx.manufacturers);
  if (match.ok) return match.value;

  return withEnsureLock(`manufacturer:${name.toLowerCase()}`, async () => {
    const again = matchErpLabel(name, ctx.manufacturers);
    if (again.ok) return again.value;

    let created = false;
    try {
      await apiPost(
        buildResourceUrl("Manufacturer"),
        { doctype: "Manufacturer", short_name: name },
        withSilent(),
      );
      created = true;
    } catch (err) {
      if (!isDuplicateItemError(err)) {
        try {
          await apiPost(
            buildResourceUrl("Manufacturer"),
            { doctype: "Manufacturer", manufacturer: name },
            withSilent(),
          );
          created = true;
        } catch (err2) {
          if (!isDuplicateItemError(err2)) {
            throw new Error(
              `Could not create Manufacturer "${name}": ${errorMessage(err2)}`,
            );
          }
        }
      }
    }
    if (
      !ctx.manufacturers.some((m) => m.toLowerCase() === name.toLowerCase())
    ) {
      ctx.manufacturers.push(name);
    }
    if (created) {
      trackMasterCreated(
        ctx.masters,
        "manufacturersCreated",
        name,
        "manufacturerNames",
      );
    }
    return name;
  });
}

async function ensureMastersForRow(
  input: ItemImportPayload,
  ctx: ItemImportContext,
): Promise<ItemImportPayload> {
  const next = { ...input };
  if (input.ensure_item_group && input.item_group) {
    next.item_group = await ensureItemGroupExists(input.item_group, ctx);
  }
  if (input.ensure_procurement_category && input.procurement_category) {
    next.procurement_category = await ensureProcurementCategoryExists(
      input.procurement_category,
      input.procurement_type,
      ctx,
    );
  }
  if (input.ensure_uom && input.stock_uom) {
    next.stock_uom = await ensureUomExists(input.stock_uom, ctx);
  }
  if (input.ensure_brand && input.brand) {
    next.brand = await ensureBrandExists(input.brand, ctx);
  }
  if (input.ensure_manufacturer && input.manufacturer) {
    next.manufacturer = await ensureManufacturerExists(input.manufacturer, ctx);
  }
  return next;
}

function throwIfBlockingCreateError(err: unknown): void {
  if (isDuplicateItemError(err)) throw err;
  if (isHsnMandatoryError(errorMessage(err))) {
    throw new Error(
      "ERPNext requires an HSN/SAC Code for new items. Add HSN in ERP Item defaults or create the item manually with HSN.",
    );
  }
}

function lifecycleDisabled(status?: ItemLifecycleStatus): 0 | 1 {
  return status && status !== "Active" ? 1 : 0;
}

async function createErpItemForImport(input: ItemImportPayload): Promise<void> {
  const core: Record<string, unknown> = {
    doctype: ITEM_DOCTYPE,
    item_code: input.item_code.trim(),
    item_name: input.item_name.trim(),
    item_group: input.item_group?.trim() || "All Item Groups",
    stock_uom: input.stock_uom?.trim() || "Nos",
    is_stock_item: input.is_stock_item !== false ? 1 : 0,
    description: input.description?.trim() || undefined,
    safety_stock: Number(input.reorder_level) || 0,
    disabled: lifecycleDisabled(input.lifecycle_status),
    brand: input.brand?.trim() || undefined,
    manufacturer: input.manufacturer?.trim() || undefined,
  };

  const withExtras: Record<string, unknown> = {
    ...core,
    ...(input.default_warehouse?.trim()
      ? { default_warehouse: input.default_warehouse.trim() }
      : {}),
    [ITEM_PROCUREMENT_TYPE_FIELD]: input.procurement_type,
    [ITEM_PROCUREMENT_CATEGORY_FIELD]: input.procurement_category,
    [ITEM_LIFECYCLE_STATUS_FIELD]: input.lifecycle_status ?? "Active",
  };

  try {
    await apiPost(buildResourceUrl(ITEM_DOCTYPE), withExtras, withSilent());
  } catch (err) {
    throwIfBlockingCreateError(err);
    // eslint-disable-next-line no-console
    console.warn(
      `${LOG_TAG} create with custom fields failed — retrying core Item fields`,
      errorMessage(err),
    );
    try {
      await apiPost(buildResourceUrl(ITEM_DOCTYPE), core, withSilent());
    } catch (err2) {
      throwIfBlockingCreateError(err2);
      throw err2 instanceof Error ? err2 : new Error(errorMessage(err2));
    }
  }

  await persistItemProcurementFields(input.item_code.trim(), {
    procurement_type: input.procurement_type,
    procurement_category: input.procurement_category,
    lifecycle_status: input.lifecycle_status ?? "Active",
  });

  // Best-effort extras that may not be list-writable on all sites.
  const extras: Record<string, unknown> = {};
  if (input.default_warehouse?.trim()) {
    extras.default_warehouse = input.default_warehouse.trim();
  }
  if (input.brand?.trim()) extras.brand = input.brand.trim();
  if (input.manufacturer?.trim()) {
    extras.manufacturer = input.manufacturer.trim();
  }
  if (Object.keys(extras).length > 0) {
    try {
      await apiPut(
        buildResourceUrl(ITEM_DOCTYPE, input.item_code.trim()),
        extras,
        withSilent(),
      );
    } catch {
      /* optional */
    }
  }
}

async function updateErpItemForImport(
  input: ItemImportPayload,
  mode: "update" | "overwrite",
): Promise<void> {
  const code = input.item_code.trim();
  const payload: Record<string, unknown> = {
    item_name: input.item_name.trim(),
    item_group: input.item_group?.trim(),
    stock_uom: input.stock_uom?.trim(),
    is_stock_item: input.is_stock_item !== false ? 1 : 0,
    safety_stock: Number(input.reorder_level) || 0,
    disabled: lifecycleDisabled(input.lifecycle_status),
    [ITEM_PROCUREMENT_TYPE_FIELD]: input.procurement_type,
    [ITEM_PROCUREMENT_CATEGORY_FIELD]: input.procurement_category,
    [ITEM_LIFECYCLE_STATUS_FIELD]: input.lifecycle_status ?? "Active",
  };

  if (mode === "overwrite") {
    payload.description = input.description?.trim() || "";
    payload.brand = input.brand?.trim() || "";
    payload.manufacturer = input.manufacturer?.trim() || "";
    if (input.default_warehouse?.trim()) {
      payload.default_warehouse = input.default_warehouse.trim();
    }
  } else {
    if (input.description?.trim()) {
      payload.description = input.description.trim();
    }
    if (input.brand?.trim()) payload.brand = input.brand.trim();
    if (input.manufacturer?.trim()) {
      payload.manufacturer = input.manufacturer.trim();
    }
    if (input.default_warehouse?.trim()) {
      payload.default_warehouse = input.default_warehouse.trim();
    }
  }

  try {
    await apiPut(buildResourceUrl(ITEM_DOCTYPE, code), payload, withSilent());
  } catch (err) {
    // Retry without warehouse / brand if ERP rejects those fields.
    const slim = { ...payload };
    delete slim.default_warehouse;
    delete slim.brand;
    delete slim.manufacturer;
    try {
      await apiPut(buildResourceUrl(ITEM_DOCTYPE, code), slim, withSilent());
    } catch (err2) {
      throw err2 instanceof Error ? err2 : new Error(errorMessage(err2));
    }
  }

  await persistItemProcurementFields(code, {
    procurement_type: input.procurement_type,
    procurement_category: input.procurement_category,
    lifecycle_status: input.lifecycle_status ?? "Active",
  });
}

export async function loadItemImportContext(): Promise<ItemImportContext> {
  const [
    codes,
    typeOpts,
    categoryOpts,
    groups,
    warehouses,
    uoms,
    brands,
    manufacturers,
  ] = await Promise.all([
    listItemCodes().catch((err) => {
      // eslint-disable-next-line no-console
      console.error(`${LOG_TAG} failed to load existing item codes`, err);
      throw err;
    }),
    fetchItemCustomFieldOptions(ITEM_PROCUREMENT_TYPE_FIELD),
    fetchItemCustomFieldOptions(ITEM_PROCUREMENT_CATEGORY_FIELD),
    apiGet<Array<{ name: string }>>(buildResourceUrl("Item Group"), {
      ...buildListConfig({
        fields: ["name"],
        filters: [["is_group", "=", 0]],
        limit_page_length: 2000,
      }),
      ...withSilent(),
    }).catch(() => [] as Array<{ name: string }>),
    apiGet<Array<{ name: string }>>(buildResourceUrl("Warehouse"), {
      ...buildListConfig({
        fields: ["name"],
        filters: [
          ["is_group", "=", 0],
          ["disabled", "=", 0],
        ],
        limit_page_length: 500,
      }),
      ...withSilent(),
    }).catch(() => [] as Array<{ name: string }>),
    apiGet<Array<{ name: string; uom_name?: string }>>(
      buildResourceUrl("UOM"),
      {
        ...buildListConfig({
          fields: ["name", "uom_name"],
          filters: [["enabled", "=", 1]],
          limit_page_length: 500,
          order_by: "name asc",
        }),
        ...withSilent(),
      },
    ).catch(async () => {
      try {
        return await apiGet<Array<{ name: string; uom_name?: string }>>(
          buildResourceUrl("UOM"),
          {
            ...buildListConfig({
              fields: ["name", "uom_name"],
              limit_page_length: 500,
              order_by: "name asc",
            }),
            ...withSilent(),
          },
        );
      } catch {
        return [] as Array<{ name: string; uom_name?: string }>;
      }
    }),
    apiGet<Array<{ name: string; brand?: string }>>(
      buildResourceUrl("Brand"),
      {
        ...buildListConfig({
          fields: ["name", "brand"],
          limit_page_length: 2000,
        }),
        ...withSilent(),
      },
    ).catch(() => [] as Array<{ name: string; brand?: string }>),
    apiGet<Array<{ name: string; short_name?: string }>>(
      buildResourceUrl("Manufacturer"),
      {
        ...buildListConfig({
          fields: ["name", "short_name"],
          limit_page_length: 2000,
        }),
        ...withSilent(),
      },
    ).catch(() => [] as Array<{ name: string; short_name?: string }>),
  ]);

  const procurementTypes =
    typeOpts.length > 0 ? typeOpts : ["Direct", "Indirect"];
  // Prefer ERP options; fall back to typed master so import can proceed.
  const procurementCategories =
    categoryOpts.length > 0
      ? categoryOpts
      : [...PROCUREMENT_CATEGORY_MASTER];

  return {
    existingCodes: new Set(codes.map((c) => c.toLowerCase())),
    procurementTypes,
    procurementCategories,
    itemGroups: (groups ?? []).map((g) => g.name).filter(Boolean),
    warehouses: (warehouses ?? []).map((w) => w.name).filter(Boolean),
    uoms: Array.from(
      new Set(
        (uoms ?? [])
          .flatMap((u) => [u.name, u.uom_name])
          .map((v) => String(v ?? "").trim())
          .filter(Boolean),
      ),
    ),
    brands: Array.from(
      new Set(
        (brands ?? [])
          .flatMap((b) => [b.brand, b.name])
          .map((v) => String(v ?? "").trim())
          .filter(Boolean),
      ),
    ),
    manufacturers: Array.from(
      new Set(
        (manufacturers ?? [])
          .flatMap((m) => [m.short_name, m.name])
          .map((v) => String(v ?? "").trim())
          .filter(Boolean),
      ),
    ),
    masters: emptyMasterStats(),
  };
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;

  async function run(): Promise<void> {
    while (next < items.length) {
      const index = next++;
      results[index] = await worker(items[index], index);
    }
  }

  const runners = Array.from(
    { length: Math.min(concurrency, Math.max(items.length, 1)) },
    () => run(),
  );
  await Promise.all(runners);
  return results;
}

/**
 * Validate and write ERPNext Item records (create / update / skip).
 * Continues on per-row failures (no full rollback).
 */
export async function importItemsToErp(
  options: ItemImportOptions,
): Promise<ItemImportSummary> {
  const importedAt = new Date().toISOString();
  const context = options.context ?? (await loadItemImportContext());
  const existingMode = options.existingMode ?? "skip";
  const autoCreateMasters = options.autoCreateMasters !== false;
  const autoCreateUom = options.autoCreateUom !== false;
  const concurrency = options.concurrency ?? 4;

  const codesInFile = new Set<string>();
  const prepared: Array<{
    row: ItemImportParsedRow;
    result?: ItemImportRowResult;
    action?: "create" | "update";
    input?: ItemImportPayload;
  }> = [];

  if (!context.masters) context.masters = emptyMasterStats();
  if (!context.brands) context.brands = [];
  if (!context.manufacturers) context.manufacturers = [];

  for (const row of options.rows) {
    const validated = validateItemImportRow(row, {
      codesInFile,
      existingCodes: context.existingCodes,
      procurementTypes: context.procurementTypes,
      procurementCategories: context.procurementCategories,
      itemGroups: context.itemGroups,
      warehouses: context.warehouses,
      uoms: context.uoms,
      brands: context.brands,
      manufacturers: context.manufacturers,
      existingMode,
      autoCreateMasters,
      autoCreateUom,
    });

    if (!validated.ok) {
      prepared.push({
        row,
        result: {
          rowNumber: row.rowNumber,
          outcome: validated.outcome,
          item_code: row.item_code.trim(),
          item_name: row.item_name.trim(),
          error: validated.error,
          suggestion: validated.suggestion,
          raw: row.raw,
        },
      });
      continue;
    }

    codesInFile.add(validated.input.item_code.toLowerCase());
    prepared.push({
      row,
      action: validated.action,
      input: validated.input,
    });
  }

  const recount = () => {
    const resultsSoFar = prepared.map((p) => p.result).filter(Boolean);
    return {
      processed: resultsSoFar.length,
      created: resultsSoFar.filter((r) => r!.outcome === "created").length,
      updated: resultsSoFar.filter((r) => r!.outcome === "updated").length,
      skipped: resultsSoFar.filter((r) => r!.outcome === "skipped").length,
      failed: resultsSoFar.filter((r) => r!.outcome === "failed").length,
      masters: { ...context.masters },
    };
  };

  options.onProgress?.({
    ...recount(),
    total: prepared.length,
  });

  const toWrite = prepared
    .map((p, index) => ({ p, index }))
    .filter(({ p }) => !p.result && p.input && p.action);

  await mapWithConcurrency(toWrite, concurrency, async ({ p, index }) => {
    const input = p.input!;
    const action = p.action!;
    try {
      const ready = await ensureMastersForRow(input, context);
      if (action === "create") {
        await createErpItemForImport(ready);
        context.existingCodes.add(ready.item_code.toLowerCase());
        prepared[index] = {
          ...p,
          result: {
            rowNumber: p.row.rowNumber,
            outcome: "created",
            item_code: ready.item_code,
            item_name: ready.item_name,
            raw: p.row.raw,
          },
        };
      } else {
        await updateErpItemForImport(
          ready,
          existingMode === "overwrite" ? "overwrite" : "update",
        );
        prepared[index] = {
          ...p,
          result: {
            rowNumber: p.row.rowNumber,
            outcome: "updated",
            item_code: ready.item_code,
            item_name: ready.item_name,
            raw: p.row.raw,
          },
        };
      }
    } catch (err) {
      const msg = errorMessage(err);
      if (action === "create" && isDuplicateItemError(err)) {
        if (existingMode === "skip") {
          context.existingCodes.add(input.item_code.toLowerCase());
          prepared[index] = {
            ...p,
            result: {
              rowNumber: p.row.rowNumber,
              outcome: "skipped",
              item_code: input.item_code,
              item_name: input.item_name,
              error: `Item Code "${input.item_code}" already exists in ERPNext Item Master.`,
              suggestion:
                'Choose "Update Existing" or "Overwrite Existing" to modify this item.',
              raw: p.row.raw,
            },
          };
        } else {
          try {
            const ready = await ensureMastersForRow(input, context);
            await updateErpItemForImport(
              ready,
              existingMode === "overwrite" ? "overwrite" : "update",
            );
            prepared[index] = {
              ...p,
              result: {
                rowNumber: p.row.rowNumber,
                outcome: "updated",
                item_code: ready.item_code,
                item_name: ready.item_name,
                raw: p.row.raw,
              },
            };
          } catch (err2) {
            prepared[index] = {
              ...p,
              result: {
                rowNumber: p.row.rowNumber,
                outcome: "failed",
                item_code: input.item_code,
                item_name: input.item_name,
                error: errorMessage(err2),
                suggestion:
                  "Retry the import. If it persists, check ERPNext permissions.",
                raw: p.row.raw,
              },
            };
          }
        }
      } else {
        prepared[index] = {
          ...p,
          result: {
            rowNumber: p.row.rowNumber,
            outcome: "failed",
            item_code: input.item_code,
            item_name: input.item_name,
            error: msg,
            suggestion: isHsnMandatoryError(msg)
              ? "Add HSN/SAC on the Item in ERPNext defaults, then retry."
              : "Retry the import. If it persists, check ERPNext permissions and server logs.",
            raw: p.row.raw,
          },
        };
        // eslint-disable-next-line no-console
        console.error(`${LOG_TAG} row ${p.row.rowNumber} failed`, err);
      }
    }

    options.onProgress?.({
      ...recount(),
      total: prepared.length,
      currentItemCode: input.item_code,
    });
  });

  const results = prepared
    .map((p) => p.result!)
    .filter(Boolean)
    .sort((a, b) => a.rowNumber - b.rowNumber);

  const counts = recount();
  const summary: ItemImportSummary = {
    fileName: options.fileName,
    importedBy: options.importedBy,
    importedAt,
    existingMode,
    totalRows: options.rows.length,
    created: counts.created,
    updated: counts.updated,
    skipped: counts.skipped,
    failed: counts.failed,
    masters: { ...context.masters },
    imported: counts.created,
    needsReview: 0,
    results,
  };

  // eslint-disable-next-line no-console
  console.info(`${LOG_TAG} complete`, {
    fileName: summary.fileName,
    existingMode,
    totalRows: summary.totalRows,
    created: summary.created,
    updated: summary.updated,
    skipped: summary.skipped,
    failed: summary.failed,
    masters: summary.masters,
  });

  await recordItemImportAudit(summary);
  return summary;
}

/** Best-effort Activity Log — never throws. */
export async function recordItemImportAudit(
  summary: ItemImportSummary,
): Promise<void> {
  const subject = `Item Master Import — ${summary.fileName}`;
  const content = [
    `Imported By: ${summary.importedBy}`,
    `Import Date: ${summary.importedAt}`,
    `File Name: ${summary.fileName}`,
    `Existing Mode: ${itemImportExistingModeLabel(summary.existingMode)}`,
    `Total Records: ${summary.totalRows}`,
    `New Items Created: ${summary.created}`,
    `Existing Items Updated: ${summary.updated}`,
    `New Categories Created: ${summary.masters.categoriesCreated}`,
    `New Item Groups Created: ${summary.masters.itemGroupsCreated}`,
    `New Brands Created: ${summary.masters.brandsCreated}`,
    `New Manufacturers Created: ${summary.masters.manufacturersCreated}`,
    `New UOMs Created: ${summary.masters.uomsCreated}`,
    `Skipped: ${summary.skipped}`,
    `Failed Rows: ${summary.failed}`,
  ].join("\n");

  try {
    await apiPost(
      "/api/method/frappe.client.insert",
      {
        doc: {
          doctype: "Activity Log",
          subject,
          content,
          operation: "Import",
          status: "Success",
          reference_doctype: "Item",
        },
      },
      withSilent(),
    );
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(`${LOG_TAG} Activity Log skipped:`, err);
  }
}
