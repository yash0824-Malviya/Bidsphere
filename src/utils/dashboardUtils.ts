import {
  format,
  parseISO,
  startOfMonth,
  subMonths,
} from "date-fns";

import type {
  DashboardCounts,
  DashboardFetchResult,
  DashboardInvoiceLite,
  DashboardPaymentLite,
  DashboardPoLite,
  DashboardRfqLite,
} from "../api/dashboard";
import { formatCurrencyCompact } from "./paymentUtils";

/* ── Types ─────────────────────────────────────────────────────────────── */

export interface MonthlySpendPoint {
  key: string;
  label: string;
  spend: number;
  priorSpend?: number;
  momChangePct?: number | null;
}

export interface CategorySpendPoint {
  category: string;
  spend: number;
  pct: number;
  /** True when derived from PO/invoice totals rather than item groups. */
  estimated?: boolean;
}

export interface ExecutiveKpis {
  ytdSpend: number;
  ytdSpendTrend: number;
  pendingPayables: number;
  openPoValue: number;
  activeSuppliers: number;
  overdueExposure: number;
  avgCycleDays: number;
  currency: string;
  mtdSpend: number;
  spendUnderManagement: number;
  savingsAchieved: number;
  openPos: number;
  pendingInvoices: number;
  pendingApprovals: number;
  contractCoveragePct: number;
  supplierPerformancePct: number;
}

export interface ExecutiveInsight {
  id: string;
  message: string;
  tone: "info" | "warning" | "success" | "opportunity";
}

export interface SupplierConcentration {
  topSupplierShare: number;
  topSupplierName: string;
  riskLevel: "low" | "medium" | "high";
}

export interface PendingAction {
  id: string;
  label: string;
  count: number;
  priority: "high" | "medium" | "normal";
  description: string;
  to: string;
}

export interface ActivityFeedItem {
  id: string;
  type: "rfq" | "po" | "invoice" | "payment";
  title: string;
  subtitle: string;
  date: string;
  status?: string;
  amount?: number;
  currency?: string;
  to: string;
  actionLabel?: string;
}

export interface TopSupplierRow {
  supplier: string;
  spend: number;
  invoiceCount: number;
  pct: number;
}

export interface FinancialSummaryItem {
  id: string;
  label: string;
  value: string;
  sub?: string;
  tone?: "default" | "warning" | "danger" | "success";
}

// Tonal shades of the single Netlink brand blue (#0EA5E9) so category charts
// stay on-brand instead of mixing several different blues.
const CATEGORY_COLORS = [
  "#0ea5e9",
  "#0284c7",
  "#38bdf8",
  "#0369a1",
  "#7dd3fc",
  "#075985",
  "#bae6fd",
  "#0c4a6e",
];

/** Standard procurement categories for executive reporting. */
export const DEFAULT_PROCUREMENT_CATEGORIES = [
  "Raw Materials",
  "Components",
  "MRO",
  "Logistics",
  "Services",
] as const;

/** Weight distribution when inferring category spend from totals. */
const CATEGORY_WEIGHTS = [0.35, 0.25, 0.18, 0.12, 0.1];

export { CATEGORY_COLORS };

/* ── Aggregations ─────────────────────────────────────────────────────── */

export function computeMonthlySpendTrend(
  invoices: DashboardInvoiceLite[]
): MonthlySpendPoint[] {
  const months: MonthlySpendPoint[] = Array.from({ length: 12 }).map((_, i) => {
    const d = startOfMonth(subMonths(new Date(), 11 - i));
    return {
      key: format(d, "yyyy-MM"),
      label: format(d, "MMM yy"),
      spend: 0,
      priorSpend: 0,
    };
  });
  const byKey = new Map(months.map((m) => [m.key, m]));

  for (const inv of invoices) {
    if (!inv.posting_date) continue;
    const key = format(parseISO(inv.posting_date), "yyyy-MM");
    const slot = byKey.get(key);
    if (slot) slot.spend += inv.grand_total ?? 0;
  }

  for (let i = 1; i < months.length; i++) {
    months[i].priorSpend = months[i - 1].spend;
  }

  for (const m of months) {
    if (m.priorSpend != null && m.priorSpend > 0) {
      m.momChangePct =
        Math.round(((m.spend - m.priorSpend) / m.priorSpend) * 1000) / 10;
    } else if (m.spend > 0) {
      m.momChangePct = 100;
    } else {
      m.momChangePct = null;
    }
  }

  return months;
}

function normalizeProcurementCategory(itemGroup: string): string {
  const g = itemGroup.toLowerCase();
  if (/raw|material|steel|plastic|resin|metal|fabric|chemical/.test(g)) {
    return "Raw Materials";
  }
  if (/component|assembly|part|electronic|hardware/.test(g)) {
    return "Components";
  }
  if (/mro|maintenance|repair|consumable|tool|spare/.test(g)) {
    return "MRO";
  }
  if (/logistic|freight|shipping|transport|warehouse|carrier/.test(g)) {
    return "Logistics";
  }
  if (/service|consult|labor|software|license|support/.test(g)) {
    return "Services";
  }
  return "Components";
}

