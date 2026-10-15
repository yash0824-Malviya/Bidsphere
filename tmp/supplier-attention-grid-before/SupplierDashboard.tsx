import { Children, useMemo, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowRight,
  Bell,
  CheckCircle2,
  Circle,
  ClipboardList,
  FileText,
  Gavel,
  Inbox,
  Loader2,
  Package,
  Receipt,
  RefreshCw,
  Send,
  Truck,
  Upload,
  Wallet,
  type LucideIcon,
} from "lucide-react";

import {
  getSupplierDashboardData,
  countActivePOs,
  type RFQRow,
} from "../../api/supplierPortal";
import { portalGetProfile } from "../../api/supplierOnboarding";
import {
  deriveAuctionStatus,
  getSupplierAuctions,
} from "../../api/reverseBidding";
import {
  deriveSupplierRfiFacingStatus,
  getSupplierRFIs,
} from "../../api/rfi";
import { APP_SUPPLIER_PORTAL } from "../../config/branding";
import { Skeleton } from "../../components/Skeleton";
import "./SupplierDashboard.css";
import { formatCurrency, formatDate } from "../../utils/format";
import { parseRfqMessage } from "../../utils/rfqMessage";
import {
  useSupplierSession,
  writeSupplierSession,
  readSupplierSession,
} from "../../hooks/useSupplierSession";

/* ─── Helpers (UI derivation only — no API changes) ──────────────────────── */

function ChecklistItem({
  label,
  state,
}: {
  label: string;
  state: "done" | "pending" | "missing";
}) {
  const color =
    state === "done"
      ? "text-emerald-700"
      : state === "pending"
        ? "text-amber-700"
        : "text-rose-600";
  return (
    <li className={`flex items-center gap-2 text-sm ${color}`}>
      {state === "done" ? (
        <CheckCircle2 className="h-4 w-4 shrink-0" />
      ) : (
        <Circle className="h-4 w-4 shrink-0" />
      )}
      {label}
    </li>
  );
}

function isPublishedRfq(rfq: RFQRow): boolean {
  return rfq.docstatus === 1 && rfq.status !== "Cancelled";
}

/* ─── Page ───────────────────────────────────────────────────────────────── */

