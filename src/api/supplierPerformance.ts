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
  has_delivery_data?: boolean;
  has_quality_data?: boolean;
  has_reliability_data?: boolean;
  unavailable_metrics?: string[];
  /** Billing dates describe invoice submission, not actual payment history. */
  invoice_timeliness_basis?: string;
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
  items?: Array<{ name?: string; qty?: number; schedule_date?: string }>;
}

interface GRNRow {
  name: string;
  supplier: string;
  supplier_name?: string;
  posting_date?: string;
  status?: string;
  per_returned?: number;
  is_return?: number;
  items?: Array<{
    purchase_order?: string;
    purchase_order_item?: string;
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
}

async function fetchSupplierGRNs(supplierNames: string[]): Promise<GRNRow[]> {
  if (supplierNames.length === 0) return [];
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
}

async function fetchSupplierInvoices(supplierNames: string[]): Promise<InvoiceRow[]> {
  if (supplierNames.length === 0) return [];
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
}

async function hydrateDocuments<T extends { name: string; supplier: string }>(
  doctype: string,
  rows: T[],
): Promise<T[]> {
  return Promise.all(rows.map(async (row) => {
    try {
      const document = await apiGet<T>(buildResourceUrl(doctype, row.name), withSilent());
      // A document fetched by its ID must still belong to that exact supplier.
      return document.name === row.name && document.supplier === row.supplier
        ? document : row;
    } catch {
      // The header remains evidence of the order, but missing line details
      // make dependent delivery/quality metrics unavailable below.
      return row;
    }
  }));
}

function nonnegativeNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function dateMillis(value: string | undefined): number | null {
  if (!value) return null;
  const millis = Date.parse(value);
  return Number.isFinite(millis) ? millis : null;
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
  if (import.meta.env.DEV) console.log("[SupplierPerformance] Fetching historical data for:", unique);

  const [poResult, grnResult, invoiceResult] = await Promise.allSettled([
    fetchSupplierPOs(unique),
    fetchSupplierGRNs(unique),
    fetchSupplierInvoices(unique),
  ]);
  const [allPOs, allGRNs] = await Promise.all([
    hydrateDocuments("Purchase Order", poResult.status === "fulfilled" ? poResult.value : []),
    hydrateDocuments("Purchase Receipt", grnResult.status === "fulfilled" ? grnResult.value : []),
  ]);
  const allInvoices = invoiceResult.status === "fulfilled" ? invoiceResult.value : [];

  // eslint-disable-next-line no-console
  if (import.meta.env.DEV) console.log("[SupplierPerformance] Raw data:", {
    pos: allPOs.length,
    grns: allGRNs.length,
    invoices: allInvoices.length,
  });

  const result: HistoricalPerformanceMap = {};

  for (const name of unique) {
    const matchesSupplier = (row: { supplier: string; supplier_name?: string }) =>
      row.supplier === name;

    const pos = allPOs.filter(matchesSupplier);
    const grns = allGRNs.filter((row) => matchesSupplier(row) && !row.is_return);
    const invoices = allInvoices.filter(matchesSupplier);

    const totalPOs = pos.length;
    const completedPOs = pos.filter(
      (p) => p.status === "Completed" || (p.per_received ?? 0) >= 100
    ).length;
    const cancelledPOs = pos.filter((p) => p.status === "Cancelled").length;
    const totalPOValue = pos.reduce((s, p) => s + (p.grand_total ?? 0), 0);

    // Delivery: match each receipt line to its actual PO and, when supplied,
    // PO child row. Never compare an unrelated first order from this supplier.
    const ordersById = new Map(pos.map((po) => [po.name, po]));
    let onTime = 0;
    let late = 0;
    let totalDelayDays = 0;
    let deliveryComplete = grnResult.status === "fulfilled" && poResult.status === "fulfilled";
    let qualityComplete = deliveryComplete && pos.length > 0 && grns.length > 0;
    let totalReceivedQty = 0;
    let totalRejectedQty = 0;
    for (const grn of grns) {
      const posted = dateMillis(grn.posting_date);
      const delays: number[] = [];
      let receiptComplete = posted !== null && !!grn.items?.length;
      if (!grn.items?.length) qualityComplete = false;
      for (const item of grn.items ?? []) {
        const order = item.purchase_order ? ordersById.get(item.purchase_order) : undefined;
        const orderLine = item.purchase_order_item
          ? order?.items?.find((line) => line.name === item.purchase_order_item)
          : undefined;
        const linked = !!order && (!item.purchase_order_item || !!orderLine);
        const expected = linked ? dateMillis(orderLine?.schedule_date || order?.schedule_date) : null;
        if (posted === null || expected === null) receiptComplete = false;
        else delays.push(Math.round((posted - expected) / 86_400_000));

        if (!linked || !nonnegativeNumber(item.received_qty) || !nonnegativeNumber(item.rejected_qty) ||
            item.rejected_qty > item.received_qty) {
          qualityComplete = false;
        } else {
          totalReceivedQty += item.received_qty;
          totalRejectedQty += item.rejected_qty;
        }
      }
      if (!receiptComplete || !delays.length) { deliveryComplete = false; continue; }
      // A multi-order receipt is late if any included commitment was missed.
      const delay = Math.max(...delays);
      if (delay <= 0) onTime++;
      else { late++; totalDelayDays += delay; }
    }
    const avgDelayDays = late > 0 ? totalDelayDays / late : 0;

    // Keep the established accepted/ordered formula, using actual line
    // quantities. PO percentages are never treated as physical quantities.
    let totalOrderedQty = 0;
    for (const order of pos) {
      if (!order.items?.length) qualityComplete = false;
      for (const item of order.items ?? []) {
        if (!nonnegativeNumber(item.qty)) qualityComplete = false;
        else totalOrderedQty += item.qty;
      }
    }

    // Invoice timeliness
    const invoicesOnTime = invoices.filter((inv) => {
      const due = dateMillis(inv.due_date);
      const posted = dateMillis(inv.posting_date);
      return due !== null && posted !== null && posted <= due;
    }).length;

    const dataSources: string[] = [];
    if (totalPOs > 0) dataSources.push(`${totalPOs} Purchase Orders`);
    if (grns.length > 0) dataSources.push(`${grns.length} GRNs`);
    if (invoices.length > 0) dataSources.push(`${invoices.length} Invoices`);
    const dataPointsCount = totalPOs + grns.length + invoices.length;

    const deliveryScore = deliveryComplete ? computeDeliveryScore(totalPOs, onTime, late, avgDelayDays) : -1;
    const qualityScore = qualityComplete ? computeQualityScore(
      totalOrderedQty,
      totalReceivedQty,
      totalRejectedQty,
    ) : -1;
    const reliabilityComplete = poResult.status === "fulfilled" && invoiceResult.status === "fulfilled" &&
      invoices.every((invoice) => dateMillis(invoice.due_date) !== null && dateMillis(invoice.posting_date) !== null);
    const reliabilityScore = reliabilityComplete ? computeReliabilityScore(
      totalPOs,
      completedPOs,
      cancelledPOs,
      invoicesOnTime,
      invoices.length
    ) : -1;

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
      total_rejected_qty: totalRejectedQty,
      qty_accuracy_pct: qualityComplete && totalOrderedQty > 0
        ? Math.round(((totalReceivedQty - totalRejectedQty) / totalOrderedQty) * 100 * 10) / 10
        : -1,
      total_invoices: invoices.length,
      invoices_on_time: invoicesOnTime,
      delivery_score: deliveryScore,
      quality_score: qualityScore,
      reliability_score: reliabilityScore,
      has_sufficient_data: [deliveryScore, qualityScore, reliabilityScore].every((score) => score >= 0),
      has_delivery_data: deliveryScore >= 0,
      has_quality_data: qualityScore >= 0,
      has_reliability_data: reliabilityScore >= 0,
      unavailable_metrics: [deliveryScore < 0 ? "delivery" : "", qualityScore < 0 ? "quality" : "",
        reliabilityScore < 0 ? "reliability" : ""].filter(Boolean),
      invoice_timeliness_basis: "Invoice posting date compared with its due date; actual payment history is unavailable.",
      data_sources: dataSources,
      data_points_count: dataPointsCount,
    };
  }

  // eslint-disable-next-line no-console
  if (import.meta.env.DEV) console.log("[SupplierPerformance] Computed performance:", result);

  return result;
}
