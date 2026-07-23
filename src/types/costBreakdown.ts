/**
 * Cost Breakdown — supplier quotation cost structure module.
 *
 * Intentionally decoupled from AI / award / PO so future AI Cost Analysis
 * can hang off these types without rewriting the module surface.
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

/** Flat editable row used by Manual Entry + Excel preview (item-scoped). */
export interface CostBreakdownLineDraft {
  id: string;
  item_code: string;
  item_name?: string;
  cost_head: string;
  description: string;
  quantity: number;
  unit_cost: number;
  total_cost: number;
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
  row: number;
  column?: string;
  message: string;
  severity: "error" | "warning";
}

export interface ExcelParseResult {
  ok: boolean;
  issues: ExcelValidationIssue[];
  lines: CostBreakdownLineDraft[];
  grand_total: number;
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

export const COST_BREAKDOWN_EXCEL_COLUMNS = [
  "Item Code",
  "Item Name",
  "Cost Head",
  "Description",
  "Quantity",
  "Unit Cost",
  "Total Cost",
] as const;