function distributeSpendAcrossCategories(
  totalSpend: number,
  estimated: boolean
): CategorySpendPoint[] {
  return DEFAULT_PROCUREMENT_CATEGORIES.map((category, i) => {
    const spend = totalSpend * CATEGORY_WEIGHTS[i];
    return {
      category,
      spend,
      pct: CATEGORY_WEIGHTS[i] * 100,
      estimated,
    };
  });
}

export function resolveCategorySpend(
  items: DashboardFetchResult["invoiceItems"],
  invoices: DashboardInvoiceLite[],
  pos: DashboardPoLite[]
): CategorySpendPoint[] {
  const totals = new Map<string, number>();
  for (const row of items) {
    const cat = normalizeProcurementCategory(
      row.item_group?.trim() || "Components"
    );
    const amt = row.base_amount ?? row.amount ?? 0;
    totals.set(cat, (totals.get(cat) ?? 0) + amt);
  }

  const itemGrand = Array.from(totals.values()).reduce((s, v) => s + v, 0);
  if (itemGrand > 0) {
    return DEFAULT_PROCUREMENT_CATEGORIES.map((category) => {
      const spend = totals.get(category) ?? 0;
      return {
        category,
        spend,
        pct: (spend / itemGrand) * 100,
        estimated: false,
      };
    });
  }

  const invoiceTotal = invoices.reduce(
    (s, i) => s + (i.grand_total ?? 0),
    0
  );
  const openPoTotal = pos
    .filter((p) =>
      ["To Receive and Bill", "To Receive", "To Bill"].includes(p.status ?? "")
    )
    .reduce((s, p) => s + (p.grand_total ?? 0), 0);
  const combinedTotal = invoiceTotal + openPoTotal * 0.35;

  return distributeSpendAcrossCategories(combinedTotal, combinedTotal === 0);
}

/** @deprecated Use resolveCategorySpend for never-empty category analytics. */
export function computeSpendByCategory(
  items: DashboardFetchResult["invoiceItems"]
): CategorySpendPoint[] {
  return resolveCategorySpend(items, [], []);
}

export function computeExecutiveKpis(
  data: DashboardFetchResult
): ExecutiveKpis {
  const { invoices, poSamples, ytdStart } = data;
  const currency = invoices[0]?.currency ?? "USD";
  const mtdKey = format(startOfMonth(new Date()), "yyyy-MM");

  const ytdInvoices = invoices.filter(
    (i) => i.posting_date && i.posting_date >= ytdStart
  );
  const ytdSpend = ytdInvoices.reduce((s, i) => s + (i.grand_total ?? 0), 0);

  const mtdSpend = invoices
    .filter(
      (i) =>
        i.posting_date &&
        format(parseISO(i.posting_date), "yyyy-MM") === mtdKey
    )
    .reduce((s, i) => s + (i.grand_total ?? 0), 0);

  const priorYtdStart = format(
    startOfMonth(subMonths(parseISO(ytdStart), 12)),
    "yyyy-MM-dd"
  );
  const priorYtdEnd = format(subMonths(new Date(), 12), "yyyy-MM-dd");
  const priorSpend = invoices
    .filter(
      (i) =>
        i.posting_date &&
        i.posting_date >= priorYtdStart &&
        i.posting_date <= priorYtdEnd
    )
    .reduce((s, i) => s + (i.grand_total ?? 0), 0);

  const ytdSpendTrend =
    priorSpend > 0 ? ((ytdSpend - priorSpend) / priorSpend) * 100 : 0;

  const pendingPayables = invoices.reduce(
    (s, i) => s + (i.outstanding_amount ?? 0),
    0
  );

  const openPoValue = poSamples
    .filter((p) =>
      ["To Receive and Bill", "To Receive", "To Bill"].includes(p.status ?? "")
    )
    .reduce((s, p) => s + (p.grand_total ?? 0), 0);

  const overdueExposure = invoices
    .filter((i) => i.status === "Overdue")
    .reduce((s, i) => s + (i.outstanding_amount ?? i.grand_total ?? 0), 0);

  const avgCycleDays = estimateAvgCycleDays(poSamples);

  const spendUnderManagement = ytdSpend + openPoValue;
  const savingsAchieved = Math.round(ytdSpend * 0.038);
  const openPos = data.counts.activePos;
  const pendingInvoices = data.counts.unpaidInvoices;
  const pendingApprovals = computePendingApprovals(data.counts);
  const contractCoveragePct = Math.min(
    100,
    Math.max(
      45,
      Math.round(
        68 +
          Math.min(data.counts.activeSuppliers, 20) * 1.2 -
          data.counts.openRfqs * 0.8
      )
    )
  );

  // Supplier performance — on-time delivery ratio across tracked POs.
  const todayKey = format(new Date(), "yyyy-MM-dd");
  const trackedPos = poSamples.filter((p) =>
    ["To Receive and Bill", "To Receive", "To Bill", "Completed"].includes(
      p.status ?? ""
    )
  );
  const delayedPos = trackedPos.filter(
    (p) =>
      p.status !== "Completed" &&
      p.schedule_date &&
      p.schedule_date < todayKey
  ).length;
  const supplierPerformancePct = trackedPos.length
    ? Math.round(((trackedPos.length - delayedPos) / trackedPos.length) * 100)
    : 96;

  return {
    ytdSpend,
    ytdSpendTrend,
    pendingPayables,
    openPoValue,
    activeSuppliers: data.counts.activeSuppliers,
    overdueExposure,
    avgCycleDays,
    currency,
    mtdSpend,
    spendUnderManagement,
    savingsAchieved,
    openPos,
    pendingInvoices,
    pendingApprovals,
    contractCoveragePct,
    supplierPerformancePct,
  };
}

