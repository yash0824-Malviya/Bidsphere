/**
 * Finance invoice workflow — the AP queue between Warehouse and Payments.
 *
 * Enterprise P2P flow (SAP Ariba / Oracle / Coupa):
 *   RFQ → Purchase Order → GRN (Warehouse) → Invoice (Finance) → Payment
 */

import { apiGet, buildListConfig, buildResourceUrl } from "./erpnext";
import { getPurchaseOrders, getPurchaseReceipts } from "./purchasing";
import { daysUntil } from "../utils/upcomingDeliveries";
import { getFinanceReviews } from "./financeReviews";
import { excludeVoucheredGRNs, getAllInvoices } from "./vouchers";

/** React Query key for Finance dashboard headline KPIs. */
export const FINANCE_DASHBOARD_METRICS_KEY = "finance-dashboard-metrics";

const LOG_TAG = "[Finance]";

/** A submitted GRN awaiting Finance invoice creation. */
export interface AwaitingInvoiceGRN {
  name: string;
  supplier: string;
  supplier_name?: string;
  posting_date?: string;
  status?: string;
  grand_total?: number;
  per_billed?: number;
  currency?: string;
}

/** Lightweight submitted-and-unpaid Purchase Invoice row for AP metrics. */
export interface PayableInvoiceLite {
  name: string;
  supplier?: string;
  supplier_name?: string;
  status?: string;
  docstatus?: number;
  due_date?: string;
  outstanding_amount?: number;
  grand_total?: number;
  paid_amount?: number;
  currency?: string;
  /** Distinguishes ERPNext Purchase Invoices from voucher-workflow invoices. */
  source?: "erpnext" | "voucher";
}

/** Open Purchase Order row for exposure calculations. */
export interface OpenPurchaseOrderLite {
  name: string;
  status?: string;
  grand_total?: number;
  per_billed?: number;
  currency?: string;
}

const EXCLUDED_PAYABLE_STATUSES = new Set([
  "Paid",
  "Cancelled",
  "Draft",
  "Return",
  "Debit Note Issued",
  "Internal Transfer",
]);

const AWAITING_PAYMENT_ERP_STATUSES = new Set([
  "Unpaid",
  "Overdue",
  "Partly Paid",
  "Submitted",
]);

/** Permitted Purchase Invoice list fields for dashboard metrics. */
const PI_METRIC_FIELDS = [
  "name",
  "supplier",
  "supplier_name",
  "status",
  "docstatus",
  "due_date",
  "outstanding_amount",
  "grand_total",
  "paid_amount",
  "currency",
] as const;

/**
 * Goods Receipt Notes that are received but not yet invoiced — the Finance
 * "Invoices Awaiting Creation" queue.
 */
export async function getGRNsAwaitingInvoice(
  limit = 100
): Promise<AwaitingInvoiceGRN[]> {
  try {
    const rows = (await getPurchaseReceipts({
      filters: [
        ["docstatus", "=", 1],
        ["status", "=", "To Bill"],
      ],
      fields: [
        "name",
        "supplier",
        "supplier_name",
        "posting_date",
        "status",
        "grand_total",
        "per_billed",
        "currency",
      ],
      order_by: "posting_date desc, modified desc",
      limit_page_length: limit,
    })) as unknown as AwaitingInvoiceGRN[];

    return rows.filter((r) => (r.per_billed ?? 0) < 100);
  } catch (err: unknown) {
    logQueryError("awaiting-invoice GRNs", err);
    return [];
  }
}

/** Aggregate finance dashboard metrics from ERPNext + RFQ workflow. */
export async function getFinanceDashboardMetrics(): Promise<FinanceWorkflowKpis> {
  const [reviewsResult, grnsResult, payablesResult, posResult] =
    await Promise.allSettled([
      getFinanceReviews({ status: "All" }),
      getGRNsAwaitingInvoice(),
      getErpNextOutstandingPayables(),
      getOpenPurchaseOrders(),
    ]);

  const financeReviews =
    reviewsResult.status === "fulfilled" ? reviewsResult.value : [];
  if (reviewsResult.status === "rejected") {
    logQueryError("finance reviews", reviewsResult.reason);
  }

  const grns = grnsResult.status === "fulfilled" ? grnsResult.value : [];
  if (grnsResult.status === "rejected") {
    logQueryError("GRNs awaiting invoice", grnsResult.reason);
  }

  const erpPayables =
    payablesResult.status === "fulfilled" ? payablesResult.value : [];
  if (payablesResult.status === "rejected") {
    logQueryError("outstanding payables", payablesResult.reason);
  }

  const openPos = posResult.status === "fulfilled" ? posResult.value : [];
  if (posResult.status === "rejected") {
    logQueryError("open purchase orders", posResult.reason);
  }

  const grnsFiltered = excludeVoucheredGRNs(grns);
  const unbilledGrnValue = grnsFiltered.reduce(
    (s, g) => s + monetaryAmount(g.grand_total),
    0
  );
  const openPoValue = sumOutstandingPoValue(openPos);
  const voucherPayables = getVoucherOutstandingPayables();
  const payables = mergePayables(erpPayables, voucherPayables);

  return computeFinanceDashboardKpis({
    financeReviews,
    awaitingCount: grnsFiltered.length,
    unbilledGrnValue,
    openPoValue,
    payables,
  });
}

