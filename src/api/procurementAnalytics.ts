/**
 * Procurement Analytics engine.
 *
 * Computes enterprise procurement KPIs and chart series from **live ERPNext
 * data only**. Nothing here is hardcoded: every metric is derived from the
 * Budget, Purchase Order, Purchase Receipt, Request for Quotation, Supplier
 * Quotation and Material Request doctypes. When the data required for a KPI
 * cannot be retrieved (empty result, missing linkage, or a permission error),
 * the KPI is flagged `available: false` so the UI can render a
 * "No data available" state instead of a fabricated number.
 *
 * The whole aggregation runs with per-metric isolation (try/catch +
 * Promise.allSettled) so a single failing query never takes down the section.
 */
import { getBudgetDashboard } from "./budgetDashboard";
import { apiGet, getCount } from "./erpnext";
import {
  getMaterialRequest,
  getMaterialRequests,
  getPurchaseOrder,
  getPurchaseOrders,
} from "./purchasing";
import {
  getRFQ,
  getRFQs,
  getSupplierQuotation,
  getSupplierQuotationSummariesForRfq,
} from "./sourcing";
import { RESPONSE_DOCTYPE } from "./supplierRfqResponse";
import { timedDashApi } from "./dashboardPerf";
import {
  fetchProcurementTruthCounts,
  logDashboardWidget,
  type ProcurementTruthCounts,
} from "./procurementDashboardTruth";

/* ── Public types ─────────────────────────────────────────────────────── */

export type KpiStatus = "good" | "warning" | "bad" | "neutral";

export interface KpiTrend {
  /** Movement of the most recent period vs the previous one. */
  direction: "up" | "down" | "flat";
  /** Percentage change (absolute value, already rounded). */
  pct: number;
  /** Short label, e.g. "vs last month". */
  label: string;
  /** When true a downward movement is a good thing (e.g. cycle time). */
  inverted?: boolean;
}

export interface AnalyticsKpi {
  available: boolean;
  /** Raw numeric value (null when unavailable). */
  value: number | null;
  /** Pre-formatted current value for display (`--` when waiting). */
  display: string;
  status: KpiStatus;
  trend: KpiTrend | null;
  /** Small numeric series for a mini sparkline (empty when not applicable). */
  sparkline: number[];
  /** Progress-bar percentage (0–100) when the KPI is a utilisation gauge. */
  progress?: number;
  /** Extra key/value bits rendered beneath the value (already formatted). */
  meta?: Array<{ label: string; value: string }>;
  /** Line under the value (e.g. "Waiting for completed RFQs"). */
  subtitle?: string;
  /** Footer tip shown under meta (waiting or live explanatory text). */
  footer?: string;
  /**
   * Custom text shown when `available` is false, in place of the generic
   * "No data available" (prefer `subtitle` + `display: "--"` for waiting KPIs).
   */
  emptyMessage?: string;
}

export interface SpendPoint {
  month: string;
  amount: number;
}
export interface BudgetActualPoint {
  name: string;
  allocated: number;
  actual: number;
}
export interface ResponsePoint {
  month: string;
  invited: number;
  responded: number;
  rate: number;
}
export interface TurnaroundPoint {
  month: string;
  days: number;
}
export interface SavingsPoint {
  month: string;
  savings: number;
}

export interface ProcurementAnalytics {
  currency: string;
  costSavings: AnalyticsKpi;
  budgetUtilisation: AnalyticsKpi;
  rfqTurnaround: AnalyticsKpi;
  supplierResponse: AnalyticsKpi;
  cycleTime: AnalyticsKpi;
  onTimeDelivery: AnalyticsKpi;
  charts: {
    monthlySpend: SpendPoint[];
    budgetVsActual: BudgetActualPoint[];
    supplierResponse: ResponsePoint[];
    rfqTurnaround: TurnaroundPoint[];
    costSavings: SavingsPoint[];
  };
}

/* ── Internal helpers ─────────────────────────────────────────────────── */

/** How many recent RFQs / POs to hydrate for join-based KPIs. Bounded to keep
 *  the dashboard responsive; each call is independent and cached for 5 min. */
const SAMPLE_LIMIT = 5;

const UNAVAILABLE: AnalyticsKpi = {
  available: false,
  value: null,
  display: "No data available",
  status: "neutral",
  trend: null,
  sparkline: [],
};

function unavailable(): AnalyticsKpi {
  return { ...UNAVAILABLE };
}

