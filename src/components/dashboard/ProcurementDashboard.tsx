import { lazy, memo, Suspense, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import type { LucideIcon } from "lucide-react";
import {
  ArrowRight,
  ClipboardCheck,
  DollarSign,
  FileSearch,
  FileText,
  Package,
  ShoppingCart,
  Truck,
  Users,
} from "lucide-react";

import {
  fetchDashboardAnalytics,
  fetchDashboardCounts,
  fetchDashboardSpendSummary,
} from "../../api/dashboard";
import { getExactCount } from "../../api/erpnext";
import { DASHBOARD_QUERY_OPTIONS } from "../../api/queryPresets";
import {
  fetchProcurementQueue,
  getMaterialRequestProcurementType,
  getMaterialRequestWorkflowStatus,
  parseForwardedItemsFromMr,
  type MaterialRequestWorkflowRecord,
} from "../../api/materialRequestWorkflow";
import { canCreateRfqFromMaterialRequest } from "../../api/createRFQFromMaterialRequest";
import {
  buildForwardedCounters,
  fetchForwardedHistory,
} from "../../api/forwardedMaterialRequests";
import { syncMaterialRequestSlaBatch } from "../../api/slaIntegration";
import { useSlaVisible } from "../../hooks/useSlaVisible";
import SlaCountdownWidget from "../sla/SlaCountdownWidget";
import ProcurementAnalyticsSection from "./ProcurementAnalyticsSection";
import type { MaterialRequestProcurementType } from "../../types/materialRequestWorkflow";
import ProcurementTypeBadge from "../ProcurementTypeBadge";
import { getDashboardConfig } from "../../config/dashboardRoles";
import {
  computeMonthlySpendTrend,
  buildActivityFeed,
  buildTopSuppliersWithTrend,
} from "../../utils/dashboardUtils";
import { formatCurrencyCompact, formatDate } from "../../utils/format";
import { Skeleton } from "../Skeleton";
import StatusBadge from "../StatusBadge";
import CompactActivityFeed from "./CompactActivityFeed";
import TopSuppliersPanel from "./TopSuppliersPanel";

const AdminSpendCharts = lazy(() => import("./AdminSpendCharts"));

/**
 * Stages secondary content so KPI cards paint first. Charts/analytics fetch a
 * beat after mount; heavy tables a beat after that. This keeps the KPI network
 * requests uncontended for a fast first meaningful paint.
 */
function useStagedReady() {
  const [chartsReady, setChartsReady] = useState(false);
  const [tablesReady, setTablesReady] = useState(false);
  useEffect(() => {
    const c = setTimeout(() => setChartsReady(true), 150);
    const t = setTimeout(() => setTablesReady(true), 450);
    return () => {
      clearTimeout(c);
      clearTimeout(t);
    };
  }, []);
  return { chartsReady, tablesReady };
}

interface Props {
  greetingName: string;
}

/* ─── Section 3 data shaping ──────────────────────────────────────────────── */

interface ForwardedRow {
  mr: MaterialRequestWorkflowRecord;
  name: string;
  procurementType: MaterialRequestProcurementType;
  department: string;
  requestDate: string;
  priority: string;
  itemCount: number;
  estValue: number;
  statusLabel: string;
  hasRfq: boolean;
  linkedRfq: string | null;
  canCreateRfq: boolean;
}

function buildForwardedRows(
  mrs: MaterialRequestWorkflowRecord[],
): ForwardedRow[] {
  return mrs.map((mr) => {
    const rateByCode = new Map<string, number>();
    for (const it of mr.items ?? []) {
      const qty = Number(it.qty) || 0;
      const rate =
        Number(it.rate) || (qty > 0 ? (Number(it.amount) || 0) / qty : 0);
      if (it.item_code) rateByCode.set(it.item_code, rate);
    }

    const forwarded = parseForwardedItemsFromMr(mr).filter(
      (fi) => (fi.forward_qty ?? fi.shortage_qty ?? 0) > 0,
    );

    let itemCount: number;
    let estValue: number;
    if (forwarded.length > 0) {
      itemCount = forwarded.length;
      estValue = forwarded.reduce(
        (sum, fi) =>
          sum +
          (fi.forward_qty ?? fi.shortage_qty ?? 0) *
            (rateByCode.get(fi.item_code) ?? 0),
        0,
      );
    } else {
      const active = (mr.items ?? []).filter((it) => (Number(it.qty) || 0) > 0);
      itemCount = active.length;
      estValue = active.reduce(
        (sum, it) =>
          sum + (Number(it.amount) || (Number(it.rate) || 0) * (Number(it.qty) || 0)),
        0,
      );
    }

    const status = getMaterialRequestWorkflowStatus(mr);
    const linkedRfq = mr.custom_linked_rfq || null;
    const hasRfq = status === "RFQ Created" || Boolean(linkedRfq);

    return {
      mr,
      name: mr.name,
      procurementType: getMaterialRequestProcurementType(mr),
      department: mr.custom_department || mr.department || "—",
      requestDate: formatDate(mr.transaction_date),
      priority: mr.custom_priority || "Medium",
      itemCount,
      estValue,
      statusLabel: hasRfq ? "RFQ Created" : "Forwarded to Procurement",
      hasRfq,
      linkedRfq,
      canCreateRfq: !linkedRfq && canCreateRfqFromMaterialRequest(mr),
    };
  });
}

/* ─── Component ───────────────────────────────────────────────────────────── */

export default function ProcurementDashboard({ greetingName }: Props) {
  const config = getDashboardConfig("procurement");
  const { chartsReady, tablesReady } = useStagedReady();
  const slaVisible = useSlaVisible();

  // ── KPI-critical queries: fire immediately for a fast first paint ──────────
  const countsQuery = useQuery({
    queryKey: ["dashboard-counts"],
    queryFn: fetchDashboardCounts,
    ...DASHBOARD_QUERY_OPTIONS,
  });

  const spendQuery = useQuery({
    queryKey: ["dashboard-spend-summary"],
    queryFn: fetchDashboardSpendSummary,
    ...DASHBOARD_QUERY_OPTIONS,
  });

  // Count-only queries — no full documents loaded, just server-side COUNT.
  const quotationsCountQuery = useQuery({
    queryKey: ["procurement-pending-quotations-count"],
    queryFn: () =>
      getExactCount("Supplier Quotation", [
        ["status", "not in", ["Ordered", "Expired", "Lost", "Cancelled"]],
      ]),
    ...DASHBOARD_QUERY_OPTIONS,
  });

  const pendingPoCountQuery = useQuery({
    queryKey: ["procurement-pending-pos-count"],
    queryFn: () => getExactCount("Purchase Order", [["docstatus", "=", 0]]),
    ...DASHBOARD_QUERY_OPTIONS,
  });

  // ── Deferred analytics — charts / top suppliers / activity feed ────────────
  const analyticsQuery = useQuery({
    queryKey: ["dashboard-analytics"],
    queryFn: fetchDashboardAnalytics,
    enabled: chartsReady,
    ...DASHBOARD_QUERY_OPTIONS,
  });

  // ── Deferred table — forwarded material request queue ──────────────────────
  const queueQuery = useQuery({
    queryKey: ["mr-procurement-queue"],
    queryFn: fetchProcurementQueue,
    enabled: tablesReady,
    ...DASHBOARD_QUERY_OPTIONS,
  });

  // ── Deferred — forwarded history (drives the tracking counters) ────────────
  const historyQuery = useQuery({
    queryKey: ["mr-forwarded-history"],
    queryFn: fetchForwardedHistory,
    enabled: tablesReady,
    ...DASHBOARD_QUERY_OPTIONS,
  });

  const forwardedCounters = useMemo(
    () => buildForwardedCounters(historyQuery.data ?? []),
    [historyQuery.data],
  );

  useEffect(() => {
    if (!slaVisible) return;
    const queue = queueQuery.data;
    if (queue && queue.length > 0) void syncMaterialRequestSlaBatch(queue);
  }, [queueQuery.data, slaVisible]);

  const counts = countsQuery.data ?? null;
  const analytics = analyticsQuery.data;

  // KPI grid only waits on its own lightweight queries — never the heavy
  // analytics fetch. Analytics panels keep their own skeletons.
  const loading = countsQuery.isLoading || spendQuery.isLoading;
  const analyticsLoading = analyticsQuery.isPending;

  const ytdSpend = spendQuery.data?.ytdSpend ?? 0;

  const monthlySpend = useMemo(
    () => computeMonthlySpendTrend(analytics?.invoices ?? []),
    [analytics?.invoices],
  );

  const topSuppliers = useMemo(
    () =>
      buildTopSuppliersWithTrend(
        analytics?.invoices ?? [],
        analytics?.poSamples ?? [],
        5,
      ),
    [analytics?.invoices, analytics?.poSamples],
  );

  const activityFeed = useMemo(() => {
    if (!analytics) return [];
    return buildActivityFeed(
      analytics.recentRfqs,
      analytics.recentPos,
      analytics.recentInvoices,
      analytics.recentPayments ?? [],
    ).filter((item) => item.type === "rfq" || item.type === "po");
  }, [analytics]);

  const forwardedRows = useMemo(
    () => buildForwardedRows(queueQuery.data ?? []),
    [queueQuery.data],
  );

  const mrWaitingForRfq = forwardedRows.filter((r) => !r.hasRfq).length;

  const pendingQuotations = quotationsCountQuery.data ?? 0;
  const pendingPos = pendingPoCountQuery.data ?? 0;

  const kpiCards = useMemo<
    Array<{
      key: string;
      label: string;
      value: string;
      icon: LucideIcon;
      to: string;
      accent: string;
    }>
  >(
    () => [
      {
        key: "spend",
        label: "Total Spend",
        value: spendQuery.data ? formatCurrencyCompact(ytdSpend) : "—",
        icon: DollarSign,
        to: "/p2p/total-spend",
        accent: "bg-primary-50 text-primary-600",
      },
      {
        key: "rfqs",
        label: "Open RFQs",
        value: counts ? counts.openRfqs.toLocaleString() : "—",
        icon: FileSearch,
        to: "/sourcing/rfq?preset=open",
        accent: "bg-primary-50 text-primary-600",
      },
      {
        key: "quotes",
        label: "Pending Quotations",
        value: quotationsCountQuery.isPending
          ? "—"
          : pendingQuotations.toLocaleString(),
        icon: FileText,
        to: "/sourcing/rfq?preset=open",
        accent: "bg-amber-50 text-amber-600",
      },
      {
        key: "pos",
        label: "Pending Purchase Orders",
        value: pendingPoCountQuery.isPending
          ? "—"
          : pendingPos.toLocaleString(),
        icon: ShoppingCart,
        to: "/p2p/purchase-orders?preset=pending",
        accent: "bg-amber-50 text-amber-600",
      },
      {
        key: "suppliers",
        label: "Active Suppliers",
        value: counts ? counts.activeSuppliers.toLocaleString() : "—",
        icon: Users,
        to: "/suppliers?status=active",
        accent: "bg-primary-50 text-primary-600",
      },
    ],
    [
      spendQuery.data,
      ytdSpend,
      counts,
      quotationsCountQuery.isPending,
      pendingQuotations,
      pendingPoCountQuery.isPending,
      pendingPos,
    ],
  );

  return (
    <div className="dashboard-stack">
      {/* ── Header with compact action ─────────────────────────────────── */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="page-subtitle">
            Welcome back, {greetingName} · {config.subtitle}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            to="/material-requests/procurement"
            className="btn-secondary px-3 py-2 text-sm"
          >
            <Package className="h-4 w-4" />
            Procurement Queue
          </Link>
          <Link to="/sourcing/rfq/new" className="btn-primary px-3.5 py-2 text-sm">
            <FileSearch className="h-4 w-4" />
            Create RFQ
          </Link>
        </div>
      </div>

      {/* ── Section 1: Executive KPI cards ─────────────────────────────── */}
      {loading ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-[78px] rounded-xl" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {kpiCards.map((c) => {
            const Icon = c.icon;
            return (
              <Link
                key={c.key}
                to={c.to}
                className="rounded-xl border border-neutral-200/80 bg-white px-3.5 py-3 shadow-sm transition-shadow hover:shadow-md"
              >
                <div className="flex items-center justify-between gap-1">
                  <p className="truncate text-[10px] font-semibold uppercase tracking-wide text-neutral-400">
                    {c.label}
                  </p>
                  <span
                    className={`flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md ${c.accent}`}
                  >
                    <Icon className="h-3.5 w-3.5" />
                  </span>
                </div>
                <p className="mt-1.5 text-lg font-bold leading-none tabular-nums text-neutral-900">
                  {c.value}
                </p>
              </Link>
            );
          })}
        </div>
      )}

      {/* ── Procurement Analytics: live KPIs + trend charts ────────────── */}
      <ProcurementAnalyticsSection enabled={chartsReady} />

      {/* ── SLA countdowns for procurement-owned stages ────────────────── */}
      <SlaCountdownWidget role="procurement" title="Procurement SLA Countdown" />

      {/* ── Section 2: Action Center ───────────────────────────────────── */}
      <section className="card p-4 sm:p-5">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h2 className="text-base font-bold text-neutral-900">Action Center</h2>
            <p className="text-xs text-neutral-500">
              Items that need your attention right now
            </p>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <AttentionTile
            label="Material Requests waiting for RFQ"
            value={queueQuery.isPending ? null : mrWaitingForRfq}
            icon={Package}
            to="/material-requests/procurement"
            accent="text-blue-700 bg-blue-50"
          />
          <AttentionTile
            label="Quotations waiting for review"
            value={quotationsCountQuery.isPending ? null : pendingQuotations}
            icon={FileText}
            to="/sourcing/rfq?preset=open"
            accent="text-amber-700 bg-amber-50"
          />
          <AttentionTile
            label="Purchase Orders waiting for approval"
            value={pendingPoCountQuery.isPending ? null : pendingPos}
            icon={ClipboardCheck}
            to="/p2p/purchase-orders?preset=pending"
            accent="text-emerald-700 bg-emerald-50"
          />
        </div>

        <div className="mt-4 grid gap-2 sm:grid-cols-3">
          <QuickAction label="Create RFQ" to="/sourcing/rfq/new" icon={FileSearch} />
          <QuickAction
            label="Review Quotations"
            to="/sourcing/rfq?preset=open"
            icon={FileText}
          />
          <QuickAction
            label="Approve PO"
            to="/p2p/purchase-orders?preset=pending"
            icon={ClipboardCheck}
          />
        </div>
      </section>

      {/* ── Forwarded tracking counters ────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <AttentionTile
          label="Forwarded Requests"
          value={historyQuery.isPending ? null : forwardedCounters.forwardedRequests}
          icon={Truck}
          to="/material-requests/procurement"
          accent="bg-amber-50 text-amber-600"
        />
        <AttentionTile
          label="RFQs Pending"
          value={historyQuery.isPending ? null : forwardedCounters.rfqsPending}
          icon={FileSearch}
          to="/material-requests/history"
          accent="bg-blue-50 text-blue-600"
        />
        <AttentionTile
          label="RFQs Created Today"
          value={historyQuery.isPending ? null : forwardedCounters.rfqsCreatedToday}
          icon={FileText}
          to="/material-requests/history"
          accent="bg-emerald-50 text-emerald-600"
        />
        <AttentionTile
          label="History Count"
          value={historyQuery.isPending ? null : forwardedCounters.historyCount}
          icon={ClipboardCheck}
          to="/material-requests/history"
          accent="bg-primary-50 text-primary-600"
        />
      </div>

      {/* ── Section 3: Forwarded Material Requests table ───────────────── */}
      <section className="card overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-neutral-100 px-4 py-3">
          <div>
            <h2 className="text-base font-bold text-neutral-900">
              Forwarded Material Requests
            </h2>
            <p className="text-xs text-neutral-500">
              Warehouse shortages awaiting RFQ creation
            </p>
          </div>
          <Link
            to="/material-requests/procurement"
            className="inline-flex items-center gap-1 text-xs font-semibold text-primary-600 no-underline hover:underline"
          >
            View full queue <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>

        <div className="max-h-[360px] overflow-auto">
          <table className="min-w-full text-sm">
            <thead className="sticky top-0 z-10 bg-neutral-50 text-[11px] uppercase tracking-wide text-neutral-500">
              <tr>
                <th className="px-4 py-2.5 text-left font-semibold">MR Number</th>
                <th className="px-4 py-2.5 text-left font-semibold">Department</th>
                <th className="px-4 py-2.5 text-left font-semibold">Request Date</th>
                <th className="px-4 py-2.5 text-left font-semibold">Priority</th>
                <th className="px-4 py-2.5 text-center font-semibold">Items</th>
                <th className="px-4 py-2.5 text-right font-semibold">Est. Value</th>
                <th className="px-4 py-2.5 text-left font-semibold">Status</th>
                <th className="px-4 py-2.5 text-right font-semibold">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {queueQuery.isPending ? (
                Array.from({ length: 4 }).map((_, i) => (
                  <tr key={i}>
                    <td colSpan={8} className="px-4 py-2">
                      <Skeleton className="h-6 w-full rounded" />
                    </td>
                  </tr>
                ))
              ) : forwardedRows.length === 0 ? (
                <tr>
                  <td
                    colSpan={8}
                    className="px-4 py-10 text-center text-sm text-neutral-500"
                  >
                    No Material Requests have been forwarded to Procurement yet.
                  </td>
                </tr>
              ) : (
                forwardedRows.map((row) => (
                  <tr key={row.name} className="hover:bg-neutral-50">
                    <td className="whitespace-nowrap px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        <Link
                          to={`/material-requests/${encodeURIComponent(row.name)}`}
                          className="font-semibold text-primary-600 no-underline hover:underline"
                        >
                          {row.name}
                        </Link>
                        <ProcurementTypeBadge
                          type={row.procurementType}
                          withIcon={false}
                        />
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-neutral-700">
                      {row.department}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-neutral-600">
                      {row.requestDate}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5">
                      <PriorityPill priority={row.priority} />
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-center">
                      <span className="inline-flex items-center gap-1 rounded-full bg-neutral-100 px-2 py-0.5 text-xs font-semibold text-neutral-700">
                        <Package className="h-3 w-3 text-neutral-500" />
                        {row.itemCount}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-right font-semibold tabular-nums text-neutral-900">
                      {row.estValue > 0 ? formatCurrencyCompact(row.estValue) : "—"}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5">
                      <StatusBadge status={row.statusLabel} />
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-right">
                      {row.linkedRfq ? (
                        <Link
                          to={`/sourcing/rfq/${encodeURIComponent(row.linkedRfq)}`}
                          className="inline-flex items-center gap-1 rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-xs font-semibold text-primary-600 no-underline hover:bg-neutral-50"
                        >
                          View RFQ
                        </Link>
                      ) : row.canCreateRfq ? (
                        <Link
                          to={`/sourcing/rfq/new?mr=${encodeURIComponent(row.name)}`}
                          className="inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-3 py-1.5 text-xs font-semibold text-white no-underline shadow-sm hover:bg-primary-700"
                        >
                          <Truck className="h-3.5 w-3.5" />
                          Create RFQ
                        </Link>
                      ) : (
                        <span className="text-neutral-400">—</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* ── Section 4: Analytics ───────────────────────────────────────── */}
      <Suspense
        fallback={
          <div className="dashboard-grid-2">
            <Skeleton className="min-h-[300px] rounded-xl" />
            <Skeleton className="min-h-[300px] rounded-xl" />
          </div>
        }
      >
        <AdminSpendCharts monthlySpend={monthlySpend} loading={analyticsLoading} />
      </Suspense>

      <TopSuppliersPanel rows={topSuppliers} loading={analyticsLoading} />

      <CompactActivityFeed
        items={activityFeed}
        loading={analyticsLoading}
        title="Recent Procurement Activity"
      />
    </div>
  );
}

/* ─── Small building blocks ───────────────────────────────────────────────── */

const AttentionTile = memo(function AttentionTile({
  label,
  value,
  icon: Icon,
  to,
  accent,
}: {
  label: string;
  value: number | null;
  icon: LucideIcon;
  to: string;
  accent: string;
}) {
  return (
    <Link
      to={to}
      className="group flex flex-col justify-between rounded-xl border border-neutral-200/80 bg-white p-3.5 shadow-sm transition-all hover:border-primary-200 hover:shadow-md"
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-medium text-neutral-600">{label}</p>
        <span
          className={`flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg ${accent}`}
        >
          <Icon className="h-3.5 w-3.5" />
        </span>
      </div>
      <div className="mt-2 flex items-end justify-between">
        <span className="text-2xl font-bold tabular-nums leading-none text-neutral-900">
          {value === null ? "—" : value}
        </span>
        <span className="inline-flex items-center gap-0.5 text-xs font-semibold text-primary-600 opacity-0 transition-opacity group-hover:opacity-100">
          Review <ArrowRight className="h-3 w-3" />
        </span>
      </div>
    </Link>
  );
});

const QuickAction = memo(function QuickAction({
  label,
  to,
  icon: Icon,
}: {
  label: string;
  to: string;
  icon: LucideIcon;
}) {
  return (
    <Link
      to={to}
      className="group flex items-center gap-2.5 rounded-xl border border-neutral-200/80 bg-white px-3 py-2.5 shadow-sm transition-all hover:border-primary-300 hover:shadow-md"
    >
      <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-primary-50 text-primary-600 transition-colors group-hover:bg-primary-600 group-hover:text-white">
        <Icon className="h-4 w-4" />
      </span>
      <span className="truncate text-sm font-semibold text-neutral-700 transition-colors group-hover:text-neutral-900">
        {label}
      </span>
    </Link>
  );
});

const PriorityPill = memo(function PriorityPill({ priority }: { priority: string }) {
  const high = priority === "Urgent" || priority === "High";
  return (
    <span
      className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-medium ${
        high ? "bg-red-50 text-red-700" : "bg-neutral-100 text-neutral-700"
      }`}
    >
      {priority}
    </span>
  );
});
