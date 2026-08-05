/**
 * Enterprise Procurement Dashboard metrics — derived from live ERP samples only.
 * No fabricated KPI values; unavailable signals surface as 0 / empty series.
 */

import type {
  DashboardPoLite,
  DashboardPoItemLite,
  DashboardRfqLite,
} from "../api/dashboard";
import type { SupplierPerformanceData } from "../api/supplierPerformance";
import type { AnalyticsKpi } from "../api/procurementAnalytics";
import type { ExecutiveInsight, RfqPipelineStage } from "./dashboardUtils";
import { formatCurrencyCompact } from "./format";

/**
 * RFQ Status Pipeline stage registry.
 *
 * `implemented: true`  → always shown (matches live BidSphere workflow).
 * `implemented: false` → hidden until enabled via workflow / optional flags
 *                        (e.g. future Technical / Commercial Review).
 */
export const RFQ_PIPELINE_STAGE_DEFS = [
  { id: "Draft", implemented: true },
  { id: "Invited", implemented: true },
  { id: "Awaiting Quote", implemented: true },
  { id: "Quoted", implemented: true },
  { id: "Technical Review", implemented: false },
  { id: "Commercial Review", implemented: false },
  { id: "Legal Review", implemented: true },
  { id: "Finance Approval", implemented: true },
  { id: "Awarded", implemented: true },
  { id: "Closed", implemented: true },
] as const;

export type EnterpriseRfqStage = (typeof RFQ_PIPELINE_STAGE_DEFS)[number]["id"];

/** @deprecated Prefer {@link resolveActiveRfqPipelineStages}. Kept for callers. */
export const ENTERPRISE_RFQ_STAGES: readonly EnterpriseRfqStage[] =
  RFQ_PIPELINE_STAGE_DEFS.filter((s) => s.implemented).map((s) => s.id);

/** Workflow-config stage names → pipeline labels (optional future stages). */
const WORKFLOW_OPTIONAL_PIPELINE_MAP: Record<string, EnterpriseRfqStage> = {
  technical_review: "Technical Review",
  commercial_review: "Commercial Review",
};

/**
 * Active pipeline stages for the dashboard.
 * Optional stages appear only when enabled in workflow config (or overrides).
 */
export function resolveActiveRfqPipelineStages(opts?: {
  /** Explicit enables for optional stages (tests / future feature flags). */
  enableOptional?: Partial<Record<EnterpriseRfqStage, boolean>>;
  /** Raw workflow stages from admin config (`name` + `enabled`). */
  workflowStages?: Array<{ name: string; enabled: boolean; label?: string }>;
}): EnterpriseRfqStage[] {
  const optionalOn = new Set<EnterpriseRfqStage>();

  for (const [wfName, pipelineId] of Object.entries(
    WORKFLOW_OPTIONAL_PIPELINE_MAP,
  )) {
    const wf = opts?.workflowStages?.find((s) => s.name === wfName);
    if (wf?.enabled) optionalOn.add(pipelineId);
  }

  for (const [stage, on] of Object.entries(opts?.enableOptional ?? {})) {
    if (on) optionalOn.add(stage as EnterpriseRfqStage);
  }

  // Also honor persisted admin workflow config when available in the browser.
  if (typeof localStorage !== "undefined" && !opts?.workflowStages) {
    try {
      const raw = localStorage.getItem("bidsphere_workflow_config");
      if (raw) {
        const stored = JSON.parse(raw) as Array<{
          name?: string;
          enabled?: boolean;
        }>;
        for (const row of stored) {
          const mapped = row.name
            ? WORKFLOW_OPTIONAL_PIPELINE_MAP[row.name]
            : undefined;
          if (mapped && row.enabled) optionalOn.add(mapped);
        }
      }
    } catch {
      /* ignore corrupt config */
    }
  }

  return RFQ_PIPELINE_STAGE_DEFS.filter(
    (s) => s.implemented || optionalOn.has(s.id),
  ).map((s) => s.id);
}

