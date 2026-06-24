/**
 * Finance invoice workflow — the AP queue between Warehouse and Payments.
 *
 * Enterprise P2P flow (SAP Ariba / Oracle / Coupa):
 *   RFQ → Purchase Order → GRN (Warehouse) → Invoice (Finance) → Payment
 *
 * "Invoices Awaiting Creation" is the derived Finance queue: submitted Goods
 * Receipt Notes (Purchase Receipts) that have been received but not yet billed
 * (`status = "To Bill"`, `per_billed < 100`). Once Finance creates and submits
 * the matching Purchase Invoice, ERPNext flips the receipt to "Completed" and
 * it leaves the queue automatically.
 */

import { apiGet, buildListConfig, buildResourceUrl } from "./erpnext";
import { getPurchaseReceipts } from "./purchasing";
import { daysUntil } from "../utils/upcomingDeliveries";
import { getFinanceReviews } from "./financeReviews";
import { excludeVoucheredGRNs } from "./vouchers";

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

/**
 * Goods Receipt Notes that are received but not yet invoiced — the Finance
 * "Invoices Awaiting Creation" queue. Returns an empty array on error so
 * callers never have to guard against null.
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

    // Defensive guard: exclude anything already fully billed.
    return rows.filter((r) => (r.per_billed ?? 0) < 100);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn("[Finance] awaiting-invoice GRNs error:", message);
    return [];
  }
}

/** Aggregate finance dashboard metrics from ERPNext + RFQ workflow. */
export async function getFinanceDashboardMetrics(): Promise<FinanceWorkflowKpis> {
  const [financeReviews, grns, payables] = await Promise.all([
    getFinanceReviews({ status: "All" }),
    getGRNsAwaitingInvoice(),
    getOutstandingPayables(),
  ]);

  const grnsFiltered = excludeVoucheredGRNs(grns);

  const awaitingGrnTotal = grnsFiltered.reduce((s, g) => s + (g.grand_total ?? 0), 0);
  const kpis = computeFinanceDashboardKpis(
    financeReviews,
    grnsFiltered.length,
    awaitingGrnTotal,
    payables
  );

  // eslint-disable-next-line no-console
  console.log("Finance Dashboard Response", { financeReviews, grns, payables, kpis });

  return kpis;
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
  currency?: string;
}

/**
 * Submitted Purchase Invoices that still carry an outstanding balance — the
 * payables backlog used for the Finance dashboard KPIs. Excludes Paid and
 * Cancelled invoices.
 */
export async function getOutstandingPayables(): Promise<PayableInvoiceLite[]> {
  try {
    const rows = await apiGet<PayableInvoiceLite[]>(
      buildResourceUrl("Purchase Invoice"),
      buildListConfig({
        filters: [
          ["outstanding_amount", ">", 0],
          ["docstatus", "=", 1],
        ],
        fields: [
          "name",
          "supplier",
          "supplier_name",
          "status",
          "docstatus",
          "due_date",
          "outstanding_amount",
          "grand_total",
          "currency",
        ],
        order_by: "due_date asc",
        limit_page_length: 200,
      })
    );
    return rows.filter(
      (r) => r.status !== "Paid" && r.status !== "Cancelled"
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn("[Finance] outstanding payables error:", message);
    return [];
  }
}

/** Finance Accounts-Payable headline metrics. */
export interface FinanceWorkflowKpis {
  /** RFQs awaiting finance review (legal approved, no PO yet). */
  pendingRfqReviews: number;
  /** RFQs with budget/finance approval. */
  approvedRfqs: number;
  /** Submitted, unpaid invoices awaiting a payment run. */
  pendingPayments: number;
  /** Total outstanding balance across all unpaid invoices. */
  outstandingPayables: number;
  /** GRNs received but not yet invoiced / vouchered. */
  grnsAwaitingVoucher: number;
  /** Combined exposure: pending RFQ value + payables + unbilled GRNs. */
  totalFinancialExposure: number;
}

/** @deprecated Use pendingRfqReviews — kept for gradual migration */
export interface LegacyFinanceWorkflowKpis {
  pendingInvoices: number;
  dueThisWeek: number;
  pendingPayments: number;
  totalPayables: number;
}

/** Derive Finance dashboard KPIs from ERPNext queues and RFQ review data. */
export function computeFinanceDashboardKpis(
  financeReviews: Array<{ finance_status: string; rfq_value?: number }>,
  awaitingCount: number,
  awaitingGrnTotal: number,
  payables: PayableInvoiceLite[]
): FinanceWorkflowKpis {
  let outstandingPayables = 0;
  for (const inv of payables) {
    outstandingPayables += inv.outstanding_amount ?? inv.grand_total ?? 0;
  }

  const pendingRfqReviews = financeReviews.filter(
    (r) => r.finance_status === "Pending Finance Review"
  ).length;
  const approvedRfqs = financeReviews.filter(
    (r) => r.finance_status === "Budget Approved"
  ).length;
  const pendingRfqValue = financeReviews
    .filter((r) => r.finance_status === "Pending Finance Review")
    .reduce((s, r) => s + (r.rfq_value ?? 0), 0);

  return {
    pendingRfqReviews,
    approvedRfqs,
    pendingPayments: payables.length,
    outstandingPayables,
    grnsAwaitingVoucher: awaitingCount,
    totalFinancialExposure: pendingRfqValue + outstandingPayables + awaitingGrnTotal,
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
    const outstanding = inv.outstanding_amount ?? inv.grand_total ?? 0;
    totalPayables += outstanding;
    const d = daysUntil(inv.due_date);
    if (d !== null && d <= 7) dueThisWeek += 1;
  }

  return {
    pendingInvoices: awaitingCount,
    dueThisWeek,
    pendingPayments: payables.length,
    totalPayables,
  };
}
