import { memo, useMemo } from "react";
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
  Receipt,
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
import { fetchProcurementAnalyticsPrimary } from "../../api/procurementAnalytics";
import { APPROVAL_WORKFLOW_QUERY_KEY } from "../../api/approvalWorkflow";
import { excludeVoucheredGRNs } from "../../api/vouchers";
import { DASHBOARD_QUERY_OPTIONS } from "../../api/queryPresets";
import { useVoucherSyncStore } from "../../store/voucherSyncStore";
import type { FinanceReviewItem, FinanceReviewStatus } from "../../types/erpnext";
import { daysUntil } from "../../utils/upcomingDeliveries";
import { formatCurrency, formatCurrencyCompact, formatDate } from "../../utils/format";
import { Skeleton } from "../Skeleton";
import DashboardWidgetError from "./DashboardWidgetError";

const PANEL =
  "finance-panel flex h-full flex-col overflow-hidden";

const TREND_H = 340;
const DONUT_H = 210;
const BUDGET_H = 300;

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
    <div className="flex shrink-0 items-start justify-between gap-3 border-b border-[#EEF2F7] px-5 py-3.5 sm:px-6">
      <div className="flex min-w-0 items-start gap-2.5">
        {Icon ? (
          <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-[#EEF3FA] text-[#1F3A6D]">
            <Icon className="h-5 w-5" />
          </span>
        ) : null}
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-[15px] font-semibold leading-tight text-[#1E293B]">
              {title}
            </h3>
            {badge != null && Number(badge) > 0 ? (
              <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-700 ring-1 ring-amber-200">
                {badge}
              </span>
            ) : null}
          </div>
          {subtitle ? (
            <p className="mt-0.5 text-[12px] text-[#64748B]">{subtitle}</p>
          ) : null}
        </div>
      </div>
      {to ? (
        <Link
          to={to}
          className="inline-flex shrink-0 items-center gap-1 text-[12px] font-semibold text-[#1F3A6D] no-underline hover:underline"
        >
          View all <ArrowRight className="h-3 w-3" />
        </Link>
      ) : null}
    </div>
  );
}

