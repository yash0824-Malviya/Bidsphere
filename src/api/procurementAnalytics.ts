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
import { getCount } from "./erpnext";
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
  getSupplierQuotations,
} from "./sourcing";
import { RESPONSE_DOCTYPE } from "./supplierRfqResponse";

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
  /** Pre-formatted current value for display. */
  display: string;
  status: KpiStatus;
  trend: KpiTrend | null;
  /** Small numeric series for a mini sparkline (empty when not applicable). */
  sparkline: number[];
  /** Progress-bar percentage (0–100) when the KPI is a utilisation gauge. */
  progress?: number;
  /** Extra key/value bits rendered beneath the value (already formatted). */
  meta?: Array<{ label: string; value: string }>;
  /**
   * Custom text shown when `available` is false, in place of the generic
   * "No data available" (e.g. cycle time uses "No completed procurement
   * cycles yet.").
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
const SAMPLE_LIMIT = 10;

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
 * Format an average procurement-cycle duration (given in hours): sub-day
 * durations show as whole hours ("6 Hours"), otherwise as one-decimal days
 * ("1.2 Days", "2.8 Days").
 */
function formatCycleDuration(hours: number): string {
  if (hours < 24) {
    const h = Math.round(hours);
    return `${h} ${h === 1 ? "Hour" : "Hours"}`;
  }
  const days = hours / 24;
  return `${days.toFixed(1)} Days`;
}

/**
 * Format an average duration (given in hours) as "2 Days 6 Hours" /
 * "6 Hours" / "45 Minutes", per the RFQ Turnaround card's requested format.
 */
