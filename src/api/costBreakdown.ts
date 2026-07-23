/**
 * Cost Breakdown service — ERPNext-backed.
 *
 * DocTypes: Cost Head Master, Cost Breakdown, Cost Breakdown Detail
 * RFQ flag: custom_require_cost_breakdown
 *
 * Does not modify RFQ/SQ create/submit core paths beyond optional custom field
 * writes. Safe to call alongside existing quotation workflows.
 */

import * as XLSX from "xlsx";

import {
  apiGet,
  apiPost,
  apiPut,
  buildListConfig,
  buildResourceUrl,
  withSilent,
  type Filter,
} from "./erpnext";
import { getRFQ, getSupplierQuotations } from "./sourcing";
import { generateId } from "../utils/id";
import type {
  CostBreakdown,
  CostBreakdownComparison,
  CostBreakdownDetailRow,
  CostBreakdownLineDraft,
  CostBreakdownSaveInput,
  CostHeadMaster,
  ExcelParseResult,
  ExcelValidationIssue,
} from "../types/costBreakdown";
import { COST_BREAKDOWN_EXCEL_COLUMNS } from "../types/costBreakdown";

const LOG = "[CostBreakdown]";
const HEAD_DOCTYPE = "Cost Head Master";
const PARENT_DOCTYPE = "Cost Breakdown";
const DETAIL_DOCTYPE = "Cost Breakdown Detail";

const DEFAULT_CURRENCY =
  (import.meta.env.VITE_DEFAULT_CURRENCY as string | undefined) || "USD";

/* ── Cost heads ────────────────────────────────────────────────────────── */

export async function listActiveCostHeads(): Promise<CostHeadMaster[]> {
  const raw = await apiGet<CostHeadMaster[]>(
    buildResourceUrl(HEAD_DOCTYPE),
    buildListConfig({
      fields: ["name", "cost_head_name", "description", "sort_order", "is_active"],
      filters: [["is_active", "=", 1]],
      order_by: "sort_order asc, cost_head_name asc",
      limit_page_length: 100,
    }),
  );
  return Array.isArray(raw) ? raw : [];
}

/* ── Helpers ───────────────────────────────────────────────────────────── */

function lineTotal(qty: number, unit: number): number {
  const q = Number(qty) || 0;
  const u = Number(unit) || 0;
  return Math.round(q * u * 100) / 100;
}

function sumLines(
  lines: Array<{ quantity: number; unit_cost: number; total_cost?: number }>,
): number {
  return Math.round(
    lines.reduce(
      (acc, l) =>
        acc + (l.total_cost ?? lineTotal(l.quantity, l.unit_cost)),
      0,
    ) * 100,
  ) / 100;
}

function mapParent(doc: Record<string, unknown>): CostBreakdown {
  const details = (Array.isArray(doc.details) ? doc.details : []).map(
    (d: Record<string, unknown>) => ({
      name: String(d.name ?? ""),
      idx: Number(d.idx ?? 0),
      cost_head: String(d.cost_head ?? ""),
      description: String(d.description ?? ""),
      quantity: Number(d.quantity ?? 0),
      unit_cost: Number(d.unit_cost ?? 0),
      total_cost: Number(
        d.total_cost ?? lineTotal(Number(d.quantity), Number(d.unit_cost)),
      ),
    }),
  ) as CostBreakdownDetailRow[];

  return {
    name: String(doc.name),
    rfq: String(doc.rfq ?? ""),
    supplier_quotation: doc.supplier_quotation
      ? String(doc.supplier_quotation)
      : undefined,
    supplier: String(doc.supplier ?? ""),
    item: String(doc.item ?? ""),
    item_name: doc.item_name ? String(doc.item_name) : undefined,
    currency: doc.currency ? String(doc.currency) : DEFAULT_CURRENCY,
    upload_type: (doc.upload_type as "Manual" | "Excel") || "Manual",
    excel_file: doc.excel_file ? String(doc.excel_file) : undefined,
    grand_total: Number(doc.grand_total ?? sumLines(details)),
    status: (doc.status as "Draft" | "Submitted") || "Draft",
    remarks: doc.remarks ? String(doc.remarks) : undefined,
    details,
    modified: doc.modified ? String(doc.modified) : undefined,
    creation: doc.creation ? String(doc.creation) : undefined,
  };
}

export function rfqRequiresCostBreakdown(rfq: {
  custom_require_cost_breakdown?: number | boolean | string;
}): boolean {
  const v = rfq.custom_require_cost_breakdown;
  return v === 1 || v === true || v === "1";
}

/* ── Load / query ──────────────────────────────────────────────────────── */