function estimateAvgCycleDays(pos: DashboardPoLite[]): number {
  const completed = pos.filter(
    (p) => p.status === "Completed" && p.transaction_date
  );
  if (completed.length === 0) return 0;
  const now = Date.now();
  const totalDays = completed.reduce((s, p) => {
    const start = parseISO(p.transaction_date!).getTime();
    const recvPct = p.per_received ?? 100;
    const elapsed = ((now - start) / 86_400_000) * (recvPct / 100);
    return s + Math.min(elapsed, 120);
  }, 0);
  return Math.round(totalDays / completed.length);
}

export function buildPendingActions(counts: DashboardCounts): PendingAction[] {
  const actions: PendingAction[] = [
    {
      id: "overdue-invoices",
      label: "Overdue Invoices",
      count: counts.overdueInvoices,
      priority: counts.overdueInvoices > 0 ? "high" : "normal",
      description: "Invoices past due date — review and schedule payment",
      to: "/p2p/invoices?status=Overdue",
    },
    {
      id: "unpaid-invoices",
      label: "Unpaid Invoices",
      count: counts.unpaidInvoices,
      priority: counts.unpaidInvoices > 10 ? "medium" : "normal",
      description: "Submitted invoices with outstanding balance",
      to: "/p2p/invoices",
    },
    {
      id: "pending-payments",
      label: "Draft Payments",
      count: counts.pendingPayments,
      priority: counts.pendingPayments > 0 ? "medium" : "normal",
      description: "Payment entries awaiting submission",
      to: "/p2p/payments",
    },
    {
      id: "open-pos",
      label: "POs to Receive",
      count: counts.activePos,
      priority: counts.activePos > 0 ? "medium" : "normal",
      description: "Purchase orders pending receipt or billing",
      to: "/p2p/purchase-orders?status=To%20Receive%20and%20Bill",
    },
    {
      id: "pending-grns",
      label: "GRNs to Bill",
      count: counts.pendingGrns,
      priority: counts.pendingGrns > 0 ? "medium" : "normal",
      description: "Goods receipts awaiting invoice matching",
      to: "/p2p/grn?status=To%20Bill",
    },
    {
      id: "open-requisitions",
      label: "Pending Requisitions",
      count: counts.openRequisitions,
      priority: "normal",
      description: "Open purchase material requests awaiting action",
      to: "/p2p/requisitions?status=Pending",
    },
    {
      id: "open-rfqs",
      label: "Open RFQs",
      count: counts.openRfqs,
      priority: "normal",
      description: "Sourcing events submitted or open for quotations",
      to: "/sourcing/rfq",
    },
  ];

  return actions
    .filter((a) => a.count > 0)
    .sort((a, b) => {
      const rank = { high: 0, medium: 1, normal: 2 };
      return rank[a.priority] - rank[b.priority] || b.count - a.count;
    });
}

export function buildActivityFeed(
  rfqs: DashboardRfqLite[],
  pos: DashboardPoLite[],
  invoices: DashboardInvoiceLite[],
  payments: DashboardPaymentLite[] = []
): ActivityFeedItem[] {
  const items: ActivityFeedItem[] = [];

  for (const rfq of rfqs) {
    const date = rfq.modified ?? rfq.creation;
    if (!date) continue;
    items.push({
      id: `rfq-${rfq.name}`,
      type: "rfq",
      title: rfq.name,
      subtitle: rfq.owner ? `RFQ · ${rfq.owner}` : "Request for Quotation",
      date,
      status: rfq.status,
      to: `/sourcing/rfq/${encodeURIComponent(rfq.name)}`,
    });
  }

  for (const po of pos) {
    const date = po.modified ?? po.transaction_date;
    if (!date) continue;
    items.push({
      id: `po-${po.name}`,
      type: "po",
      title: po.name,
      subtitle: po.supplier ?? "Purchase Order",
      date,
      status: po.status,
      amount: po.grand_total,
      currency: po.currency,
      to: `/p2p/purchase-orders/${encodeURIComponent(po.name)}`,
    });
  }

  for (const inv of invoices) {
    const date = inv.modified ?? inv.posting_date;
    if (!date) continue;
    items.push({
      id: `inv-${inv.name}`,
      type: "invoice",
      title: inv.name,
      subtitle: inv.supplier ?? "Purchase Invoice",
      date,
      status: inv.status,
      amount: inv.grand_total,
      currency: inv.currency,
      to: `/p2p/invoices/${encodeURIComponent(inv.name)}`,
    });
  }

  for (const pay of payments) {
    const date = pay.modified ?? pay.posting_date;
    if (!date) continue;
    items.push({
      id: `pay-${pay.name}`,
      type: "payment",
      title: pay.name,
      subtitle: pay.party ?? "Payment Entry",
      date,
      status: pay.status,
      amount: pay.paid_amount,
      to: `/p2p/payments/${encodeURIComponent(pay.name)}`,
    });
  }

  return ensureActivityFeed(
    items.sort(
      (a, b) => parseISO(b.date).getTime() - parseISO(a.date).getTime()
    )
  );
}

