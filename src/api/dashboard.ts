/**
 * Dashboard data layer — count-based KPIs and capped list fetches for
 * client-side aggregation. Uses Promise.allSettled so 403 permission errors
 * on individual doctypes degrade gracefully instead of crashing the page.
 */
import { format, startOfMonth, startOfYear, subMonths } from "date-fns";

import { getPaymentEntries, getPurchaseInvoices } from "./accounts";
import { getPurchaseOrders } from "./purchasing";
import { apiGet, getCount, type Filter } from "./erpnext";

const AGGREGATE_LIMIT = 5000;

export interface DashboardInvoiceLite {
  name: string;
  supplier: string;
  posting_date: string;
  grand_total: number;
  outstanding_amount?: number;
  currency?: string;
  status?: string;
  modified?: string;
}

export interface DashboardPoLite {
  name: string;
  supplier: string;
  status?: string;
  transaction_date?: string;
  schedule_date?: string;
  grand_total?: number;
  currency?: string;
  per_received?: number;
  per_billed?: number;
  modified?: string;
}

export interface DashboardRfqLite {
  name: string;
  status?: string;
  modified?: string;
  creation?: string;
  owner?: string;
}

export interface DashboardInvoiceItemLite {
  item_group?: string;
  amount?: number;
  base_amount?: number;
}

export interface DashboardPaymentLite {
  name: string;
  party?: string;
  posting_date?: string;
  modified?: string;
  paid_amount?: number;
  status?: string;
}

export interface DashboardCounts {
  activeSuppliers: number;
  openRequisitions: number;
  openRfqs: number;
  activePos: number;
  pendingGrns: number;
  unpaidInvoices: number;
  overdueInvoices: number;
  pendingPayments: number;
  totalPayments: number;
  totalPos: number;
  totalInvoices: number;
}

export interface DashboardFetchResult {
  counts: DashboardCounts;
  invoices: DashboardInvoiceLite[];
  poSamples: DashboardPoLite[];
  invoiceItems: DashboardInvoiceItemLite[];
  recentRfqs: DashboardRfqLite[];
  recentPos: DashboardPoLite[];
  recentInvoices: DashboardInvoiceLite[];
  recentPayments: DashboardPaymentLite[];
  upcomingDeliveries: DashboardPoLite[];
  ytdStart: string;
  trendStart: string;
}

const EMPTY_COUNTS: DashboardCounts = {
  activeSuppliers: 0,
  openRequisitions: 0,
  openRfqs: 0,
  activePos: 0,
  pendingGrns: 0,
  unpaidInvoices: 0,
  overdueInvoices: 0,
  pendingPayments: 0,
  totalPayments: 0,
  totalPos: 0,
  totalInvoices: 0,
};

function twelveMonthsAgo(): string {
  return format(startOfMonth(subMonths(new Date(), 11)), "yyyy-MM-dd");
}

function ytdStart(): string {
  return format(startOfYear(new Date()), "yyyy-MM-dd");
}

function settled<T>(result: PromiseSettledResult<T>, fallback: T): T {
  if (result.status === "fulfilled") return result.value;
  const reason = result.reason;
  if (reason instanceof Error) {
    console.warn("[Dashboard]", reason.message);
  }
  return fallback;
}

async function fetchInvoicesForAggregation(
  since: string
): Promise<DashboardInvoiceLite[]> {
  const rows = await getPurchaseInvoices({
    filters: [
      ["posting_date", ">=", since],
      ["docstatus", "=", 1],
    ] as Filter[],
    fields: [
      "name",
      "supplier",
      "posting_date",
      "grand_total",
      "outstanding_amount",
      "currency",
      "status",
    ],
    limit_page_length: AGGREGATE_LIMIT,
    order_by: "posting_date desc",
  });
  return rows as DashboardInvoiceLite[];
}