export async function listCostBreakdownsForQuotation(
  supplierQuotation: string,
): Promise<CostBreakdown[]> {
  if (!supplierQuotation) return [];
  const rows = await apiGet<Array<{ name: string }>>(
    buildResourceUrl(PARENT_DOCTYPE),
    withSilent(
      buildListConfig({
        fields: ["name"],
        filters: [["supplier_quotation", "=", supplierQuotation]],
        limit_page_length: 200,
      }),
    ),
  );
  const names = Array.isArray(rows) ? rows.map((r) => r.name) : [];
  const docs = await Promise.all(
    names.map((n) =>
      apiGet<Record<string, unknown>>(
        buildResourceUrl(PARENT_DOCTYPE, n),
        withSilent(),
      ),
    ),
  );
  return docs.map(mapParent);
}

export async function listCostBreakdownsForRfqSupplier(
  rfq: string,
  supplier: string,
): Promise<CostBreakdown[]> {
  const filters: Filter[] = [
    ["rfq", "=", rfq],
    ["supplier", "=", supplier],
  ];
  const rows = await apiGet<Array<{ name: string }>>(
    buildResourceUrl(PARENT_DOCTYPE),
    withSilent(
      buildListConfig({
        fields: ["name"],
        filters,
        limit_page_length: 200,
      }),
    ),
  );
  const names = Array.isArray(rows) ? rows.map((r) => r.name) : [];
  const docs = await Promise.all(
    names.map((n) =>
      apiGet<Record<string, unknown>>(
        buildResourceUrl(PARENT_DOCTYPE, n),
        withSilent(),
      ),
    ),
  );
  return docs.map(mapParent);
}

/** Flatten multiple per-item parents into editable lines. */
export function flattenBreakdownsToLines(
  docs: CostBreakdown[],
): CostBreakdownLineDraft[] {
  const lines: CostBreakdownLineDraft[] = [];
  for (const doc of docs) {
    for (const d of doc.details) {
      lines.push({
        id: generateId(),
        item_code: doc.item,
        item_name: doc.item_name,
        cost_head: d.cost_head,
        description: d.description ?? "",
        quantity: d.quantity,
        unit_cost: d.unit_cost,
        total_cost: d.total_cost,
      });
    }
  }
  return lines;
}

export function validateLines(
  lines: CostBreakdownLineDraft[],
  allowedHeads: Set<string>,
  allowedItems: Set<string>,
): ExcelValidationIssue[] {
  const issues: ExcelValidationIssue[] = [];
  const seen = new Set<string>();

  lines.forEach((line, i) => {
    const row = i + 2; // header = 1
    if (!line.item_code?.trim()) {
      issues.push({
        row,
        column: "Item Code",
        message: "Item Code is required.",
        severity: "error",
      });
    } else if (
      allowedItems.size > 0 &&
      !allowedItems.has(line.item_code.trim())
    ) {
      issues.push({
        row,
        column: "Item Code",
        message: `Item "${line.item_code}" is not on this RFQ.`,
        severity: "error",
      });
    }

    if (!line.cost_head?.trim()) {
      issues.push({
        row,
        column: "Cost Head",
        message: "Cost Head is required.",
        severity: "error",
      });
    } else if (!allowedHeads.has(line.cost_head.trim())) {
      issues.push({
        row,
        column: "Cost Head",
        message: `Unknown Cost Head "${line.cost_head}".`,
        severity: "error",
      });
    }

    if (Number(line.quantity) < 0) {
      issues.push({
        row,
        column: "Quantity",
        message: "Quantity cannot be negative.",
        severity: "error",
      });
    }
    if (Number(line.unit_cost) < 0) {
      issues.push({
        row,
        column: "Unit Cost",
        message: "Unit Cost cannot be negative.",
        severity: "error",
      });
    }
    if (!Number.isFinite(Number(line.quantity))) {
      issues.push({
        row,
        column: "Quantity",
        message: "Quantity must be a valid number.",
        severity: "error",
      });
    }
    if (!Number.isFinite(Number(line.unit_cost))) {
      issues.push({
        row,
        column: "Unit Cost",
        message: "Unit Cost must be a valid number.",
        severity: "error",
      });
    }

    const key = `${line.item_code.trim().toLowerCase()}::${line.cost_head.trim().toLowerCase()}`;
    if (line.item_code && line.cost_head) {
      if (seen.has(key)) {
        issues.push({
          row,
          column: "Cost Head",
          message: `Duplicate Cost Head "${line.cost_head}" for item ${line.item_code}.`,
          severity: "error",
        });
      }
      seen.add(key);
    }
  });

  return issues;
}