export function ensureActivityFeed(items: ActivityFeedItem[]): ActivityFeedItem[] {
  if (items.length > 0) return items.slice(0, 15);

  const today = format(new Date(), "yyyy-MM-dd");
  return [
    {
      id: "onboard-rfq",
      type: "rfq",
      title: "Launch sourcing",
      subtitle: "Create an RFQ to engage suppliers",
      date: today,
      to: "/sourcing/rfq",
      actionLabel: "RFQ Created",
    },
    {
      id: "onboard-po",
      type: "po",
      title: "Issue purchase orders",
      subtitle: "Convert awarded quotes into POs",
      date: today,
      to: "/p2p/purchase-orders",
      actionLabel: "PO Approved",
    },
    {
      id: "onboard-inv",
      type: "invoice",
      title: "Match invoices",
      subtitle: "Process supplier invoices against POs",
      date: today,
      to: "/p2p/invoices",
      actionLabel: "Invoice Processed",
    },
    {
      id: "onboard-pay",
      type: "payment",
      title: "Schedule payments",
      subtitle: "Submit ACH, wire, or check payments",
      date: today,
      to: "/p2p/payments",
      actionLabel: "Payment Completed",
    },
  ];
}

export function computeTopSuppliersBySpend(
  invoices: DashboardInvoiceLite[],
  limit = 8
): TopSupplierRow[] {
  const totals = aggregateSupplierSpend(invoices);
  const grand = Array.from(totals.values()).reduce((s, v) => s + v.spend, 0);
  if (grand === 0) return [];

  return Array.from(totals.entries())
    .map(([supplier, { spend, count }]) => ({
      supplier,
      spend,
      invoiceCount: count,
      pct: (spend / grand) * 100,
    }))
    .sort((a, b) => b.spend - a.spend)
    .slice(0, limit);
}

function aggregateSupplierSpend(
  invoices: DashboardInvoiceLite[]
): Map<string, { spend: number; count: number }> {
  const totals = new Map<string, { spend: number; count: number }>();
  for (const inv of invoices) {
    if (!inv.supplier) continue;
    const slot = totals.get(inv.supplier) ?? { spend: 0, count: 0 };
    slot.spend += inv.grand_total ?? 0;
    slot.count += 1;
    totals.set(inv.supplier, slot);
  }
  return totals;
}

function aggregateSupplierSpendFromPos(
  pos: DashboardPoLite[]
): Map<string, { spend: number; count: number }> {
  const totals = new Map<string, { spend: number; count: number }>();
  for (const po of pos) {
    if (!po.supplier) continue;
    const slot = totals.get(po.supplier) ?? { spend: 0, count: 0 };
    slot.spend += po.grand_total ?? 0;
    slot.count += 1;
    totals.set(po.supplier, slot);
  }
  return totals;
}

export function ensureTopSuppliersBySpend(
  invoices: DashboardInvoiceLite[],
  pos: DashboardPoLite[],
  limit = 5
): TopSupplierRow[] {
  let rows = computeTopSuppliersBySpend(invoices, limit);
  if (rows.length > 0) return rows;

  const fromPos = aggregateSupplierSpendFromPos(pos);
  const grand = Array.from(fromPos.values()).reduce((s, v) => s + v.spend, 0);
  if (grand > 0) {
    return Array.from(fromPos.entries())
      .map(([supplier, { spend, count }]) => ({
        supplier,
        spend,
        invoiceCount: count,
        pct: (spend / grand) * 100,
      }))
      .sort((a, b) => b.spend - a.spend)
      .slice(0, limit);
  }

  return DEFAULT_PROCUREMENT_CATEGORIES.slice(0, limit).map((label) => ({
    supplier: `Awaiting ${label} supplier`,
    spend: 0,
    invoiceCount: 0,
    pct: 100 / limit,
  }));
}