function formatDaysHours(totalHours: number): string {
  const totalMinutes = Math.round(totalHours * 60);
  const days = Math.floor(totalMinutes / (24 * 60));
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
  if (days === 0 && hours === 0) {
    const minutes = Math.max(1, totalMinutes % 60);
    return `${minutes} ${minutes === 1 ? "Minute" : "Minutes"}`;
  }
  const parts: string[] = [];
  if (days > 0) parts.push(`${days} ${days === 1 ? "Day" : "Days"}`);
  if (hours > 0) parts.push(`${hours} ${hours === 1 ? "Hour" : "Hours"}`);
  return parts.join(" ");
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
  valid_till?: string;
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

/** Budget utilisation from the Budget doctype (allocated vs consumed). */
async function computeBudget(): Promise<{
  kpi: AnalyticsKpi;
  chart: BudgetActualPoint[];
  currency: string;
}> {
  const data = await getBudgetDashboard();
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

  const pct = Math.round(utilizationPct);
  const status: KpiStatus =
    pct >= 90 ? "bad" : pct >= 70 ? "warning" : "good";

  return {
    currency: data.currency || "USD",
    chart,
    kpi: {
      available: true,
      value: pct,
      display: `${pct}%`,
      status,
      trend: null,
      sparkline: [],
      progress: Math.min(100, pct),
      meta: [
        { label: "Allocated", value: formatUSD(totalBudget) },
        { label: "Remaining", value: formatUSD(availableBudget) },
        { label: "Spent", value: formatUSD(consumedBudget) },
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

  const chart: SavingsPoint[] = monthKeys.map((k) => ({
    month: monthLabel(k),
    savings: Math.round(byMonth.get(k) ?? 0),
  }));

  if (contributingRfqs === 0 || totalSavings <= 0) {
    return { kpi: unavailable(), chart };
  }

  const pct = totalBaseline > 0 ? (totalSavings / totalBaseline) * 100 : 0;
  const sparkline = chart.map((c) => c.savings);
  return {
    kpi: {
      available: true,
      value: totalSavings,
      display: formatUSD(totalSavings),
      status: "good",
      trend: trendFromSeries(sparkline, "vs last month"),
      sparkline,
      meta: [
        { label: "Savings", value: `${pct.toFixed(1)}%` },
        { label: "RFQs", value: String(contributingRfqs) },
      ],
    },
    chart,
  };
}

/* ── Orchestration ────────────────────────────────────────────────────── */

export async function fetchProcurementAnalytics(): Promise<ProcurementAnalytics> {
  const t0 = typeof performance !== "undefined" ? performance.now() : 0;
  const monthKeys = last12MonthKeys();

  // Kick off the independent list queries in parallel.
  const [budgetRes, poRes, rfqListRes, mrRes, declineCountRes] =
    await Promise.allSettled([
      computeBudget(),
      getPurchaseOrders({ limit_page_length: 200, order_by: "transaction_date desc" }),
      getRFQs(),
      getMaterialRequests({
        limit_page_length: 200,
        fields: ["name", "status", "transaction_date", "creation", "modified", "owner"],
      }),
      getCount(RESPONSE_DOCTYPE, []),
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

  // Hydrate the join-based samples in parallel, tolerating per-item failures.
  const [rfqDetails, quotesPerRfq, poDetails] = await Promise.all([
    Promise.all(
      recentRfqs.map((r) =>
        getRFQ(r.name)
          .then((d) => d as unknown as RfqLike)
          .catch(() => null)
      )
    ),
    Promise.all(
      recentRfqs.map((r) =>
        getSupplierQuotations(r.name)
          .then((qs) => ({ rfq: r, quotes: qs as unknown as SqLike[] }))
          .catch(() => ({ rfq: r, quotes: [] as SqLike[] }))
      )
    ),
    Promise.all(
      recentPos.map((p) =>
        getPurchaseOrder(p.name)
          .then(
            (d) =>
              d as unknown as {
                creation?: string;
                transaction_date?: string;
                remarks?: string;
                items?: Array<{
                  material_request?: string;
                  request_for_quotation?: string;
                  supplier_quotation?: string;
                }>;
              }
          )
          .catch(() => null)
      )
    ),
  ]);

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
    supplierResponse = unavailable();
  } else {
    const rate = (respondedTotal / invitedTotal) * 100;
    const spark = supplierResponseChart.map((c) => c.rate);
    supplierResponse = {
      available: true,
      value: Math.round(rate),
      display: `${Math.round(rate)}%`,
      status: rate >= 75 ? "good" : rate >= 50 ? "warning" : "bad",
      trend: trendFromSeries(spark, "vs last month"),
      sparkline: spark,
      progress: Math.min(100, Math.round(rate)),
      meta: [
        { label: "Invited", value: String(invitedTotal) },
        { label: "Responded", value: String(respondedTotal) },
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

  // RFQ name → earliest Purchase Order creation raised against it. This is
  // the RFQ's real completion signal (see the RFQ turnaround block below).
  const rfqCompletedAt = new Map<string, Date>();

  const cycleHours: number[] = [];
  for (let i = 0; i < poDetails.length; i++) {
    const doc = poDetails[i];
    if (!doc) continue;
    const poDate = safeDate(doc.creation) ?? safeDate(doc.transaction_date);
    if (!poDate) continue;

    let rfqName = rfqNameForPo(doc);
    if (!rfqName) {
      const sqNames = [
        ...new Set((doc.items ?? []).map((it) => it.supplier_quotation).filter(Boolean)),
      ] as string[];
      for (const sqName of sqNames) {
        rfqName = await resolveRfqForSupplierQuotation(sqName);
        if (rfqName) break;
      }
    }
    if (rfqName) {
      const existing = rfqCompletedAt.get(rfqName);
      if (!existing || poDate < existing) rfqCompletedAt.set(rfqName, poDate);
    }

    // Primary: Material Request creation date.
    let sourceDate: Date | null = null;
    for (const it of doc.items ?? []) {
      if (!it.material_request) continue;
      sourceDate = await resolveMrDate(it.material_request);
      if (sourceDate) break;
    }

    // Fallback: RFQ creation date.
    if (!sourceDate && rfqName) {
      sourceDate = await resolveRfqDate(rfqName);
    }

    if (!sourceDate) continue;
    const hours = diffHours(poDate, sourceDate);
    if (hours >= 0 && hours < 365 * 24) cycleHours.push(hours);
  }

  /* ── RFQ turnaround = Average(PO creation − RFQ creation) over RFQs that
   * have resulted in a Purchase Order. ERPNext's "Request for Quotation"
   * status never actually transitions to a "Completed"/"Closed" value in
   * this workflow (RFQs stay "Submitted" forever), and the `valid_till`
   * field is a supplier quote-validity deadline, not a completion date — so
   * neither can be used as `completed_date`. Instead, an RFQ is considered
   * complete once a Purchase Order has been raised from one of its accepted
   * Supplier Quotations (the same signal the RFQ list page's "Completed"
   * badge uses), and that PO's creation timestamp is the workflow
   * completion timestamp. */
  const turnaroundHours: number[] = [];
  const turnByMonth = new Map<string, number[]>();
  for (const [rfqName, completedAt] of rfqCompletedAt) {
    const created = await resolveRfqDate(rfqName);
    if (!created) continue;
    const hours = diffHours(completedAt, created);
    if (hours < 0 || hours >= 365 * 24) continue;
    turnaroundHours.push(hours);
    const mKey = monthKey(created);
    if (monthKeys.includes(mKey)) {
      const arr = turnByMonth.get(mKey) ?? [];
      arr.push(hours / 24);
      turnByMonth.set(mKey, arr);
    }
  }

  const rfqTurnaroundChart: TurnaroundPoint[] = monthKeys.map((k) => ({
    month: monthLabel(k),
    days: Number(mean(turnByMonth.get(k) ?? []).toFixed(1)),
  }));

  const completedRfqCount = turnaroundHours.length;
  let rfqTurnaround: AnalyticsKpi;
  if (completedRfqCount === 0) {
    rfqTurnaround = {
      ...unavailable(),
      emptyMessage: "No completed RFQs yet",
    };
  } else {
    const avgHours = mean(turnaroundHours);
    const avgDays = avgHours / 24;
    const spark = rfqTurnaroundChart.map((c) => c.days);
    rfqTurnaround = {
      available: true,
      value: Number(avgDays.toFixed(2)),
      display: formatDaysHours(avgHours),
      status: avgDays <= 5 ? "good" : avgDays <= 10 ? "warning" : "bad",
      trend: trendFromSeries(spark, "vs last month", true),
      sparkline: spark,
      meta: [{ label: "Completed RFQs", value: String(completedRfqCount) }],
    };
  }

  const completedCyclesCount = cycleHours.length;
  let cycleTime: AnalyticsKpi;
  if (completedCyclesCount === 0) {
    cycleTime = {
      ...unavailable(),
      emptyMessage: "No completed procurement cycles yet.",
    };
  } else {
    const avgHours = mean(cycleHours);
    const avgDays = avgHours / 24;
    cycleTime = {
      available: true,
      value: Number(avgDays.toFixed(2)),
      display: formatCycleDuration(avgHours),
      status: avgDays <= 7 ? "good" : avgDays <= 14 ? "warning" : "bad",
      trend: null,
      sparkline: [],
      meta: [
        {
          label: "Completed cycles",
          value: String(completedCyclesCount),
        },
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
    onTimeDelivery = unavailable();
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

  if (import.meta.env.DEV && t0) {
    console.log(
      `[Dashboard] procurement analytics ${Math.round(performance.now() - t0)}ms`,
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