/* ── Save ──────────────────────────────────────────────────────────────── */

/** Ensure the supplier is invited on the RFQ before write operations. */
export async function assertSupplierInvitedToRfq(
  rfqName: string,
  supplier: string,
): Promise<void> {
  const rfq = await getRFQ(rfqName);
  const invited = (rfq.suppliers ?? []).some((s) => s.supplier === supplier);
  if (!invited) {
    throw new Error(
      "Only suppliers invited to this RFQ can submit a cost breakdown.",
    );
  }
}

export async function saveCostBreakdown(
  input: CostBreakdownSaveInput,
): Promise<CostBreakdown[]> {
  if (!input.rfq) throw new Error("RFQ is required.");
  if (!input.supplier) throw new Error("Supplier is required.");
  if (!input.lines.length) {
    throw new Error("Add at least one cost breakdown line.");
  }

  await assertSupplierInvitedToRfq(input.rfq, input.supplier);

  const heads = await listActiveCostHeads();
  const headSet = new Set(heads.map((h) => h.name));

  const drafts: CostBreakdownLineDraft[] = input.lines.map((l) => ({
    id: generateId(),
    item_code: l.item_code,
    item_name: l.item_name,
    cost_head: l.cost_head,
    description: l.description ?? "",
    quantity: Number(l.quantity),
    unit_cost: Number(l.unit_cost),
    total_cost: lineTotal(Number(l.quantity), Number(l.unit_cost)),
  }));

  const issues = validateLines(drafts, headSet, new Set());
  const errors = issues.filter((i) => i.severity === "error");
  if (errors.length) {
    throw new Error(errors.map((e) => `Row ${e.row}: ${e.message}`).join(" "));
  }

  // Group by item → one parent doc per item
  const byItem = new Map<string, CostBreakdownLineDraft[]>();
  for (const line of drafts) {
    const key = line.item_code.trim();
    const list = byItem.get(key) ?? [];
    list.push(line);
    byItem.set(key, list);
  }

  // Remove prior breakdowns for this SQ (or RFQ+supplier if SQ not yet known)
  const existing = input.supplier_quotation
    ? await listCostBreakdownsForQuotation(input.supplier_quotation)
    : await listCostBreakdownsForRfqSupplier(input.rfq, input.supplier);

  for (const old of existing) {
    try {
      await apiPost("/api/method/frappe.client.delete", {
        doctype: PARENT_DOCTYPE,
        name: old.name,
      }, withSilent());
    } catch {
      /* best-effort cleanup */
    }
  }

  const saved: CostBreakdown[] = [];
  for (const [itemCode, lines] of byItem) {
    const details = lines.map((l, idx) => ({
      doctype: DETAIL_DOCTYPE,
      cost_head: l.cost_head,
      description: l.description || "",
      quantity: l.quantity,
      unit_cost: l.unit_cost,
      total_cost: l.total_cost,
      idx: idx + 1,
    }));
    const grand = sumLines(details);
    const payload = {
      doctype: PARENT_DOCTYPE,
      rfq: input.rfq,
      supplier_quotation: input.supplier_quotation || undefined,
      supplier: input.supplier,
      item: itemCode,
      item_name: lines[0]?.item_name || itemCode,
      currency: input.currency || DEFAULT_CURRENCY,
      upload_type: input.upload_type,
      excel_file: input.excel_file || undefined,
      status: input.status || "Draft",
      remarks: input.remarks || "",
      grand_total: grand,
      details,
    };

    const created = await apiPost<Record<string, unknown>>(
      buildResourceUrl(PARENT_DOCTYPE),
      payload,
    );
    saved.push(mapParent(created));
  }

  // eslint-disable-next-line no-console
  console.log(LOG, "Saved cost breakdowns", {
    rfq: input.rfq,
    supplier: input.supplier,
    sq: input.supplier_quotation,
    parents: saved.length,
    lines: drafts.length,
    grand_total: sumLines(drafts),
  });

  return saved;
}

/** Link draft breakdowns to a newly created Supplier Quotation name. */
export async function attachCostBreakdownToQuotation(
  rfq: string,
  supplier: string,
  supplierQuotation: string,
): Promise<void> {
  const docs = await listCostBreakdownsForRfqSupplier(rfq, supplier);
  await Promise.all(
    docs
      .filter((d) => !d.supplier_quotation)
      .map((d) =>
        apiPut(
          buildResourceUrl(PARENT_DOCTYPE, d.name),
          { supplier_quotation: supplierQuotation, status: "Submitted" },
          withSilent(),
        ),
      ),
  );
}