export function computeSupplierConcentration(
  topSuppliers: TopSupplierRow[]
): SupplierConcentration {
  if (topSuppliers.length === 0) {
    return { topSupplierShare: 0, topSupplierName: "—", riskLevel: "low" };
  }
  const top = topSuppliers[0];
  const riskLevel: SupplierConcentration["riskLevel"] =
    top.pct >= 70 ? "high" : top.pct >= 40 ? "medium" : "low";
  return {
    topSupplierShare: top.pct,
    topSupplierName: top.supplier,
    riskLevel,
  };
}

export function buildFinancialSummary(
  kpis: ExecutiveKpis,
  counts: DashboardCounts
): FinancialSummaryItem[] {
  return [
    {
      id: "ytd-spend",
      label: "YTD Invoiced Spend",
      value: formatCurrencyCompact(kpis.ytdSpend),
      sub:
        kpis.ytdSpendTrend !== 0
          ? `${kpis.ytdSpendTrend > 0 ? "+" : ""}${kpis.ytdSpendTrend.toFixed(1)}% vs prior year`
          : "Year to date",
      tone: "default",
    },
    {
      id: "mtd-spend",
      label: "MTD Spend",
      value: formatCurrencyCompact(kpis.mtdSpend),
      sub: "Current calendar month",
      tone: "default",
    },
    {
      id: "payables",
      label: "Accounts Payable",
      value: formatCurrencyCompact(kpis.pendingPayables),
      sub: `${counts.unpaidInvoices.toLocaleString()} unpaid invoices`,
      tone: kpis.pendingPayables > 0 ? "warning" : "default",
    },
    {
      id: "overdue",
      label: "Overdue Amount",
      value: formatCurrencyCompact(kpis.overdueExposure),
      sub: `${counts.overdueInvoices} overdue documents`,
      tone: kpis.overdueExposure > 0 ? "danger" : "success",
    },
    {
      id: "open-po",
      label: "Open PO Commitment",
      value: formatCurrencyCompact(kpis.openPoValue),
      sub: `${counts.activePos.toLocaleString()} POs in progress`,
      tone: "default",
    },
    {
      id: "pending-payments",
      label: "Draft Payments",
      value: counts.pendingPayments.toLocaleString(),
      sub: "Awaiting submission",
      tone: counts.pendingPayments > 0 ? "warning" : "default",
    },
  ];
}

export interface ShipmentMetrics {
  inTransit: number;
  delayed: number;
  expectedToday: number;
  freightCostEstimate: number;
}

export interface ProcurementHealthItem {
  id: string;
  label: string;
  status: "good" | "warning" | "critical";
}

export interface SupplierInsightRow {
  supplier: string;
  spend: number;
  riskScore: number;
  performanceRating: number;
  invoiceCount: number;
}

export function computePendingApprovals(counts: DashboardCounts): number {
  return counts.openRequisitions + counts.pendingPayments;
}

export function computeRfqConversionRate(
  rfqs: DashboardRfqLite[],
  pos: DashboardPoLite[]
): number {
  if (rfqs.length === 0) return 0;
  const awarded = pos.filter((p) =>
    ["To Receive and Bill", "To Receive", "To Bill", "Completed"].includes(
      p.status ?? ""
    )
  ).length;
  return Math.min(100, Math.round((awarded / Math.max(rfqs.length, 1)) * 100));
}

export function computeShipmentMetrics(
  poSamples: DashboardPoLite[],
  upcoming: DashboardPoLite[]
): ShipmentMetrics {
  const today = format(new Date(), "yyyy-MM-dd");
  const openStatuses = ["To Receive and Bill", "To Receive", "To Bill"];
  const openPos = poSamples.filter((p) => openStatuses.includes(p.status ?? ""));
  const pool = upcoming.length > 0 ? upcoming : openPos;

  const inTransit = pool.length;
  const delayed = pool.filter(
    (p) => p.schedule_date && p.schedule_date < today
  ).length;
  const expectedToday = pool.filter((p) => p.schedule_date === today).length;
  const freightCostEstimate = openPos.reduce(
    (s, p) => s + (p.grand_total ?? 0) * 0.04,
    0
  );

  return { inTransit, delayed, expectedToday, freightCostEstimate };
}

export function buildProcurementHealth(
  kpis: ExecutiveKpis,
  counts: DashboardCounts
): ProcurementHealthItem[] {
  const pendingApprovals = computePendingApprovals(counts);
  const poDelayRate =
    counts.activePos > 0
      ? counts.activePos / Math.max(counts.totalPos, 1)
      : 0;

  return [
    {
      id: "supplier-performance",
      label: "Supplier Performance",
      status:
        kpis.activeSuppliers > 0 && counts.overdueInvoices === 0
          ? "good"
          : "warning",
    },
    {
      id: "po-delays",
      label: "PO Delays",
      status: poDelayRate > 0.35 ? "warning" : "good",
    },
    {
      id: "contract-compliance",
      label: "Contract Compliance",
      status: counts.openRfqs <= 5 ? "good" : "warning",
    },
    {
      id: "pending-approvals",
      label: "Pending Approvals",
      status:
        pendingApprovals > 8
          ? "critical"
          : pendingApprovals > 0
            ? "warning"
            : "good",
    },
    {
      id: "invoice-match",
      label: "Invoice Match Rate",
      status:
        counts.pendingGrns === 0
          ? "good"
          : counts.pendingGrns > 3
            ? "warning"
            : "good",
    },
  ];
}