/**
 * Submitted ERPNext Purchase Invoices with a positive outstanding balance.
 * Uses only Frappe-permitted list fields; outstanding is derived client-side
 * when the list API omits or zeroes `outstanding_amount`.
 */
export async function getErpNextOutstandingPayables(): Promise<PayableInvoiceLite[]> {
  try {
    const rows = await fetchPurchaseInvoicesForMetrics(PI_METRIC_FIELDS);
    return rows
      .filter(isOutstandingErpPayable)
      .map((row) => ({ ...row, source: "erpnext" as const }));
  } catch (err: unknown) {
    logQueryError("outstanding payables", err);
    return [];
  }
}

/** @deprecated Alias — use getErpNextOutstandingPayables. */
export async function getOutstandingPayables(): Promise<PayableInvoiceLite[]> {
  const erp = await getErpNextOutstandingPayables();
  return mergePayables(erp, getVoucherOutstandingPayables());
}

/** Submitted POs with remaining unbilled commitment. */
export async function getOpenPurchaseOrders(): Promise<OpenPurchaseOrderLite[]> {
  try {
    return await getPurchaseOrders({
      filters: [
        ["docstatus", "=", 1],
        ["status", "not in", ["Completed", "Closed", "Cancelled"]],
      ],
      fields: ["name", "status", "grand_total", "per_billed", "currency"],
      limit_page_length: 500,
      order_by: "modified desc",
    });
  } catch (err: unknown) {
    logQueryError("open purchase orders", err);
    return [];
  }
}

/** Finance Accounts-Payable headline metrics. */
export interface FinanceWorkflowKpis {
  pendingRfqReviews: number;
  approvedRfqs: number;
  pendingPayments: number;
  outstandingPayables: number;
  grnsAwaitingVoucher: number;
  totalFinancialExposure: number;
}

/** @deprecated Use pendingRfqReviews — kept for gradual migration */
export interface LegacyFinanceWorkflowKpis {
  pendingInvoices: number;
  dueThisWeek: number;
  pendingPayments: number;
  totalPayables: number;
}

export interface FinanceDashboardComputeInput {
  financeReviews: Array<{ finance_status: string; rfq_value?: number }>;
  awaitingCount: number;
  unbilledGrnValue: number;
  openPoValue: number;
  payables: PayableInvoiceLite[];
}

/** Derive Finance dashboard KPIs from ERPNext queues and RFQ review data. */
export function computeFinanceDashboardKpis(
  input: FinanceDashboardComputeInput
): FinanceWorkflowKpis;
/** @deprecated Pass a FinanceDashboardComputeInput object instead. */
export function computeFinanceDashboardKpis(
  financeReviews: Array<{ finance_status: string; rfq_value?: number }>,
  awaitingCount: number,
  awaitingGrnTotal: number,
  payables: PayableInvoiceLite[]
): FinanceWorkflowKpis;
export function computeFinanceDashboardKpis(
  inputOrReviews:
    | FinanceDashboardComputeInput
    | Array<{ finance_status: string; rfq_value?: number }>,
  awaitingCount?: number,
  awaitingGrnTotal?: number,
  payablesArg?: PayableInvoiceLite[]
): FinanceWorkflowKpis {
  const input: FinanceDashboardComputeInput = Array.isArray(inputOrReviews)
    ? {
        financeReviews: inputOrReviews,
        awaitingCount: awaitingCount ?? 0,
        unbilledGrnValue: awaitingGrnTotal ?? 0,
        openPoValue: 0,
        payables: payablesArg ?? [],
      }
    : inputOrReviews;

  let outstandingPayables = 0;
  let pendingPayments = 0;

  for (const inv of input.payables) {
    const amount = invoiceOutstandingAmount(inv);
    if (amount <= 0) continue;
    outstandingPayables += amount;
    if (isAwaitingPayment(inv)) pendingPayments += 1;
  }

  const pendingRfqReviews = input.financeReviews.filter(
    (r) => r.finance_status === "Pending Finance Review"
  ).length;
  const approvedRfqs = input.financeReviews.filter(
    (r) => r.finance_status === "Budget Approved"
  ).length;
  const approvedCommitments = input.financeReviews
    .filter((r) => r.finance_status === "Budget Approved")
    .reduce((s, r) => s + (r.rfq_value ?? 0), 0);

  return {
    pendingRfqReviews,
    approvedRfqs,
    pendingPayments,
    outstandingPayables,
    grnsAwaitingVoucher: input.awaitingCount,
    totalFinancialExposure:
      input.openPoValue +
      outstandingPayables +
      input.unbilledGrnValue +
      approvedCommitments,
  };
}