async function fetchInvoiceItems(): Promise<DashboardInvoiceItemLite[]> {
  try {
    return await apiGet<DashboardInvoiceItemLite[]>(
      "/api/resource/Purchase Invoice Item",
      {
        params: {
          fields: JSON.stringify(["item_group", "amount", "base_amount"]),
          filters: JSON.stringify([["docstatus", "=", 1]]),
          limit_page_length: AGGREGATE_LIMIT,
          order_by: "creation desc",
        },
      }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn("[Dashboard] invoice items:", message);
    return [];
  }
}

async function fetchCounts(): Promise<DashboardCounts> {
  const results = await Promise.allSettled([
    getCount("Supplier", [["disabled", "=", 0]]),
    getCount("Material Request", [
      ["material_request_type", "=", "Purchase"],
      ["status", "not in", ["Stopped", "Cancelled", "Ordered"]],
    ]),
    getCount("Request for Quotation", [
      ["status", "in", ["Submitted", "Open"]],
    ]),
    getCount("Purchase Order", [
      ["status", "in", ["To Receive and Bill", "To Receive", "To Bill"]],
    ]),
    getCount("Purchase Receipt", [["status", "=", "To Bill"]]),
    getCount("Purchase Invoice", [
      ["docstatus", "=", 1],
      ["outstanding_amount", ">", 0],
    ]),
    getCount("Purchase Invoice", [
      ["docstatus", "=", 1],
      ["outstanding_amount", ">", 0],
      ["status", "=", "Overdue"],
    ]),
    getCount("Payment Entry", [
      ["payment_type", "=", "Pay"],
      ["docstatus", "=", 0],
    ]),
    getCount("Payment Entry", [
      ["payment_type", "=", "Pay"],
      ["docstatus", "=", 1],
    ]),
    getCount("Purchase Order", [["docstatus", "=", 1]]),
    getCount("Purchase Invoice", [["docstatus", "=", 1]]),
  ]);

  const [
    activeSuppliers,
    openRequisitions,
    openRfqs,
    activePos,
    pendingGrns,
    unpaidInvoices,
    overdueInvoices,
    pendingPayments,
    totalPayments,
    totalPos,
    totalInvoices,
  ] = results.map((r) =>
    settled(r, 0)
  ) as [
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
  ];

  return {
    activeSuppliers,
    openRequisitions,
    openRfqs,
    activePos,
    pendingGrns,
    unpaidInvoices,
    overdueInvoices,
    pendingPayments,
    totalPayments,
    totalPos,
    totalInvoices,
  };
}

async function fetchUpcomingDeliveries(): Promise<DashboardPoLite[]> {
  const today = format(new Date(), "yyyy-MM-dd");
  const rows = await getPurchaseOrders({
    filters: [
      ["docstatus", "=", 1],
      ["schedule_date", ">=", today],
      ["status", "in", ["To Receive and Bill", "To Receive", "To Bill"]],
    ] as Filter[],
    fields: [
      "name",
      "supplier",
      "status",
      "schedule_date",
      "grand_total",
      "currency",
      "per_received",
    ],
    limit_page_length: 10,
    order_by: "schedule_date asc",
  });
  return rows as DashboardPoLite[];
}

export async function fetchDashboardCounts(): Promise<DashboardCounts> {
  return fetchCounts();
}

export async function fetchDashboardAnalytics(): Promise<
  Omit<DashboardFetchResult, "counts">
> {
  const trendStart = twelveMonthsAgo();
  const ytd = ytdStart();

  const results = await Promise.allSettled([
    fetchInvoicesForAggregation(trendStart),
    fetchInvoiceItems(),
    getPurchaseOrders({
      filters: [["docstatus", "=", 1]] as Filter[],
      fields: [
        "name",
        "supplier",
        "status",
        "transaction_date",
        "schedule_date",
        "grand_total",
        "currency",
        "per_received",
        "per_billed",
      ],
      limit_page_length: AGGREGATE_LIMIT,
      order_by: "transaction_date desc",
    }),
    apiGet<DashboardRfqLite[]>("/api/resource/Request for Quotation", {
      params: {
        fields: JSON.stringify([
          "name",
          "status",
          "modified",
          "creation",
          "owner",
        ]),
        limit_page_length: 10,
        order_by: "modified desc",
      },
    }),
    getPurchaseOrders({
      fields: [
        "name",
        "supplier",
        "status",
        "transaction_date",
        "modified",
        "grand_total",
        "currency",
        "schedule_date",
        "per_received",
      ],
      limit_page_length: 10,
      order_by: "creation desc",
    }),
    getPurchaseInvoices({
      filters: [["docstatus", "=", 1]] as Filter[],
      fields: [
        "name",
        "supplier",
        "posting_date",
        "modified",
        "grand_total",
        "outstanding_amount",
        "currency",
        "status",
      ],
      limit_page_length: 50,
      order_by: "modified desc",
    }),
    fetchUpcomingDeliveries(),
    getPaymentEntries({
      filters: [["docstatus", "=", 1]] as Filter[],
      limit_page_length: 10,
    }),
  ]);

  return {
    invoices: settled(results[0], [] as DashboardInvoiceLite[]),
    invoiceItems: settled(results[1], [] as DashboardInvoiceItemLite[]),
    poSamples: settled(results[2], [] as DashboardPoLite[]),
    recentRfqs: settled(results[3], [] as DashboardRfqLite[]),
    recentPos: settled(results[4], [] as DashboardPoLite[]),
    recentInvoices: settled(
      results[5] as PromiseSettledResult<DashboardInvoiceLite[]>,
      [] as DashboardInvoiceLite[]
    ),
    upcomingDeliveries: settled(results[6], [] as DashboardPoLite[]),
    recentPayments: settled(
      results[7] as PromiseSettledResult<DashboardPaymentLite[]>,
      [] as DashboardPaymentLite[]
    ),
    ytdStart: ytd,
    trendStart,
  };
}

export async function fetchDashboardData(): Promise<DashboardFetchResult> {
  const trendStart = twelveMonthsAgo();
  const ytd = ytdStart();

  const results = await Promise.allSettled([
    fetchCounts(),
    fetchInvoicesForAggregation(trendStart),
    fetchInvoiceItems(),
    getPurchaseOrders({
      filters: [["docstatus", "=", 1]] as Filter[],
      fields: [
        "name",
        "supplier",
        "status",
        "transaction_date",
        "schedule_date",
        "grand_total",
        "currency",
        "per_received",
        "per_billed",
      ],
      limit_page_length: AGGREGATE_LIMIT,
      order_by: "transaction_date desc",
    }),
    apiGet<DashboardRfqLite[]>("/api/resource/Request for Quotation", {
      params: {
        fields: JSON.stringify([
          "name",
          "status",
          "modified",
          "creation",
          "owner",
        ]),
        limit_page_length: 10,
        order_by: "modified desc",
      },
    }),
    getPurchaseOrders({
      fields: [
        "name",
        "supplier",
        "status",
        "transaction_date",
        "modified",
        "grand_total",
        "currency",
      ],
      limit_page_length: 10,
      order_by: "creation desc",
    }),
    getPurchaseInvoices({
      filters: [["docstatus", "=", 1]] as Filter[],
      fields: [
        "name",
        "supplier",
        "posting_date",
        "modified",
        "grand_total",
        "outstanding_amount",
        "currency",
        "status",
      ],
      limit_page_length: 50,
      order_by: "modified desc",
    }),
    fetchUpcomingDeliveries(),
    getPaymentEntries({
      filters: [["docstatus", "=", 1]] as Filter[],
      limit_page_length: 10,
    }),
  ]);

  const counts = settled(results[0], EMPTY_COUNTS);
  const invoices = settled(results[1], [] as DashboardInvoiceLite[]);
  const invoiceItems = settled(results[2], [] as DashboardInvoiceItemLite[]);
  const poSamples = settled(results[3], [] as DashboardPoLite[]);
  const recentRfqs = settled(results[4], [] as DashboardRfqLite[]);
  const recentPos = settled(results[5], [] as DashboardPoLite[]);
  const recentInvoices = settled(
    results[6] as PromiseSettledResult<DashboardInvoiceLite[]>,
    [] as DashboardInvoiceLite[]
  );
  const upcomingDeliveries = settled(results[7], [] as DashboardPoLite[]);
  const recentPayments = settled(
    results[8] as PromiseSettledResult<DashboardPaymentLite[]>,
    [] as DashboardPaymentLite[]
  );

  // Derive overdue count from invoice list when count query returned 0 but
  // we have invoice rows (e.g. partial permission on count filters).
  if (counts.overdueInvoices === 0 && recentInvoices.length > 0) {
    counts.overdueInvoices = recentInvoices.filter(
      (i) => i.status === "Overdue"
    ).length;
  }

  return {
    counts,
    invoices,
    poSamples: poSamples as DashboardPoLite[],
    invoiceItems,
    recentRfqs,
    recentPos: recentPos as DashboardPoLite[],
    recentInvoices,
    recentPayments,
    upcomingDeliveries,
    ytdStart: ytd,
    trendStart,
  };
}