export const ENTERPRISE_SPEND_CATEGORIES = [
  "Raw Material",
  "Components",
  "Services",
  "Packaging",
  "MRO",
  "CapEx",
] as const;

export type EnterpriseSpendCategory = (typeof ENTERPRISE_SPEND_CATEGORIES)[number];

export interface PoSpendSeriesPoint {
  month: string;
  amount: number;
}

export interface CategoryDonutPoint {
  category: string;
  spend: number;
  pct: number;
  /** Distinct purchase orders contributing to this category. */
  orderCount: number;
}

/** Fixed procurement dashboard spend buckets (Spend by Category widget). */
export const PROCUREMENT_SPEND_CATEGORIES = [
  "Raw Material",
  "Auto Parts",
  "Consumables",
  "Tools",
  "Electrical",
  "Packaging",
  "Services",
  "Miscellaneous",
] as const;

export type ProcurementSpendCategory =
  (typeof PROCUREMENT_SPEND_CATEGORIES)[number];

export const PROCUREMENT_SPEND_CATEGORY_COLORS: Record<
  ProcurementSpendCategory,
  string
> = {
  "Raw Material": "#1F3A6D",
  "Auto Parts": "#3B6BA5",
  Consumables: "#0E7C6E",
  Tools: "#A66418",
  Electrical: "#D97706",
  Packaging: "#10B981",
  Services: "#8B5CF6",
  Miscellaneous: "#64748B",
};

export type SpendCategoryPeriod = "month" | "3m" | "6m" | "ytd";

export function spendPeriodDateRange(period: SpendCategoryPeriod): {
  fromDate: string;
  toDate: string;
} {
  const now = new Date();
  const toDate = now.toISOString().slice(0, 10);
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  switch (period) {
    case "month":
      start.setDate(1);
      break;
    case "3m":
      start.setMonth(start.getMonth() - 3);
      break;
    case "6m":
      start.setMonth(start.getMonth() - 6);
      break;
    case "ytd":
      start.setMonth(0);
      start.setDate(1);
      break;
  }
  return { fromDate: start.toISOString().slice(0, 10), toDate };
}

/** Map ERP Item Group → fixed procurement spend category bucket. */
export function bucketProcurementSpendCategory(
  itemGroup?: string,
): ProcurementSpendCategory {
  const g = (itemGroup ?? "").trim().toLowerCase();
  if (!g) return "Miscellaneous";
  if (/raw\s*material|steel|plastic|resin|metal|fabric|chemical|sheet|alloy/.test(g)) {
    return "Raw Material";
  }
  if (
    /auto|automotive|vehicle|oem|aftermarket|\bpart|component|assembly|bearing|gear|fastener/.test(
      g,
    )
  ) {
    return "Auto Parts";
  }
  if (/consumable|mro|maintenance|lubricant|cleaning|stationery|adhesive/.test(g)) {
    return "Consumables";
  }
  if (/\btool|wrench|drill|cutter|fixture|gauge|calibrat/.test(g)) {
    return "Tools";
  }
  if (/electr|wiring|cable|circuit|motor|battery|electronic|sensor|switch/.test(g)) {
    return "Electrical";
  }
  if (/pack|carton|box|crate|pallet|wrap|label|packaging/.test(g)) {
    return "Packaging";
  }
  if (
    /service|consult|labor|labour|software|license|support|logistic|freight|transport/.test(
      g,
    )
  ) {
    return "Services";
  }
  return "Miscellaneous";
}