export default function SupplierDashboard() {
  const {
    supplierName,
    erpSupplierName,
    isReady,
    isAuthenticated,
    unlocked,
    displayStatus,
    sessionToken,
  } = useSupplierSession();

  const profileQuery = useQuery({
    queryKey: ["portal-profile", sessionToken],
    queryFn: async () => {
      const res = await portalGetProfile(sessionToken);
      const current = readSupplierSession();
      if (current) {
        writeSupplierSession({
          ...current,
          unlocked: !!res.unlocked,
          displayStatus: res.display_status,
          linkedSupplier: res.linked_supplier || current.linkedSupplier,
          companyName: res.company_name || current.companyName,
          firstLogin: !!res.first_login,
        });
      }
      return res;
    },
    enabled: isAuthenticated && !!sessionToken,
    retry: 1,
  });

  const dashQuery = useQuery({
    queryKey: ["supplier-portal-dashboard", erpSupplierName],
    queryFn: () => getSupplierDashboardData(erpSupplierName),
    enabled: isAuthenticated && unlocked && !!erpSupplierName,
    retry: 1,
  });

  const auctionsQuery = useQuery({
    queryKey: ["supplier-portal-auctions-kpi", erpSupplierName],
    queryFn: () => getSupplierAuctions(erpSupplierName),
    enabled: isAuthenticated && unlocked && !!erpSupplierName,
    retry: 1,
    refetchInterval: 2_000,
    staleTime: 1_000,
    refetchOnWindowFocus: true,
  });

  const rfiQuery = useQuery({
    queryKey: ["supplier-portal-rfis", erpSupplierName],
    queryFn: () => getSupplierRFIs(erpSupplierName),
    enabled: isAuthenticated && unlocked && !!erpSupplierName,
    staleTime: 15_000,
    refetchOnMount: "always",
  });

  if (!isReady || !isAuthenticated) return null;

  const record = profileQuery.data?.record;
  const docs = record?.documents ?? [];
  const hasGst = docs.some((d) => /gst/i.test(String(d.document_type || "")));
  const hasPan = docs.some((d) => /pan/i.test(String(d.document_type || "")));
  const hasBank = !!(record?.bank_name || record?.bank_account_number);
  const progressSteps = [
    !!record?.company_name,
    !!record?.contact_person,
    !!(record?.years_in_business || record?.annual_turnover),
    hasBank,
    docs.length > 0,
    ["Submitted", "Under Review", "Approved"].includes(String(record?.status)),
  ];
  const progress = Math.round(
    (progressSteps.filter(Boolean).length / progressSteps.length) * 100,
  );

  const status = profileQuery.data?.display_status || displayStatus;

  /* ── Locked / onboarding ──────────────────────────────────────────────── */

  if (!unlocked) {
    return (
      <>
        <div className="flex w-full flex-col gap-6">
          <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-[#F8FAFC] p-6 shadow-sm sm:p-7">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              {APP_SUPPLIER_PORTAL}
            </p>
            <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
              Welcome, {supplierName}
            </h1>
            <p className="mt-2 max-w-xl text-sm text-slate-600">
              Complete your onboarding to unlock RFQs, auctions, purchase orders, and finance.
            </p>
            <p className="mt-3 text-xs font-semibold uppercase tracking-wider text-slate-400">
              Estimated time · 10 minutes
            </p>
            <Link
              to="/supplier/profile"
              className="mt-4 inline-flex items-center gap-2 rounded-xl bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white shadow-sm no-underline transition hover:bg-slate-800"
            >
              Start Onboarding <ArrowRight className="h-4 w-4" />
            </Link>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="font-semibold text-slate-900">Progress</h2>
                {profileQuery.isLoading ? (
                  <Skeleton className="h-4 w-10" />
                ) : (
                  <span className="text-sm font-semibold text-slate-700">{progress}%</span>
                )}
              </div>
              {profileQuery.isLoading ? (
                <Skeleton className="h-2 w-full rounded-full" />
              ) : (
                <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                  <div
                    className="h-full rounded-full bg-emerald-500 transition-all"
                    style={{ width: `${progress}%` }}
                  />
                </div>
              )}
              <p className="mt-3 text-xs text-slate-500">
                Company · Contact · Business · Bank · Documents · Review
              </p>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="mb-3 flex items-center gap-2 font-semibold text-slate-900">
                <ClipboardList className="h-4 w-4" /> Checklist
              </h2>
              {profileQuery.isLoading ? (
                <div className="space-y-2">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <Skeleton key={i} className="h-4 w-3/4" />
                  ))}
                </div>
              ) : (
                <ul className="space-y-2">
                  <ChecklistItem
                    label="Company Details"
                    state={record?.company_name ? "done" : "missing"}
                  />
                  <ChecklistItem label="GST Uploaded" state={hasGst ? "done" : "pending"} />
                  <ChecklistItem label="PAN Uploaded" state={hasPan ? "done" : "pending"} />
                  <ChecklistItem label="Bank Details" state={hasBank ? "done" : "missing"} />
                  <ChecklistItem
                    label="Documents"
                    state={docs.length ? "done" : "pending"}
                  />
                  <ChecklistItem
                    label="Review / Submit"
                    state={
                      ["Submitted", "Under Review", "Approved"].includes(String(record?.status))
                        ? "done"
                        : "pending"
                    }
                  />
                </ul>
              )}
            </div>
          </div>

          {["Submitted", "Under Review"].includes(String(record?.status)) && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              Waiting for Procurement Approval
            </div>
          )}
        </div>
      </>
    );
  }

  return (
    <UnlockedDashboard
      supplierName={supplierName}
      status={status || "Approved"}
      dashQuery={dashQuery}
      auctionsQuery={auctionsQuery}
      rfiQuery={rfiQuery}
      isRefreshing={profileQuery.isFetching || dashQuery.isFetching || rfiQuery.isFetching}
      onRefresh={() => {
        if (isAuthenticated && sessionToken) void profileQuery.refetch();
        if (isAuthenticated && unlocked && erpSupplierName) {
          void dashQuery.refetch();
          void auctionsQuery.refetch();
          void rfiQuery.refetch();
        }
      }}
    />
  );
}