export async function submitCostBreakdownForQuotation(
  supplierQuotation: string,
): Promise<void> {
  const docs = await listCostBreakdownsForQuotation(supplierQuotation);
  await Promise.all(
    docs.map((d) =>
      apiPut(
        buildResourceUrl(PARENT_DOCTYPE, d.name),
        { status: "Submitted" },
        withSilent(),
      ),
    ),
  );
}

/* ── Excel template + parse ────────────────────────────────────────────── */

export async function buildCostBreakdownTemplateBlob(options: {
  rfqName: string;
  items: Array<{ item_code: string; item_name?: string }>;
}): Promise<Blob> {
  const heads = await listActiveCostHeads();
  const rows: Array<Record<string, string | number>> = [];

  // One starter row per (item × first cost head) so suppliers see the shape
  for (const item of options.items) {
    const head = heads[0]?.cost_head_name || heads[0]?.name || "Raw Material";
    rows.push({
      "Item Code": item.item_code,
      "Item Name": item.item_name || item.item_code,
      "Cost Head": head,
      Description: "",
      Quantity: 1,
      "Unit Cost": 0,
      "Total Cost": 0,
    });
  }

  if (!rows.length) {
    rows.push({
      "Item Code": "",
      "Item Name": "",
      "Cost Head": "",
      Description: "",
      Quantity: 1,
      "Unit Cost": 0,
      "Total Cost": 0,
    });
  }

  const sheet = XLSX.utils.json_to_sheet(rows, {
    header: [...COST_BREAKDOWN_EXCEL_COLUMNS],
  });

  // Freeze header row
  sheet["!freeze"] = { xSplit: 0, ySplit: 1 };
  sheet["!cols"] = [
    { wch: 16 },
    { wch: 28 },
    { wch: 18 },
    { wch: 28 },
    { wch: 12 },
    { wch: 12 },
    { wch: 12 },
  ];

  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, "Cost Breakdown");

  // Reference sheet of allowed cost heads
  const headRows = heads.map((h, i) => ({
    "Sort Order": h.sort_order ?? (i + 1) * 10,
    "Cost Head": h.cost_head_name || h.name,
    Description: h.description || "",
  }));
  const headSheet = XLSX.utils.json_to_sheet(headRows);
  XLSX.utils.book_append_sheet(book, headSheet, "Cost Heads");

  const out = XLSX.write(book, { bookType: "xlsx", type: "array" });
  return new Blob([out], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export async function parseCostBreakdownExcel(
  file: File,
  options: {
    allowedItemCodes: string[];
    itemNames?: Record<string, string>;
  },
): Promise<ExcelParseResult> {
  const buffer = await file.arrayBuffer();
  const book = XLSX.read(buffer, { type: "array" });
  const sheetName = book.SheetNames[0];
  if (!sheetName) {
    return {
      ok: false,
      issues: [
        {
          row: 0,
          message: "Excel file has no sheets.",
          severity: "error",
        },
      ],
      lines: [],
      grand_total: 0,
    };
  }

  const sheet = book.Sheets[sheetName];
  const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    defval: "",
  });

  const issues: ExcelValidationIssue[] = [];
  if (!rawRows.length) {
    issues.push({
      row: 0,
      message: "Excel has no data rows.",
      severity: "error",
    });
  }

  // Column presence
  const first = rawRows[0] ?? {};
  const keys = Object.keys(first);
  for (const col of COST_BREAKDOWN_EXCEL_COLUMNS) {
    if (col === "Total Cost") continue; // computed
    const found = keys.some(
      (k) => k.trim().toLowerCase() === col.toLowerCase(),
    );
    if (!found && rawRows.length > 0) {
      issues.push({
        row: 1,
        column: col,
        message: `Missing required column: ${col}`,
        severity: "error",
      });
    }
  }

  const pick = (row: Record<string, unknown>, col: string): string => {
    const entry = Object.entries(row).find(
      ([k]) => k.trim().toLowerCase() === col.toLowerCase(),
    );
    return entry ? String(entry[1] ?? "").trim() : "";
  };

  const heads = await listActiveCostHeads();
  const headByName = new Map<string, string>();
  for (const h of heads) {
    headByName.set((h.cost_head_name || h.name).toLowerCase(), h.name);
    headByName.set(h.name.toLowerCase(), h.name);
  }

  const lines: CostBreakdownLineDraft[] = [];
  rawRows.forEach((row, idx) => {
    const item_code = pick(row, "Item Code");
    const item_name =
      pick(row, "Item Name") || options.itemNames?.[item_code] || item_code;
    const costHeadRaw = pick(row, "Cost Head");
    const description = pick(row, "Description");
    const qtyRaw = pick(row, "Quantity");
    const unitRaw = pick(row, "Unit Cost");

    // Skip fully empty rows
    if (!item_code && !costHeadRaw && !qtyRaw && !unitRaw) return;

    const quantity = Number(qtyRaw);
    const unit_cost = Number(unitRaw);
    const resolvedHead =
      headByName.get(costHeadRaw.toLowerCase()) || costHeadRaw;

    lines.push({
      id: generateId(),
      item_code,
      item_name,
      cost_head: resolvedHead,
      description,
      quantity: Number.isFinite(quantity) ? quantity : NaN,
      unit_cost: Number.isFinite(unit_cost) ? unit_cost : NaN,
      total_cost:
        Number.isFinite(quantity) && Number.isFinite(unit_cost)
          ? lineTotal(quantity, unit_cost)
          : 0,
    });

    void idx;
  });

  const allowedHeads = new Set(heads.map((h) => h.name));
  const allowedItems = new Set(options.allowedItemCodes);
  issues.push(...validateLines(lines, allowedHeads, allowedItems));

  const ok = !issues.some((i) => i.severity === "error");
  return {
    ok,
    issues,
    lines,
    grand_total: ok ? sumLines(lines) : 0,
  };
}