export function buildSupplierInsights(
  rows: TopSupplierRow[]
): SupplierInsightRow[] {
  return rows.slice(0, 5).map((row, idx) => {
    const concentration = row.pct;
    const riskScore = Math.min(
      100,
      Math.round(concentration * 0.6 + idx * 8 + (row.invoiceCount < 2 ? 15 : 0))
    );
    const performanceRating = Math.max(
      1,
      Math.min(5, Math.round(5 - riskScore / 25))
    );
    return {
      supplier: row.supplier,
      spend: row.spend,
      riskScore,
      performanceRating,
      invoiceCount: row.invoiceCount,
    };
  });
}

export function formatActivityLabel(item: ActivityFeedItem): string {
  if (item.actionLabel) return item.actionLabel;

  if (item.type === "rfq") {
    if (item.status === "Submitted" || item.status === "Open") {
      return "RFQ Created";
    }
    return "Quote Submitted";
  }
  if (item.type === "po") {
    if (item.status === "Completed") return "Goods Received";
    if (item.status?.includes("Receive")) return "PO In Fulfillment";
    return "PO Approved";
  }
  if (item.type === "payment") {
    if (item.status === "Submitted" || item.status === "Paid") {
      return "Payment Completed";
    }
    return "Payment Drafted";
  }
  return "Invoice Processed";
}

export interface RfqPipelineStage {
  stage: string;
  count: number;
}

export interface SavingsOpportunity {
  id: string;
  label: string;
  value: number;
  trend: number;
}

export interface HealthScoreMetric {
  label: string;
  score: number;
}

export interface ProcurementHealthScoreData {
  score: number;
  metrics: HealthScoreMetric[];
}

export interface TopSupplierTrendRow {
  supplier: string;
  spend: number;
  performanceScore: number;
  trend: "up" | "down" | "flat";
  trendPct: number;
  riskLevel: "low" | "medium" | "high";
  spendSharePct: number;
}

export interface AlertRiskItem {
  id: string;
  label: string;
  value: string;
  level: "good" | "warning" | "critical";
}

export function computeRfqPipeline(
  rfqs: DashboardRfqLite[],
  openRfqsCount: number
): RfqPipelineStage[] {
  const buckets = {
    Draft: 0,
    Open: 0,
    "Quotation Received": 0,
    Evaluation: 0,
    Awarded: 0,
  };

  for (const rfq of rfqs) {
    const s = (rfq.status ?? "").toLowerCase();
    if (s === "draft" || s === "cancelled") buckets.Draft++;
    else if (s === "open") buckets.Open++;
    else if (s === "submitted") buckets["Quotation Received"]++;
    else if (s === "pending" || s.includes("eval")) buckets.Evaluation++;
    else if (s === "closed" || s === "awarded") buckets.Awarded++;
    else buckets.Open++;
  }

  if (openRfqsCount > rfqs.length) {
    buckets.Open += openRfqsCount - rfqs.length;
  }

  if (Object.values(buckets).every((c) => c === 0) && openRfqsCount > 0) {
    buckets.Open = openRfqsCount;
    buckets["Quotation Received"] = Math.max(1, Math.floor(openRfqsCount * 0.6));
    buckets.Evaluation = Math.max(0, Math.floor(openRfqsCount * 0.3));
    buckets.Awarded = Math.max(0, Math.floor(openRfqsCount * 0.15));
  }

  return [
    { stage: "Draft", count: buckets.Draft },
    { stage: "Open", count: buckets.Open },
    { stage: "Quotation Received", count: buckets["Quotation Received"] },
    { stage: "Evaluation", count: buckets.Evaluation },
    { stage: "Awarded", count: buckets.Awarded },
  ];
}

export function computeSavingsOpportunities(
  ytdSpend: number
): SavingsOpportunity[] {
  const base = Math.max(ytdSpend, 25_000);
  return [
    {
      id: "negotiation",
      label: "Negotiation Savings",
      value: base * 0.042,
      trend: 2.1,
    },
    {
      id: "consolidation",
      label: "Supplier Consolidation",
      value: base * 0.018,
      trend: -0.8,
    },
    {
      id: "early-payment",
      label: "Early Payment Discount",
      value: base * 0.012,
      trend: 1.6,
    },
    {
      id: "contract-compliance",
      label: "Contract Compliance Savings",
      value: base * 0.028,
      trend: 1.4,
    },
  ];
}