/* ─── Unlocked enterprise dashboard ──────────────────────────────────────── */

function UnlockedDashboard({
  supplierName,
  status,
  dashQuery,
  auctionsQuery,
  rfiQuery,
  isRefreshing,
  onRefresh,
}: {
  supplierName: string;
  status: string;
  dashQuery: ReturnType<typeof useQuery<Awaited<ReturnType<typeof getSupplierDashboardData>>>>;
  auctionsQuery: ReturnType<typeof useQuery<Awaited<ReturnType<typeof getSupplierAuctions>>>>;
  rfiQuery: ReturnType<typeof useQuery<Awaited<ReturnType<typeof getSupplierRFIs>>>>;
  isRefreshing: boolean;
  onRefresh: () => void;
}) {
  const data = dashQuery.data;
  const rfqs = data?.rfqs ?? [];
  const quotations = data?.quotations ?? [];
  const pos = data?.pos ?? [];
  const pendingPaymentsCount = data?.pendingPayments ?? 0;

  const submittedCount = quotations.filter((sq) =>
    /submit/i.test(String(sq.status || "")),
  ).length;
  const activePOsCount = countActivePOs(pos);
  const liveAuctions = (auctionsQuery.data ?? []).filter(
    (a) => deriveAuctionStatus(a) === "Live",
  ).length;

  const publishedRfqs = useMemo(() => rfqs.filter(isPublishedRfq), [rfqs]);
  const awaitingCount = Math.max(0, publishedRfqs.length - submittedCount);

  const pendingTasks = awaitingCount + pendingPaymentsCount + liveAuctions;

  const recentRfqs = useMemo(
    () =>
      [...rfqs]
        .sort(
          (a, b) =>
            new Date(b.modified || b.transaction_date || 0).getTime() -
            new Date(a.modified || a.transaction_date || 0).getTime(),
        )
        .slice(0, 5),
    [rfqs],
  );
  const recentOrders = useMemo(
    () =>
      [...pos]
        .sort(
          (a, b) =>
            new Date(b.modified || b.transaction_date || 0).getTime() -
            new Date(a.modified || a.transaction_date || 0).getTime(),
        )
        .slice(0, 5),
    [pos],
  );

  const rfiRows = rfiQuery.data ?? [];
  const rfiFacing = rfiRows.map((r) => deriveSupplierRfiFacingStatus(r));
  const rfiKpis: Array<{
    title: string;
    value: number;
    icon: LucideIcon;
    iconWrap: string;
    to: string;
  }> = [
    {
      title: "Draft",
      value: rfiFacing.filter((s) => s === "Draft").length,
      icon: ClipboardList,
      iconWrap: "bg-slate-100 text-slate-600 ring-slate-200",
      to: "/supplier/rfis",
    },
    {
      title: "Submitted",
      value: rfiFacing.filter((s) => s === "Submitted" || s === "Under Review")
        .length,
      icon: Send,
      iconWrap: "bg-blue-50 text-blue-700 ring-blue-100",
      to: "/supplier/rfis",
    },
    {
      title: "Approved",
      value: rfiFacing.filter((s) => s === "Approved").length,
      icon: CheckCircle2,
      iconWrap: "bg-emerald-50 text-emerald-700 ring-emerald-100",
      to: "/supplier/rfis",
    },
    {
      title: "Rejected",
      value: rfiFacing.filter((s) => s === "Rejected").length,
      icon: Bell,
      iconWrap: "bg-rose-50 text-rose-700 ring-rose-100",
      to: "/supplier/rfis",
    },
  ];

  const kpis: Array<{
    title: string;
    description: string;
    value: number;
    icon: LucideIcon;
    iconWrap: string;
    to: string;
  }> = [
    {
      title: "Total RFQs",
      description: "RFQs received",
      value: rfqs.length,
      icon: FileText,
      iconWrap: "bg-blue-50 text-blue-700 ring-blue-100",
      to: "/supplier/rfqs",
    },
    {
      title: "Awaiting Response",
      description: "RFQs requiring action",
      value: awaitingCount,
      icon: Inbox,
      iconWrap: "bg-amber-50 text-amber-700 ring-amber-100",
      to: "/supplier/rfqs",
    },
    {
      title: "Submitted Quotations",
      description: "Submitted responses",
      value: submittedCount,
      icon: Send,
      iconWrap: "bg-emerald-50 text-emerald-700 ring-emerald-100",
      to: "/supplier/quotations",
    },
    {
      title: "Active Purchase Orders",
      description: "Active supplier orders",
      value: activePOsCount,
      icon: Package,
      iconWrap: "bg-blue-50 text-blue-700 ring-blue-100",
      to: "/supplier/purchase-orders",
    },
    {
      title: "Pending Payments",
      description: "Payments awaiting processing",
      value: pendingPaymentsCount,
      icon: Wallet,
      iconWrap: "bg-violet-50 text-violet-700 ring-violet-100",
      to: "/supplier/payments",
    },
    {
      title: "Live Auctions",
      description: "Auctions live now",
      value: liveAuctions,
      icon: Gavel,
      iconWrap: "bg-blue-50 text-blue-700 ring-blue-100",
      to: "/supplier/auctions",
    },
  ];

  const quickActions: Array<{
    label: string;
    to: string;
    icon: LucideIcon;
  }> = [
    {
      label: "Create Quotation",
      to: "/supplier/rfqs",
      icon: FileText,
    },
    {
      label: "View RFQs",
      to: "/supplier/rfqs",
      icon: Inbox,
    },
    {
      label: "Upload Documents",
      to: "/supplier/profile?tab=documents",
      icon: Upload,
    },
    {
      label: "View Contracts",
      to: "/supplier/contracts",
      icon: ClipboardList,
    },
    {
      label: "Track Orders",
      to: "/supplier/delivery-schedule",
      icon: Truck,
    },
    {
      label: "View Invoices",
      to: "/supplier/invoices",
      icon: Receipt,
    },
  ];

  // Reuse the dashboard's loaded counts; no additional workflow queries.
  const attentionItems = [
    {
      title: "RFQs Awaiting Response",
      description: "RFQs received from procurement that require your response.",
      count: awaitingCount,
      icon: Inbox,
      to: "/supplier/rfqs",
      action: "View RFQs",
      tone: "pending",
    },
    {
      title: "Pending payments",
      description: "Track the status of outstanding payments.",
      count: pendingPaymentsCount,
      icon: Wallet,
      to: "/supplier/payments",
      action: "Review payment status",
      tone: "neutral",
    },
    {
      title: "Live auctions",
      description: "View bidding activity in your live auctions.",
      count: liveAuctions,
      icon: Gavel,
      to: "/supplier/auctions",
      action: "View live auctions",
      tone: "neutral",
    },
  ].filter((item) => item.count > 0);

  return (
    <div className="supplier-dashboard">
      <div className="spd-main">
        <header className="spd-hero">
          <div className="min-w-0">
            <h1 className="spd-hero-title">Supplier Dashboard</h1>
            <p className="spd-hero-welcome">Welcome back, {supplierName}</p>
            <p className="spd-hero-sub">
              Manage RFQs, quotations, contracts, purchase orders and payments from one place.
            </p>
          </div>
          <div className="spd-hero-stats">
            <div className="spd-hero-stat">
              <p className="spd-hero-stat-label">Pending Tasks</p>
              {dashQuery.isLoading || auctionsQuery.isLoading ? (
                <Skeleton className="mt-1 h-5 w-8" />
              ) : (
                <p className="spd-hero-stat-value">{pendingTasks}</p>
              )}
            </div>
            <div className="spd-hero-stat">
              <p className="spd-hero-stat-label">Account Status</p>
              <p className="spd-hero-stat-value is-status" data-status={status}>
                <span aria-hidden="true" />{status}
              </p>
            </div>
            <button type="button" className="spd-refresh" onClick={onRefresh} disabled={isRefreshing}>
              <RefreshCw className={isRefreshing ? "animate-spin" : undefined} aria-hidden="true" />
              {isRefreshing ? "Refreshing" : "Refresh"}
            </button>
          </div>
        </header>

        {/* RFQ Summary KPIs */}
        <section className="spd-kpis spd-primary-kpis" aria-label="Supplier overview">
          <div className="spd-section-head">
            <h2 className="spd-section-title">Supplier Overview</h2>
          </div>
          <div className="spd-kpi-grid spd-kpi-grid--primary">
            {dashQuery.isLoading || auctionsQuery.isLoading
              ? Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="spd-metric" aria-hidden="true">
                    <Skeleton className="h-4 w-20" />
                    <Skeleton className="mt-5 h-9 w-12" />
                  </div>
                ))
              : kpis.map((kpi) => (
                  <SupplierMetric
                    key={kpi.title}
                    {...kpi}
                  />
                ))}
          </div>
          {/* RFI Overview */}
          <div className="spd-kpis spd-rfi-kpis">
            <div className="spd-section-head">
              <h3 className="spd-secondary-title">RFI Overview</h3>
              <Link to="/supplier/rfis" className="spd-section-link">
                View all RFIs <ArrowRight aria-hidden="true" />
              </Link>
            </div>
            <div className="spd-kpi-grid spd-kpi-grid--rfi">
              {rfiQuery.isLoading
                ? Array.from({ length: 4 }).map((_, i) => (
                    <div key={i} className="spd-rfi-metric" aria-hidden="true">
                      <Skeleton className="h-4 w-20" />
                      <Skeleton className="h-7 w-8" />
                    </div>
                  ))
                : rfiKpis.map((kpi) => (
                    <SupplierMetric
                      key={kpi.title}
                      {...kpi}
                      compact
                    />
                  ))}
            </div>
          </div>
        </section>

        {!dashQuery.isLoading && !auctionsQuery.isLoading && attentionItems.length > 0 && (
          <section aria-labelledby="supplier-attention-title">
            <div className="spd-section-head">
              <h2 id="supplier-attention-title" className="spd-section-title">Requires Your Attention</h2>
            </div>
            <div className="spd-attention-grid">
              {attentionItems.map(({ title, description, count, icon: Icon, to, action, tone }) => (
                <Link key={title} to={to} className="spd-attention-card" data-tone={tone}>
                  <div className="spd-attention-top">
                    <span className="spd-attention-icon" aria-hidden="true"><Icon /></span>
                    <span className="spd-attention-count">{count}</span>
                  </div>
                  <div className="spd-attention-copy">
                    <h3>{title}</h3>
                    <p>{description}</p>
                  </div>
                  <span className="spd-attention-action">{action} <ArrowRight aria-hidden="true" /></span>
                </Link>
              ))}
            </div>
          </section>
        )}

        {/* Quick Actions */}
        <section className="spd-actions">
          <div className="spd-section-head">
            <h2 className="spd-section-title">Quick Actions</h2>
            <span className="spd-section-caption">
              Common supplier workflows
            </span>
          </div>
          <div className="spd-actions-grid">
            {quickActions.map((qa) => {
              const Icon = qa.icon;
              return (
                <Link key={qa.label} to={qa.to} className="spd-action">
                  <span className="spd-action-icon" aria-hidden="true">
                    <Icon />
                  </span>
                  <span className="spd-action-label">{qa.label}</span>
                </Link>
              );
            })}
          </div>
        </section>

        {/* Recent Activity — Recent RFQs | Recent Orders */}
        <section>
          <div className="spd-section-head">
            <h2 className="spd-section-title">Recent Activity</h2>
            {dashQuery.isFetching && (
              <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-400" />
            )}
          </div>
          <div className="spd-recent-grid">
            <RecentPanel
              title="Recent RFQs"
              viewAll="/supplier/rfqs"
              loading={dashQuery.isLoading}
              empty="No RFQs yet"
            >
              {recentRfqs.map((rfq) => {
                const title = parseRfqMessage(rfq.message_for_supplier).title
                  || (rfq.message_for_supplier ?? "").trim();
                return (
                <li key={rfq.name}>
                  <Link
                    to={`/supplier/rfq/${encodeURIComponent(rfq.name)}`}
                    className="spd-list-item"
                  >
                    <div className="min-w-0">
                      <p className="spd-list-primary">{rfq.name}</p>
                      {title && <p className="spd-list-description" title={title}>{title}</p>}
                      <div className="spd-list-secondary">
                        <ActivityStatus status={rfq.status || "Open"} />
                        {rfq.company && <span>{rfq.company}</span>}
                      </div>
                    </div>
                    <div className="spd-list-end">
                      <span className="spd-list-meta">{rfq.transaction_date
                        ? formatDate(rfq.transaction_date)
                        : "—"}</span>
                      <span className="spd-list-open">Open <ArrowRight aria-hidden="true" /></span>
                    </div>
                  </Link>
                </li>
                );
              })}
            </RecentPanel>

            <RecentPanel
              title="Recent Orders"
              viewAll="/supplier/purchase-orders"
              loading={dashQuery.isLoading}
              empty="No purchase orders yet"
            >
              {recentOrders.map((po) => (
                <li key={po.name}>
                  <Link
                    to={`/supplier/po/${encodeURIComponent(po.name)}`}
                    className="spd-list-item"
                  >
                    <div className="min-w-0">
                      <p className="spd-list-primary">{po.name}</p>
                      <p className="spd-list-description">Supplier order · {formatCurrency(po.grand_total)}</p>
                      <div className="spd-list-secondary">
                        <ActivityStatus status={po.status || "—"} />
                      </div>
                    </div>
                    <div className="spd-list-end">
                      <span className="spd-list-meta">{po.transaction_date
                        ? formatDate(po.transaction_date)
                        : "—"}</span>
                      <span className="spd-list-open">Open <ArrowRight aria-hidden="true" /></span>
                    </div>
                  </Link>
                </li>
              ))}
            </RecentPanel>
          </div>
        </section>
      </div>
    </div>
  );
}