/** Aggregate PO/PI lines into fixed category buckets for the Spend by Category chart. */
export function buildBucketedCategorySpend(
  items: DashboardPoItemLite[],
): CategoryDonutPoint[] {
  const totals = new Map<string, number>();
  const orders = new Map<string, Set<string>>();

  for (const row of items) {
    const amt = Number(row.base_amount ?? row.amount ?? 0);
    if (!(amt > 0)) continue;
    const category = bucketProcurementSpendCategory(row.item_group);
    totals.set(category, (totals.get(category) ?? 0) + amt);
    if (row.parent) {
      let set = orders.get(category);
      if (!set) {
        set = new Set();
        orders.set(category, set);
      }
      set.add(row.parent);
    }
  }

  const grand = Array.from(totals.values()).reduce((s, v) => s + v, 0);
  if (!(grand > 0)) return [];

  return PROCUREMENT_SPEND_CATEGORIES.map((category) => {
    const spend = totals.get(category) ?? 0;
    return {
      category,
      spend,
      pct: spend > 0 ? (spend / grand) * 100 : 0,
      orderCount: orders.get(category)?.size ?? 0,
    };
  }).filter((row) => row.spend > 0);
}

export interface SupplierOverviewMetrics {
  totalSuppliers: number;
  activeSuppliers: number;
  newThisMonth: number;
  highRiskSuppliers: number;
  averageScore: number | null;
}

export interface SupplierScoreBar {
  supplier: string;
  score: number;
  quality: number;
  delivery: number;
  cost: number;
  responsiveness: number;
  spend: number;
}

export type OperationalHealthLevel =
  | "ok"
  | "warning"
  | "critical"
  | "unavailable";

export interface OperationalHealthCard {
  id: string;
  label: string;
  /** Numeric count, or null when the metric/feature is not available. */
  value: number | null;
  level: OperationalHealthLevel;
  /** Status line under the value (e.g. "✔ No overdue RFQs"). */
  caption: string;
  tooltip: string;
  to: string;
}

/** Live ERP counts for Operational Health. `null` = feature/API unavailable. */
export interface OperationalHealthCounts {
  overdueRfqs: number | null;
  expiringContracts: number | null;
  highRiskSuppliers: number | null;
  pendingOnboarding: number | null;
  lateDeliveries: number | null;
  blockedSuppliers: number | null;
}

function ytdStartIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-01-01`;
}

function monthKeyFromDate(raw?: string | null): string | null {
  if (!raw) return null;
  const key = raw.slice(0, 7);
  return /^\d{4}-\d{2}$/.test(key) ? key : null;
}

function monthLabel(key: string): string {
  const [y, m] = key.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleString("en-US", { month: "short" });
}

/** Sum submitted PO spend YTD + MoM % from the last two calendar months. */
export function computePoYtdSpend(pos: DashboardPoLite[]): {
  ytdSpend: number;
  momPct: number | null;
  releasedToday: number;
} {
  const ytd = ytdStartIso();
  const today = new Date().toISOString().slice(0, 10);
  let ytdSpend = 0;
  let releasedToday = 0;
  const buckets = new Map<string, number>();

  for (const po of pos) {
    const date = po.transaction_date ?? po.modified;
    const amt = Number(po.grand_total ?? 0);
    if (date && date.slice(0, 10) >= ytd) ytdSpend += amt;
    if (date && date.slice(0, 10) === today) releasedToday += 1;
    const key = monthKeyFromDate(date);
    if (key) buckets.set(key, (buckets.get(key) ?? 0) + amt);
  }

  const months = Array.from(buckets.keys()).sort();
  let momPct: number | null = null;
  if (months.length >= 2) {
    const curr = buckets.get(months[months.length - 1]) ?? 0;
    const prev = buckets.get(months[months.length - 2]) ?? 0;
    if (prev > 0) momPct = ((curr - prev) / prev) * 100;
  }

  return { ytdSpend, momPct, releasedToday };
}

/** Last 12 months PO spend series for the line chart. */
export function computeMonthlyPoSpend(pos: DashboardPoLite[]): PoSpendSeriesPoint[] {
  const now = new Date();
  const series: PoSpendSeriesPoint[] = [];
  const byKey = new Map<string, number>();

  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    byKey.set(key, 0);
    series.push({ month: monthLabel(key), amount: 0 });
  }

  const keys = Array.from(byKey.keys());
  for (const po of pos) {
    const key = monthKeyFromDate(po.transaction_date ?? po.modified);
    if (!key || !byKey.has(key)) continue;
    byKey.set(key, (byKey.get(key) ?? 0) + Number(po.grand_total ?? 0));
  }

  return series.map((row, i) => ({
    month: row.month,
    amount: byKey.get(keys[i]) ?? 0,
  }));
}

function mapItemGroupToEnterpriseCategory(
  itemGroup: string,
): EnterpriseSpendCategory | null {
  const g = itemGroup.toLowerCase();
  // More specific buckets first (e.g. "Packaging Materials" must not become Raw Material).
  if (/packag|carton|label|film|wrap/.test(g)) return "Packaging";
  if (/capex|capital|asset|equipment|machinery|fixed/.test(g)) return "CapEx";
  if (/mro|maintenance|repair|spare|consumable|tool/.test(g)) return "MRO";
  if (/service|consult|labor|software|license|support/.test(g)) return "Services";
  if (/component|assembly|part|electronic|hardware/.test(g)) return "Components";
  if (/raw\s*material|steel|plastic|resin|metal|fabric|chemical/.test(g)) {
    return "Raw Material";
  }
  if (/^materials?$|raw/.test(g)) return "Raw Material";
  // Unmapped groups roll into Components (common ERP default for parts/indirect).
  if (/indirect|office|admin|travel|utility|facility|logistic|freight/.test(g)) {
    return "Components";
  }
  return "Components";
}

/**
 * Group submitted PO line spend by Item Group (business category label).
 * Tracks distinct purchase orders per category for tooltips.
 * Caps the chart at the top categories + an "Other" bucket for readability.
 */
export function computeCategorySpendDistribution(
  items: DashboardPoItemLite[],
  opts?: { maxCategories?: number },
): CategoryDonutPoint[] {
  const maxCategories = opts?.maxCategories ?? 8;
  const spendByCat = new Map<string, number>();
  const ordersByCat = new Map<string, Set<string>>();

  for (const row of items) {
    const amt = Number(row.base_amount ?? row.amount ?? 0);
    if (!(amt > 0)) continue;
    const category = row.item_group?.trim() || "Uncategorized";
    spendByCat.set(category, (spendByCat.get(category) ?? 0) + amt);
    if (row.parent) {
      let set = ordersByCat.get(category);
      if (!set) {
        set = new Set();
        ordersByCat.set(category, set);
      }
      set.add(row.parent);
    }
  }

  const grand = Array.from(spendByCat.values()).reduce((s, v) => s + v, 0);
  if (!(grand > 0)) return [];

  const ranked = Array.from(spendByCat.entries())
    .map(([category, spend]) => ({
      category,
      spend,
      pct: (spend / grand) * 100,
      orderCount: ordersByCat.get(category)?.size ?? 0,
    }))
    .sort((a, b) => b.spend - a.spend);

  if (ranked.length <= maxCategories) return ranked;

  const head = ranked.slice(0, maxCategories - 1);
  const tail = ranked.slice(maxCategories - 1);
  const otherSpend = tail.reduce((s, r) => s + r.spend, 0);
  const otherOrders = new Set<string>();
  for (const row of tail) {
    for (const po of ordersByCat.get(row.category) ?? []) {
      otherOrders.add(po);
    }
  }
  return [
    ...head,
    {
      category: "Other",
      spend: otherSpend,
      pct: (otherSpend / grand) * 100,
      orderCount: otherOrders.size,
    },
  ];
}

/** @deprecated Prefer computeCategorySpendDistribution (real Item Group names). */
export function computeEnterpriseCategorySpend(
  items: DashboardPoItemLite[],
): CategoryDonutPoint[] {
  const totals = new Map<string, number>();
  const orders = new Map<string, Set<string>>();
  for (const row of items) {
    const amt = Number(row.base_amount ?? row.amount ?? 0);
    if (!(amt > 0)) continue;
    const cat = mapItemGroupToEnterpriseCategory(
      row.item_group?.trim() || "Components",
    );
    if (!cat) continue;
    totals.set(cat, (totals.get(cat) ?? 0) + amt);
    if (row.parent) {
      let set = orders.get(cat);
      if (!set) {
        set = new Set();
        orders.set(cat, set);
      }
      set.add(row.parent);
    }
  }
  const grand = Array.from(totals.values()).reduce((s, v) => s + v, 0);
  if (!(grand > 0)) return [];

  return ENTERPRISE_SPEND_CATEGORIES.filter((c) => (totals.get(c) ?? 0) > 0).map(
    (category) => {
      const spend = totals.get(category) ?? 0;
      return {
        category,
        spend,
        pct: (spend / grand) * 100,
        orderCount: orders.get(category)?.size ?? 0,
      };
    },
  );
}

/** Average overall score from ranked supplier performance rows. */
export function computeAverageSupplierScore(
  rows: Array<{ score: number }>,
): number | null {
  const scored = rows.filter((r) => r.score > 0);
  if (scored.length === 0) return null;
  const avg =
    scored.reduce((s, r) => s + r.score, 0) / scored.length;
  return Math.round(avg * 10) / 10;
}

/**
 * Enterprise RFQ pipeline — only active (implemented / config-enabled) stages.
 * Counts use valid workflow signals only; unimplemented stages are omitted.
 */
export function computeEnterpriseRfqPipeline(opts: {
  rfqs: DashboardRfqLite[];
  openRfqsCount: number;
  quoteCounts?: Map<string, number>;
  /** Invited supplier counts from Request for Quotation Supplier. */
  supplierCounts?: Map<string, number>;
  rfqsWithPo?: Set<string>;
  legalPending?: number;
  financePending?: number;
  enableOptional?: Partial<Record<EnterpriseRfqStage, boolean>>;
  workflowStages?: Array<{ name: string; enabled: boolean; label?: string }>;
}): RfqPipelineStage[] {
  const {
    rfqs,
    openRfqsCount,
    quoteCounts,
    supplierCounts,
    rfqsWithPo,
    legalPending = 0,
    financePending = 0,
  } = opts;

  const activeStages = resolveActiveRfqPipelineStages({
    enableOptional: opts.enableOptional,
    workflowStages: opts.workflowStages,
  });

  const buckets = Object.fromEntries(
    activeStages.map((s) => [s, 0]),
  ) as Record<EnterpriseRfqStage, number>;

  const ensure = (stage: EnterpriseRfqStage) => {
    if (!(stage in buckets)) buckets[stage] = 0;
  };
  for (const s of [
    "Draft",
    "Invited",
    "Awaiting Quote",
    "Quoted",
    "Awarded",
    "Closed",
    "Legal Review",
    "Finance Approval",
  ] as const) {
    ensure(s);
  }

  for (const rfq of rfqs) {
    const status = (rfq.status ?? "").toLowerCase();
    const quotes = quoteCounts?.get(rfq.name) ?? 0;
    const suppliers = supplierCounts?.get(rfq.name) ?? 0;
    const hasPo = rfqsWithPo?.has(rfq.name) ?? false;

    if (status === "cancelled") continue;
    if (
      hasPo ||
      status === "ordered" ||
      status === "awarded" ||
      status.includes("partially")
    ) {
      buckets.Awarded += 1;
      continue;
    }
    if (status === "closed") {
      buckets.Closed += 1;
      continue;
    }
    if (status === "draft") {
      buckets.Draft += 1;
      continue;
    }
    if (quotes > 0) {
      buckets.Quoted += 1;
      continue;
    }
    // Open / submitted without quotes → Invited when suppliers exist, else waiting.
    if (suppliers > 0) {
      buckets.Invited += 1;
      continue;
    }
    buckets["Awaiting Quote"] += 1;
  }

  // Pad open RFQs not covered by the recent sample into Awaiting Quote.
  const sampledOpen = rfqs.filter((r) => {
    const s = (r.status ?? "").toLowerCase();
    return s === "submitted" || s === "open" || s === "replied";
  }).length;
  if (openRfqsCount > sampledOpen) {
    buckets["Awaiting Quote"] += openRfqsCount - sampledOpen;
  }

  // Legal / Finance are live workflow queues (not inferred from ERP RFQ status).
  if ("Legal Review" in buckets) buckets["Legal Review"] = legalPending;
  if ("Finance Approval" in buckets) {
    buckets["Finance Approval"] = financePending;
  }

  return activeStages.map((stage) => ({
    stage,
    count: buckets[stage] ?? 0,
  }));
}

export function countLateDeliveries(pos: DashboardPoLite[]): number {
  const today = new Date().toISOString().slice(0, 10);
  return pos.filter((po) => {
    const sched = po.schedule_date?.slice(0, 10);
    if (!sched || sched >= today) return false;
    const received = Number(po.per_received ?? 0);
    const status = (po.status ?? "").toLowerCase();
    if (status === "completed" || status === "closed" || status === "cancelled") {
      return false;
    }
    return received < 100;
  }).length;
}

/** Open RFQs older than 14 days (modified) — proxy when valid_till is not queryable. */
export function countOverdueRfqs(rfqs: DashboardRfqLite[]): number {
  const cutoff = Date.now() - 14 * 86_400_000;
  return rfqs.filter((rfq) => {
    const s = (rfq.status ?? "").toLowerCase();
    if (s === "closed" || s === "cancelled" || s === "draft" || s === "ordered") {
      return false;
    }
    const raw = rfq.creation || rfq.modified;
    if (!raw) return false;
    const t = new Date(raw).getTime();
    return !Number.isNaN(t) && t < cutoff;
  }).length;
}

/**
 * Rank suppliers by Overall Score (desc), with tie-breakers:
 * 1. Overall Supplier Score
 * 2. On-Time Delivery %
 * 3. Quality Score
 * 4. RFQ Response Time (responsiveness)
 * 5. Cost Competitiveness
 *
 * Returns at most `limit` rows (default Top 5). Suppliers without usable
 * performance data are omitted so the chart can show an empty state.
 */
export function buildSupplierPerformanceBars(
  candidates: Array<{ supplier: string; spend: number }>,
  performance: Record<string, SupplierPerformanceData | undefined>,
  limit = 5,
): SupplierScoreBar[] {
  const rows: SupplierScoreBar[] = [];

  for (const row of candidates) {
    const perf = performance[row.supplier];
    if (!perf) continue;

    const delivery = perf.delivery_score >= 0 ? perf.delivery_score : 0;
    const quality = perf.quality_score >= 0 ? perf.quality_score : 0;
    const reliability = perf.reliability_score >= 0 ? perf.reliability_score : 0;
    // Cost / responsiveness proxies from reliability until dedicated fields exist.
    const cost = reliability;
    const responsiveness = reliability;
    const dims = [quality, delivery, cost, responsiveness].filter((n) => n > 0);
    if (dims.length === 0 && !perf.has_sufficient_data) continue;

    const score =
      dims.length > 0
        ? dims.reduce((s, n) => s + n, 0) / dims.length
        : 0;
    if (!(score > 0) && !perf.has_sufficient_data) continue;

    rows.push({
      supplier: row.supplier,
      score: Math.round(score * 10) / 10,
      quality: Math.round(quality * 10) / 10,
      delivery: Math.round(delivery * 10) / 10,
      cost: Math.round(cost * 10) / 10,
      responsiveness: Math.round(responsiveness * 10) / 10,
      spend: row.spend,
    });
  }

  rows.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (b.delivery !== a.delivery) return b.delivery - a.delivery;
    if (b.quality !== a.quality) return b.quality - a.quality;
    if (b.responsiveness !== a.responsiveness) {
      return b.responsiveness - a.responsiveness;
    }
    if (b.cost !== a.cost) return b.cost - a.cost;
    return a.supplier.localeCompare(b.supplier);
  });

  return rows.slice(0, Math.max(0, limit));
}

function healthLevel(
  value: number | null,
  warningAt: number,
  criticalAt: number,
): OperationalHealthLevel {
  if (value == null) return "unavailable";
  if (value <= 0) return "ok";
  if (value >= criticalAt) return "critical";
  if (value >= warningAt) return "warning";
  return "warning";
}

function healthCard(opts: {
  id: string;
  label: string;
  value: number | null;
  okCaption: string;
  issueCaption: (n: number) => string;
  tooltip: string;
  to: string;
  warningAt?: number;
  criticalAt?: number;
}): OperationalHealthCard {
  const warningAt = opts.warningAt ?? 1;
  const criticalAt = opts.criticalAt ?? 5;
  const level = healthLevel(opts.value, warningAt, criticalAt);

  if (level === "unavailable") {
    return {
      id: opts.id,
      label: opts.label,
      value: null,
      level,
      caption: "Data not available",
      tooltip: opts.tooltip,
      to: opts.to,
    };
  }

  const n = opts.value ?? 0;
  return {
    id: opts.id,
    label: opts.label,
    value: n,
    level,
    caption: n === 0 ? opts.okCaption : opts.issueCaption(n),
    tooltip: opts.tooltip,
    to: opts.to,
  };
}

/**
 * Build Operational Health cards from live ERP counts.
 * Pass `null` for any metric that is not implemented / API failed.
 * A real count of 0 shows a green "No issues" caption — never looks empty.
 */
export function buildOperationalHealthCards(
  counts: OperationalHealthCounts,
): OperationalHealthCard[] {
  return [
    healthCard({
      id: "overdue-rfqs",
      label: "Overdue RFQs",
      value: counts.overdueRfqs,
      okCaption: "✔ No overdue RFQs",
      issueCaption: (n) =>
        `${n} open RFQ${n === 1 ? "" : "s"} aging 14+ days`,
      tooltip:
        "Open RFQs (Submitted/Open) with no modification in the last 14 days",
      to: "/sourcing/rfq?preset=open",
      warningAt: 1,
      criticalAt: 6,
    }),
    healthCard({
      id: "expiring-contracts",
      label: "Expiring Contracts",
      value: counts.expiringContracts,
      okCaption: "✔ No expiring contracts",
      issueCaption: (n) =>
        `${n} contract${n === 1 ? "" : "s"} expiring soon`,
      tooltip: "Contracts module is not connected in this environment",
      to: "/contracts",
    }),
    healthCard({
      id: "high-risk",
      label: "High Risk Suppliers",
      value: counts.highRiskSuppliers,
      okCaption: "✔ No high-risk suppliers",
      issueCaption: (n) =>
        `${n} supplier${n === 1 ? "" : "s"} below score 60`,
      tooltip: "Suppliers with overall performance score below 60",
      to: "/reports/operations/supplier-performance",
      warningAt: 1,
      criticalAt: 4,
    }),
    healthCard({
      id: "onboarding",
      label: "Pending Supplier Onboarding",
      value: counts.pendingOnboarding,
      okCaption: "✔ No pending onboarding",
      issueCaption: (n) =>
        `${n} request${n === 1 ? "" : "s"} awaiting review`,
      tooltip: "Supplier onboarding requests in Submitted or Under Review",
      to: "/suppliers/onboarding",
      warningAt: 1,
      criticalAt: 10,
    }),
    healthCard({
      id: "late-deliveries",
      label: "Late Deliveries",
      value: counts.lateDeliveries,
      okCaption: "✔ No late deliveries",
      issueCaption: (n) =>
        `${n} PO${n === 1 ? "" : "s"} past schedule date`,
      tooltip:
        "Submitted purchase orders past schedule date still awaiting receipt",
      to: "/reports/operations/deliveries",
      warningAt: 1,
      criticalAt: 4,
    }),
    healthCard({
      id: "blocked",
      label: "Blocked Suppliers",
      value: counts.blockedSuppliers,
      okCaption: "✔ No blocked suppliers",
      issueCaption: (n) =>
        `${n} disabled supplier${n === 1 ? "" : "s"}`,
      tooltip: "Supplier master records with disabled = 1",
      to: "/suppliers?status=inactive",
      warningAt: 1,
      criticalAt: 6,
    }),
  ];
}

export function buildProcurementInsights(opts: {
  openRfqs: number;
  overdueRfqs: number;
  momSpendPct: number | null;
  lateDeliveries: number;
  highRiskSuppliers: number;
  costSavings: AnalyticsKpi | null | undefined;
  budgetUtilisation: AnalyticsKpi | null | undefined;
  topRiskSupplier?: string;
}): ExecutiveInsight[] {
  const insights: ExecutiveInsight[] = [];

  if (opts.overdueRfqs > 0) {
    insights.push({
      id: "overdue-rfqs",
      message: `${opts.overdueRfqs} RFQ${opts.overdueRfqs === 1 ? " is" : "s are"} overdue.`,
      tone: "warning",
    });
  } else if (opts.openRfqs > 0) {
    insights.push({
      id: "open-rfqs",
      message: `${opts.openRfqs} active RFQ${opts.openRfqs === 1 ? "" : "s"} in progress.`,
      tone: "info",
    });
  }

  if (opts.topRiskSupplier && opts.lateDeliveries > 0) {
    insights.push({
      id: "supplier-delay",
      message: `Supplier ${opts.topRiskSupplier} has late deliveries on open POs.`,
      tone: "warning",
    });
  } else if (opts.lateDeliveries > 0) {
    insights.push({
      id: "late-pos",
      message: `${opts.lateDeliveries} purchase order${opts.lateDeliveries === 1 ? "" : "s"} past scheduled delivery.`,
      tone: "warning",
    });
  }

  if (opts.momSpendPct != null && Math.abs(opts.momSpendPct) >= 5) {
    const dir = opts.momSpendPct > 0 ? "increased" : "decreased";
    insights.push({
      id: "spend-mom",
      message: `Spend ${dir} ${Math.abs(opts.momSpendPct).toFixed(0)}% this month.`,
      tone: opts.momSpendPct > 10 ? "warning" : "info",
    });
  }

  if (
    opts.budgetUtilisation?.available &&
    opts.budgetUtilisation.progress != null &&
    opts.budgetUtilisation.progress > 100
  ) {
    const over = opts.budgetUtilisation.progress - 100;
    insights.push({
      id: "budget-over",
      message: `Procurement spend exceeds budget by ${over.toFixed(0)}%.`,
      tone: "warning",
    });
  }

  if (opts.highRiskSuppliers > 0) {
    insights.push({
      id: "high-risk",
      message: `${opts.highRiskSuppliers} high-risk supplier${opts.highRiskSuppliers === 1 ? "" : "s"} need attention.`,
      tone: "warning",
    });
  }

  if (opts.costSavings?.available && (opts.costSavings.value ?? 0) > 0) {
    insights.push({
      id: "savings",
      message: `Identified savings opportunity of ${formatCurrencyCompact(opts.costSavings.value ?? 0)}.`,
      tone: "opportunity",
    });
  }

  if (insights.length === 0) {
    insights.push({
      id: "idle",
      message: "Connect more PO and RFQ data to unlock procurement intelligence.",
      tone: "info",
    });
  }

  return insights.slice(0, 6);
}

export function topSuppliersByPoSpend(
  pos: DashboardPoLite[],
  limit = 10,
): Array<{ supplier: string; spend: number }> {
  const map = new Map<string, number>();
  for (const po of pos) {
    const name = (po.supplier || "").trim();
    if (!name) continue;
    map.set(name, (map.get(name) ?? 0) + Number(po.grand_total ?? 0));
  }
  return Array.from(map.entries())
    .map(([supplier, spend]) => ({ supplier, spend }))
    .sort((a, b) => b.spend - a.spend)
    .slice(0, limit);
}