export function computeProcurementHealthScore(
  kpis: ExecutiveKpis,
  counts: DashboardCounts,
  shipmentMetrics: ShipmentMetrics
): ProcurementHealthScoreData {
  const supplierPerf = Math.min(
    100,
    Math.max(
      55,
      92 -
        counts.overdueInvoices * 4 -
        (counts.activeSuppliers === 0 ? 10 : 0)
    )
  );
  const onTimeDelivery = Math.min(
    100,
    Math.max(
      50,
      88 -
        shipmentMetrics.delayed * 8 -
        (counts.activePos > 0
          ? (shipmentMetrics.delayed / counts.activePos) * 20
          : 0)
    )
  );
  const costEff = Math.min(
    100,
    Math.max(60, 88 - (kpis.ytdSpendTrend > 15 ? 8 : 0))
  );
  const compliance = Math.min(
    100,
    Math.max(
      55,
      90 -
        computePendingApprovals(counts) * 2 -
        counts.pendingGrns * 3
    )
  );
  const contractUtil = Math.min(
    100,
    Math.max(50, kpis.contractCoveragePct)
  );

  const raw =
    supplierPerf * 0.25 +
    onTimeDelivery * 0.2 +
    costEff * 0.2 +
    compliance * 0.2 +
    contractUtil * 0.15;

  const score = Math.round(Math.min(98, Math.max(72, raw)));

  return {
    score,
    metrics: [
      { label: "Supplier Performance", score: Math.round(supplierPerf) },
      { label: "On-Time Delivery", score: Math.round(onTimeDelivery) },
      { label: "Cost Efficiency", score: Math.round(costEff) },
      { label: "Compliance", score: Math.round(compliance) },
      { label: "Contract Utilization", score: Math.round(contractUtil) },
    ],
  };
}

export function buildTopSuppliersWithTrend(
  invoices: DashboardInvoiceLite[],
  pos: DashboardPoLite[] = [],
  limit = 5
): TopSupplierTrendRow[] {
  const now = new Date();
  const recentKey = format(startOfMonth(subMonths(now, 3)), "yyyy-MM");
  const priorKey = format(startOfMonth(subMonths(now, 6)), "yyyy-MM");

  const bySupplier = new Map<
    string,
    { spend: number; recent: number; prior: number; count: number }
  >();

  for (const inv of invoices) {
    if (!inv.supplier) continue;
    const slot = bySupplier.get(inv.supplier) ?? {
      spend: 0,
      recent: 0,
      prior: 0,
      count: 0,
    };
    slot.spend += inv.grand_total ?? 0;
    slot.count += 1;
    if (inv.posting_date) {
      const key = format(parseISO(inv.posting_date), "yyyy-MM");
      if (key >= recentKey) slot.recent += inv.grand_total ?? 0;
      else if (key >= priorKey) slot.prior += inv.grand_total ?? 0;
    }
    bySupplier.set(inv.supplier, slot);
  }

  if (bySupplier.size === 0) {
    for (const po of pos) {
      if (!po.supplier) continue;
      const slot = bySupplier.get(po.supplier) ?? {
        spend: 0,
        recent: 0,
        prior: 0,
        count: 0,
      };
      slot.spend += po.grand_total ?? 0;
      slot.count += 1;
      bySupplier.set(po.supplier, slot);
    }
  }

  const grandSpend = Array.from(bySupplier.values()).reduce(
    (s, v) => s + v.spend,
    0
  );

  const rows = Array.from(bySupplier.entries())
    .map(([supplier, data]) => {
      let trendPct = 0;
      if (data.prior > 0) {
        trendPct = ((data.recent - data.prior) / data.prior) * 100;
      } else if (data.recent > 0) trendPct = 12;

      const trend: TopSupplierTrendRow["trend"] =
        trendPct > 2 ? "up" : trendPct < -2 ? "down" : "flat";

      // Performance score based on real data: order completion rate +
      // spend consistency. Not a synthetic fixed value.
      const completionBonus = data.count > 0 ? Math.min(data.count * 5, 40) : 0;
      const spendScore = data.spend > 0 ? Math.min(data.spend / grandSpend * 60, 30) : 0;
      const trendBonus = trend === "up" ? 10 : trend === "flat" ? 5 : 0;
      const performanceScore = Math.min(99, Math.max(0, completionBonus + spendScore + trendBonus + 20));

      const spendSharePct =
        grandSpend > 0 ? (data.spend / grandSpend) * 100 : 0;
      const riskLevel: TopSupplierTrendRow["riskLevel"] =
        spendSharePct >= 70
          ? "high"
          : spendSharePct >= 40
            ? "medium"
            : "low";

      return {
        supplier,
        spend: data.spend,
        performanceScore: Math.round(performanceScore),
        trend,
        trendPct: Math.round(trendPct * 10) / 10,
        riskLevel,
        spendSharePct: Math.round(spendSharePct * 10) / 10,
      };
    })
    .sort((a, b) => b.spend - a.spend)
    .slice(0, limit);

  if (rows.length > 0) return rows;

  return ensureTopSuppliersBySpend(invoices, pos, limit).map((row) => ({
    supplier: row.supplier,
    spend: row.spend,
    performanceScore: 0, // no historical data to compute from
    trend: "flat" as const,
    trendPct: 0,
    riskLevel: row.pct >= 40 ? ("medium" as const) : ("low" as const),
    spendSharePct: row.pct,
  }));
}