function SupplierMetric({
  title, description, value, icon: Icon, iconWrap, to, compact = false,
}: {
  title: string;
  description?: string;
  value: number;
  icon: LucideIcon;
  iconWrap: string;
  to: string;
  compact?: boolean;
}) {
  return (
    <Link to={to} className={compact ? "spd-rfi-metric" : "spd-metric"}>
      <span className={`spd-metric-icon ${iconWrap}`} aria-hidden="true"><Icon /></span>
      <span className="spd-metric-label">{title}</span>
      <span className="spd-metric-value">{value}</span>
      {description && <span className="spd-metric-description">{description}</span>}
    </Link>
  );
}

function ActivityStatus({ status }: { status: string }) {
  // Presentation only; the original backend status is always displayed verbatim.
  const tone = /^(approved|completed|paid|closed)$/i.test(status)
    ? "success"
    : /reject|cancel/i.test(status)
      ? "danger"
      : /pending|await|to receive|to bill|review/i.test(status)
        ? "pending"
        : /^(submitted|open)$/i.test(status)
          ? "info"
          : "neutral";
  return <span className="spd-activity-status" data-tone={tone}>{status}</span>;
}

function RecentPanel({
  title,
  viewAll,
  loading,
  empty,
  children,
}: {
  title: string;
  viewAll: string;
  loading: boolean;
  empty: string;
  children: ReactNode;
}) {
  const hasItems = Children.count(children) > 0;

  return (
    <div className="spd-panel">
      <div className="spd-panel-head">
        <h3 className="spd-panel-title">{title}</h3>
        <Link to={viewAll} className="spd-section-link" aria-label={`View all ${title === "Recent RFQs" ? "RFQs" : "orders"}`}>
          View all <ArrowRight aria-hidden="true" />
        </Link>
      </div>
      {loading ? (
        <div className="space-y-2 p-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-9 w-full rounded-md" />
          ))}
        </div>
      ) : !hasItems ? (
        <div className="spd-empty">{empty}</div>
      ) : (
        <ul className="spd-list">{children}</ul>
      )}
    </div>
  );
}
