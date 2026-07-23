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
  ItemCostBreakdownDraft,
  ItemCostHeadEntry,
} from "../types/costBreakdown";
import {
  buildCostBreakdownExcelColumns,
  COST_BREAKDOWN_EXCEL_COLUMNS_LEGACY,
} from "../types/costBreakdown";

const LOG = "[CostBreakdown]";
const HEAD_DOCTYPE = "Cost Head Master";
const PARENT_DOCTYPE = "Cost Breakdown";
const DETAIL_DOCTYPE = "Cost Breakdown Detail";

const DEFAULT_CURRENCY =
  (import.meta.env.VITE_DEFAULT_CURRENCY as string | undefined) || "USD";

/** Tolerance when comparing breakdown total vs quoted unit price. */
export const BALANCE_EPSILON = 0.01;

/* ── Cost heads ────────────────────────────────────────────────────────── */

/** Display label for a Cost Head Master row. */
export function costHeadDisplayName(head: CostHeadMaster): string {
  return String(head.cost_head_name || head.name || "").trim();
}

/** Sort active masters by Sort Order, then display name. */
export function sortCostHeads(heads: CostHeadMaster[]): CostHeadMaster[] {
  return [...heads].sort((a, b) => {
    const sa = Number(a.sort_order) || 0;
    const sb = Number(b.sort_order) || 0;
    if (sa !== sb) return sa - sb;
    return costHeadDisplayName(a).localeCompare(costHeadDisplayName(b));
  });
}

export async function listActiveCostHeads(): Promise<CostHeadMaster[]> {
  try {
    const raw = await apiGet<CostHeadMaster[]>(
      buildResourceUrl(HEAD_DOCTYPE),
      buildListConfig({
        fields: [
          "name",
          "cost_head_name",
          "description",
          "sort_order",
          "is_active",
        ],
        filters: [["is_active", "=", 1]],
        order_by: "sort_order asc, cost_head_name asc",
        limit_page_length: 500,
      }),
    );
    const heads = sortCostHeads(
      (Array.isArray(raw) ? raw : []).filter(
        (h) => h && h.is_active !== 0 && String(h.name || "").trim(),
      ),
    );
    // eslint-disable-next-line no-console
    console.info(LOG, "Cost Head Master records", {
      count: heads.length,
      names: heads.map((h) => h.name),
      labels: heads.map((h) => costHeadDisplayName(h)),
      sort_orders: heads.map((h) => h.sort_order ?? 0),
    });
    return heads;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(LOG, "Failed to fetch Cost Head Master", err);
    throw err;
  }
}

/* ── Helpers ───────────────────────────────────────────────────────────── */

/** Values that must never be sent as Cost Head Master Link targets. */
const INVALID_COST_HEAD_TOKENS = new Set([
  "cost",
  "cost head",
  "cost heads",
  "cost_head",
  "total",
  "total cost",
  "unit cost",
  "amount",
  "description",
  "item",
  "item code",
  "item name",
]);