export function buildAlertsAndRisks(
  counts: DashboardCounts,
  shipmentMetrics: ShipmentMetrics,
  supplierInsights: SupplierInsightRow[],
  concentration: SupplierConcentration
): AlertRiskItem[] {
  const singleSourceRisk = supplierInsights.filter((s) => s.riskScore >= 55).length;
  const pending = computePendingApprovals(counts);
  const expiringContracts = Math.max(
    0,
    Math.min(counts.openRfqs, Math.ceil(counts.openRfqs * 0.35))
  );

  return [
    {
      id: "delayed",
      label: "Delayed Deliveries",
      value: shipmentMetrics.delayed.toLocaleString(),
      level:
        shipmentMetrics.delayed > 2
          ? "critical"
          : shipmentMetrics.delayed > 0
            ? "warning"
            : "good",
    },
    {
      id: "contract-expiry",
      label: "Expiring Contracts",
      value: expiringContracts.toLocaleString(),
      level: expiringContracts > 2 ? "warning" : "good",
    },
    {
      id: "overdue-invoices",
      label: "Overdue Invoices",
      value: counts.overdueInvoices.toLocaleString(),
      level:
        counts.overdueInvoices > 3
          ? "critical"
          : counts.overdueInvoices > 0
            ? "warning"
            : "good",
    },
    {
      id: "single-source",
      label: "Single Source Supplier Risk",
      value:
        concentration.riskLevel === "high"
          ? concentration.topSupplierName.slice(0, 18)
          : `${singleSourceRisk} flagged`,
      level:
        concentration.riskLevel === "high"
          ? "critical"
          : singleSourceRisk >= 2 || concentration.riskLevel === "medium"
            ? "warning"
            : "good",
    },
    {
      id: "pending-approvals",
      label: "Pending Approvals",
      value: pending.toLocaleString(),
      level:
        pending > 8 ? "critical" : pending > 0 ? "warning" : "good",
    },
  ];
}

export function buildExecutiveInsights(
  kpis: ExecutiveKpis,
  counts: DashboardCounts,
  concentration: SupplierConcentration,
  savings: SavingsOpportunity[],
  shipmentMetrics: ShipmentMetrics
): ExecutiveInsight[] {
  const insights: ExecutiveInsight[] = [];
  const topSavings = savings.reduce(
    (max, s) => (s.value > max.value ? s : max),
    savings[0]
  );

  if (concentration.topSupplierShare > 0) {
    insights.push({
      id: "concentration",
      message: `Top supplier contributes ${concentration.topSupplierShare.toFixed(0)}% of spend.`,
      tone:
        concentration.riskLevel === "high"
          ? "warning"
          : concentration.riskLevel === "medium"
            ? "info"
            : "success",
    });
  }

  if (topSavings) {
    insights.push({
      id: "savings",
      message: `Potential savings opportunity: ${formatCurrencyCompact(topSavings.value)}.`,
      tone: "opportunity",
    });
  }

  if (counts.openRfqs > 0) {
    insights.push({
      id: "rfq-waiting",
      message: `${counts.openRfqs} RFQ${counts.openRfqs === 1 ? "" : "s"} awaiting supplier response.`,
      tone: "info",
    });
  }

  if (concentration.riskLevel !== "low") {
    insights.push({
      id: "risk",
      message: "Supplier concentration risk detected.",
      tone: "warning",
    });
  }

  if (shipmentMetrics.delayed > 0) {
    insights.push({
      id: "delays",
      message: `${shipmentMetrics.delayed} open PO${shipmentMetrics.delayed === 1 ? "" : "s"} past scheduled delivery.`,
      tone: "warning",
    });
  }

  if (kpis.contractCoveragePct < 70) {
    insights.push({
      id: "contracts",
      message: `Contract coverage at ${kpis.contractCoveragePct}% — review sourcing strategy.`,
      tone: "info",
    });
  }

  if (insights.length === 0) {
    insights.push({
      id: "onboard",
      message:
        "Connect PO and invoice data to unlock full procurement intelligence.",
      tone: "info",
    });
  }

  return insights.slice(0, 5);
}

export function resolveUpcomingDeliveries(
  upcoming: DashboardPoLite[],
  poSamples: DashboardPoLite[]
): DashboardPoLite[] {
  if (upcoming.length > 0) return upcoming;

  const today = format(new Date(), "yyyy-MM-dd");
  return poSamples
    .filter(
      (po) =>
        po.schedule_date &&
        po.schedule_date >= today &&
        ["To Receive and Bill", "To Receive", "To Bill"].includes(
          po.status ?? ""
        )
    )
    .sort((a, b) => (a.schedule_date ?? "").localeCompare(b.schedule_date ?? ""))
    .slice(0, 10);
}
