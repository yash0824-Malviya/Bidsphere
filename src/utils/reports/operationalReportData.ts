import { format, parseISO, startOfMonth, subMonths } from "date-fns";

import type { Filter } from "../../api/erpnext";
import {
  apiGet,
  buildListConfig,
  buildResourceUrl,
  withSilent,
} from "../../api/erpnext";
import { getGrnList, type GrnListRow } from "../../api/purchasing";
import {
  getSupplierPerformance,
  type SupplierPerformanceData,
} from "../../api/supplierPerformance";
import type { PurchaseOrder } from "../../types/erpnext";

const PO_DOCTYPE = "Purchase Order";

/**
 * Proven list fields — same set used by Purchase Orders list page
 * (`PurchaseOrdersPage`), which already loads successfully against this ERP.
 */
export const PO_CORE_FIELDS = [
  "name",
  "supplier",
  "supplier_name",
  "transaction_date",
  "creation",
  "status",
  "grand_total",
  "per_received",
  "per_billed",
  "currency",
] as const;

/**
 * Enrichment fields tried after the proven core set succeeds.
 * Missing fields are stripped on ERP "Field not permitted" and hidden in UI.
 */
export const PO_OPTIONAL_FIELDS = [
  "schedule_date",
  "owner",
  "company",
  "modified",
  "cost_center",
  "department",
] as const;

/** @deprecated Prefer PO_CORE_FIELDS + PO_OPTIONAL_FIELDS. */
export const REPORT_PO_FIELDS = [
  ...PO_CORE_FIELDS,
  ...PO_OPTIONAL_FIELDS,
] as const;

/** Absolute minimum if even proven fields are rejected one-by-one. */
const PO_MINIMAL_FIELDS = [
  "name",
  "supplier",
  "status",
  "transaction_date",
  "grand_total",
] as const;

export type ReportPo = PurchaseOrder & {
  cost_center?: string;
  department?: string;
  owner?: string;
  company?: string;
};

export interface ReportPoFetchResult {
  rows: ReportPo[];
  /** Fields successfully used in the last successful query. */
  availableFields: string[];
  /** Fields removed because ERP rejected them. */
  removedFields: string[];
}

function isDev(): boolean {
  try {
    return Boolean(import.meta.env?.DEV);
  } catch {
    return false;
  }
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  const axiosErr = err as {
    response?: { status?: number; data?: unknown };
    message?: string;
  };
  const axiosData = axiosErr?.response?.data;
  if (typeof axiosData === "string") return axiosData;
  if (axiosData && typeof axiosData === "object") {
    const d = axiosData as {
      message?: unknown;
      exc?: unknown;
      _server_messages?: unknown;
    };
    if (typeof d.message === "string" && d.message) return d.message;
    if (typeof d.exc === "string" && d.exc) return d.exc;
    if (typeof d._server_messages === "string") return d._server_messages;
  }
  if (typeof axiosErr?.message === "string" && axiosErr.message) {
    return axiosErr.message;
  }
  try {
    return JSON.stringify(err);
  } catch {
    return String(err ?? "");
  }
}

function httpStatus(err: unknown): number | undefined {
  return (err as { response?: { status?: number } })?.response?.status;
}

function extractForbiddenField(err: unknown): string | null {
  const msg = errorMessage(err);
  const match = /Field not permitted in query:\s*([A-Za-z0-9_]+)/i.exec(msg);
  return match?.[1] ?? null;
}

function isFieldPermissionError(err: unknown): boolean {
  return /Field not permitted in query|DataError|Unknown column|No field named/i.test(
    errorMessage(err),
  );
}

function isPermissionDenied(err: unknown): boolean {
  const status = httpStatus(err);
  if (status === 403) return true;
  return /permission|not permitted to read|insufficient permission/i.test(
    errorMessage(err),
  );
}

function uniqueFields(fields: string[]): string[] {
  return Array.from(new Set(fields.filter(Boolean)));
}

function normalizePoRows(response: unknown): ReportPo[] {
  if (Array.isArray(response)) return response as ReportPo[];
  if (response && typeof response === "object") {
    const obj = response as { data?: unknown; message?: unknown };
    if (Array.isArray(obj.data)) return obj.data as ReportPo[];
    if (Array.isArray(obj.message)) return obj.message as ReportPo[];
  }
  return [];
}

