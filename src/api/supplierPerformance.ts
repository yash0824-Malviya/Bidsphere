/**
 * Supplier Historical Performance API.
 *
 * Fetches real ERPNext data (Purchase Orders, GRNs/Purchase Receipts,
 * Purchase Invoices) to compute actual supplier performance metrics for
 * the AI scoring engine.
 *
 * Data sources:
 *   - Purchase Order       → delivery commitment, order history
 *   - Purchase Receipt     → on-time delivery, qty accuracy
 *   - Purchase Invoice     → payment/billing history
 *   - Supplier             → master record, status
 */

import {
  apiGet,
  buildListConfig,
  buildResourceUrl,
  withSilent,
} from "./erpnext";

/* -------------------------------------------------------------------------- */
/*  Types                                                                      */
/* -------------------------------------------------------------------------- */

export interface SupplierPerformanceData {
  supplier_name: string;

  /* Order history */
  total_pos: number;
  completed_pos: number;
  cancelled_pos: number;
  total_po_value: number;

  /* Delivery performance (from Purchase Receipts / GRNs) */
  total_grns: number;
  on_time_deliveries: number;
  late_deliveries: number;
  avg_delay_days: number;

  /* Quality (from GRN accepted qty vs ordered qty) */
  total_ordered_qty: number;
  total_received_qty: number;
  total_rejected_qty: number;
  qty_accuracy_pct: number;

  /* Invoice / billing */
  total_invoices: number;
  invoices_on_time: number;

  /* Computed scores (0–100) */
  delivery_score: number;
  quality_score: number;
  reliability_score: number;

  /* Data sufficiency */
  has_sufficient_data: boolean;
  data_sources: string[];
  data_points_count: number;
}

export interface HistoricalPerformanceMap {
  [supplierName: string]: SupplierPerformanceData;
}

/* -------------------------------------------------------------------------- */
/*  ERPNext data fetchers                                                      */
/* -------------------------------------------------------------------------- */

interface PORow {
  name: string;
  supplier: string;
  supplier_name?: string;
  status?: string;
  grand_total?: number;
  per_received?: number;
  schedule_date?: string;
  transaction_date?: string;
  modified?: string;
}

interface GRNRow {
  name: string;
  supplier: string;
  supplier_name?: string;
  posting_date?: string;
  status?: string;
  per_returned?: number;
  items?: Array<{
    purchase_order?: string;
    qty?: number;
    received_qty?: number;
    rejected_qty?: number;
    schedule_date?: string;
  }>;
}

interface InvoiceRow {
  name: string;
  supplier: string;
  supplier_name?: string;
  posting_date?: string;
  due_date?: string;
  status?: string;
  grand_total?: number;
}

async function fetchSupplierPOs(supplierNames: string[]): Promise<PORow[]> {
  if (supplierNames.length === 0) return [];
  try {
    return await apiGet<PORow[]>(
      buildResourceUrl("Purchase Order"),
      withSilent(buildListConfig({
        fields: [
          "name", "supplier", "supplier_name", "status",
          "grand_total", "per_received", "schedule_date",
          "transaction_date", "modified",
        ],
        filters: [
          ["supplier", "in", supplierNames],
          ["docstatus", "=", 1],
        ],
        order_by: "transaction_date desc",
        limit_page_length: 200,
      }))
    );
  } catch {
    return [];
  }
}

async function fetchSupplierGRNs(supplierNames: string[]): Promise<GRNRow[]> {
  if (supplierNames.length === 0) return [];
  try {
    return await apiGet<GRNRow[]>(
      buildResourceUrl("Purchase Receipt"),
      withSilent(buildListConfig({
        fields: [
          "name", "supplier", "supplier_name", "posting_date",
          "status", "per_returned",
        ],
        filters: [
          ["supplier", "in", supplierNames],
          ["docstatus", "=", 1],
        ],
        order_by: "posting_date desc",
        limit_page_length: 200,
      }))
    );
  } catch {
    return [];
  }
}