/* ── Comparison ────────────────────────────────────────────────────────── */

export async function getCostBreakdownComparison(
  rfqName: string,
): Promise<CostBreakdownComparison> {
  const rfq = await getRFQ(rfqName);
  const quotations = await getSupplierQuotations(rfqName);

  const supplierMeta = new Map<
    string,
    { supplier: string; supplier_name: string; supplier_quotation?: string }
  >();
  for (const sq of quotations) {
    supplierMeta.set(sq.supplier, {
      supplier: sq.supplier,
      supplier_name: sq.supplier_name || sq.supplier,
      supplier_quotation: sq.name,
    });
  }
  // Also include invited suppliers with no SQ yet (empty columns)
  for (const s of rfq.suppliers ?? []) {
    if (!supplierMeta.has(s.supplier)) {
      supplierMeta.set(s.supplier, {
        supplier: s.supplier,
        supplier_name: s.supplier_name || s.supplier,
      });
    }
  }

  const heads = await listActiveCostHeads();
  const cost_heads = heads.map((h) => h.cost_head_name || h.name);

  const amounts: Record<string, Record<string, number>> = {};
  for (const h of cost_heads) amounts[h] = {};

  const suppliers: CostBreakdownComparison["suppliers"] = [];
  const byItemMap = new Map<
    string,
    {
      item_code: string;
      item_name?: string;
      amounts: Record<string, Record<string, number>>;
      grand_totals: Record<string, number>;
    }
  >();

  for (const meta of supplierMeta.values()) {
    let docs: CostBreakdown[] = [];
    if (meta.supplier_quotation) {
      docs = await listCostBreakdownsForQuotation(meta.supplier_quotation);
    } else {
      docs = await listCostBreakdownsForRfqSupplier(rfqName, meta.supplier);
    }

    let supplierGrand = 0;
    for (const doc of docs) {
      supplierGrand += doc.grand_total;
      let itemBucket = byItemMap.get(doc.item);
      if (!itemBucket) {
        itemBucket = {
          item_code: doc.item,
          item_name: doc.item_name,
          amounts: {},
          grand_totals: {},
        };
        byItemMap.set(doc.item, itemBucket);
      }
      itemBucket.grand_totals[meta.supplier] =
        (itemBucket.grand_totals[meta.supplier] ?? 0) + doc.grand_total;

      for (const d of doc.details) {
        const headLabel =
          heads.find((h) => h.name === d.cost_head)?.cost_head_name ||
          d.cost_head;
        if (!amounts[headLabel]) amounts[headLabel] = {};
        amounts[headLabel][meta.supplier] =
          (amounts[headLabel][meta.supplier] ?? 0) + d.total_cost;

        if (!itemBucket.amounts[headLabel]) itemBucket.amounts[headLabel] = {};
        itemBucket.amounts[headLabel][meta.supplier] =
          (itemBucket.amounts[headLabel][meta.supplier] ?? 0) + d.total_cost;
      }
    }

    suppliers.push({
      ...meta,
      grand_total: Math.round(supplierGrand * 100) / 100,
    });
  }

  // Ensure every seeded head appears even if unused
  for (const h of cost_heads) {
    if (!amounts[h]) amounts[h] = {};
  }

  return {
    rfq: rfqName,
    suppliers,
    cost_heads,
    amounts,
    by_item: Array.from(byItemMap.values()),
  };
}

export { lineTotal, sumLines };
