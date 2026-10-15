import { memo, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  Clock,
  CreditCard,
  FileText,
  History,
  Inbox,
  Package,
  Receipt,
  ShieldAlert,
  XCircle,
} from "lucide-react";

import {
  getGRNsAwaitingInvoice,
  getOutstandingPayables,
  invoiceOutstandingAmount,
  type PayableInvoiceLite,
} from "../../api/financeWorkflow";
import { getFinanceReviewHistory } from "../../api/financeReviews";
import { getPaymentEntries, getPurchaseInvoices } from "../../api/accounts";
import { getPurchaseOrders } from "../../api/purchasing";
import { fetchProcurementAnalyticsPrimary } from "../../api/procurementAnalytics";
import { APPROVAL_WORKFLOW_QUERY_KEY } from "../../api/approvalWorkflow";
import { excludeVoucheredGRNs } from "../../api/vouchers";
import { DASHBOARD_QUERY_OPTIONS } from "../../api/queryPresets";
import { useVoucherSyncStore } from "../../store/voucherSyncStore";
import type { FinanceReviewItem, FinanceReviewStatus } from "../../types/erpnext";
import { daysUntil } from "../../utils/upcomingDeliveries";
import {
  formatCurrency,
  formatCurrencyCompact,
  formatDate,
} from "../../utils/format";
import { Skeleton } from "../Skeleton";
import DashboardWidgetError from "./DashboardWidgetError";

const PANEL = "finance-panel flex h-full flex-col overflow-hidden";

const TREND_H = 300;
const DONUT_H = 200;
const BUDGET_H = 280;

const AXIS = {
  tick: {
    fontSize: 10,
    fill: "#98A2B3",
    fontFamily: '"IBM Plex Mono", ui-monospace, monospace',
  },
  axisLine: false as const,
  tickLine: false as const,
};

const TOOLTIP = {
  fontSize: 12,
  borderRadius: 8,
  border: "1px solid #E3E6EB",
  boxShadow: "0 1px 2px rgba(16,24,40,0.04), 0 1px 3px rgba(16,24,40,0.04)",
  fontFamily: "Inter, sans-serif",
};

const PAYMENT_COLORS = {
  paid: "#12805C",
  outstanding: "#1F3A6D",
  overdue: "#DC2626",
  dueToday: "#D97706",
};

const STATUS_TONE: Record<FinanceReviewStatus, string> = {
  "Pending Finance Review": "bg-warning-100 text-warning-700",
  "Budget Approved": "bg-success-100 text-success-700",
  Rejected: "bg-danger-100 text-danger-700",
};