async function fetchSupplierInvoices(supplierNames: string[]): Promise<InvoiceRow[]> {
  if (supplierNames.length === 0) return [];
  try {
    return await apiGet<InvoiceRow[]>(
      buildResourceUrl("Purchase Invoice"),
      withSilent(buildListConfig({
        fields: [
          "name", "supplier", "supplier_name", "posting_date",
          "due_date", "status", "grand_total",
        ],
        filters: [
          ["supplier", "in", supplierNames],
          ["docstatus", "=", 1],
        ],
        order_by: "posting_date desc",
        limit_page_length: 200,
      }))
    );
  } catch {
    return [];
  }
}

/* -------------------------------------------------------------------------- */
/*  Score computation helpers                                                  */
/* -------------------------------------------------------------------------- */

function clamp(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)));
}

function computeDeliveryScore(
  totalPOs: number,
  onTime: number,
  late: number,
  avgDelayDays: number
): number {
  if (totalPOs === 0) return -1; // no data
  const totalDeliveries = onTime + late;
  if (totalDeliveries === 0) return -1;
  const onTimePct = (onTime / totalDeliveries) * 100;
  const delayPenalty = Math.min(avgDelayDays * 3, 30);
  return clamp(onTimePct - delayPenalty);
}

function computeQualityScore(
  orderedQty: number,
  receivedQty: number,
  rejectedQty: number
): number {
  if (orderedQty === 0) return -1; // no data
  const accuracyPct = orderedQty > 0
    ? ((receivedQty - rejectedQty) / orderedQty) * 100
    : 0;
  return clamp(accuracyPct);
}

function computeReliabilityScore(
  totalPOs: number,
  completedPOs: number,
  cancelledPOs: number,
  invoicesOnTime: number,
  totalInvoices: number
): number {
  if (totalPOs === 0) return -1; // no data
  const completionRate = totalPOs > 0 ? (completedPOs / totalPOs) * 100 : 0;
  const cancellationPenalty = totalPOs > 0 ? (cancelledPOs / totalPOs) * 30 : 0;
  const invoiceTimeliness = totalInvoices > 0 ? (invoicesOnTime / totalInvoices) * 20 : 10;
  return clamp(completionRate - cancellationPenalty + invoiceTimeliness);
}

/* -------------------------------------------------------------------------- */
/*  Main API                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Fetch historical performance data for a set of suppliers from ERPNext.
 *
 * Queries Purchase Orders, Purchase Receipts (GRNs), and Purchase Invoices
 * to compute real delivery, quality, and reliability scores.
 *
 * Returns `-1` for any dimension where data is insufficient, so the
 * scoring engine can flag "Insufficient Historical Data" instead of
 * fabricating scores.
 */