export function roundMoney(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

export function lineTotal(qty: number, unit: number): number {
  return roundMoney((Number(qty) || 0) * (Number(unit) || 0));
}

export function sumLines(
  lines: Array<{ quantity: number; unit_cost: number; total_cost?: number }>,
): number {
  return roundMoney(
    lines.reduce(
      (acc, l) =>
        acc + (l.total_cost ?? lineTotal(l.quantity, l.unit_cost)),
      0,
    ),
  );
}

/** Build lookup of aliases → ERP Cost Head Master.name */
export function buildCostHeadLookup(
  heads: CostHeadMaster[],
): Map<string, string> {
  const map = new Map<string, string>();
  for (const h of heads) {
    const erpName = String(h.name || "").trim();
    if (!erpName) continue;
    map.set(erpName.toLowerCase(), erpName);
    const label = String(h.cost_head_name || "").trim();
    if (label) map.set(label.toLowerCase(), erpName);
  }
  return map;
}

/**
 * Resolve a UI / Excel label to an ERPNext Cost Head Master `name`.
 * Returns null when the value is not a real master record (never invents names).
 */
export function resolveCostHeadName(
  raw: string | null | undefined,
  heads: CostHeadMaster[],
): string | null {
  const key = String(raw || "").trim().toLowerCase();
  if (!key) return null;
  if (INVALID_COST_HEAD_TOKENS.has(key)) return null;
  if (!heads.length) return null;
  return buildCostHeadLookup(heads).get(key) ?? null;
}

/** @deprecated Use resolveCostHeadName — kept for call-site compatibility. */
export function resolveItemWiseHeadName(
  label: string,
  heads: CostHeadMaster[],
): string {
  return resolveCostHeadName(label, heads) ?? "";
}

/**
 * Build empty item-head rows from ERPNext Cost Head Master only.
 * `cost_head` is always the ERP document name (Link id).
 */
export function emptyItemHeads(
  heads: CostHeadMaster[] = [],
): ItemCostHeadEntry[] {
  return sortCostHeads(heads).map((h) => ({
    label: costHeadDisplayName(h),
    cost_head: String(h.name).trim(),
    description: "",
    amount: 0,
  }));
}

export function itemBreakdownTotal(item: ItemCostBreakdownDraft): number {
  return roundMoney(
    (item.heads ?? []).reduce((s, h) => s + (Number(h.amount) || 0), 0),
  );
}

export function itemBalanceDiff(item: ItemCostBreakdownDraft): number {
  return roundMoney(itemBreakdownTotal(item) - (Number(item.quoted_unit_price) || 0));
}

export function isItemBalanced(item: ItemCostBreakdownDraft): boolean {
  const total = itemBreakdownTotal(item);
  const quoted = Number(item.quoted_unit_price) || 0;
  if (!(quoted > 0) || !(total > 0)) return false;
  return Math.abs(total - quoted) <= BALANCE_EPSILON;
}

export function isItemComplete(item: ItemCostBreakdownDraft): boolean {
  return isItemBalanced(item);
}

export function buildItemDrafts(options: {
  items: Array<{
    item_code: string;
    item_name?: string;
    qty?: number;
    unit_price?: number;
  }>;
  heads?: CostHeadMaster[];
  existingLines?: CostBreakdownLineDraft[];
}): ItemCostBreakdownDraft[] {
  const master = options.heads ?? [];
  const byItem = new Map<string, CostBreakdownLineDraft[]>();
  for (const line of options.existingLines ?? []) {
    const key = line.item_code.trim();
    const list = byItem.get(key) ?? [];
    list.push(line);
    byItem.set(key, list);
  }

  return options.items.map((it) => {
    const heads = emptyItemHeads(master);
    const existing = byItem.get(it.item_code.trim()) ?? [];
    const unmatched: CostBreakdownLineDraft[] = [];

    for (const line of existing) {
      const resolved = resolveCostHeadName(line.cost_head, master);
      const entry = resolved
        ? heads.find((h) => h.cost_head === resolved)
        : undefined;
      if (entry) {
        entry.amount = roundMoney(
          entry.amount +
            (line.total_cost || lineTotal(line.quantity, line.unit_cost)),
        );
        if (line.description && !entry.description) {
          entry.description = line.description;
        }
      } else {
        unmatched.push(line);
      }
    }

    // Fold unknown/inactive heads into "Other" when that master exists.
    if (unmatched.length) {
      const other = heads.find(
        (h) =>
          h.cost_head.toLowerCase() === "other" ||
          h.label.toLowerCase() === "other",
      );
      if (other) {
        for (const line of unmatched) {
          other.amount = roundMoney(
            other.amount +
              (line.total_cost || lineTotal(line.quantity, line.unit_cost)),
          );
          if (line.description) {
            other.description = other.description
              ? `${other.description}; ${line.description}`
              : line.description;
          }
        }
      }
    }

    return {
      item_code: it.item_code,
      item_name: it.item_name || it.item_code,
      qty: Number(it.qty) || 0,
      quoted_unit_price: Number(it.unit_price) || 0,
      heads,
    };
  });
}

/** Flatten item drafts to persistence lines (skip zero amounts). */
export function itemDraftsToLines(
  items: ItemCostBreakdownDraft[],
  heads: CostHeadMaster[] = [],
): CostBreakdownLineDraft[] {
  const lines: CostBreakdownLineDraft[] = [];
  const nameSet = new Set(heads.map((h) => h.name));
  for (const item of items) {
    for (const head of item.heads ?? []) {
      const amount = Number(head.amount) || 0;
      if (!(amount > 0)) continue;
      // Prefer the already-bound ERP name; never invent labels like "Overhead".
      const resolved =
        (head.cost_head && nameSet.has(head.cost_head)
          ? head.cost_head
          : null) ||
        resolveCostHeadName(head.cost_head, heads) ||
        resolveCostHeadName(head.label, heads) ||
        "";
      lines.push({
        id: generateId(),
        item_code: item.item_code,
        item_name: item.item_name,
        cost_head: resolved,
        description: head.description || "",
        quantity: 1,
        unit_cost: amount,
        total_cost: amount,
        excel_row: item.excel_row,
      });
    }
  }
  return lines;
}

export function validateItemDrafts(
  items: ItemCostBreakdownDraft[],
  heads: CostHeadMaster[] = [],
): ExcelValidationIssue[] {
  const issues: ExcelValidationIssue[] = [];
  const erpNames = new Set(heads.map((h) => h.name));

  items.forEach((item, idx) => {
    const row = item.excel_row && item.excel_row > 0 ? item.excel_row : idx + 1;
    const total = itemBreakdownTotal(item);
    const quoted = Number(item.quoted_unit_price) || 0;

    for (const head of item.heads ?? []) {
      const amount = Number(head.amount) || 0;
      if (!Number.isFinite(Number(head.amount)) || amount < 0) {
        issues.push({
          row,
          column: head.label,
          item_code: item.item_code,
          message: `${head.label} amount must be a non-negative number.`,
          severity: "error",
        });
      }
      if (!(amount > 0)) continue;

      const resolved =
        resolveCostHeadName(head.cost_head, heads) ||
        resolveCostHeadName(head.label, heads);
      if (!resolved || (erpNames.size > 0 && !erpNames.has(resolved))) {
        issues.push({
          row,
          column: head.label,
          item_code: item.item_code,
          message: "Invalid Cost Head",
          severity: "error",
        });
      }
    }

    if (!(total > 0)) {
      issues.push({
        row,
        item_code: item.item_code,
        message: "Enter at least one cost-head amount.",
        severity: "error",
      });
      return;
    }

    if (!(quoted > 0)) {
      issues.push({
        row,
        item_code: item.item_code,
        column: "Quoted Unit Price",
        message: "Quoted Unit Price is required to balance the cost breakdown.",
        severity: "error",
      });
      return;
    }

    if (Math.abs(total - quoted) > BALANCE_EPSILON) {
      issues.push({
        row,
        item_code: item.item_code,
        message: `Cost Breakdown Total (${total}) does not match Quoted Unit Price (${quoted}). Difference = ${roundMoney(total - quoted)}.`,
        severity: "error",
      });
    }
  });
  return issues;
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
    // Prefer original Excel row; otherwise 1-based grid index (no header).
    const row = line.excel_row && line.excel_row > 0 ? line.excel_row : i + 1;
    const item_code = line.item_code?.trim() || undefined;
    const base = { row, item_code, line_id: line.id } as const;

    if (!line.item_code?.trim()) {
      issues.push({
        ...base,
        column: "Item Code",
        message: "Item Code is required.",
        severity: "error",
      });
    } else if (
      allowedItems.size > 0 &&
      !allowedItems.has(line.item_code.trim())
    ) {
      issues.push({
        ...base,
        column: "Item Code",
        message: `Item "${line.item_code}" is not on this RFQ.`,
        severity: "error",
      });
    }

    if (!line.cost_head?.trim()) {
      issues.push({
        ...base,
        column: "Cost Head",
        message: "Cost Head is required.",
        severity: "error",
      });
    } else if (
      allowedHeads.size > 0 &&
      !allowedHeads.has(line.cost_head.trim())
    ) {
      issues.push({
        ...base,
        column: "Cost Head",
        message: "Invalid Cost Head",
        severity: "error",
      });
    }

    if (!Number.isFinite(Number(line.quantity))) {
      issues.push({
        ...base,
        column: "Quantity",
        message: "Quantity must be a valid number.",
        severity: "error",
      });
    } else if (Number(line.quantity) < 0) {
      issues.push({
        ...base,
        column: "Quantity",
        message: "Quantity cannot be negative.",
        severity: "error",
      });
    }

    if (!Number.isFinite(Number(line.unit_cost))) {
      issues.push({
        ...base,
        column: "Unit Cost",
        message: "Unit Cost must be a valid number.",
        severity: "error",
      });
    } else if (!(Number(line.unit_cost) > 0)) {
      issues.push({
        ...base,
        column: "Unit Cost",
        message: "Unit Cost must be greater than 0",
        severity: "error",
      });
    }

    const key = `${line.item_code.trim().toLowerCase()}::${line.cost_head.trim().toLowerCase()}`;
    if (line.item_code && line.cost_head) {
      if (seen.has(key)) {
        issues.push({
          ...base,
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
  if (!heads.length) {
    throw new Error(
      "No active Cost Head Master records found in ERPNext. Seed Cost Head Master and ensure is_active = 1.",
    );
  }

  // Only real ERP Link names are valid — never UI labels like "Cost Head".
  const headSet = new Set(heads.map((h) => h.name));

  const drafts: CostBreakdownLineDraft[] = [];
  const resolveErrors: string[] = [];
  input.lines.forEach((l, idx) => {
    const resolved = resolveCostHeadName(l.cost_head, heads);
    if (!resolved) {
      resolveErrors.push(
        `Row ${idx + 1}: Invalid Cost Head${l.cost_head ? ` ("${l.cost_head}")` : ""}`,
      );
      return;
    }
    drafts.push({
      id: generateId(),
      item_code: l.item_code,
      item_name: l.item_name,
      cost_head: resolved,
      description: l.description ?? "",
      quantity: Number(l.quantity),
      unit_cost: Number(l.unit_cost),
      total_cost: lineTotal(Number(l.quantity), Number(l.unit_cost)),
    });
  });

  if (resolveErrors.length) {
    // eslint-disable-next-line no-console
    console.error(LOG, "Invalid Cost Head values blocked before save", {
      resolveErrors,
      incoming: input.lines.map((l) => l.cost_head),
      validMasters: heads.map((h) => h.name),
    });
    throw new Error(resolveErrors.join(" · "));
  }

  const issues = validateLines(drafts, headSet, new Set());
  const errors = issues.filter((i) => i.severity === "error");
  if (errors.length) {
    throw new Error(
      errors
        .map((e) => {
          const parts = [
            e.row > 0 ? `Row ${e.row}` : "Row ?",
            e.item_code ? `Item = ${e.item_code}` : null,
            e.column ? `Column = ${e.column}` : null,
            `Error = ${e.message}`,
          ].filter(Boolean);
          return parts.join(" | ");
        })
        .join(" · "),
    );
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
      cost_head: l.cost_head, // Cost Head Master.name only
      description: l.description || "",
      quantity: l.quantity,
      unit_cost: l.unit_cost,
      total_cost: l.total_cost,
      idx: idx + 1,
    }));

    // eslint-disable-next-line no-console
    console.info(LOG, "Saving Cost Breakdown detail rows", {
      item: itemCode,
      cost_heads: details.map((d) => d.cost_head),
      linkDoctype: HEAD_DOCTYPE,
    });

    for (const d of details) {
      if (!headSet.has(d.cost_head)) {
        throw new Error(`Invalid Cost Head ("${d.cost_head}")`);
      }
      if (INVALID_COST_HEAD_TOKENS.has(d.cost_head.trim().toLowerCase())) {
        throw new Error(`Invalid Cost Head ("${d.cost_head}")`);
      }
    }

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

    // eslint-disable-next-line no-console
    console.info(LOG, "ERPNext POST payload", {
      item: itemCode,
      grand_total: grand,
      details: details.map((d) => ({
        cost_head: d.cost_head,
        amount: d.unit_cost,
        total_cost: d.total_cost,
      })),
      payload,
    });

    const created = await apiPost<Record<string, unknown>>(
      buildResourceUrl(PARENT_DOCTYPE),
      payload,
    );

    // eslint-disable-next-line no-console
    console.info(LOG, "ERPNext API response", {
      item: itemCode,
      name: created?.name,
      grand_total: created?.grand_total,
      details: Array.isArray(created?.details)
        ? (created.details as Array<Record<string, unknown>>).map((d) => ({
            cost_head: d.cost_head,
            unit_cost: d.unit_cost,
            total_cost: d.total_cost,
          }))
        : created?.details,
    });

    saved.push(mapParent(created));
  }

  // eslint-disable-next-line no-console
  console.info(LOG, "Saved cost breakdowns", {
    rfq: input.rfq,
    supplier: input.supplier,
    sq: input.supplier_quotation,
    parents: saved.length,
    lines: drafts.length,
    grand_total: sumLines(drafts),
    childRows: saved.flatMap((d) =>
      (d.details ?? []).map((r) => ({
        parent: d.name,
        item: d.item,
        cost_head: r.cost_head,
        amount: r.unit_cost,
      })),
    ),
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

/* ── Excel template + parse (item-wise) ────────────────────────────────── */

function pickCell(row: Record<string, unknown>, col: string): string {
  const entry = Object.entries(row).find(
    ([k]) => k.trim().toLowerCase() === col.toLowerCase(),
  );
  return entry ? String(entry[1] ?? "").trim() : "";
}

function hasColumn(keys: string[], col: string): boolean {
  return keys.some((k) => k.trim().toLowerCase() === col.toLowerCase());
}

function isLegacyExcel(keys: string[]): boolean {
  return (
    hasColumn(keys, "Cost Head") &&
    (hasColumn(keys, "Unit Cost") || hasColumn(keys, "Quantity"))
  );
}

export async function buildCostBreakdownTemplateBlob(options: {
  rfqName: string;
  items: Array<{ item_code: string; item_name?: string }>;
}): Promise<Blob> {
  const heads = await listActiveCostHeads();
  if (!heads.length) {
    throw new Error(
      "No active Cost Head Master records found. Cannot build Cost Breakdown Excel template.",
    );
  }

  const headLabels = heads.map((h) => costHeadDisplayName(h));
  const columns = buildCostBreakdownExcelColumns(heads);

  const rows: Array<Record<string, string | number>> = options.items.map(
    (item) => {
      const row: Record<string, string | number> = {
        "Item Code": item.item_code,
        "Item Name": item.item_name || item.item_code,
      };
      for (const label of headLabels) row[label] = 0;
      row.Total = 0;
      return row;
    },
  );

  if (!rows.length) {
    const row: Record<string, string | number> = {
      "Item Code": "",
      "Item Name": "",
    };
    for (const label of headLabels) row[label] = 0;
    row.Total = 0;
    rows.push(row);
  }

  const sheet = XLSX.utils.json_to_sheet(rows, {
    header: columns,
  });
  sheet["!freeze"] = { xSplit: 0, ySplit: 1 };
  sheet["!cols"] = [
    { wch: 16 },
    { wch: 28 },
    ...headLabels.map(() => ({ wch: 14 })),
    { wch: 12 },
  ];

  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, "Cost Breakdown");

  const headRows = heads.map((h) => ({
    "Sort Order": Number(h.sort_order) || 0,
    "Cost Head": costHeadDisplayName(h),
    "ERP Name": h.name,
    Active: h.is_active === 0 ? 0 : 1,
  }));
  XLSX.utils.book_append_sheet(
    book,
    XLSX.utils.json_to_sheet(headRows),
    "Cost Heads",
  );

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

function finalizeParseResult(
  issues: ExcelValidationIssue[],
  lines: CostBreakdownLineDraft[],
  items: ItemCostBreakdownDraft[],
): ExcelParseResult {
  const errorIssues = issues.filter((i) => i.severity === "error");
  const failedRowSet = new Set(
    errorIssues.map((i) => i.row).filter((r) => r > 1),
  );
  const failed_rows = [...failedRowSet].sort((a, b) => a - b);
  const valid_lines = lines.filter(
    (l) => !l.excel_row || !failedRowSet.has(l.excel_row),
  );
  const result: ExcelParseResult = {
    ok: errorIssues.length === 0,
    issues,
    lines,
    valid_lines,
    failed_rows,
    grand_total: sumLines(valid_lines),
    items,
  };

  // eslint-disable-next-line no-console
  console.info("[CostBreakdown Excel] Validation result", {
    ok: result.ok,
    issueCount: issues.length,
    lineCount: lines.length,
    itemCount: items.length,
    validCount: valid_lines.length,
    failed_rows,
    issues,
  });
  // eslint-disable-next-line no-console
  console.info("[CostBreakdown Excel] Failed rows", failed_rows);
  // eslint-disable-next-line no-console
  console.info(
    "[CostBreakdown Excel] Error messages",
    errorIssues.map((e) => ({
      row: e.row,
      column: e.column,
      item_code: e.item_code,
      message: e.message,
    })),
  );

  return result;
}

export async function parseCostBreakdownExcel(
  file: File,
  options: {
    allowedItemCodes: string[];
    itemNames?: Record<string, string>;
    /** RFQ items with qty / quoted unit price for card population. */
    rfqItems?: Array<{
      item_code: string;
      item_name?: string;
      qty?: number;
      unit_price?: number;
    }>;
  },
): Promise<ExcelParseResult> {
  const buffer = await file.arrayBuffer();
  const book = XLSX.read(buffer, { type: "array" });
  const sheetName = book.SheetNames[0];
  if (!sheetName) {
    return finalizeParseResult(
      [{ row: 0, message: "Excel file has no sheets.", severity: "error" }],
      [],
      [],
    );
  }

  const sheet = book.Sheets[sheetName];
  const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    defval: "",
  });

  // eslint-disable-next-line no-console
  console.info("[CostBreakdown Excel] Parsed Excel", {
    sheetName,
    rowCount: rawRows.length,
    rows: rawRows,
  });

  const issues: ExcelValidationIssue[] = [];
  if (!rawRows.length) {
    issues.push({
      row: 0,
      message: "Excel has no data rows.",
      severity: "error",
    });
  }

  const keys = Object.keys(rawRows[0] ?? {});
  const heads = await listActiveCostHeads();
  const allowedItems = new Set(options.allowedItemCodes);
  const rfqMeta = new Map(
    (options.rfqItems ?? []).map((i) => [i.item_code.trim(), i]),
  );

  // ── Legacy row-wise format (Cost Head + Unit Cost) ────────────────────
  if (rawRows.length > 0 && isLegacyExcel(keys)) {
    for (const col of COST_BREAKDOWN_EXCEL_COLUMNS_LEGACY) {
      if (col === "Total Cost" || col === "Description") continue;
      if (!hasColumn(keys, col)) {
        issues.push({
          row: 1,
          column: col,
          message: `Missing required column: ${col}`,
          severity: "error",
        });
      }
    }

    const headByName = new Map<string, string>();
    for (const h of heads) {
      headByName.set((h.cost_head_name || h.name).toLowerCase(), h.name);
      headByName.set(h.name.toLowerCase(), h.name);
    }

    const lines: CostBreakdownLineDraft[] = [];
    rawRows.forEach((row, idx) => {
      const excel_row = idx + 2;
      const item_code = pickCell(row, "Item Code");
      const costHeadRaw = pickCell(row, "Cost Head");
      const qtyRaw = pickCell(row, "Quantity");
      const unitRaw = pickCell(row, "Unit Cost");
      if (!item_code && !costHeadRaw && !qtyRaw && !unitRaw) return;

      const quantity = Number(qtyRaw);
      const unit_cost = Number(unitRaw);
      const resolvedHead =
        resolveCostHeadName(costHeadRaw, heads) ||
        headByName.get(costHeadRaw.toLowerCase()) ||
        "";
      if (costHeadRaw && !resolvedHead) {
        issues.push({
          row: excel_row,
          column: "Cost Head",
          item_code,
          message: "Invalid Cost Head",
          severity: "error",
        });
      }

      lines.push({
        id: generateId(),
        item_code,
        item_name:
          pickCell(row, "Item Name") ||
          options.itemNames?.[item_code] ||
          item_code,
        cost_head: resolvedHead,
        description: pickCell(row, "Description"),
        quantity: Number.isFinite(quantity) ? quantity : NaN,
        unit_cost: Number.isFinite(unit_cost) ? unit_cost : NaN,
        total_cost:
          Number.isFinite(quantity) && Number.isFinite(unit_cost)
            ? lineTotal(quantity, unit_cost)
            : 0,
        excel_row,
      });
    });

    const allowedHeads = new Set(heads.map((h) => h.name));
    issues.push(...validateLines(lines, allowedHeads, allowedItems));

    const items = buildItemDrafts({
      items: options.rfqItems?.length
        ? options.rfqItems
        : [...new Set(lines.map((l) => l.item_code))]
            .filter(Boolean)
            .map((code) => ({
              item_code: code,
              item_name: options.itemNames?.[code] || code,
            })),
      heads,
      existingLines: lines,
    });

    return finalizeParseResult(issues, lines, items);
  }

  // ── Item-wise format (one row per item, cost heads as columns) ────────
  if (!heads.length) {
    issues.push({
      row: 0,
      message:
        "No active Cost Head Master records found. Cannot import Cost Breakdown Excel.",
      severity: "error",
    });
    return finalizeParseResult(issues, [], []);
  }

  const headLabels = heads.map((h) => costHeadDisplayName(h));
  const reservedCols = new Set(
    ["item code", "item name", "total", "total cost", "description", "quantity", "unit cost"],
  );

  // Require every active Cost Head Master column (by display name or ERP name).
  for (const h of heads) {
    const label = costHeadDisplayName(h);
    const has =
      hasColumn(keys, label) ||
      hasColumn(keys, h.name) ||
      (h.cost_head_name ? hasColumn(keys, h.cost_head_name) : false);
    if (rawRows.length > 0 && !has) {
      issues.push({
        row: 1,
        column: label,
        message: `Missing required Cost Head column: ${label}`,
        severity: "error",
      });
    }
  }

  if (rawRows.length > 0 && !hasColumn(keys, "Item Code")) {
    issues.push({
      row: 1,
      column: "Item Code",
      message: "Missing required column: Item Code",
      severity: "error",
    });
  }

  // Unknown numeric columns (e.g. legacy "Overhead") → Invalid Cost Head.
  for (const key of keys) {
    const k = key.trim();
    if (!k || reservedCols.has(k.toLowerCase())) continue;
    if (resolveCostHeadName(k, heads)) continue;
    const used = rawRows.some((row) => {
      const v = String(row[key] ?? "").trim();
      if (!v) return false;
      const n = Number(v);
      return Number.isFinite(n) && n !== 0;
    });
    if (used) {
      issues.push({
        row: 1,
        column: k,
        message: "Invalid Cost Head",
        severity: "error",
      });
    }
  }

  const itemDrafts: ItemCostBreakdownDraft[] = [];
  const lines: CostBreakdownLineDraft[] = [];

  function pickHeadCell(
    row: Record<string, unknown>,
    entry: ItemCostHeadEntry,
  ): string {
    return (
      pickCell(row, entry.label) ||
      pickCell(row, entry.cost_head) ||
      ""
    );
  }

  rawRows.forEach((row, idx) => {
    const excel_row = idx + 2;
    const item_code = pickCell(row, "Item Code");
    if (!item_code) {
      const anyHead = headLabels.some((h) => pickCell(row, h));
      if (!anyHead) return;
      issues.push({
        row: excel_row,
        column: "Item Code",
        message: "Item Code is required.",
        severity: "error",
      });
      return;
    }

    if (allowedItems.size > 0 && !allowedItems.has(item_code)) {
      issues.push({
        row: excel_row,
        column: "Item Code",
        item_code,
        message: `Item "${item_code}" is not on this RFQ.`,
        severity: "error",
      });
    }

    const meta = rfqMeta.get(item_code);
    const headEntries = emptyItemHeads(heads);
    let rowTotal = 0;

    for (const entry of headEntries) {
      const raw = pickHeadCell(row, entry);
      if (!raw) {
        entry.amount = 0;
        continue;
      }
      const amount = Number(raw);
      if (!Number.isFinite(amount) || amount < 0) {
        issues.push({
          row: excel_row,
          column: entry.label,
          item_code,
          message: `${entry.label} must be a non-negative number.`,
          severity: "error",
        });
        entry.amount = Number.isFinite(amount) ? amount : NaN;
        continue;
      }
      entry.amount = roundMoney(amount);
      rowTotal = roundMoney(rowTotal + entry.amount);

      // Always persist ERP Cost Head Master.name
      const resolved =
        resolveCostHeadName(entry.cost_head, heads) ||
        resolveCostHeadName(entry.label, heads);
      if (entry.amount > 0 && !resolved) {
        issues.push({
          row: excel_row,
          column: entry.label,
          item_code,
          message: "Invalid Cost Head",
          severity: "error",
        });
        continue;
      }
      if (resolved) entry.cost_head = resolved;

      if (entry.amount > 0 && resolved) {
        lines.push({
          id: generateId(),
          item_code,
          item_name:
            pickCell(row, "Item Name") ||
            meta?.item_name ||
            options.itemNames?.[item_code] ||
            item_code,
          cost_head: resolved,
          description: "",
          quantity: 1,
          unit_cost: entry.amount,
          total_cost: entry.amount,
          excel_row,
        });
      }
    }

    const totalCell = pickCell(row, "Total");
    if (totalCell) {
      const declared = Number(totalCell);
      if (Number.isFinite(declared) && Math.abs(declared - rowTotal) > BALANCE_EPSILON) {
        issues.push({
          row: excel_row,
          column: "Total",
          item_code,
          message: `Total column (${declared}) does not match sum of cost heads (${rowTotal}).`,
          severity: "error",
        });
      }
    }

    if (!(rowTotal > 0)) {
      issues.push({
        row: excel_row,
        item_code,
        message: "Enter at least one cost-head amount for this item.",
        severity: "error",
      });
    }

    itemDrafts.push({
      item_code,
      item_name:
        pickCell(row, "Item Name") ||
        meta?.item_name ||
        options.itemNames?.[item_code] ||
        item_code,
      qty: Number(meta?.qty) || 0,
      quoted_unit_price: Number(meta?.unit_price) || 0,
      heads: headEntries,
      excel_row,
    });
  });

  // Merge onto full RFQ item list so every card is populated / blank.
  const merged = buildItemDrafts({
    items: options.rfqItems?.length
      ? options.rfqItems
      : itemDrafts.map((i) => ({
          item_code: i.item_code,
          item_name: i.item_name,
          qty: i.qty,
          unit_price: i.quoted_unit_price,
        })),
    heads,
  });

  const uploadedByCode = new Map(itemDrafts.map((i) => [i.item_code, i]));
  for (const item of merged) {
    const uploaded = uploadedByCode.get(item.item_code);
    if (!uploaded) continue;
    item.heads = uploaded.heads;
    item.excel_row = uploaded.excel_row;
  }

  return finalizeParseResult(issues, lines, merged);
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