/**
 * Fetch Purchase Orders for operational reports.
 *
 * - Starts with proven list fields (same as Purchase Orders page).
 * - Retries after stripping ERP-rejected fields.
 * - Never silently swallows non-field errors — logs the exact error and throws.
 * - A successful empty list (`[]`) is valid (no POs in ERP for this user).
 */
export async function fetchReportPurchaseOrders(
  limit = 500,
): Promise<ReportPoFetchResult> {
  const removedFields: string[] = [];
  let fields = uniqueFields([...PO_CORE_FIELDS, ...PO_OPTIONAL_FIELDS]);
  const url = buildResourceUrl(PO_DOCTYPE);

  for (let attempt = 0; attempt < 16; attempt++) {
    if (fields.length === 0) {
      const err = new Error(
        "Purchase Order query has no remaining permitted fields.",
      );
      console.error("Purchase Order API error:", err.message);
      throw err;
    }

    const listConfig = buildListConfig({
      fields,
      limit_page_length: limit,
      // Match working PO list ordering; fall back handled if modified stripped.
      order_by: fields.includes("modified")
        ? "modified desc"
        : fields.includes("transaction_date")
          ? "transaction_date desc, name desc"
          : "name desc",
    });
    // Silent only for schema probes — real failures are re-thrown below.
    const config = withSilent(listConfig);
    const params = listConfig.params;

    console.log("Purchase Order API:", url);
    console.log("Request:", params);

    try {
      const response = await apiGet<unknown>(url, config);
      console.log("ERP Response:", response);

      const orders = normalizePoRows(response);
      console.log("Purchase Orders:", orders);

      if (!Array.isArray(response) && orders.length === 0 && response != null) {
        console.warn(
          "Purchase Order API: response was not an array — parsed as empty.",
          { responseType: typeof response, response },
        );
      }

      if (orders.length === 0) {
        console.warn(
          "Purchase Order API: ERP returned 0 records. " +
            "This is a successful empty result (not an error). " +
            "Check ERP permissions / whether POs exist for this company.",
          { url, params, removedFields: [...removedFields] },
        );
      }

      return {
        rows: orders,
        availableFields: [...fields],
        removedFields: uniqueFields(removedFields),
      };
    } catch (err) {
      const message = errorMessage(err);
      const status = httpStatus(err);
      console.error("Purchase Order API error:", {
        message,
        status,
        url,
        params,
        attempt: attempt + 1,
        requestedFields: fields,
        removedFields: [...removedFields],
        raw: err,
      });

      const forbidden = extractForbiddenField(err);
      if (forbidden && fields.includes(forbidden)) {
        fields = fields.filter((f) => f !== forbidden);
        removedFields.push(forbidden);
        console.warn(
          `Purchase Order API: removed unsupported field "${forbidden}", retrying…`,
        );
        continue;
      }

      if (isFieldPermissionError(err)) {
        // Drop unknown bad field(s): peel optionals first, then fall to minimal.
        const before = fields.join(",");
        if (fields.some((f) => (PO_OPTIONAL_FIELDS as readonly string[]).includes(f))) {
          fields = fields.filter(
            (f) => !(PO_OPTIONAL_FIELDS as readonly string[]).includes(f),
          );
          for (const opt of PO_OPTIONAL_FIELDS) {
            if (!removedFields.includes(opt)) removedFields.push(opt);
          }
        } else if (
          fields.length >
          PO_MINIMAL_FIELDS.filter((f) => !removedFields.includes(f)).length
        ) {
          for (const f of fields) {
            if (!(PO_MINIMAL_FIELDS as readonly string[]).includes(f)) {
              removedFields.push(f);
            }
          }
          fields = uniqueFields(
            PO_MINIMAL_FIELDS.filter((f) => !removedFields.includes(f)),
          );
        } else {
          // Cannot recover — surface the exact ERP error.
          throw err instanceof Error ? err : new Error(message);
        }
        if (fields.join(",") !== before) {
          console.warn(
            "Purchase Order API: field error — retrying with reduced fields",
            { fields, removedFields: [...removedFields] },
          );
          continue;
        }
      }

      if (isPermissionDenied(err)) {
        throw new Error(
          `Permission denied reading Purchase Order` +
            (status ? ` (HTTP ${status})` : "") +
            `: ${message}`,
        );
      }

      // Non-field failure — never replace with [].
      throw err instanceof Error ? err : new Error(message);
    }
  }

  throw new Error("Purchase Order query exceeded retry limit.");
}

/** Convenience: true when the last fetch (or a field list) includes `field`. */
export function reportPoHasField(
  availableFields: string[] | undefined,
  field: string,
): boolean {
  if (!availableFields || availableFields.length === 0) return false;
  return availableFields.includes(field);
}