function safeDate(value: unknown): Date | null {
  if (!value || typeof value !== "string") return null;
  // ERPNext dates are "YYYY-MM-DD" or "YYYY-MM-DD HH:mm:ss".
  const iso = value.includes(" ") ? value.replace(" ", "T") : value;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

function diffDays(later: Date, earlier: Date): number {
  return (later.getTime() - earlier.getTime()) / 86_400_000;
}

function diffHours(later: Date, earlier: Date): number {
  return (later.getTime() - earlier.getTime()) / 3_600_000;
}

/**
 * Compact enterprise duration: "6h 18m", "2d 6h", "45m".
 * Never returns "0 days" / NaN.
 */
function formatCompactDuration(totalHours: number): string {
  if (!Number.isFinite(totalHours) || totalHours < 0) return "--";
  const totalMinutes = Math.round(totalHours * 60);
  if (totalMinutes <= 0) return "<1m";
  const days = Math.floor(totalMinutes / (24 * 60));
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) {
    return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  }
  if (hours > 0) {
    return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  }
  return `${minutes}m`;
}

/** @deprecated alias — prefer formatCompactDuration */
function formatCycleDuration(hours: number): string {
  return formatCompactDuration(hours);
}

/** @deprecated alias — prefer formatCompactDuration */
function formatDaysHours(totalHours: number): string {
  return formatCompactDuration(totalHours);
}

function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(key: string): string {
  const [y, m] = key.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleString("en-US", { month: "short" });
}

function last12MonthKeys(): string[] {
  const out: string[] = [];
  const now = new Date();
  for (let i = 11; i >= 0; i--) {
    out.push(monthKey(new Date(now.getFullYear(), now.getMonth() - i, 1)));
  }
  return out;
}