function FinanceDashboardGrid() {
  const syncVersion = useVoucherSyncStore((s) => s.version);

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
        limit_page_length: 8,
        order_by: "modified desc",
      }),
    ...DASHBOARD_QUERY_OPTIONS,
  });

  const analytics = analyticsQuery.data;
  const payables = payablesQuery.data ?? [];
  const pendingGrns = grnsFilteredQuery.data ?? [];

  const monthlySpend = analytics?.charts.monthlySpend ?? [];
  const budgetVsActual = analytics?.charts.budgetVsActual ?? [];

  const spendSeries = useMemo(() => {
    return monthlySpend.map((row, i) => {
      const prev = i > 0 ? monthlySpend[i - 1].amount : null;
      const momPct =
        prev != null && prev > 0 ? ((row.amount - prev) / prev) * 100 : null;
      return { ...row, prevAmount: prev, momPct };
    });
  }, [monthlySpend]);

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

    const paid = (paymentsQuery.data ?? []).reduce(
      (sum, p) => sum + (Number(p.paid_amount) || 0),
      0,
    );

    // Always expose the four legend buckets (enterprise payment status).
    return [
      { name: "Paid", value: paid, color: PAYMENT_COLORS.paid },
      { name: "Outstanding", value: outstanding, color: PAYMENT_COLORS.outstanding },
      { name: "Overdue", value: overdue, color: PAYMENT_COLORS.overdue },
      { name: "Due Today", value: dueToday, color: PAYMENT_COLORS.dueToday },
    ];
  }, [payables, paymentsQuery.data]);

  const paymentStatusHasData = paymentStatus.some((s) => s.value > 0);

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

  const transactions = useMemo(() => {
    type Row = {
      key: string;
      sortDate: string;
      date: string;
      type: "Payment" | "Invoice";
      reference: string;
      party: string;
      amount: number;
      status: string;
      to: string;
    };

    const rows: Row[] = [];

    for (const p of paymentsQuery.data ?? []) {
      rows.push({
        key: `pay-${p.name}`,
        sortDate: p.posting_date || p.modified || "",
        date: p.posting_date || p.modified || "",
        type: "Payment",
        reference: p.name ?? "—",
        party: p.party_name || p.party || "—",
        amount: p.paid_amount ?? 0,
        status: p.status ?? "Submitted",
        to: `/p2p/payments/${encodeURIComponent(p.name ?? "")}`,
      });
    }

    for (const inv of invoicesQuery.data ?? []) {
      rows.push({
        key: `inv-${inv.name}`,
        sortDate: inv.modified || inv.posting_date || "",
        date: inv.posting_date || inv.modified || "",
        type: "Invoice",
        reference: inv.name ?? "—",
        party: inv.supplier ?? "—",
        amount: inv.grand_total ?? 0,
        status: inv.status ?? "Submitted",
        to: `/p2p/invoices/${encodeURIComponent(inv.name ?? "")}`,
      });
    }

    return rows
      .sort((a, b) => (b.sortDate > a.sortDate ? 1 : -1))
      .slice(0, 12);
  }, [paymentsQuery.data, invoicesQuery.data]);

  const analyticsLoading =
    (analyticsQuery.isPending || analyticsQuery.isFetching) && !analytics;
  const payablesLoading =
    (payablesQuery.isPending || payablesQuery.isFetching) && !payablesQuery.data;
  const queueLoading =
    grnsQuery.isPending ||
    (grnsFilteredQuery.isPending && pendingGrns.length === 0);

  return (
    <div className="finance-dashboard-grid">
      {/* Section 1 — Financial Trend + Payment Status */}
      <div className="finance-dashboard-grid__charts">
        <div className={PANEL}>
          <PanelHeader
            title="Financial Trend"
            subtitle="Monthly invoiced spend · last 12 months"
            icon={Receipt}
          />
          <div className="min-h-0 flex-1 px-4 pb-5 pt-2 sm:px-5">
            {analyticsQuery.isError ? (
              <DashboardWidgetError
                title="Financial trend unavailable"
                error={analyticsQuery.error}
                className="min-h-[340px] border-0 shadow-none"
                onRetry={() => void analyticsQuery.refetch()}
              />
            ) : analyticsLoading ? (
              <Skeleton className="h-[340px] w-full rounded-xl" />
            ) : spendSeries.some((p) => p.amount > 0) ? (
              <ResponsiveContainer width="100%" height={TREND_H}>
                <AreaChart
                  data={spendSeries}
                  margin={{ top: 16, right: 16, left: 4, bottom: 8 }}
                >
                  <defs>
                    <linearGradient id="financeSpendFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#1F3A6D" stopOpacity={0.3} />
                      <stop offset="100%" stopColor="#1F3A6D" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="#EEF2F7" vertical={false} strokeDasharray="3 6" />
                  <XAxis
                    dataKey="month"
                    {...AXIS}
                    interval={0}
                    tickMargin={8}
                  />
                  <YAxis
                    {...AXIS}
                    width={56}
                    tickFormatter={formatCurrencyCompact}
                  />
                  <Tooltip
                    cursor={{ stroke: "#1F3A6D", strokeWidth: 1, strokeDasharray: "4 4" }}
                    contentStyle={{
                      ...TOOLTIP,
                      borderRadius: 12,
                      padding: "12px 14px",
                    }}
                    formatter={(v: number, _name, item) => {
                      const mom = (item?.payload as { momPct?: number | null })
                        ?.momPct;
                      const label =
                        mom != null && Number.isFinite(mom)
                          ? `Spend (${mom >= 0 ? "+" : ""}${mom.toFixed(1)}% MoM)`
                          : "Monthly spend";
                      return [formatCurrency(v), label];
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
                    isAnimationActive
                    animationDuration={900}
                    animationEasing="ease-out"
                    dot={{ r: 3, fill: "#1F3A6D", strokeWidth: 0 }}
                    activeDot={{
                      r: 5,
                      fill: "#1F3A6D",
                      stroke: "#fff",
                      strokeWidth: 2,
                    }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="grid h-[340px] place-items-center text-[13px] text-[#98A2B3]">
                Waiting for invoiced spend data
              </div>
            )}
          </div>
        </div>

        <div className={`${PANEL} finance-panel--payment`}>
          <PanelHeader
            title="Payment Status"
            subtitle="Paid vs open payables by urgency"
            icon={CreditCard}
            to="/p2p/payments"
          />
          <div className="flex min-h-0 flex-1 flex-col px-4 pb-4 pt-1 sm:px-5">
            {payablesQuery.isError && paymentsQuery.isError ? (
              <DashboardWidgetError
                title="Payment status unavailable"
                error={payablesQuery.error ?? paymentsQuery.error}
                className="min-h-[210px] border-0 shadow-none"
                onRetry={() => {
                  void payablesQuery.refetch();
                  void paymentsQuery.refetch();
                }}
              />
            ) : payablesLoading && paymentsQuery.isPending ? (
              <Skeleton className="mx-auto h-[180px] w-[180px] rounded-full" />
            ) : paymentStatusHasData ? (
              <>
                <ResponsiveContainer width="100%" height={DONUT_H}>
                  <PieChart>
                    <Pie
                      data={paymentStatus.filter((s) => s.value > 0)}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      innerRadius={66}
                      outerRadius={96}
                      paddingAngle={2.5}
                      isAnimationActive
                      animationDuration={800}
                    >
                      {paymentStatus
                        .filter((s) => s.value > 0)
                        .map((entry) => (
                          <Cell key={entry.name} fill={entry.color} />
                        ))}
                    </Pie>
                    <Tooltip
                      formatter={(v: number, name: string) => [
                        formatCurrency(v),
                        name,
                      ]}
                      contentStyle={{
                        ...TOOLTIP,
                        borderRadius: 12,
                        padding: "10px 12px",
                      }}
                    />
                  </PieChart>
                </ResponsiveContainer>
                <ul className="finance-payment-legend">
                  {paymentStatus.map((s) => (
                    <li key={s.name}>
                      <span
                        className="finance-payment-legend__swatch"
                        style={{ backgroundColor: s.color }}
                      />
                      <span className="finance-payment-legend__label">
                        {s.name}
                      </span>
                      <span
                        className="finance-payment-legend__value"
                        title={formatCurrency(s.value)}
                      >
                        {formatCurrencyCompact(s.value)}
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <div className="grid flex-1 place-items-center py-10 text-[13px] text-[#98A2B3]">
                No payment status data
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Section 2 — Pending Invoice Queue + Recent Finance Activity */}
      <div className="finance-dashboard-grid__pair">
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
              <table className="w-full min-w-[480px] text-left text-sm">
                <thead className="sticky top-0 bg-[#F8FAFC] text-[10px] font-semibold uppercase tracking-wider text-[#64748B]">
                  <tr>
                    <th className="px-4 py-2.5">GRN</th>
                    <th className="px-3 py-2.5">Supplier</th>
                    <th className="px-3 py-2.5 text-right">Amount</th>
                    <th className="px-3 py-2.5">Date</th>
                    <th className="px-4 py-2.5 text-right">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {pendingGrns.slice(0, 8).map((g) => (
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
                      <td className="px-4 py-2.5 text-right">
                        <Link
                          to={`/p2p/grn/${encodeURIComponent(g.name)}`}
                          className="text-[12px] font-semibold text-[#1F3A6D] no-underline hover:underline"
                        >
                          Create
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className={PANEL}>
          <PanelHeader
            title="Recent Finance Activity"
            subtitle="RFQ financial review timeline"
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
              {(historyQuery.data ?? []).map((row, idx, arr) => (
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

      {/* Section 3 — Budget vs Actual + Upcoming Due Payments */}
      <div className="finance-dashboard-grid__pair">
        <div className={PANEL}>
          <PanelHeader
            title="Budget vs Actual"
            subtitle="Top budgets · allocated vs spent"
            icon={FileText}
            to="/budget"
          />
          <div className="min-h-0 flex-1 px-4 pb-5 pt-2 sm:px-5">
            {analyticsQuery.isError ? (
              <DashboardWidgetError
                title="Budget data unavailable"
                error={analyticsQuery.error}
                className="min-h-[300px] border-0 shadow-none"
                onRetry={() => void analyticsQuery.refetch()}
              />
            ) : analyticsLoading ? (
              <Skeleton className="h-[300px] w-full rounded-xl" />
            ) : budgetVsActual.length > 0 ? (
              <ResponsiveContainer width="100%" height={BUDGET_H}>
                <BarChart
                  data={budgetVsActual}
                  margin={{ top: 8, right: 10, left: 0, bottom: 8 }}
                >
                  <CartesianGrid stroke="#EEF2F7" vertical={false} />
                  <XAxis
                    dataKey="name"
                    {...AXIS}
                    interval={0}
                    height={36}
                    angle={-12}
                    textAnchor="end"
                  />
                  <YAxis {...AXIS} width={40} tickFormatter={formatCurrencyCompact} />
                  <Tooltip
                    contentStyle={TOOLTIP}
                    formatter={(v: number) => formatCurrency(v)}
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
              <div className="grid h-[280px] place-items-center text-[13px] text-[#98A2B3]">
                No budget data available
              </div>
            )}
          </div>
        </div>

        <div className={PANEL}>
          <PanelHeader
            title="Upcoming Due Payments"
            subtitle="Outstanding invoices sorted by due date"
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

      {/* Section 4 — Recent Financial Transactions (full width) */}
      <div className={PANEL}>
        <PanelHeader
          title="Recent Financial Transactions"
          subtitle="Latest submitted payments and purchase invoices"
          icon={Receipt}
          to="/p2p/payments"
        />
        {paymentsQuery.isPending && invoicesQuery.isPending ? (
          <div className="space-y-2 p-5">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-10 rounded-lg" />
            ))}
          </div>
        ) : transactions.length === 0 ? (
          <div className="flex flex-1 items-center justify-center px-6 py-10 text-[13px] text-[#64748B]">
            No recent financial transactions
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead>
                <tr className="border-b border-[#EEF2F7] text-[10px] font-semibold uppercase tracking-wider text-[#64748B]">
                  <th className="px-5 py-2.5">Date</th>
                  <th className="px-3 py-2.5">Type</th>
                  <th className="px-3 py-2.5">Reference</th>
                  <th className="px-3 py-2.5">Party</th>
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
                            : "bg-[#EEF3FA] text-[#1F3A6D]"
                        }`}
                      >
                        {tx.type}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 font-semibold text-[#1E293B]">
                      {tx.reference}
                    </td>
                    <td className="max-w-[160px] truncate px-3 py-2.5 text-[#475569]">
                      {tx.party}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums font-medium text-[#1E293B]">
                      {formatCurrency(tx.amount)}
                    </td>
                    <td className="px-3 py-2.5 text-[#64748B]">{tx.status}</td>
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
                  : `Due in ${d}d`
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
        ? "Pending review"
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