export async function fetchReportGrns(limit = 500): Promise<GrnListRow[]> {
  return getGrnList({ limit });
}

export async function fetchSupplierPerformanceForPos(
  pos: ReportPo[],
): Promise<SupplierPerformanceData[]> {
  const names = Array.from(
    new Set(pos.map((p) => p.supplier).filter(Boolean)),
  );
  if (names.length === 0) return [];
  const map = await getSupplierPerformance(names.slice(0, 80));
  return Object.values(map);
}

export function isOpenPoStatus(status?: string): boolean {
  const s = (status || "").toLowerCase();
  return (
    s.includes("to receive") ||
    s.includes("to bill") ||
    s === "on hold" ||
    s === "to approve"
  );
}

export function isCompletedPoStatus(status?: string): boolean {
  const s = (status || "").toLowerCase();
  return s === "completed" || s === "closed";
}

export function isCancelledPoStatus(status?: string): boolean {
  const s = (status || "").toLowerCase();
  return s.includes("cancel");
}

export function isDraftPoStatus(status?: string): boolean {
  const s = (status || "").toLowerCase();
  return !s || s === "draft";
}

export function daysBetween(from?: string | null, to = new Date()): number {
  if (!from) return 0;
  const start = parseISO(from.slice(0, 10));
  if (Number.isNaN(start.getTime())) return 0;
  return Math.max(
    0,
    Math.floor((to.getTime() - start.getTime()) / 86_400_000),
  );
}

export function monthKey(iso?: string | null): string | null {
  if (!iso) return null;
  try {
    return format(parseISO(iso.slice(0, 10)), "yyyy-MM");
  } catch {
    return null;
  }
}

export function lastNMonthLabels(n = 6): string[] {
  const out: string[] = [];
  const now = startOfMonth(new Date());
  for (let i = n - 1; i >= 0; i--) {
    out.push(format(subMonths(now, i), "yyyy-MM"));
  }
  return out;
}

export function formatMonthLabel(key: string): string {
  try {
    return format(parseISO(`${key}-01`), "MMM yyyy");
  } catch {
    return key;
  }
}

export function buildPoTrend(
  pos: ReportPo[],
  months = 6,
): Array<{ month: string; count: number; value: number }> {
  const keys = lastNMonthLabels(months);
  const map = new Map(
    keys.map((k) => [k, { month: formatMonthLabel(k), count: 0, value: 0 }]),
  );
  for (const po of pos) {
    const k = monthKey(po.transaction_date || po.creation);
    if (!k || !map.has(k)) continue;
    const row = map.get(k)!;
    row.count += 1;
    row.value += Number(po.grand_total) || 0;
  }
  return keys.map((k) => map.get(k)!);
}

export function statusDistribution(
  pos: ReportPo[],
): Array<{ name: string; value: number }> {
  const counts = new Map<string, number>();
  for (const po of pos) {
    const name = po.status || "Draft";
    counts.set(name, (counts.get(name) || 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value);
}

export function supplierDistribution(
  pos: ReportPo[],
  topN = 8,
): Array<{ name: string; value: number; count: number }> {
  const map = new Map<string, { value: number; count: number }>();
  for (const po of pos) {
    const name = po.supplier_name || po.supplier || "Unknown";
    const cur = map.get(name) || { value: 0, count: 0 };
    cur.value += Number(po.grand_total) || 0;
    cur.count += 1;
    map.set(name, cur);
  }
  return Array.from(map.entries())
    .map(([name, v]) => ({ name, ...v }))
    .sort((a, b) => b.value - a.value)
    .slice(0, topN);
}

export function activeDeliveryFilter(): Filter[] {
  return [
    ["docstatus", "=", 1],
    ["status", "in", ["To Receive and Bill", "To Receive"]],
  ];
}

export function isGrnOverdue(grn: GrnListRow): boolean {
  if (!grn.posting_date) return false;
  if ((grn.status || "").toLowerCase() === "completed") return false;
  const today = format(new Date(), "yyyy-MM-dd");
  return grn.posting_date.slice(0, 10) < today;
}

export function isGrnToday(grn: GrnListRow): boolean {
  if (!grn.posting_date && !grn.creation) return false;
  const today = format(new Date(), "yyyy-MM-dd");
  const d = (grn.posting_date || grn.creation || "").slice(0, 10);
  return d === today;
}