/** Derive legacy four KPIs from the awaiting queue and payables backlog. */
export function computeFinanceWorkflowKpis(
  awaitingCount: number,
  payables: PayableInvoiceLite[]
): LegacyFinanceWorkflowKpis {
  let totalPayables = 0;
  let dueThisWeek = 0;

  for (const inv of payables) {
    const outstanding = invoiceOutstandingAmount(inv);
    totalPayables += outstanding;
    const d = daysUntil(inv.due_date);
    if (d !== null && d <= 7) dueThisWeek += 1;
  }

  return {
    pendingInvoices: awaitingCount,
    dueThisWeek,
    pendingPayments: payables.filter(isAwaitingPayment).length,
    totalPayables,
  };
}

/* ── helpers ─────────────────────────────────────────────────────────────── */

async function fetchPurchaseInvoicesForMetrics(
  fields: readonly string[]
): Promise<PayableInvoiceLite[]> {
  try {
    return await apiGet<PayableInvoiceLite[]>(
      buildResourceUrl("Purchase Invoice"),
      buildListConfig({
        filters: [["docstatus", "=", 1]],
        fields: [...fields],
        order_by: "due_date asc",
        limit_page_length: 500,
      })
    );
  } catch (err: unknown) {
    if (fields.includes("paid_amount")) {
      logQueryError(
        "purchase invoices (with paid_amount) — retrying without paid_amount",
        err
      );
      const fallbackFields = fields.filter((f) => f !== "paid_amount");
      return apiGet<PayableInvoiceLite[]>(
        buildResourceUrl("Purchase Invoice"),
        buildListConfig({
          filters: [["docstatus", "=", 1]],
          fields: fallbackFields,
          order_by: "due_date asc",
          limit_page_length: 500,
        })
      );
    }
    throw err;
  }
}

function isOutstandingErpPayable(inv: PayableInvoiceLite): boolean {
  if ((inv.docstatus ?? 0) !== 1) return false;
  const status = inv.status ?? "";
  if (EXCLUDED_PAYABLE_STATUSES.has(status)) return false;
  return invoiceOutstandingAmount(inv) > 0;
}

function isAwaitingPayment(inv: PayableInvoiceLite): boolean {
  if (inv.source === "voucher") {
    return inv.status === "approved";
  }
  if ((inv.docstatus ?? 0) !== 1) return false;
  const status = inv.status ?? "";
  if (EXCLUDED_PAYABLE_STATUSES.has(status)) return false;
  return AWAITING_PAYMENT_ERP_STATUSES.has(status);
}

export function monetaryAmount(value?: number | null): number {
  if (value != null && !Number.isNaN(value)) return value;
  return 0;
}

/**
 * Outstanding balance for a payable invoice row.
 * Prefers `outstanding_amount`; falls back to `grand_total - paid_amount`.
 */
export function invoiceOutstandingAmount(inv: PayableInvoiceLite): number {
  const outstanding = inv.outstanding_amount;
  if (outstanding != null && outstanding > 0) return outstanding;

  const grand = inv.grand_total ?? 0;
  const paid = inv.paid_amount ?? 0;
  const computed = grand - paid;
  if (computed > 0) return computed;

  return 0;
}

/** @deprecated Use invoiceOutstandingAmount */
export const invoiceOutstandingUsd = invoiceOutstandingAmount;

export function sumOutstandingPoValue(pos: OpenPurchaseOrderLite[]): number {
  return pos.reduce((sum, po) => {
    const total = monetaryAmount(po.grand_total);
    const perBilled = Math.min(100, Math.max(0, po.per_billed ?? 0));
    const unbilledShare = (100 - perBilled) / 100;
    return sum + total * unbilledShare;
  }, 0);
}

function getVoucherOutstandingPayables(): PayableInvoiceLite[] {
  return getAllInvoices()
    .filter((inv) => inv.status === "submitted" || inv.status === "approved")
    .map((inv) => ({
      name: inv.invoice_number,
      supplier: inv.supplier,
      supplier_name: inv.supplier_name,
      status: inv.status,
      docstatus: 1,
      due_date: inv.due_date,
      outstanding_amount: inv.amount,
      grand_total: inv.amount,
      currency: inv.currency || "USD",
      source: "voucher" as const,
    }))
    .filter((inv) => invoiceOutstandingAmount(inv) > 0);
}

function mergePayables(
  erp: PayableInvoiceLite[],
  voucher: PayableInvoiceLite[]
): PayableInvoiceLite[] {
  const seen = new Set(erp.map((row) => row.name));
  return [...erp, ...voucher.filter((row) => !seen.has(row.name))];
}

function logQueryError(label: string, err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  console.warn(`${LOG_TAG} ${label} error:`, message);
}

/** Invalidate Finance dashboard KPI queries after AP workflow mutations. */
export function invalidateFinanceDashboardMetrics(
  queryClient: { invalidateQueries: (opts: { queryKey: string[] }) => void }
): void {
  void queryClient.invalidateQueries({
    queryKey: [FINANCE_DASHBOARD_METRICS_KEY],
  });
}