export function formatUSD(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000)
    return `$${(n / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)}M`;
  if (abs >= 1_000) return `$${(n / 1_000).toFixed(abs >= 10_000 ? 0 : 1)}K`;
  return `$${n.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/** Build a trend from the last two points of a monthly series. */
function trendFromSeries(
  series: number[],
  label: string,
  inverted = false
): KpiTrend | null {
  if (series.length < 2) return null;
  const prev = series[series.length - 2];
  const curr = series[series.length - 1];
  if (prev === 0 && curr === 0) return null;
  const rawPct = prev === 0 ? 100 : ((curr - prev) / Math.abs(prev)) * 100;
  const direction = curr > prev ? "up" : curr < prev ? "down" : "flat";
  return {
    direction,
    pct: Math.round(Math.abs(rawPct)),
    label,
    inverted,
  };
}

/* ── Individual KPI computations ─────────────────────────────────────── */

interface RfqLike {
  transaction_date?: string;
  creation?: string;
  modified?: string;
  suppliers?: Array<{ quote_status?: string; quote_received?: number }>;
}

interface SqLike {
  name?: string;
  grand_total?: number;
  transaction_date?: string;
  modified?: string;
}

interface PoLike {
  name: string;
  transaction_date?: string;
  schedule_date?: string;
  grand_total?: number;
  per_received?: number;
  status?: string;
  modified?: string;
}

function isResponded(status?: string, received?: number): boolean {
  if (typeof received === "number" && received > 0) return true;
  if (!status) return false;
  const s = status.toLowerCase();
  // A "No Quote" decline is an intentional response, not a pending one.
  return (
    s.includes("received") ||
    s.includes("submitted") ||
    s.includes("answered") ||
    s.includes("no quote") ||
    s.includes("declined")
  );
}

type PoDetailLite = {
  name?: string;
  creation?: string;
  transaction_date?: string;
  remarks?: string;
  items?: Array<{
    material_request?: string;
    request_for_quotation?: string;
    supplier_quotation?: string;
  }>;
};

/**
 * Prefer ONE Purchase Order Item list query for linkage fields; only fall
 * back to get_doc when the child doctype is not queryable.
 *
 * Never request `request_for_quotation` on Purchase Order Item — this
 * install returns HTTP 417 "Field not permitted in query". RFQ links are
 * recovered via `supplier_quotation` → Supplier Quotation Item.
 */
async function hydratePoDetailsForAnalytics(
  pos: Array<PoLike & { creation?: string }>,
): Promise<Array<PoDetailLite | null>> {
  if (pos.length === 0) return [];
  const poNames = pos.map((p) => p.name);

  const byParent = new Map<string, PoDetailLite>();
  for (const p of pos) {
    byParent.set(p.name, {
      name: p.name,
      transaction_date: p.transaction_date,
      creation: (p as { creation?: string }).creation,
      items: [],
    });
  }

  try {
    const items = await apiGet<
      Array<{
        parent?: string;
        material_request?: string;
        supplier_quotation?: string;
      }>
    >("/api/resource/Purchase Order Item", {
      params: {
        // Only fields known to be list-queryable on this ERPNext install.
        fields: JSON.stringify([
          "parent",
          "material_request",
          "supplier_quotation",
        ]),
        filters: JSON.stringify([["parent", "in", poNames]]),
        limit_page_length: Math.min(500, poNames.length * 40),
      },
    });
    for (const row of items ?? []) {
      const parent = row.parent?.trim();
      if (!parent || !byParent.has(parent)) continue;
      byParent.get(parent)!.items!.push({
        material_request: row.material_request,
        supplier_quotation: row.supplier_quotation,
      });
    }

    return poNames.map((n) => byParent.get(n) ?? null);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(
      "[ERP failing request] Purchase Order Item hydrate (analytics)",
      { poNames, fields: ["parent", "material_request", "supplier_quotation"] },
      err instanceof Error ? err.message : err,
    );
    // Fall back to get_doc (full doc includes child tables).
    return Promise.all(
      poNames.map((name) =>
        getPurchaseOrder(name)
          .then((d) => d as unknown as PoDetailLite)
          .catch(() => null),
      ),
    );
  }
}

/** Sum draft (pending) PO grand totals for budget forecast commitment. */
async function sumPendingPoCommitment(): Promise<number> {
  try {
    const rows = await getPurchaseOrders({
      filters: [["docstatus", "=", 0]],
      fields: ["name", "grand_total", "docstatus"],
      limit_page_length: 200,
      order_by: "modified desc",
    });
    return rows.reduce((s, r) => s + (Number(r.grand_total) || 0), 0);
  } catch {
    return 0;
  }
}

/** Budget utilisation from the Budget doctype (allocated vs consumed). */
async function computeBudget(opts?: {
  openRfqs?: number;
  pendingPurchaseOrders?: number;
}): Promise<{
  kpi: AnalyticsKpi;
  chart: BudgetActualPoint[];
  currency: string;
}> {
  const [data, pendingCommitment] = await Promise.all([
    getBudgetDashboard({ maxBudgets: 8 }),
    sumPendingPoCommitment(),
  ]);
  const { totalBudget, consumedBudget, availableBudget, utilizationPct } =
    data.kpis;

  const chart: BudgetActualPoint[] = (data.rows ?? [])
    .slice()
    .sort((a, b) => b.allocated - a.allocated)
    .slice(0, 6)
    .map((r) => ({
      name: r.department || r.costCenter || r.name,
      allocated: r.allocated,
      actual: r.consumed,
    }));

  if (!data.hasBudgets || totalBudget <= 0) {
    return { kpi: unavailable(), chart, currency: data.currency || "USD" };
  }

  // Forecast = spent + pending PO commitment (+ light RFQ pipeline buffer).
  const openRfqs = opts?.openRfqs ?? 0;
  const avgPendingPo =
    (opts?.pendingPurchaseOrders ?? 0) > 0
      ? pendingCommitment / (opts!.pendingPurchaseOrders as number)
      : 0;
  const rfqPipelineEstimate = openRfqs > 0 ? openRfqs * avgPendingPo * 0.35 : 0;
  const forecast = Math.max(
    consumedBudget,
    consumedBudget + pendingCommitment + rfqPipelineEstimate,
  );
  const remaining = Math.max(totalBudget - consumedBudget, 0);
  const pct = Math.round(utilizationPct);
  const forecastPct =
    totalBudget > 0 ? Math.round((forecast / totalBudget) * 100) : 0;
  const status: KpiStatus =
    pct >= 90 ? "bad" : pct >= 70 ? "warning" : "good";

  return {
    currency: data.currency || "USD",
    chart,
    kpi: {
      available: true,
      value: pct,
      display: `${pct}%`,
      subtitle: "Budget utilisation",
      status,
      trend: null,
      sparkline: [],
      progress: Math.min(100, pct),
      meta: [
        { label: "Allocated", value: formatUSD(totalBudget) },
        { label: "Spent", value: formatUSD(consumedBudget) },
        { label: "Remaining", value: formatUSD(remaining) },
        {
          label: "Forecast",
          value: `${formatUSD(forecast)} (${forecastPct}%)`,
        },
      ],
    },
  };
}

/**
 * Cost savings captured through competitive sourcing.
 * For each RFQ with two or more supplier quotations we take
 * (highest quote − lowest quote) as the negotiated saving, and the highest
 * quote as the baseline "estimated" cost. Savings % = savings / baseline.
 */
function computeSavings(
  quotesByRfq: Array<{ month: string | null; quotes: SqLike[] }>
): { kpi: AnalyticsKpi; chart: SavingsPoint[] } {
  const monthKeys = last12MonthKeys();
  const byMonth = new Map<string, number>(monthKeys.map((k) => [k, 0]));
  let totalSavings = 0;
  let totalBaseline = 0;
  let contributingRfqs = 0;
  const thisMonthKey = monthKey(new Date());

  for (const { month, quotes } of quotesByRfq) {
    const totals = quotes
      .map((q) => Number(q.grand_total ?? 0))
      .filter((v) => v > 0);
    if (totals.length < 2) continue;
    const max = Math.max(...totals);
    const min = Math.min(...totals);
    const saving = max - min;
    if (saving <= 0) continue;
    totalSavings += saving;
    totalBaseline += max;
    contributingRfqs += 1;
    if (month && byMonth.has(month)) {
      byMonth.set(month, (byMonth.get(month) ?? 0) + saving);
    }
  }

  const chart: SavingsPoint[] = monthKeys
    .map((k) => ({
      month: monthLabel(k),
      savings: Math.round(byMonth.get(k) ?? 0),
    }))
    .filter((p) => p.savings > 0);

  if (contributingRfqs === 0 || totalSavings <= 0) {
    return {
      kpi: {
        ...unavailable(),
        display: "--",
        emptyMessage: "No data available",
        subtitle: "Need 2+ quotes per RFQ to measure savings",
      },
      chart,
    };
  }

  const pct = totalBaseline > 0 ? (totalSavings / totalBaseline) * 100 : 0;
  const savedThisMonth = byMonth.get(thisMonthKey) ?? 0;
  const sparkline = monthKeys.map((k) => byMonth.get(k) ?? 0).filter((v) => v > 0);
  return {
    kpi: {
      available: true,
      value: totalSavings,
      display: formatUSD(totalSavings),
      subtitle: "Highest quote − lowest quote",
      status: "good",
      trend: trendFromSeries(
        monthKeys.map((k) => byMonth.get(k) ?? 0),
        "vs last month",
      ),
      sparkline,
      meta: [
        { label: "Savings", value: `${pct.toFixed(1)}%` },
        { label: "RFQs", value: String(contributingRfqs) },
        {
          label: "Saved this month",
          value: formatUSD(savedThisMonth),
        },
      ],
    },
    chart,
  };
}

/* ── Orchestration ────────────────────────────────────────────────────── */

export async function fetchProcurementAnalytics(): Promise<ProcurementAnalytics> {
  const t0 = typeof performance !== "undefined" ? performance.now() : 0;
  const monthKeys = last12MonthKeys();

  // Truth counts first (shared cache with executive KPIs), then parallel samples.
  const truth: ProcurementTruthCounts = await timedDashApi(
    "Truth counts (analytics)",
    () => fetchProcurementTruthCounts(),
  ).catch(() => ({
    openRfqs: 0,
    pendingQuotations: 0,
    pendingPurchaseOrders: 0,
    activeSuppliers: 0,
    submittedMaterialRequests: 0,
    submittedPurchaseOrders: 0,
    fetchedAt: new Date().toISOString(),
    source: "frappe.client.get_count" as const,
  }));

  const [budgetRes, poRes, rfqListRes, mrRes, declineCountRes] =
    await Promise.allSettled([
      timedDashApi("Supplier Analytics · Budget", () =>
        computeBudget({
          openRfqs: truth.openRfqs,
          pendingPurchaseOrders: truth.pendingPurchaseOrders,
        }),
      ),
      timedDashApi("Supplier Analytics · PO list", () =>
        getPurchaseOrders({
          limit_page_length: 100,
          fields: [
            "name",
            "status",
            "transaction_date",
            "schedule_date",
            "grand_total",
            "per_received",
            "modified",
            "creation",
          ],
          order_by: "transaction_date desc",
        }),
      ),
      timedDashApi("Supplier Analytics · RFQ list", () => getRFQs()),
      timedDashApi("Supplier Analytics · MR list", () =>
        getMaterialRequests({
          limit_page_length: 100,
          fields: [
            "name",
            "status",
            "transaction_date",
            "creation",
            "modified",
            "owner",
          ],
        }),
      ),
      timedDashApi("Supplier Analytics · No-quote count", () =>
        getCount(RESPONSE_DOCTYPE, []),
      ),
    ]);

  const noQuoteTotal =
    declineCountRes.status === "fulfilled" ? Number(declineCountRes.value) : 0;

  const budget =
    budgetRes.status === "fulfilled"
      ? budgetRes.value
      : { kpi: unavailable(), chart: [] as BudgetActualPoint[], currency: "USD" };

  const poRows: PoLike[] =
    poRes.status === "fulfilled" ? (poRes.value as PoLike[]) : [];

  const rfqRows =
    rfqListRes.status === "fulfilled" ? rfqListRes.value : [];

  const mrRows = mrRes.status === "fulfilled" ? mrRes.value : [];
  const mrDateMap = new Map<string, string>();
  for (const m of mrRows) {
    const created = (m as { creation?: string }).creation ?? m?.transaction_date;
    if (m?.name && created) mrDateMap.set(m.name, created);
  }

  const recentRfqs = rfqRows.slice(0, SAMPLE_LIMIT);
  // Cycle time only considers completed procurement — never Draft/Cancelled POs.
  const eligiblePos = poRows.filter(
    (p) => p.status !== "Draft" && p.status !== "Cancelled"
  );
  const recentPos = eligiblePos.slice(0, SAMPLE_LIMIT);

  // Hydrate join samples in parallel.
  // SQ path uses list summaries (no N× get_doc). PO links prefer a single
  // Purchase Order Item query before falling back to get_doc.
  const [rfqDetails, quotesPerRfq, poDetails] = await timedDashApi(
    "Supplier Analytics · hydrate samples",
    () =>
      Promise.all([
        Promise.all(
          recentRfqs.map((r) =>
            getRFQ(r.name)
              .then((d) => d as unknown as RfqLike)
              .catch(() => null),
          ),
        ),
        Promise.all(
          recentRfqs.map((r) =>
            getSupplierQuotationSummariesForRfq(r.name)
              .then((qs) => ({ rfq: r, quotes: qs as SqLike[] }))
              .catch(() => ({ rfq: r, quotes: [] as SqLike[] })),
          ),
        ),
        hydratePoDetailsForAnalytics(recentPos),
      ]),
  );

  /* ── Monthly spend (submitted POs by transaction_date) ── */
  const spendByMonth = new Map<string, number>(monthKeys.map((k) => [k, 0]));
  for (const po of poRows) {
    if (po.status === "Draft" || po.status === "Cancelled") continue;
    const d = safeDate(po.transaction_date);
    const amt = Number(po.grand_total ?? 0);
    if (!d || amt <= 0) continue;
    const k = monthKey(d);
    if (spendByMonth.has(k)) spendByMonth.set(k, (spendByMonth.get(k) ?? 0) + amt);
  }
  const monthlySpend: SpendPoint[] = monthKeys.map((k) => ({
    month: monthLabel(k),
    amount: Math.round(spendByMonth.get(k) ?? 0),
  }));

  /* ── Cost savings (quote spread per RFQ) ── */
  const quotesForSavings = quotesPerRfq.map(({ rfq, quotes }) => {
    const d =
      safeDate(quotes[0]?.transaction_date) ||
      safeDate((rfq as { modified?: string }).modified);
    return { month: d ? monthKey(d) : null, quotes };
  });
  const savings = computeSavings(quotesForSavings);

  /* ── Supplier response rate (from RFQ details) ──
   * RFQ turnaround is computed further below, once the RFQ→SupplierQuotation→
   * PurchaseOrder linkage (built for the cycle-time KPI) is available — an
   * RFQ's actual completion is marked by the PO raised against it, not by any
   * field on the RFQ document itself (see comment there for details). */
  const respByMonth = new Map<string, { invited: number; responded: number }>();
  let invitedTotal = 0;
  let respondedTotal = 0;

  for (const doc of rfqDetails) {
    if (!doc) continue;
    const created = safeDate(doc.transaction_date) || safeDate(doc.creation);
    const mKey = created ? monthKey(created) : null;

    const suppliers = doc.suppliers ?? [];
    const invited = suppliers.length;
    const responded = suppliers.filter((s) =>
      isResponded(s.quote_status, s.quote_received)
    ).length;
    invitedTotal += invited;
    respondedTotal += responded;
    if (mKey) {
      const cur = respByMonth.get(mKey) ?? { invited: 0, responded: 0 };
      cur.invited += invited;
      cur.responded += responded;
      respByMonth.set(mKey, cur);
    }
  }

  const supplierResponseChart: ResponsePoint[] = monthKeys.map((k) => {
    const v = respByMonth.get(k) ?? { invited: 0, responded: 0 };
    return {
      month: monthLabel(k),
      invited: v.invited,
      responded: v.responded,
      rate: v.invited > 0 ? Math.round((v.responded / v.invited) * 100) : 0,
    };
  });

  let supplierResponse: AnalyticsKpi;
  if (invitedTotal === 0) {
    supplierResponse = {
      ...unavailable(),
      display: "--",
      emptyMessage: "No data available",
      subtitle: "No supplier invitations in sample",
    };
  } else {
    const pendingResponses = Math.max(0, invitedTotal - respondedTotal);
    const rate = (respondedTotal / invitedTotal) * 100;
    const spark = supplierResponseChart
      .map((c) => c.rate)
      .filter((r) => r > 0);
    supplierResponse = {
      available: true,
      value: Math.round(rate),
      display: `${Math.round(rate)}%`,
      subtitle: "Response rate",
      status: rate >= 75 ? "good" : rate >= 50 ? "warning" : "bad",
      trend: trendFromSeries(
        supplierResponseChart.map((c) => c.rate),
        "vs last month",
      ),
      sparkline: spark,
      progress: Math.min(100, Math.round(rate)),
      meta: [
        { label: "Invited", value: String(invitedTotal) },
        { label: "Responded", value: String(respondedTotal) },
        { label: "Pending", value: String(pendingResponses) },
        ...(noQuoteTotal > 0
          ? [{ label: "No Quote", value: String(noQuoteTotal) }]
          : []),
      ],
    };
  }

  /* ── Procurement cycle time ──────────────────────────────────────────────
   * Average(PO creation − Material Request creation) over completed POs. When a
   * PO has no linked Material Request, fall back to Average(PO − RFQ creation).
   * Only completed POs are considered (Draft/Cancelled were already filtered
   * out of `recentPos`). Durations are collected in HOURS so the card can show
   * hours for same-day cycles and days otherwise. */

  // RFQ creation dates from the hydrated RFQ sample, plus an on-demand cache.
  const rfqDateByName = new Map<string, string>();
  recentRfqs.forEach((r, idx) => {
    const d = rfqDetails[idx];
    const created = d?.creation ?? d?.transaction_date;
    if (r?.name && created) rfqDateByName.set(r.name, created);
  });

  // Supplier Quotation → RFQ, so a PO that only links its winning SQ can still
  // resolve back to the originating RFQ for the fallback.
  const sqToRfq = new Map<string, string>();
  for (const { rfq, quotes } of quotesPerRfq) {
    for (const q of quotes) {
      if (q?.name) sqToRfq.set(q.name, rfq.name);
    }
  }

  async function resolveMrDate(mrName: string): Promise<Date | null> {
    if (mrDateMap.has(mrName)) return safeDate(mrDateMap.get(mrName));
    try {
      const mr = (await getMaterialRequest(mrName)) as unknown as {
        creation?: string;
        transaction_date?: string;
      };
      const created = mr.creation ?? mr.transaction_date;
      if (created) {
        mrDateMap.set(mrName, created);
        return safeDate(created);
      }
    } catch {
      /* missing/inaccessible MR — skip this linkage */
    }
    return null;
  }

  async function resolveRfqDate(rfqName: string): Promise<Date | null> {
    if (rfqDateByName.has(rfqName)) return safeDate(rfqDateByName.get(rfqName));
    try {
      const rfq = (await getRFQ(rfqName)) as unknown as {
        creation?: string;
        transaction_date?: string;
      };
      const created = rfq.creation ?? rfq.transaction_date;
      if (created) {
        rfqDateByName.set(rfqName, created);
        return safeDate(created);
      }
    } catch {
      /* missing/inaccessible RFQ — skip this linkage */
    }
    return null;
  }

  function rfqNameForPo(doc: {
    remarks?: string;
    items?: Array<{ request_for_quotation?: string; supplier_quotation?: string }>;
  }): string | null {
    const items = doc.items ?? [];
    for (const it of items) {
      if (it.request_for_quotation) return it.request_for_quotation;
    }
    for (const it of items) {
      const sq = it.supplier_quotation;
      if (sq && sqToRfq.has(sq)) return sqToRfq.get(sq) ?? null;
    }
    // `createPOFromRFQ` stores the originating RFQ name in the PO's remarks.
    const remarks = doc.remarks?.trim();
    if (remarks && /rfq/i.test(remarks)) return remarks;
    return null;
  }

  // `sqToRfq` only knows about Supplier Quotations belonging to the small
  // `recentRfqs` sample, so a PO's winning SQ is frequently absent from it
  // even though the SQ itself always carries its originating RFQ on each
  // line item. Hydrate that SQ on demand (cached) as a last-resort lookup so
  // RFQ completion isn't silently missed just because the RFQ fell outside
  // the bounded sample.
  const sqRfqCache = new Map<string, string | null>();
  async function resolveRfqForSupplierQuotation(
    sqName: string
  ): Promise<string | null> {
    if (sqRfqCache.has(sqName)) return sqRfqCache.get(sqName) ?? null;
    try {
      const sq = (await getSupplierQuotation(sqName)) as unknown as {
        items?: Array<{ request_for_quotation?: string }>;
      };
      const rfqName =
        sq.items?.find((it) => it.request_for_quotation)
          ?.request_for_quotation ?? null;
      sqRfqCache.set(sqName, rfqName);
      return rfqName;
    } catch {
      sqRfqCache.set(sqName, null);
      return null;
    }
  }

  // Resolve linkages in parallel. Cycle time uses ONLY
  // Purchase Order Date − Material Request Date (completed cycles).
  // RFQ turnaround uses completed_date (PO) − creation_date (RFQ).
  const cycleResolved = await Promise.all(
    poDetails.map(async (doc) => {
      if (!doc) return null;
      const poDate =
        safeDate(doc.transaction_date) ?? safeDate(doc.creation);
      if (!poDate) return null;

      let rfqName = rfqNameForPo(doc);
      if (!rfqName) {
        const sqNames = [
          ...new Set(
            (doc.items ?? [])
              .map((it) => it.supplier_quotation)
              .filter(Boolean),
          ),
        ] as string[];
        const resolved = await Promise.all(
          sqNames.map((sq) => resolveRfqForSupplierQuotation(sq)),
        );
        rfqName = resolved.find(Boolean) ?? null;
      }

      const mrNames = [
        ...new Set(
          (doc.items ?? [])
            .map((it) => it.material_request)
            .filter(Boolean),
        ),
      ] as string[];
      const mrDates = await Promise.all(mrNames.map((n) => resolveMrDate(n)));
      let cycleHours: number | null = null;
      let completedMr: string | null = null;
      for (let i = 0; i < mrNames.length; i++) {
        const mrDate = mrDates[i];
        if (!mrDate) continue;
        const hours = diffHours(poDate, mrDate);
        if (Number.isFinite(hours) && hours >= 0 && hours < 365 * 24) {
          cycleHours = hours;
          completedMr = mrNames[i];
          break;
        }
      }

      return { rfqName, poDate, cycleHours, completedMr };
    }),
  );

  // RFQ name → earliest Purchase Order date (completed_date signal).
  const rfqCompletedAt = new Map<string, Date>();
  const cycleHours: number[] = [];
  for (const row of cycleResolved) {
    if (!row) continue;
    if (row.cycleHours != null) cycleHours.push(row.cycleHours);
    if (row.rfqName) {
      const existing = rfqCompletedAt.get(row.rfqName);
      if (!existing || row.poDate < existing) {
        rfqCompletedAt.set(row.rfqName, row.poDate);
      }
    }
  }

  /* ── RFQ turnaround = Average(completed_date − creation_date) over
   * completed RFQs only. An RFQ is complete once a Purchase Order has been
   * raised against it; that PO date is completed_date. */
  const turnaroundHours: number[] = [];
  const turnByMonth = new Map<string, number[]>();
  const turnEntries = await Promise.all(
    [...rfqCompletedAt.entries()].map(async ([rfqName, completedAt]) => {
      const created = await resolveRfqDate(rfqName);
      if (!created) return null;
      const hours = diffHours(completedAt, created);
      if (!Number.isFinite(hours) || hours < 0 || hours >= 365 * 24) return null;
      return { created, hours };
    }),
  );
  for (const entry of turnEntries) {
    if (!entry) continue;
    turnaroundHours.push(entry.hours);
    const mKey = monthKey(entry.created);
    if (monthKeys.includes(mKey)) {
      const arr = turnByMonth.get(mKey) ?? [];
      arr.push(entry.hours / 24);
      turnByMonth.set(mKey, arr);
    }
  }

  // Only months with real averages — never pad charts with 0 days.
  const rfqTurnaroundChart: TurnaroundPoint[] = monthKeys
    .map((k) => {
      const values = turnByMonth.get(k) ?? [];
      if (values.length === 0) return null;
      const days = mean(values);
      if (!Number.isFinite(days) || days <= 0) return null;
      return { month: monthLabel(k), days: Number(days.toFixed(1)) };
    })
    .filter((p): p is TurnaroundPoint => p != null);

  // Completed RFQs = RFQs with a linked PO (closed) in the analytics sample.
  // Open RFQs = exact ERP count (same filter as top KPI card).
  const completedRfqCount = turnaroundHours.length;
  const openRfqCount = truth.openRfqs;

  let rfqTurnaround: AnalyticsKpi;
  const avgTurnHours =
    completedRfqCount > 0 ? mean(turnaroundHours) : Number.NaN;
  if (
    completedRfqCount === 0 ||
    !Number.isFinite(avgTurnHours) ||
    avgTurnHours < 0
  ) {
    rfqTurnaround = {
      ...unavailable(),
      display: "--",
      subtitle: "No completed RFQs yet",
      emptyMessage: "No completed RFQs yet",
      meta: [
        { label: "Open RFQs", value: String(openRfqCount) },
        { label: "Completed RFQs", value: "0" },
      ],
      footer: "KPI will appear after the first RFQ is completed.",
    };
  } else {
    const avgDays = avgTurnHours / 24;
    const fastestH = Math.min(...turnaroundHours);
    const slowestH = Math.max(...turnaroundHours);
    const spark = rfqTurnaroundChart.map((c) => c.days).filter((d) => d > 0);
    rfqTurnaround = {
      available: true,
      value: Number(avgDays.toFixed(2)),
      display: formatCompactDuration(avgTurnHours),
      subtitle: "Average RFQ Turnaround",
      status: avgDays <= 5 ? "good" : avgDays <= 10 ? "warning" : "bad",
      trend: spark.length >= 2 ? trendFromSeries(spark, "vs last month", true) : null,
      sparkline: spark,
      meta: [
        { label: "Completed RFQs", value: String(completedRfqCount) },
        { label: "Open RFQs", value: String(openRfqCount) },
        { label: "Fastest", value: formatCompactDuration(fastestH) },
        { label: "Slowest", value: formatCompactDuration(slowestH) },
      ],
    };
  }

  const completedCyclesCount = cycleHours.length;
  const completedMrNames = new Set(
    cycleResolved
      .map((r) => r?.completedMr)
      .filter((n): n is string => Boolean(n)),
  );
  const materialRequestCount = truth.submittedMaterialRequests;
  const purchaseOrderCount = truth.submittedPurchaseOrders;
  const activeCycles = Math.max(
    0,
    truth.submittedMaterialRequests - completedMrNames.size,
  );
  const avgCycleHours =
    completedCyclesCount > 0 ? mean(cycleHours) : Number.NaN;

  let cycleTime: AnalyticsKpi;
  if (
    completedCyclesCount === 0 ||
    !Number.isFinite(avgCycleHours) ||
    avgCycleHours < 0
  ) {
    cycleTime = {
      ...unavailable(),
      display: "--",
      subtitle: "Waiting for completed procurement cycles.",
      emptyMessage: "Waiting for completed procurement cycles.",
      meta: [
        { label: "Material Requests", value: String(materialRequestCount) },
        { label: "Purchase Orders", value: String(purchaseOrderCount) },
      ],
      footer: "KPI will appear after the first Purchase Order is generated.",
    };
  } else {
    const avgDays = avgCycleHours / 24;
    const fastestH = Math.min(...cycleHours);
    const slowestH = Math.max(...cycleHours);
    cycleTime = {
      available: true,
      value: Number(avgDays.toFixed(2)),
      display: formatCompactDuration(avgCycleHours),
      subtitle: "Average Procurement Cycle",
      status: avgDays <= 7 ? "good" : avgDays <= 14 ? "warning" : "bad",
      trend: null,
      sparkline: [],
      meta: [
        { label: "Completed Cycles", value: String(completedCyclesCount) },
        { label: "Active cycles", value: String(activeCycles) },
        { label: "Fastest", value: formatCompactDuration(fastestH) },
        { label: "Slowest", value: formatCompactDuration(slowestH) },
      ],
    };
  }

  /* ── On-time delivery (received POs vs required/schedule date) ── */
  let received = 0;
  let onTime = 0;
  for (const po of poRows) {
    if ((po.per_received ?? 0) < 100) continue;
    const sched = safeDate(po.schedule_date);
    const delivered = safeDate(po.modified);
    if (!sched || !delivered) continue;
    received += 1;
    // Allow the whole scheduled day.
    if (diffDays(delivered, sched) <= 1) onTime += 1;
  }
  let onTimeDelivery: AnalyticsKpi;
  if (received === 0) {
    onTimeDelivery = {
      ...unavailable(),
      display: "--",
      emptyMessage: "No data available",
      subtitle: "No fully received purchase orders yet",
    };
  } else {
    const rate = (onTime / received) * 100;
    onTimeDelivery = {
      available: true,
      value: Math.round(rate),
      display: `${Math.round(rate)}%`,
      status: rate >= 90 ? "good" : rate >= 75 ? "warning" : "bad",
      trend: null,
      sparkline: [],
      progress: Math.min(100, Math.round(rate)),
      meta: [
        { label: "On time", value: String(onTime) },
        { label: "Received", value: String(received) },
      ],
    };
  }

  logDashboardWidget("5. RFQ Turnaround", {
    available: rfqTurnaround.available,
    display: rfqTurnaround.display,
    value: rfqTurnaround.value,
    openRfqs: openRfqCount,
    openRfqsSource: "truth.get_count RFQ status in Submitted|Open",
    completedRfqs: completedRfqCount,
    completedRfqsSource: "sample: RFQs with linked PO (closed − created)",
    matchesExecutiveOpenRfqs: openRfqCount === truth.openRfqs,
  });
  logDashboardWidget("6. Procurement Cycle Time", {
    available: cycleTime.available,
    display: cycleTime.display,
    value: cycleTime.value,
    materialRequests: materialRequestCount,
    purchaseOrders: purchaseOrderCount,
    completedCycles: completedCyclesCount,
    formula: "PO submitted − Material Request submitted",
  });
  logDashboardWidget("7. Budget Utilisation", {
    available: budget.kpi.available,
    display: budget.kpi.display,
    value: budget.kpi.value,
    meta: budget.kpi.meta,
    currency: budget.currency,
  });
  logDashboardWidget("8. Cost Savings", {
    available: savings.kpi.available,
    display: savings.kpi.display,
    value: savings.kpi.value,
    meta: savings.kpi.meta,
    source: "Highest SQ − Lowest SQ per RFQ",
  });
  logDashboardWidget("9. Supplier Response Rate", {
    available: supplierResponse.available,
    display: supplierResponse.display,
    value: supplierResponse.value,
    meta: supplierResponse.meta,
    progress: supplierResponse.progress,
  });
  logDashboardWidget("10. On-Time Delivery", {
    available: onTimeDelivery.available,
    display: onTimeDelivery.display,
    value: onTimeDelivery.value,
    received,
    onTime,
  });

  if (import.meta.env.DEV && t0) {
    console.log(
      `[Dashboard Perf] procurement analytics ${Math.round(performance.now() - t0)}ms`,
    );
  }

  return {
    currency: budget.currency,
    costSavings: savings.kpi,
    budgetUtilisation: budget.kpi,
    rfqTurnaround,
    supplierResponse,
    cycleTime,
    onTimeDelivery,
    charts: {
      monthlySpend,
      budgetVsActual: budget.chart,
      supplierResponse: supplierResponseChart,
      rfqTurnaround: rfqTurnaroundChart,
      costSavings: savings.chart,
    },
  };
}