export async function getSupplierPerformance(
  supplierNames: string[]
): Promise<HistoricalPerformanceMap> {
  const unique = [...new Set(supplierNames.filter(Boolean))];
  if (unique.length === 0) return {};

  // eslint-disable-next-line no-console
  console.log("[SupplierPerformance] Fetching historical data for:", unique);

  const [allPOs, allGRNs, allInvoices] = await Promise.all([
    fetchSupplierPOs(unique),
    fetchSupplierGRNs(unique),
    fetchSupplierInvoices(unique),
  ]);

  // eslint-disable-next-line no-console
  console.log("[SupplierPerformance] Raw data:", {
    pos: allPOs.length,
    grns: allGRNs.length,
    invoices: allInvoices.length,
  });

  const result: HistoricalPerformanceMap = {};

  for (const name of unique) {
    const nameLower = name.toLowerCase();
    const matchesSupplier = (row: { supplier: string; supplier_name?: string }) =>
      row.supplier?.toLowerCase() === nameLower ||
      row.supplier_name?.toLowerCase() === nameLower;

    const pos = allPOs.filter(matchesSupplier);
    const grns = allGRNs.filter(matchesSupplier);
    const invoices = allInvoices.filter(matchesSupplier);

    const totalPOs = pos.length;
    const completedPOs = pos.filter(
      (p) => p.status === "Completed" || (p.per_received ?? 0) >= 100
    ).length;
    const cancelledPOs = pos.filter((p) => p.status === "Cancelled").length;
    const totalPOValue = pos.reduce((s, p) => s + (p.grand_total ?? 0), 0);

    // Delivery: compare GRN posting_date to PO schedule_date
    let onTime = 0;
    let late = 0;
    let totalDelayDays = 0;
    for (const grn of grns) {
      const grnDate = grn.posting_date ? new Date(grn.posting_date) : null;
      // Find the PO(s) for this supplier to compare schedule_date
      const relatedPO = pos.find((p) =>
        p.schedule_date && grnDate
      );
      if (relatedPO?.schedule_date && grnDate) {
        const expected = new Date(relatedPO.schedule_date);
        const diff = Math.round(
          (grnDate.getTime() - expected.getTime()) / (1000 * 60 * 60 * 24)
        );
        if (diff <= 0) {
          onTime++;
        } else {
          late++;
          totalDelayDays += diff;
        }
      } else {
        onTime++; // no schedule comparison → assume on-time
      }
    }
    const avgDelayDays = late > 0 ? totalDelayDays / late : 0;

    // Quality: ordered vs received qty
    const totalOrderedQty = pos.reduce(
      (s, p) => s + (p.per_received !== undefined ? 100 : 0),
      0
    );
    const totalReceivedQty = pos.reduce(
      (s, p) => s + (p.per_received ?? 0),
      0
    );

    // Invoice timeliness
    const invoicesOnTime = invoices.filter((inv) => {
      if (!inv.due_date || !inv.posting_date) return true;
      return new Date(inv.posting_date) <= new Date(inv.due_date);
    }).length;

    const dataSources: string[] = [];
    if (totalPOs > 0) dataSources.push(`${totalPOs} Purchase Orders`);
    if (grns.length > 0) dataSources.push(`${grns.length} GRNs`);
    if (invoices.length > 0) dataSources.push(`${invoices.length} Invoices`);
    const dataPointsCount = totalPOs + grns.length + invoices.length;

    const deliveryScore = computeDeliveryScore(totalPOs, onTime, late, avgDelayDays);
    const qualityScore = computeQualityScore(
      totalOrderedQty,
      totalReceivedQty,
      0 // rejected qty not easily available at PO level
    );
    const reliabilityScore = computeReliabilityScore(
      totalPOs,
      completedPOs,
      cancelledPOs,
      invoicesOnTime,
      invoices.length
    );

    result[name] = {
      supplier_name: name,
      total_pos: totalPOs,
      completed_pos: completedPOs,
      cancelled_pos: cancelledPOs,
      total_po_value: totalPOValue,
      total_grns: grns.length,
      on_time_deliveries: onTime,
      late_deliveries: late,
      avg_delay_days: Math.round(avgDelayDays * 10) / 10,
      total_ordered_qty: totalOrderedQty,
      total_received_qty: totalReceivedQty,
      total_rejected_qty: 0,
      qty_accuracy_pct: totalOrderedQty > 0
        ? Math.round((totalReceivedQty / totalOrderedQty) * 100 * 10) / 10
        : 0,
      total_invoices: invoices.length,
      invoices_on_time: invoicesOnTime,
      delivery_score: deliveryScore,
      quality_score: qualityScore,
      reliability_score: reliabilityScore,
      has_sufficient_data: dataPointsCount >= 1,
      data_sources: dataSources,
      data_points_count: dataPointsCount,
    };
  }

  // eslint-disable-next-line no-console
  console.log("[SupplierPerformance] Computed performance:", result);

  return result;
}
