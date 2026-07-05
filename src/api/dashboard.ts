/**
 * Dashboard data layer — count-based KPIs and capped list fetches for
 * client-side aggregation. Uses Promise.allSettled so 403 permission errors
 * on individual doctypes degrade gracefully instead of crashing the page.
 */
import { format, startOfMonth, startOfYear, subMonths } from "date-fns";

import { getPaymentEntries, getPurchaseInvoices } from "./accounts";
import { getPurchaseOrders } from "./purchasing";
import { apiGet, getCount, COMPANY, type Filter } from "./erpnext";

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

/**
 * A procurement line (Purchase Invoice / Purchase Order) resolved to its Item
 * Group. Category Spend Breakdown is built from these
 * (Invoice or PO → line item → Item → Item Group).
 */
export interface DashboardPoItemLite {
  item_code?: string;
  item_group?: string;
  amount?: number;
  base_amount?: number;
}

/** Aggregated source for the Category Spend Breakdown widget. */
export interface CategorySpendSource {
  /** Resolved line items grouped downstream by Item Group. */
  items: DashboardPoItemLite[];
  /** ERPNext company default currency (e.g. "USD"). */
  currency: string;
  /** Which live doctype the spend came from. */
  basis: "invoice" | "po" | "none";
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

/**
 * Fetch submitted line items from a procurement child doctype (Purchase Invoice
 * Item / Purchase Order Item) for the Category Spend widget. `item_group` is
 * read directly when ERPNext exposes it; otherwise it's resolved from the Item
 * master downstream. Returns [] on any failure.
 */
async function fetchLineItems(
  doctype: "Purchase Invoice Item" | "Purchase Order Item"
): Promise<DashboardPoItemLite[]> {
  const withGroup = ["item_code", "item_group", "base_amount", "amount"];
  const withoutGroup = ["item_code", "base_amount", "amount"];
  const filters = JSON.stringify([["docstatus", "=", 1]]);
  const url = `/api/resource/${doctype}`;

  const run = (fields: string[]) =>
    apiGet<DashboardPoItemLite[]>(url, {
      params: {
        fields: JSON.stringify(fields),
        filters,
        limit_page_length: AGGREGATE_LIMIT,
        order_by: "creation desc",
      },
    });

  try {
    return await run(withGroup);
  } catch (err: unknown) {
    // Some installs reject selecting item_group on the child — fall back and
    // rely entirely on Item-master resolution.
    console.warn(
      `[Dashboard] ${doctype} (with item_group):`,
      err instanceof Error ? err.message : String(err)
    );
    try {
      return await run(withoutGroup);
    } catch (retryErr: unknown) {
      console.warn(
        `[Dashboard] ${doctype}:`,
        retryErr instanceof Error ? retryErr.message : String(retryErr)
      );
      return [];
    }
  }
}

/** Fill missing `item_group` on lines via a single bulk Item-master lookup. */
async function resolveItemGroups(
  rows: DashboardPoItemLite[]
): Promise<DashboardPoItemLite[]> {
  const unresolvedCodes = Array.from(
    new Set(
      rows
        .filter((r) => !r.item_group?.trim() && r.item_code)
        .map((r) => r.item_code as string)
    )
  );
  if (unresolvedCodes.length === 0) return rows;

  const groupByCode = new Map<string, string>();
  try {
    const itemRows = await apiGet<
      Array<{ name: string; item_code?: string; item_group?: string }>
    >("/api/resource/Item", {
      params: {
        fields: JSON.stringify(["name", "item_code", "item_group"]),
        filters: JSON.stringify([["item_code", "in", unresolvedCodes]]),
        limit_page_length: unresolvedCodes.length,
      },
    });
    for (const item of itemRows ?? []) {
      const code = item.item_code || item.name;
      if (code && item.item_group?.trim()) {
        groupByCode.set(code, item.item_group.trim());
      }
    }
  } catch (err: unknown) {
    console.warn(
      "[Dashboard] Item group resolution:",
      err instanceof Error ? err.message : String(err)
    );
  }

  return rows.map((r) =>
    r.item_group?.trim() || !r.item_code
      ? r
      : { ...r, item_group: groupByCode.get(r.item_code) }
  );
}

/** ERPNext company default currency, with a safe USD fallback. */
async function fetchDefaultCurrency(): Promise<string> {
  try {
    const rows = await apiGet<Array<{ default_currency?: string }>>(
      "/api/resource/Company",
      {
        params: {
          fields: JSON.stringify(["default_currency"]),
          filters: JSON.stringify([["name", "=", COMPANY]]),
          limit_page_length: 1,
        },
      }
    );
    return rows?.[0]?.default_currency?.trim() || "USD";
  } catch {
    return "USD";
  }
}

/**
 * Category Spend source of truth (live ERPNext only).
 *
 * Priority: submitted Purchase Invoices → (if none) submitted Purchase Orders.
 * RFQs are never used. Each line is resolved to its real Item Group
 * (line → Item → Item Group); lines with no group are labelled
 * "Unknown Category" downstream. Returns `basis: "none"` with an empty list when
 * there is no submitted spend, so the widget can hide the chart entirely.
 */
export async function fetchCategorySpend(): Promise<CategorySpendSource> {
  const [currency, invoiceLines] = await Promise.all([
    fetchDefaultCurrency(),
    fetchLineItems("Purchase Invoice Item"),
  ]);

  let items = invoiceLines;
  let basis: CategorySpendSource["basis"] = "invoice";

  if (items.length === 0) {
    items = await fetchLineItems("Purchase Order Item");
    basis = "po";
  }

  if (items.length === 0) {
    return { items: [], currency, basis: "none" };
  }

  const resolved = await resolveItemGroups(items);
  return { items: resolved, currency, basis };
}

/* ── Filtered Category Spend Breakdown (donut widget) ──────────────────── */

export interface CategorySpendBreakdownFilters {
  company?: string;
  fromDate?: string;
  toDate?: string;
  costCenter?: string;
}

export interface FilteredCategorySpend {
  /** Resolved procurement lines (item group + base net amount). */
  lines: DashboardPoItemLite[];
  currency: string;
  basis: "invoice" | "po" | "none";
}

/** Submitted parent document names matching the company / date filters. */
async function fetchSpendParentNames(
  doctype: "Purchase Invoice" | "Purchase Order",
  dateField: "posting_date" | "transaction_date",
  f: CategorySpendBreakdownFilters
): Promise<string[]> {
  const filters: Filter[] = [["docstatus", "=", 1]];
  if (f.company) filters.push(["company", "=", f.company]);
  if (f.fromDate) filters.push([dateField, ">=", f.fromDate]);
  if (f.toDate) filters.push([dateField, "<=", f.toDate]);
  try {
    const rows = await apiGet<Array<{ name: string }>>(
      `/api/resource/${doctype}`,
      {
        params: {
          fields: JSON.stringify(["name"]),
          filters: JSON.stringify(filters),
          limit_page_length: AGGREGATE_LIMIT,
          order_by: "creation desc",
        },
      }
    );
    return (rows ?? []).map((r) => r.name).filter(Boolean);
  } catch (err: unknown) {
    console.warn(
      `[Category Spend] ${doctype} names:`,
      err instanceof Error ? err.message : String(err)
    );
    return [];
  }
}

/** Child line items for the given parents, spend read from `base_net_amount`. */
async function fetchSpendChildLines(
  childDoctype: "Purchase Invoice Item" | "Purchase Order Item",
  parentNames: string[],
  costCenter?: string
): Promise<DashboardPoItemLite[]> {
  if (parentNames.length === 0) return [];
  const filters: Filter[] = [["parent", "in", parentNames]];
  if (costCenter) filters.push(["cost_center", "=", costCenter]);

  const run = (fields: string[]) =>
    apiGet<
      Array<{
        item_code?: string;
        item_group?: string;
        base_net_amount?: number;
        base_amount?: number;
        amount?: number;
      }>
    >(`/api/resource/${childDoctype}`, {
      params: {
        fields: JSON.stringify(fields),
        filters: JSON.stringify(filters),
        limit_page_length: AGGREGATE_LIMIT,
      },
    });

  let rows: Awaited<ReturnType<typeof run>> = [];
  try {
    rows = await run([
      "item_code",
      "item_group",
      "base_net_amount",
      "base_amount",
      "amount",
    ]);
  } catch {
    try {
      // Some installs reject item_group / base_net_amount on the child table.
      rows = await run(["item_code", "base_amount", "amount"]);
    } catch (err: unknown) {
      console.warn(
        `[Category Spend] ${childDoctype}:`,
        err instanceof Error ? err.message : String(err)
      );
      return [];
    }
  }

  // Normalise spend into `base_amount` (company/base currency = task 4's
  // base_net_amount, falling back to base_amount then amount).
  return (rows ?? []).map((r) => ({
    item_code: r.item_code,
    item_group: r.item_group,
    base_amount: r.base_net_amount ?? r.base_amount ?? r.amount ?? 0,
  }));
}

/**
 * Category Spend Breakdown source with Company / Date / Cost Center filters.
 *
 * Live ERPNext only: submitted Purchase Invoice Items (preferred) → submitted
 * Purchase Order Items (fallback). Spend uses `base_net_amount` (company base
 * currency). Item groups are resolved from the Item master where missing.
 * Returns `basis: "none"` with no lines when there is genuinely no data.
 */
export async function fetchCategorySpendFiltered(
  f: CategorySpendBreakdownFilters = {}
): Promise<FilteredCategorySpend> {
  const currency = await fetchDefaultCurrency();

  // 1) Preferred: Purchase Invoices.
  const invoiceNames = await fetchSpendParentNames(
    "Purchase Invoice",
    "posting_date",
    f
  );
  let lines = await fetchSpendChildLines(
    "Purchase Invoice Item",
    invoiceNames,
    f.costCenter
  );
  let basis: FilteredCategorySpend["basis"] = "invoice";

  // 2) Fallback: Purchase Orders when no invoice spend exists.
  if (!lines.some((l) => (l.base_amount ?? 0) > 0)) {
    const poNames = await fetchSpendParentNames(
      "Purchase Order",
      "transaction_date",
      f
    );
    lines = await fetchSpendChildLines("Purchase Order Item", poNames, f.costCenter);
    basis = "po";
  }

  if (!lines.some((l) => (l.base_amount ?? 0) > 0)) {
    return { lines: [], currency, basis: "none" };
  }

  const resolved = await resolveItemGroups(lines);
  return { lines: resolved, currency, basis };
}

/** Company names for the Category Spend filter (live ERPNext). */
export async function fetchCompanyOptions(): Promise<string[]> {
  try {
    const rows = await apiGet<Array<{ name: string }>>("/api/resource/Company", {
      params: {
        fields: JSON.stringify(["name"]),
        limit_page_length: 200,
        order_by: "name asc",
      },
    });
    return (rows ?? []).map((r) => r.name).filter(Boolean);
  } catch {
    return [];
  }
}

/** Non-group Cost Centers for the Category Spend filter (live ERPNext). */
export async function fetchCostCenterOptions(company?: string): Promise<string[]> {
  const filters: Filter[] = [["is_group", "=", 0]];
  if (company) filters.push(["company", "=", company]);
  try {
    const rows = await apiGet<Array<{ name: string }>>(
      "/api/resource/Cost Center",
      {
        params: {
          fields: JSON.stringify(["name"]),
          filters: JSON.stringify(filters),
          limit_page_length: 500,
          order_by: "name asc",
        },
      }
    );
    return (rows ?? []).map((r) => r.name).filter(Boolean);
  } catch {
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
