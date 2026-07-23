/**
 * Cost Breakdown — supplier quotation cost structure module.
 *
 * Item-wise UI: one card per RFQ item with cost-head amounts loaded from
 * ERPNext Cost Head Master (never hardcoded on the frontend).
 * Persistence maps to ERPNext Cost Breakdown + Detail (qty=1, unit_cost=amount).
 */

export type CostBreakdownUploadType = "Manual" | "Excel";
export type CostBreakdownStatus = "Draft" | "Submitted";

export interface CostHeadMaster {
  name: string;
  cost_head_name: string;
  description?: string;
  sort_order?: number;
  is_active?: 0 | 1;
}

export interface CostBreakdownDetailRow {
  name?: string;
  idx?: number;
  cost_head: string;
  description?: string;
  quantity: number;
  unit_cost: number;
  total_cost: number;
}

export interface CostBreakdown {
  name: string;
  rfq: string;
  supplier_quotation?: string;
  supplier: string;
  item: string;
  item_name?: string;
  currency?: string;
  upload_type: CostBreakdownUploadType;
  excel_file?: string;
  grand_total: number;
  status: CostBreakdownStatus;
  remarks?: string;
  details: CostBreakdownDetailRow[];
  modified?: string;
  creation?: string;
}

/** Flat editable row used when persisting / comparing (item × cost head). */
export interface CostBreakdownLineDraft {
  id: string;
  item_code: string;
  item_name?: string;
  cost_head: string;
  description: string;
  quantity: number;
  unit_cost: number;
  total_cost: number;
  /** 1-based Excel row (header = 1) when the line came from an upload. */
  excel_row?: number;
}

/** One cost-head cell inside an item card. */
export interface ItemCostHeadEntry {
  /** ERP Cost Head Master.name — exact Link value for save. */
  cost_head: string;
  /** Display label (cost_head_name or name). */
  label: string;
  description: string;
  /** Per-unit amount that contributes to the item breakdown total. */
  amount: number;
}

/** Item-wise draft used by the expandable card UI. */
export interface ItemCostBreakdownDraft {
  item_code: string;
  item_name: string;
  qty: number;
  quoted_unit_price: number;
  heads: ItemCostHeadEntry[];
  excel_row?: number;
}

export interface CostBreakdownSaveInput {
  rfq: string;
  supplier_quotation?: string;
  supplier: string;
  currency?: string;
  upload_type: CostBreakdownUploadType;
  excel_file?: string;
  status?: CostBreakdownStatus;
  remarks?: string;
  /** Flat lines spanning one or more items — grouped by item on save. */
  lines: Array<{
    item_code: string;
    item_name?: string;
    cost_head: string;
    description?: string;
    quantity: number;
    unit_cost: number;
  }>;
}

export interface ExcelValidationIssue {
  /** 1-based Excel / grid row (0 = file-level). */
  row: number;
  column?: string;
  message: string;
  severity: "error" | "warning";
  /** Item Code value from the failing row (when available). */
  item_code?: string;
  /** Draft line id — used to highlight cells when applicable. */
  line_id?: string;
}

export interface ExcelParseResult {
  ok: boolean;
  issues: ExcelValidationIssue[];
  /** Flat lines (qty=1, unit_cost=amount) for persistence compatibility. */
  lines: CostBreakdownLineDraft[];
  /** Rows that passed validation — safe to keep on partial import. */
  valid_lines: CostBreakdownLineDraft[];
  /** Distinct Excel row numbers that failed validation. */
  failed_rows: number[];
  grand_total: number;
  /** Item-wise drafts for the card UI (preferred). */
  items?: ItemCostBreakdownDraft[];
}

/** Matrix for procurement comparison: cost_head → supplier → amount. */
export interface CostBreakdownComparison {
  rfq: string;
  suppliers: Array<{
    supplier: string;
    supplier_name: string;
    supplier_quotation?: string;
    grand_total: number;
  }>;
  cost_heads: string[];
  /** amounts[cost_head][supplier] */
  amounts: Record<string, Record<string, number>>;
  /** Optional per-item breakdown for future AI / drill-down. */
  by_item?: Array<{
    item_code: string;
    item_name?: string;
    amounts: Record<string, Record<string, number>>;
    grand_totals: Record<string, number>;
  }>;
}

/** Build item-wise Excel headers from active Cost Head Master records. */
export function buildCostBreakdownExcelColumns(
  heads: Array<{ name: string; cost_head_name?: string }>,
): string[] {
  const headCols = heads.map((h) =>
    String(h.cost_head_name || h.name || "").trim(),
  ).filter(Boolean);
  return ["Item Code", "Item Name", ...headCols, "Total"];
}

/** Legacy row-wise columns — still accepted on upload for migration. */
export const COST_BREAKDOWN_EXCEL_COLUMNS_LEGACY = [
  "Item Code",
  "Item Name",
  "Cost Head",
  "Description",
  "Quantity",
  "Unit Cost",
  "Total Cost",
] as const;