function PanelHeader({
  title,
  subtitle,
  icon: Icon,
  to,
  badge,
}: {
  title: string;
  subtitle?: string;
  icon?: React.ComponentType<{ className?: string }>;
  to?: string;
  badge?: string | number;
}) {
  return (
    <div className="flex shrink-0 items-start justify-between gap-3 border-b border-[#E2E8F0] px-5 py-3.5 sm:px-6">
      <div className="flex min-w-0 items-start gap-2.5">
        {Icon ? (
          <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-[#EEF3FA] text-[#1F3A6D]">
            <Icon className="h-5 w-5" />
          </span>
        ) : null}
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-[16px] font-semibold leading-tight text-[#0F2745]">
              {title}
            </h3>
            {badge != null && Number(badge) > 0 ? (
              <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-700 ring-1 ring-amber-200">
                {badge}
              </span>
            ) : null}
          </div>
          {subtitle ? (
            <p className="mt-0.5 text-[13px] text-[#64748B]">{subtitle}</p>
          ) : null}
        </div>
      </div>
      {to ? (
        <Link
          to={to}
          className="inline-flex shrink-0 items-center gap-1 text-[13px] font-semibold text-[#1F3A6D] no-underline hover:underline"
        >
          View all <ArrowRight className="h-3 w-3" />
        </Link>
      ) : null}
    </div>
  );
}

function FinanceDashboardGrid() {
  const syncVersion = useVoucherSyncStore((s) => s.version);
  const [txFilter, setTxFilter] = useState<"All" | "PO" | "Invoice" | "Voucher" | "Payment" | "GRN">("All");

  const analyticsQuery = useQuery({
    queryKey: ["finance-dashboard-analytics"],
    queryFn: fetchProcurementAnalyticsPrimary,
    ...DASHBOARD_QUERY_OPTIONS,
  });

  const payablesQuery = useQuery({
    queryKey: ["finance-dashboard-payables", syncVersion],
    queryFn: getOutstandingPayables,
    ...DASHBOARD_QUERY_OPTIONS,
  });

  const grnsQuery = useQuery({
    queryKey: ["grns-awaiting-invoice"],
    queryFn: () => getGRNsAwaitingInvoice(),
    ...DASHBOARD_QUERY_OPTIONS,
  });

  const grnsFilteredQuery = useQuery({
    queryKey: ["grns-awaiting-excluded", syncVersion, grnsQuery.data?.length ?? 0],
    queryFn: () => excludeVoucheredGRNs(grnsQuery.data ?? []),
    enabled: !!grnsQuery.data,
    staleTime: 30_000,
  });

  const historyQuery = useQuery({
    queryKey: [APPROVAL_WORKFLOW_QUERY_KEY, "finance-history", 8],
    queryFn: () => getFinanceReviewHistory(8),
    ...DASHBOARD_QUERY_OPTIONS,
  });

  const paymentsQuery = useQuery({
    queryKey: ["finance-dashboard-payments"],
    queryFn: () =>
      getPaymentEntries({
        filters: [["docstatus", "=", 1]],
        limit_page_length: 100,
      }),
    ...DASHBOARD_QUERY_OPTIONS,
  });

  const invoicesQuery = useQuery({
    queryKey: ["finance-dashboard-recent-invoices"],
    queryFn: () =>
      getPurchaseInvoices({
        filters: [["docstatus", "=", 1]],
        limit_page_length: 50,
        order_by: "modified desc",
      }),
    ...DASHBOARD_QUERY_OPTIONS,
  });

  const posQuery = useQuery({
    queryKey: ["finance-dashboard-pos"],
    queryFn: () => getPurchaseOrders({ limit_page_length: 500 }),
    ...DASHBOARD_QUERY_OPTIONS,
  });

  const analytics = analyticsQuery.data;
  const payables = payablesQuery.data ?? [];
  const pendingGrns = grnsFilteredQuery.data ?? [];
  const pos = posQuery.data ?? [];
  const payments = paymentsQuery.data ?? [];
  const invoices = invoicesQuery.data ?? [];

  // ==========================================
  // PO Metrics & Lifecycle Breakdown
  // ==========================================
  const poMetrics = useMemo(() => {
    const total = pos.length;
    const awaitingReview = pos.filter(
      (p) => p.status === "Draft" || p.docstatus === 0
    ).length;
    const approved = pos.filter(
      (p) => p.docstatus === 1 && p.status !== "Cancelled"
    ).length;
    const pendingInvoice = pos.filter(
      (p) =>
        p.status === "To Bill" ||
        (p.per_billed != null &&
          p.per_billed < 100 &&
          p.status !== "Draft" &&
          p.status !== "Cancelled")
    ).length;
    const grnReceived = pos.filter(
      (p) =>
        p.per_received != null && p.per_received > 0 && p.status !== "Cancelled"
    ).length;
    const paymentPending = pos.filter(
      (p) => p.status === "To Receive and Bill" || p.status === "To Bill"
    ).length;
    const totalCommitment = pos
      .filter((p) => p.status !== "Cancelled")
      .reduce((sum, p) => sum + (p.grand_total || 0), 0);

    const invoicedCount = pos.filter(
      (p) =>
        (p.per_billed != null && p.per_billed > 0) ||
        p.status === "To Receive and Bill" ||
        p.status === "To Bill" ||
        p.status === "Completed"
    ).length;

    const settledCount = pos.filter((p) => p.status === "Completed").length;
    const voucheredCount = pos.filter(
      (p) => p.status === "To Receive and Bill" || p.status === "Completed"
    ).length;

    return {
      total,
      awaitingReview,
      approved,
      pendingInvoice,
      grnReceived,
      paymentPending,
      totalCommitment,
      invoicedCount,
      voucheredCount,
      settledCount,
    };
  }, [pos]);

  // ==========================================
  // Priority / Attention Section Metrics
  // ==========================================
  const attentionData = useMemo(() => {
    let overdueSum = 0;
    let overdueCount = 0;
    let dueTodaySum = 0;
    let dueTodayCount = 0;

    for (const inv of payables) {
      const amt = invoiceOutstandingAmount(inv);
      if (amt <= 0) continue;
      const d = daysUntil(inv.due_date);
      if (d != null && d < 0) {
        overdueSum += amt;
        overdueCount += 1;
      } else if (d === 0) {
        dueTodaySum += amt;
        dueTodayCount += 1;
      }
    }

    const pendingRfqs = (historyQuery.data ?? []).filter(
      (h) => h.finance_status === "Pending Finance Review"
    ).length;

    return {
      overdueSum,
      overdueCount,
      dueTodaySum,
      dueTodayCount,
      pendingRfqs,
      pendingGrnsCount: pendingGrns.length,
    };
  }, [payables, historyQuery.data, pendingGrns.length]);

  // ==========================================
  // Spend & Financial Trend
  // ==========================================
  const monthlySpend = analytics?.charts.monthlySpend ?? [];
  const spendSeries = useMemo(() => {
    return monthlySpend.map((row, i) => {
      const prev = i > 0 ? monthlySpend[i - 1].amount : null;
      const momPct =
        prev != null && prev > 0 ? ((row.amount - prev) / prev) * 100 : null;
      return { ...row, prevAmount: prev, momPct };
    });
  }, [monthlySpend]);

  const spendSummary = useMemo(() => {
    const total = monthlySpend.reduce((sum, m) => sum + m.amount, 0);
    const avg = monthlySpend.length > 0 ? total / monthlySpend.length : 0;
    const highest = Math.max(0, ...monthlySpend.map((m) => m.amount));
    const current =
      monthlySpend.length > 0 ? monthlySpend[monthlySpend.length - 1].amount : 0;
    return { total, avg, highest, current };
  }, [monthlySpend]);

  // ==========================================
  // Payment Status (Paid, Outstanding, Overdue, Due Today)
  // ==========================================
  const paymentStatus = useMemo(() => {
    let overdue = 0;
    let dueToday = 0;
    let outstanding = 0;

    for (const inv of payables) {
      const amount = invoiceOutstandingAmount(inv);
      if (amount <= 0) continue;
      const d = daysUntil(inv.due_date);
      if (d != null && d < 0) overdue += amount;
      else if (d === 0) dueToday += amount;
      else outstanding += amount;
    }

    const paid = payments.reduce(
      (sum, p) => sum + (Number(p.paid_amount) || 0),
      0
    );

    const totalExposure = paid + outstanding + overdue + dueToday;

    return {
      totalExposure,
      paid,
      outstanding,
      overdue,
      dueToday,
      chartData: [
        { name: "Paid", value: paid, color: PAYMENT_COLORS.paid },
        { name: "Outstanding", value: outstanding, color: PAYMENT_COLORS.outstanding },
        { name: "Overdue", value: overdue, color: PAYMENT_COLORS.overdue },
        { name: "Due Today", value: dueToday, color: PAYMENT_COLORS.dueToday },
      ],
    };
  }, [payables, payments]);

  const paymentStatusHasData = paymentStatus.chartData.some((s) => s.value > 0);

  // ==========================================
  // Budget vs Actual Analytics
  // ==========================================
  const budgetData = useMemo(() => {
    const chart = analytics?.charts.budgetVsActual ?? [];
    const totalAllocated = chart.reduce((sum, b) => sum + (b.allocated || 0), 0);
    const totalActual = chart.reduce((sum, b) => sum + (b.actual || 0), 0);
    const totalRemaining = Math.max(0, totalAllocated - totalActual);
    const utilization =
      totalAllocated > 0 ? (totalActual / totalAllocated) * 100 : 0;

    return {
      chartData: chart,
      totalAllocated,
      totalActual,
      totalRemaining,
      utilization,
    };
  }, [analytics?.charts.budgetVsActual]);

  // ==========================================
  // Upcoming Due Payments
  // ==========================================
  const upcomingDue = useMemo(() => {
    return [...payables]
      .filter((inv) => invoiceOutstandingAmount(inv) > 0)
      .sort((a, b) => {
        const da = daysUntil(a.due_date);
        const db = daysUntil(b.due_date);
        if (da == null && db == null) return 0;
        if (da == null) return 1;
        if (db == null) return -1;
        return da - db;
      })
      .slice(0, 8);
  }, [payables]);

  // ==========================================
  // Recent Financial Transactions Feed
  // ==========================================
  const transactions = useMemo(() => {
    type Row = {
      key: string;
      sortDate: string;
      date: string;
      type: "Payment" | "Invoice" | "Voucher" | "PO" | "GRN";
      reference: string;
      party: string;
      poRef?: string;
      amount: number;
      status: string;
      to: string;
    };

    const rows: Row[] = [];

    // Payments
    for (const p of payments) {
      rows.push({
        key: `pay-${p.name}`,
        sortDate: p.posting_date || p.modified || "",
        date: p.posting_date || p.modified || "",
        type: "Payment",
        reference: p.name ?? "—",
        party: p.party_name || p.party || "—",
        poRef: "—",
        amount: p.paid_amount ?? 0,
        status: p.status ?? "Submitted",
        to: `/p2p/payments/${encodeURIComponent(p.name ?? "")}`,
      });
    }

    // Invoices
    for (const inv of invoices) {
      rows.push({
        key: `inv-${inv.name}`,
        sortDate: inv.modified || inv.posting_date || "",
        date: inv.posting_date || inv.modified || "",
        type: "Invoice",
        reference: inv.name ?? "—",
        party: inv.supplier ?? "—",
        poRef: inv.items?.[0]?.purchase_order ?? "—",
        amount: inv.grand_total ?? 0,
        status: inv.status ?? "Submitted",
        to: `/p2p/invoices/${encodeURIComponent(inv.name ?? "")}`,
      });
    }

    // Purchase Orders
    for (const p of pos.slice(0, 20)) {
      rows.push({
        key: `po-${p.name}`,
        sortDate: p.transaction_date || p.modified || "",
        date: p.transaction_date || p.modified || "",
        type: "PO",
        reference: p.name ?? "—",
        party: p.supplier_name || p.supplier || "—",
        poRef: p.name,
        amount: p.grand_total ?? 0,
        status: p.status ?? "Active",
        to: `/p2p/purchase-orders/${encodeURIComponent(p.name ?? "")}`,
      });
    }

    // GRNs
    for (const g of pendingGrns.slice(0, 10)) {
      rows.push({
        key: `grn-${g.name}`,
        sortDate: g.posting_date || "",
        date: g.posting_date || "",
        type: "GRN",
        reference: g.name ?? "—",
        party: g.supplier_name || g.supplier || "—",
        poRef: "—",
        amount: g.grand_total ?? 0,
        status: g.status ?? "Received",
        to: `/p2p/grn/${encodeURIComponent(g.name ?? "")}`,
      });
    }

    const filtered =
      txFilter === "All"
        ? rows
        : rows.filter((r) => r.type === txFilter);

    return filtered
      .sort((a, b) => (b.sortDate > a.sortDate ? 1 : -1))
      .slice(0, 10);
  }, [payments, invoices, pos, pendingGrns, txFilter]);

  const analyticsLoading =
    (analyticsQuery.isPending || analyticsQuery.isFetching) && !analytics;
  const payablesLoading =
    (payablesQuery.isPending || payablesQuery.isFetching) && !payablesQuery.data;
  const queueLoading =
    grnsQuery.isPending ||
    (grnsFilteredQuery.isPending && pendingGrns.length === 0);

  return (
    <div className="finance-dashboard-grid space-y-5">
      {/* ============================================================== */}
      {/* SECTION 1: FINANCE ATTENTION REQUIRED (Priority Action Cards)  */}
      {/* ============================================================== */}
      <div className="rounded-xl border border-slate-200/90 bg-linear-to-r from-slate-50/70 via-white to-slate-50/70 p-4 shadow-2xs">
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ShieldAlert className="h-4 w-4 text-primary-700" />
            <h2 className="text-sm font-bold tracking-tight text-slate-900">
              Finance Attention Required
            </h2>
            <span className="text-xs text-slate-500">
              · Items requiring immediate financial action
            </span>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {/* 1. Overdue Invoices */}
          <Link
            to="/p2p/invoices"
            className="group flex items-center justify-between rounded-xl border border-rose-200 bg-rose-50/40 p-3.5 shadow-2xs transition hover:border-rose-300 hover:bg-rose-50/70 no-underline"
          >
            <div className="min-w-0">
              <span className="text-[11px] font-bold uppercase tracking-wider text-rose-700">
                Overdue Invoices
              </span>
              <div className="mt-1 flex items-baseline gap-2">
                <span className="text-lg font-bold text-rose-900 tabular-nums">
                  {formatCurrencyCompact(attentionData.overdueSum)}
                </span>
                <span className="text-xs font-semibold text-rose-700">
                  ({attentionData.overdueCount} inv)
                </span>
              </div>
            </div>
            <span className="inline-flex items-center gap-1 text-xs font-semibold text-rose-700 group-hover:underline">
              Review <ArrowRight className="h-3 w-3" />
            </span>
          </Link>

          {/* 2. RFQs Awaiting Finance Review */}
          <Link
            to="/budget/pending-reviews"
            className="group flex items-center justify-between rounded-xl border border-amber-200 bg-amber-50/40 p-3.5 shadow-2xs transition hover:border-amber-300 hover:bg-amber-50/70 no-underline"
          >
            <div className="min-w-0">
              <span className="text-[11px] font-bold uppercase tracking-wider text-amber-700">
                RFQs Awaiting Review
              </span>
              <div className="mt-1 flex items-baseline gap-2">
                <span className="text-lg font-bold text-amber-900 tabular-nums">
                  {attentionData.pendingRfqs}
                </span>
                <span className="text-xs text-amber-700">Clearance req.</span>
              </div>
            </div>
            <span className="inline-flex items-center gap-1 text-xs font-semibold text-amber-700 group-hover:underline">
              Review <ArrowRight className="h-3 w-3" />
            </span>
          </Link>

          {/* 3. GRNs Awaiting Voucher */}
          <Link
            to="/p2p/vouchers"
            className="group flex items-center justify-between rounded-xl border border-sky-200 bg-sky-50/40 p-3.5 shadow-2xs transition hover:border-sky-300 hover:bg-sky-50/70 no-underline"
          >
            <div className="min-w-0">
              <span className="text-[11px] font-bold uppercase tracking-wider text-sky-700">
                GRNs Awaiting Voucher
              </span>
              <div className="mt-1 flex items-baseline gap-2">
                <span className="text-lg font-bold text-sky-900 tabular-nums">
                  {attentionData.pendingGrnsCount}
                </span>
                <span className="text-xs text-sky-700">Receipts</span>
              </div>
            </div>
            <span className="inline-flex items-center gap-1 text-xs font-semibold text-sky-700 group-hover:underline">
              Process <ArrowRight className="h-3 w-3" />
            </span>
          </Link>

          {/* 4. Payments Due Today */}
          <Link
            to="/p2p/payments"
            className="group flex items-center justify-between rounded-xl border border-emerald-200 bg-emerald-50/40 p-3.5 shadow-2xs transition hover:border-emerald-300 hover:bg-emerald-50/70 no-underline"
          >
            <div className="min-w-0">
              <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-700">
                Payments Due Today
              </span>
              <div className="mt-1 flex items-baseline gap-2">
                <span className="text-lg font-bold text-emerald-900 tabular-nums">
                  {formatCurrencyCompact(attentionData.dueTodaySum)}
                </span>
                <span className="text-xs font-semibold text-emerald-700">
                  ({attentionData.dueTodayCount} due)
                </span>
              </div>
            </div>
            <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 group-hover:underline">
              View <ArrowRight className="h-3 w-3" />
            </span>
          </Link>
        </div>
      </div>

      {/* ============================================================== */}
      {/* SECTION 2: PURCHASE ORDER FINANCIAL OVERVIEW (MAJOR PRIORITY)   */}
      {/* ============================================================== */}
      <div className={PANEL}>
        <PanelHeader
          title="Purchase Order Financial Overview"
          subtitle="Monitor commitments, invoice progress, GRN settlement and payment exposure."
          icon={Package}
          to="/p2p/purchase-orders"
        />
        <div className="p-5">
          {posQuery.isPending ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-20 rounded-xl" />
              ))}
            </div>
          ) : (
            <div className="space-y-4">
              {/* 6 Top PO Tiles */}
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
                <Link
                  to="/p2p/purchase-orders"
                  className="group flex flex-col justify-between rounded-xl border border-slate-200/90 bg-slate-50/60 p-3 shadow-2xs transition hover:border-slate-300 hover:bg-white no-underline"
                >
                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 truncate">
                    Total POs
                  </span>
                  <div className="mt-1 text-2xl font-bold tabular-nums text-slate-900">
                    {poMetrics.total}
                  </div>
                  <span className="text-[11px] text-slate-400">All commitments</span>
                </Link>

                <Link
                  to="/p2p/purchase-orders?status=To%20Receive%20and%20Bill"
                  className="group flex flex-col justify-between rounded-xl border border-slate-200/90 bg-emerald-50/30 p-3 shadow-2xs transition hover:border-emerald-300 hover:bg-white no-underline"
                >
                  <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-700 truncate">
                    Approved POs
                  </span>
                  <div className="mt-1 text-2xl font-bold tabular-nums text-emerald-700">
                    {poMetrics.approved}
                  </div>
                  <span className="text-[11px] text-emerald-600/80">Active orders</span>
                </Link>

                <Link
                  to="/p2p/purchase-orders?status=To%20Bill"
                  className="group flex flex-col justify-between rounded-xl border border-slate-200/90 bg-blue-50/30 p-3 shadow-2xs transition hover:border-blue-300 hover:bg-white no-underline"
                >
                  <span className="text-[11px] font-bold uppercase tracking-wider text-blue-700 truncate">
                    Awaiting Invoice
                  </span>
                  <div className="mt-1 text-2xl font-bold tabular-nums text-blue-700">
                    {poMetrics.pendingInvoice}
                  </div>
                  <span className="text-[11px] text-blue-600/80">Unbilled orders</span>
                </Link>

                <Link
                  to="/p2p/purchase-orders?status=To%20Receive"
                  className="group flex flex-col justify-between rounded-xl border border-slate-200/90 bg-sky-50/30 p-3 shadow-2xs transition hover:border-sky-300 hover:bg-white no-underline"
                >
                  <span className="text-[11px] font-bold uppercase tracking-wider text-sky-700 truncate">
                    GRN Received
                  </span>
                  <div className="mt-1 text-2xl font-bold tabular-nums text-sky-700">
                    {poMetrics.grnReceived}
                  </div>
                  <span className="text-[11px] text-sky-600/80">Goods received</span>
                </Link>

                <Link
                  to="/p2p/purchase-orders?status=To%20Receive%20and%20Bill"
                  className="group flex flex-col justify-between rounded-xl border border-slate-200/90 bg-purple-50/30 p-3 shadow-2xs transition hover:border-purple-300 hover:bg-white no-underline"
                >
                  <span className="text-[11px] font-bold uppercase tracking-wider text-purple-700 truncate">
                    Awaiting Payment
                  </span>
                  <div className="mt-1 text-2xl font-bold tabular-nums text-purple-700">
                    {poMetrics.paymentPending}
                  </div>
                  <span className="text-[11px] text-purple-600/80">Open payables</span>
                </Link>

                <Link
                  to="/p2p/purchase-orders"
                  className="group flex flex-col justify-between rounded-xl border border-slate-200/90 bg-emerald-50/50 p-3 shadow-2xs transition hover:border-emerald-400 hover:bg-white no-underline"
                  title={formatCurrency(poMetrics.totalCommitment)}
                >
                  <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-800 truncate">
                    Total Commitment
                  </span>
                  <div className="mt-1 text-xl font-bold tabular-nums text-emerald-800 truncate">
                    {formatCurrencyCompact(poMetrics.totalCommitment)}
                  </div>
                  <span className="text-[11px] text-emerald-600/80">Total value</span>
                </Link>
              </div>

              {/* PO Lifecycle Flow Pipeline */}
              <div className="rounded-xl border border-slate-100 bg-slate-50/50 p-4">
                <div className="mb-2 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                  Financial Settlement Lifecycle
                </div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                  <div className="flex flex-col rounded-lg border border-slate-200 bg-white p-2.5 text-center">
                    <span className="text-[10px] font-semibold text-slate-500">1. PO Issued</span>
                    <span className="text-sm font-bold text-slate-900">{poMetrics.total} orders</span>
                  </div>
                  <div className="flex flex-col rounded-lg border border-slate-200 bg-white p-2.5 text-center">
                    <span className="text-[10px] font-semibold text-sky-600">2. GRN Received</span>
                    <span className="text-sm font-bold text-sky-900">{poMetrics.grnReceived} orders</span>
                  </div>
                  <div className="flex flex-col rounded-lg border border-slate-200 bg-white p-2.5 text-center">
                    <span className="text-[10px] font-semibold text-blue-600">3. Invoice Created</span>
                    <span className="text-sm font-bold text-blue-900">{poMetrics.invoicedCount} orders</span>
                  </div>
                  <div className="flex flex-col rounded-lg border border-slate-200 bg-white p-2.5 text-center">
                    <span className="text-[10px] font-semibold text-amber-600">4. Voucher Issued</span>
                    <span className="text-sm font-bold text-amber-900">{poMetrics.voucheredCount} orders</span>
                  </div>
                  <div className="flex flex-col rounded-lg border border-slate-200 bg-white p-2.5 text-center">
                    <span className="text-[10px] font-semibold text-emerald-600">5. Payment Settled</span>
                    <span className="text-sm font-bold text-emerald-900">{poMetrics.settledCount} orders</span>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ============================================================== */}
      {/* SECTION 3: FINANCIAL TREND + PAYMENT STATUS                    */}
      {/* ============================================================== */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        {/* Financial Trend (2/3 width on desktop) */}
        <div className={`${PANEL} lg:col-span-2`}>
          <PanelHeader
            title="Financial Trend"
            subtitle="Monthly invoiced spend · last 12 months"
            icon={Receipt}
          />
          <div className="p-5">
            {/* Summary strip above chart */}
            <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4 rounded-lg bg-slate-50 p-3 border border-slate-100">
              <div>
                <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                  Total Invoiced
                </span>
                <p className="text-sm font-bold text-slate-900 tabular-nums">
                  {formatCurrencyCompact(spendSummary.total)}
                </p>
              </div>
              <div>
                <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                  Average Monthly
                </span>
                <p className="text-sm font-bold text-slate-900 tabular-nums">
                  {formatCurrencyCompact(spendSummary.avg)}
                </p>
              </div>
              <div>
                <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                  Highest Month
                </span>
                <p className="text-sm font-bold text-slate-900 tabular-nums">
                  {formatCurrencyCompact(spendSummary.highest)}
                </p>
              </div>
              <div>
                <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                  Current Month
                </span>
                <p className="text-sm font-bold text-primary-700 tabular-nums">
                  {formatCurrencyCompact(spendSummary.current)}
                </p>
              </div>
            </div>

            {analyticsQuery.isError ? (
              <DashboardWidgetError
                title="Financial trend unavailable"
                error={analyticsQuery.error}
                className="min-h-[260px] border-0 shadow-none"
                onRetry={() => void analyticsQuery.refetch()}
              />
            ) : analyticsLoading ? (
              <Skeleton className="h-[260px] w-full rounded-xl" />
            ) : spendSeries.some((p) => p.amount > 0) ? (
              <ResponsiveContainer width="100%" height={TREND_H}>
                <AreaChart
                  data={spendSeries}
                  margin={{ top: 12, right: 12, left: 0, bottom: 4 }}
                >
                  <defs>
                    <linearGradient id="financeSpendFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#1F3A6D" stopOpacity={0.3} />
                      <stop offset="100%" stopColor="#1F3A6D" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="#EEF2F7" vertical={false} strokeDasharray="3 6" />
                  <XAxis dataKey="month" {...AXIS} interval={0} tickMargin={6} />
                  <YAxis {...AXIS} width={52} tickFormatter={formatCurrencyCompact} />
                  <Tooltip
                    cursor={{ stroke: "#1F3A6D", strokeWidth: 1, strokeDasharray: "4 4" }}
                    contentStyle={{ ...TOOLTIP, borderRadius: 10, padding: "10px 12px" }}
                    formatter={(v: any, _name, item) => {
                      const val = Number(v ?? 0);
                      const mom = (item?.payload as { momPct?: number | null })?.momPct;
                      const label =
                        mom != null && Number.isFinite(mom)
                          ? `Spend (${mom >= 0 ? "+" : ""}${mom.toFixed(1)}% MoM)`
                          : "Monthly spend";
                      return [formatCurrency(val), label];
                    }}
                    labelFormatter={(label) => `Month: ${label}`}
                  />
                  <Area
                    type="monotone"
                    dataKey="amount"
                    name="Spend"
                    stroke="#1F3A6D"
                    strokeWidth={2.5}
                    fill="url(#financeSpendFill)"
                    dot={{ r: 3, fill: "#1F3A6D", strokeWidth: 0 }}
                    activeDot={{ r: 5, fill: "#1F3A6D", stroke: "#fff", strokeWidth: 2 }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="grid h-[260px] place-items-center text-[13px] text-[#98A2B3]">
                Waiting for invoiced spend data
              </div>
            )}
          </div>
        </div>

        {/* Payment Status Donut (1/3 width on desktop) */}
        <div className={`${PANEL} lg:col-span-1`}>
          <PanelHeader
            title="Payment Status"
            subtitle="Paid vs outstanding payables"
            icon={CreditCard}
            to="/p2p/payments"
          />
          <div className="flex flex-1 flex-col p-5">
            {payablesLoading && paymentsQuery.isPending ? (
              <Skeleton className="mx-auto h-[180px] w-[180px] rounded-full" />
            ) : paymentStatusHasData ? (
              <>
                <ResponsiveContainer width="100%" height={DONUT_H}>
                  <PieChart>
                    <Pie
                      data={paymentStatus.chartData.filter((s) => s.value > 0)}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      innerRadius={55}
                      outerRadius={80}
                      paddingAngle={2.5}
                    >
                      {paymentStatus.chartData
                        .filter((s) => s.value > 0)
                        .map((entry) => (
                          <Cell key={entry.name} fill={entry.color} />
                        ))}
                    </Pie>
                    <Tooltip
                      formatter={(v: any, name: any) => [
                        formatCurrency(Number(v ?? 0)),
                        String(name ?? ""),
                      ]}
                      contentStyle={{ ...TOOLTIP, borderRadius: 10, padding: "8px 10px" }}
                    />
                  </PieChart>
                </ResponsiveContainer>

                <div className="mt-3 grid grid-cols-2 gap-2 border-t border-slate-100 pt-3">
                  <div className="rounded-lg bg-emerald-50/50 p-2 text-center border border-emerald-100/50">
                    <span className="text-[10px] font-semibold text-emerald-700">Paid</span>
                    <p className="text-xs font-bold text-emerald-900">
                      {formatCurrencyCompact(paymentStatus.paid)}
                    </p>
                  </div>
                  <div className="rounded-lg bg-blue-50/50 p-2 text-center border border-blue-100/50">
                    <span className="text-[10px] font-semibold text-blue-700">Outstanding</span>
                    <p className="text-xs font-bold text-blue-900">
                      {formatCurrencyCompact(paymentStatus.outstanding)}
                    </p>
                  </div>
                  <div className="rounded-lg bg-rose-50/50 p-2 text-center border border-rose-100/50">
                    <span className="text-[10px] font-semibold text-rose-700">Overdue</span>
                    <p className="text-xs font-bold text-rose-900">
                      {formatCurrencyCompact(paymentStatus.overdue)}
                    </p>
                  </div>
                  <div className="rounded-lg bg-amber-50/50 p-2 text-center border border-amber-100/50">
                    <span className="text-[10px] font-semibold text-amber-700">Due Today</span>
                    <p className="text-xs font-bold text-amber-900">
                      {formatCurrencyCompact(paymentStatus.dueToday)}
                    </p>
                  </div>
                </div>
              </>
            ) : (
              <div className="grid flex-1 place-items-center py-10 text-[13px] text-[#98A2B3]">
                No payment status records
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ============================================================== */}
      {/* SECTION 4: PENDING INVOICE QUEUE + RECENT FINANCE ACTIVITY     */}
      {/* ============================================================== */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {/* Pending Invoice Queue */}
        <div className={PANEL}>
          <PanelHeader
            title="Pending Invoice Queue"
            subtitle="Goods received · awaiting voucher & invoice creation"
            icon={Inbox}
            to="/p2p/vouchers"
            badge={pendingGrns.length}
          />
          {queueLoading ? (
            <div className="space-y-2 p-5">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-10 rounded-lg" />
              ))}
            </div>
          ) : pendingGrns.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 py-10 text-center">
              <Inbox className="h-7 w-7 text-neutral-300" />
              <p className="text-sm font-medium text-neutral-700">
                No invoices pending creation
              </p>
              <p className="text-xs text-neutral-500">
                Submitted goods receipts appear here for voucher issuance.
              </p>
            </div>
          ) : (
            <div className="min-h-0 flex-1 overflow-x-auto overflow-y-auto">
              <table className="w-full min-w-[500px] text-left text-sm">
                <thead className="sticky top-0 bg-[#F8FAFC] text-[10px] font-semibold uppercase tracking-wider text-[#64748B]">
                  <tr>
                    <th className="px-4 py-2.5">GRN</th>
                    <th className="px-3 py-2.5">Supplier</th>
                    <th className="px-3 py-2.5 text-right">Amount</th>
                    <th className="px-3 py-2.5">Received Date</th>
                    <th className="px-3 py-2.5">Status</th>
                    <th className="px-4 py-2.5 text-right">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {pendingGrns.slice(0, 6).map((g) => (
                    <tr
                      key={g.name}
                      className="border-t border-[#F1F5F9] hover:bg-[#F8FAFC]"
                    >
                      <td className="px-4 py-2.5 font-semibold text-[#1F3A6D]">
                        <Link
                          to={`/p2p/grn/${encodeURIComponent(g.name)}`}
                          className="no-underline hover:underline"
                        >
                          {g.name}
                        </Link>
                      </td>
                      <td className="max-w-[120px] truncate px-3 py-2.5 text-[#475569]">
                        {g.supplier_name ?? g.supplier ?? "—"}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums font-medium text-[#1E293B]">
                        {formatCurrency(g.grand_total)}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-[#64748B]">
                        {g.posting_date ? formatDate(g.posting_date) : "—"}
                      </td>
                      <td className="px-3 py-2.5">
                        <span className="rounded-full bg-sky-50 px-2 py-0.5 text-[10px] font-semibold text-sky-700">
                          {g.status ?? "Received"}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <Link
                          to={`/p2p/grn/${encodeURIComponent(g.name)}`}
                          className="inline-flex items-center gap-1 text-[12px] font-semibold text-[#1F3A6D] no-underline hover:underline"
                        >
                          Create Voucher <ArrowRight className="h-2.5 w-2.5" />
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Recent Finance Activity */}
        <div className={PANEL}>
          <PanelHeader
            title="Recent Finance Activity"
            subtitle="Latest financial review and transaction activity"
            icon={History}
            to="/budget/pending-reviews"
          />
          {historyQuery.isPending ? (
            <div className="space-y-3 p-5">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-12 rounded-lg" />
              ))}
            </div>
          ) : (historyQuery.data ?? []).length === 0 ? (
            <div className="flex flex-1 items-center justify-center px-6 py-10 text-[13px] text-[#64748B]">
              No recent finance review activity
            </div>
          ) : (
            <ol className="min-h-0 flex-1 space-y-0 overflow-y-auto px-5 py-3">
              {(historyQuery.data ?? []).slice(0, 6).map((row, idx, arr) => (
                <ActivityTimelineItem
                  key={row.rfq_name}
                  row={row}
                  isLast={idx === arr.length - 1}
                />
              ))}
            </ol>
          )}
        </div>
      </div>

      {/* ============================================================== */}
      {/* SECTION 5: BUDGET VS ACTUAL + UPCOMING DUE PAYMENTS            */}
      {/* ============================================================== */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {/* Budget vs Actual */}
        <div className={PANEL}>
          <PanelHeader
            title="Budget vs Actual"
            subtitle="Allocated budget compared with actual spend"
            icon={FileText}
            to="/budget"
          />
          <div className="p-5">
            {/* Variance info strip */}
            <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4 rounded-lg bg-slate-50 p-3 border border-slate-100 text-center">
              <div>
                <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                  Budget
                </span>
                <p className="text-xs font-bold text-slate-900">
                  {formatCurrencyCompact(budgetData.totalAllocated)}
                </p>
              </div>
              <div>
                <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                  Actual
                </span>
                <p className="text-xs font-bold text-slate-900">
                  {formatCurrencyCompact(budgetData.totalActual)}
                </p>
              </div>
              <div>
                <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                  Remaining
                </span>
                <p className="text-xs font-bold text-emerald-700">
                  {formatCurrencyCompact(budgetData.totalRemaining)}
                </p>
              </div>
              <div>
                <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                  Utilization
                </span>
                <p className="text-xs font-bold text-primary-700">
                  {budgetData.utilization.toFixed(1)}%
                </p>
              </div>
            </div>

            {budgetData.chartData.length > 0 ? (
              <ResponsiveContainer width="100%" height={BUDGET_H}>
                <BarChart
                  data={budgetData.chartData}
                  margin={{ top: 8, right: 8, left: 0, bottom: 8 }}
                >
                  <CartesianGrid stroke="#EEF2F7" vertical={false} />
                  <XAxis
                    dataKey="name"
                    {...AXIS}
                    interval={0}
                    height={36}
                    angle={-10}
                    textAnchor="end"
                  />
                  <YAxis {...AXIS} width={42} tickFormatter={formatCurrencyCompact} />
                  <Tooltip
                    contentStyle={TOOLTIP}
                    formatter={(v: any) => formatCurrency(Number(v ?? 0))}
                  />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar
                    dataKey="allocated"
                    name="Allocated"
                    fill="#EEF3FA"
                    radius={[3, 3, 0, 0]}
                  />
                  <Bar
                    dataKey="actual"
                    name="Actual"
                    fill="#17315D"
                    radius={[3, 3, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="grid h-[240px] place-items-center text-[13px] text-[#98A2B3]">
                No budget records available
              </div>
            )}
          </div>
        </div>

        {/* Upcoming Due Payments */}
        <div className={PANEL}>
          <PanelHeader
            title="Upcoming Due Payments"
            subtitle="Outstanding invoices sorted by urgency"
            icon={CalendarClock}
            to="/p2p/payments"
            badge={upcomingDue.length}
          />
          {payablesLoading ? (
            <div className="space-y-2 p-5">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-11 rounded-lg" />
              ))}
            </div>
          ) : upcomingDue.length === 0 ? (
            <div className="flex flex-1 items-center justify-center px-6 py-10 text-[13px] text-[#64748B]">
              No upcoming payment obligations
            </div>
          ) : (
            <ul className="min-h-0 flex-1 divide-y divide-[#F1F5F9] overflow-y-auto">
              {upcomingDue.map((inv) => (
                <DuePaymentRow key={inv.name} inv={inv} />
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* ============================================================== */}
      {/* SECTION 6: RECENT FINANCIAL TRANSACTIONS (FULL WIDTH)          */}
      {/* ============================================================== */}
      <div className={PANEL}>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#E2E8F0] px-5 py-3.5 sm:px-6">
          <div className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-[#EEF3FA] text-[#1F3A6D]">
              <Receipt className="h-5 w-5" />
            </span>
            <div>
              <h3 className="text-[16px] font-semibold leading-tight text-[#0F2745]">
                Recent Financial Transactions
              </h3>
              <p className="mt-0.5 text-[13px] text-[#64748B]">
                Latest submitted payments, invoices and vouchers
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Filter Tabs */}
            <div className="flex rounded-lg bg-slate-100 p-0.5 text-xs font-semibold text-slate-600">
              {(["All", "PO", "Invoice", "Payment", "GRN"] as const).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setTxFilter(tab)}
                  className={`rounded-md px-2.5 py-1 transition ${
                    txFilter === tab
                      ? "bg-white text-slate-900 shadow-2xs"
                      : "text-slate-500 hover:text-slate-800"
                  }`}
                >
                  {tab}
                </button>
              ))}
            </div>

            <Link
              to="/p2p/payments"
              className="inline-flex shrink-0 items-center gap-1 text-[13px] font-semibold text-[#1F3A6D] no-underline hover:underline ml-2"
            >
              View all <ArrowRight className="h-3 w-3" />
            </Link>
          </div>
        </div>

        {transactions.length === 0 ? (
          <div className="flex flex-1 items-center justify-center px-6 py-10 text-[13px] text-[#64748B]">
            No recent financial transactions found
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead>
                <tr className="border-b border-[#EEF2F7] bg-slate-50/50 text-[10px] font-semibold uppercase tracking-wider text-[#64748B]">
                  <th className="px-5 py-2.5">Date</th>
                  <th className="px-3 py-2.5">Type</th>
                  <th className="px-3 py-2.5">Reference</th>
                  <th className="px-3 py-2.5">Supplier / Party</th>
                  <th className="px-3 py-2.5">PO</th>
                  <th className="px-3 py-2.5 text-right">Amount</th>
                  <th className="px-3 py-2.5">Status</th>
                  <th className="px-5 py-2.5 text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {transactions.map((tx) => (
                  <tr
                    key={tx.key}
                    className="border-b border-[#F8FAFC] hover:bg-[#F8FAFC]"
                  >
                    <td className="whitespace-nowrap px-5 py-2.5 text-[#64748B]">
                      {tx.date ? formatDate(tx.date) : "—"}
                    </td>
                    <td className="px-3 py-2.5">
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold ${
                          tx.type === "Payment"
                            ? "bg-emerald-50 text-emerald-700"
                            : tx.type === "Invoice"
                              ? "bg-blue-50 text-blue-700"
                              : tx.type === "PO"
                                ? "bg-purple-50 text-purple-700"
                                : "bg-[#EEF3FA] text-[#1F3A6D]"
                        }`}
                      >
                        {tx.type}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 font-semibold text-[#1E293B]">
                      {tx.reference}
                    </td>
                    <td className="max-w-[150px] truncate px-3 py-2.5 text-[#475569]">
                      {tx.party}
                    </td>
                    <td className="px-3 py-2.5 text-[#64748B] text-xs">
                      {tx.poRef ?? "—"}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums font-medium text-[#1E293B]">
                      {formatCurrency(tx.amount)}
                    </td>
                    <td className="px-3 py-2.5 text-[#64748B] text-xs">
                      {tx.status}
                    </td>
                    <td className="px-5 py-2.5 text-right">
                      <Link
                        to={tx.to}
                        className="text-[12px] font-semibold text-[#1F3A6D] no-underline hover:underline"
                      >
                        Open
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ============================================================== */}
      {/* SECTION 7: EXECUTIVE FINANCIAL HEALTH SUMMARY                  */}
      {/* ============================================================== */}
      <div className="rounded-xl border border-slate-200/90 bg-white p-5 shadow-2xs">
        <div className="mb-4 flex items-center justify-between border-b border-slate-100 pb-3">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
            <h3 className="text-sm font-bold tracking-tight text-slate-900">
              Financial Health Summary
            </h3>
          </div>
          <span className="text-xs text-slate-400">
            Real-time AP & commitment exposure metrics
          </span>
        </div>

        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
          <div className="rounded-lg border border-slate-100 bg-slate-50/50 p-3">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
              Total Commitments
            </span>
            <div className="mt-1 text-base font-bold text-slate-900">
              {formatCurrencyCompact(poMetrics.totalCommitment)}
            </div>
          </div>

          <div className="rounded-lg border border-slate-100 bg-slate-50/50 p-3">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
              Total Paid
            </span>
            <div className="mt-1 text-base font-bold text-emerald-700">
              {formatCurrencyCompact(paymentStatus.paid)}
            </div>
          </div>

          <div className="rounded-lg border border-slate-100 bg-slate-50/50 p-3">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
              Outstanding
            </span>
            <div className="mt-1 text-base font-bold text-blue-700">
              {formatCurrencyCompact(paymentStatus.outstanding)}
            </div>
          </div>

          <div className="rounded-lg border border-slate-100 bg-slate-50/50 p-3">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
              Overdue
            </span>
            <div className="mt-1 text-base font-bold text-rose-700">
              {formatCurrencyCompact(paymentStatus.overdue)}
            </div>
          </div>

          <div className="rounded-lg border border-slate-100 bg-slate-50/50 p-3">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
              Budget Utilization
            </span>
            <div className="mt-1 text-base font-bold text-slate-900">
              {budgetData.utilization.toFixed(1)}%
            </div>
            <div className="mt-1.5 h-1.5 w-full rounded-full bg-slate-200 overflow-hidden">
              <div
                className="h-full bg-primary-600 rounded-full"
                style={{ width: `${Math.min(100, budgetData.utilization)}%` }}
              />
            </div>
          </div>

          <div className="rounded-lg border border-slate-100 bg-slate-50/50 p-3">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
              Payment Completion
            </span>
            <div className="mt-1 text-base font-bold text-slate-900">
              {paymentStatus.totalExposure > 0
                ? ((paymentStatus.paid / paymentStatus.totalExposure) * 100).toFixed(1)
                : "100"}%
            </div>
            <div className="mt-1.5 h-1.5 w-full rounded-full bg-slate-200 overflow-hidden">
              <div
                className="h-full bg-emerald-600 rounded-full"
                style={{
                  width: `${
                    paymentStatus.totalExposure > 0
                      ? Math.min(100, (paymentStatus.paid / paymentStatus.totalExposure) * 100)
                      : 100
                  }%`,
                }}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function DuePaymentRow({ inv }: { inv: PayableInvoiceLite }) {
  const amount = invoiceOutstandingAmount(inv);
  const d = daysUntil(inv.due_date);
  const overdue = d != null && d < 0;
  const dueSoon = d != null && d >= 0 && d <= 7;

  return (
    <li>
      <Link
        to={`/p2p/invoices/${encodeURIComponent(inv.name ?? "")}`}
        className="flex items-center gap-3 px-5 py-3 no-underline transition hover:bg-[#F8FAFC]"
      >
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-semibold text-[#1E293B]">
            {inv.name}
          </p>
          <p className="mt-0.5 truncate text-[12px] text-[#64748B]">
            {inv.supplier_name ?? inv.supplier ?? "—"}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-[13px] font-semibold tabular-nums text-[#1E293B]">
            {formatCurrency(amount)}
          </p>
          <p
            className={`mt-0.5 text-[11px] font-semibold ${
              overdue
                ? "text-rose-600"
                : dueSoon
                  ? "text-amber-600"
                  : "text-[#64748B]"
            }`}
          >
            {inv.due_date
              ? overdue
                ? `${Math.abs(d ?? 0)}d overdue`
                : d === 0
                  ? "Due today"
                  : `${d}d remaining`
              : "No due date"}
          </p>
        </div>
      </Link>
    </li>
  );
}

function ActivityTimelineItem({
  row,
  isLast,
}: {
  row: FinanceReviewItem;
  isLast: boolean;
}) {
  const tone =
    STATUS_TONE[row.finance_status] ?? "bg-neutral-100 text-neutral-700";
  const Icon =
    row.finance_status === "Budget Approved"
      ? CheckCircle2
      : row.finance_status === "Rejected"
        ? XCircle
        : Clock;
  const label =
    row.finance_status === "Budget Approved"
      ? "Approved"
      : row.finance_status === "Pending Finance Review"
        ? "Pending"
        : row.finance_status;

  return (
    <li className="relative flex gap-3 pb-4">
      {!isLast ? (
        <span
          className="absolute bottom-0 left-[15px] top-8 w-px bg-[#E2E8F0]"
          aria-hidden
        />
      ) : null}
      <span className="relative z-[1] flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#F1F5F9] text-[#64748B]">
        <Icon className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1 pt-0.5">
        <div className="flex flex-wrap items-center gap-2">
          <Link
            to={`/finance/reviews/${encodeURIComponent(row.rfq_name)}`}
            className="text-[13px] font-semibold text-[#1F3A6D] no-underline hover:underline"
          >
            {row.rfq_name}
          </Link>
          <span
            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold ${tone}`}
          >
            {label}
          </span>
        </div>
        <p className="mt-0.5 text-[12px] text-[#64748B]">
          {row.supplier ?? "—"} · {formatCurrency(row.rfq_value ?? 0)}
          {row.finance_review_date
            ? ` · ${formatDate(row.finance_review_date)}`
            : ""}
        </p>
      </div>
    </li>
  );
}

export default memo(FinanceDashboardGrid);
