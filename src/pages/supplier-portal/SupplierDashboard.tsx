import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowRight,
  Bell,
  CheckCircle2,
  Circle,
  ClipboardList,
  CreditCard,
  FileText,
  Gavel,
  Inbox,
  Loader2,
  Package,
  Send,
  Sparkles,
  TrendingUp,
  Truck,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import {
  getSupplierDashboardData,
  countActivePOs,
  type PORow,
  type RFQRow,
  type SQRow,
} from "../../api/supplierPortal";
import { portalGetProfile } from "../../api/supplierOnboarding";
import {
  deriveAuctionStatus,
  getSupplierAuctions,
} from "../../api/reverseBidding";
import { getSupplierPerformance } from "../../api/supplierPerformance";
import { getNotificationsForViewer } from "../../api/notifications";
import { APP_SUPPLIER_PORTAL, COMPANY_NAME } from "../../config/branding";
import { Skeleton, TableSkeleton } from "../../components/Skeleton";
import { formatCurrency, formatDate, formatDateTime } from "../../utils/format";
import {
  useSupplierSession,
  writeSupplierSession,
  readSupplierSession,
} from "../../hooks/useSupplierSession";
import SupplierPortalLayout from "./SupplierPortalLayout";

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

function rfqPriority(rfq: RFQRow): "Critical" | "High" | "Normal" {
  const due = rfq.valid_till || rfq.transaction_date;
  if (due) {
    const days =
      (new Date(due).getTime() - Date.now()) / (1000 * 60 * 60 * 24);
    if (!Number.isNaN(days)) {
      if (days <= 2) return "Critical";
      if (days <= 7) return "High";
    }
  }
  // Published invitations without a due date still need attention.
  return isPublishedRfq(rfq) ? "High" : "Normal";
}

function priorityClass(priority: string) {
  if (priority === "Critical") return "bg-rose-50 text-rose-700 ring-rose-200";
  if (priority === "High") return "bg-amber-50 text-amber-800 ring-amber-200";
  return "bg-slate-50 text-slate-600 ring-slate-200";
}

function statusTone(status?: string) {
  const s = (status || "").toLowerCase();
  if (s.includes("submit") || s.includes("open"))
    return "bg-sky-50 text-sky-800 ring-sky-200";
  if (s.includes("draft")) return "bg-slate-50 text-slate-600 ring-slate-200";
  if (s.includes("cancel") || s.includes("clos"))
    return "bg-neutral-100 text-neutral-600 ring-neutral-200";
  return "bg-emerald-50 text-emerald-700 ring-emerald-200";
}

function monthKey(iso?: string): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(key: string): string {
  const [y, m] = key.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleString(undefined, {
    month: "short",
    year: "2-digit",
  });
}

function buildMonthlyOverview(pos: PORow[], quotations: SQRow[]) {
  const map = new Map<string, { month: string; orders: number; quotes: number; value: number }>();
  const ensure = (key: string) => {
    if (!map.has(key)) {
      map.set(key, { month: monthLabel(key), orders: 0, quotes: 0, value: 0 });
    }
    return map.get(key)!;
  };

  for (const po of pos) {
    const key = monthKey(po.transaction_date || po.modified);
    if (!key) continue;
    const row = ensure(key);
    row.orders += 1;
    row.value += Number(po.grand_total || 0);
  }
  for (const sq of quotations) {
    const key = monthKey(sq.transaction_date || sq.modified);
    if (!key) continue;
    ensure(key).quotes += 1;
  }

  // Last 6 calendar months for a stable axis
  const out: Array<{ month: string; orders: number; quotes: number; value: number }> = [];
  const now = new Date();
  for (let i = 5; i >= 0; i -= 1) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    out.push(map.get(key) ?? { month: monthLabel(key), orders: 0, quotes: 0, value: 0 });
  }
  return out;
}

type ActivityItem = {
  id: string;
  title: string;
  detail: string;
  at: string;
  tone: "info" | "success" | "warning" | "neutral";
};

function buildActivity(
  rfqs: RFQRow[],
  quotations: SQRow[],
  pos: PORow[],
): ActivityItem[] {
  const items: ActivityItem[] = [];
  for (const r of rfqs.slice(0, 8)) {
    items.push({
      id: `rfq-${r.name}`,
      title: "RFQ invitation",
      detail: r.name,
      at: r.modified || r.transaction_date || "",
      tone: r.docstatus === 1 ? "warning" : "neutral",
    });
  }
  for (const q of quotations.slice(0, 8)) {
    items.push({
      id: `sq-${q.name}`,
      title: q.status === "Submitted" ? "Quotation submitted" : "Quotation updated",
      detail: q.name,
      at: q.modified || q.transaction_date || "",
      tone: "success",
    });
  }
  for (const p of pos.slice(0, 8)) {
    items.push({
      id: `po-${p.name}`,
      title: "Purchase order",
      detail: `${p.name}${p.status ? ` · ${p.status}` : ""}`,
      at: p.modified || p.transaction_date || "",
      tone: "info",
    });
  }
  return items
    .filter((i) => i.at)
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
    .slice(0, 8);
}

function activityDot(tone: ActivityItem["tone"]) {
  if (tone === "success") return "bg-emerald-500";
  if (tone === "warning") return "bg-amber-500";
  if (tone === "info") return "bg-sky-500";
  return "bg-slate-400";
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

  const performanceQuery = useQuery({
    queryKey: ["supplier-portal-performance", erpSupplierName],
    queryFn: async () => {
      const map = await getSupplierPerformance([erpSupplierName]);
      return map[erpSupplierName] ?? Object.values(map)[0] ?? null;
    },
    enabled: isAuthenticated && unlocked && !!erpSupplierName,
    retry: 1,
  });

  const notificationsQuery = useQuery({
    queryKey: ["supplier-portal-notifications", erpSupplierName],
    queryFn: () =>
      getNotificationsForViewer({
        role: "supplier",
        supplierId: erpSupplierName,
        userEmail: readSupplierSession()?.portalUser,
      }).slice(0, 8),
    enabled: isAuthenticated && unlocked && !!erpSupplierName,
    staleTime: 30_000,
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
      <SupplierPortalLayout
        supplierName={supplierName}
        statusBadge={status}
        unlocked={false}
      >
        <div className="mx-auto max-w-5xl space-y-4 px-4 py-5 sm:px-6">
          <div
            className="overflow-hidden rounded-2xl border border-slate-200 p-6 text-white shadow-sm sm:p-7"
            style={{
              background:
                "linear-gradient(135deg, #0B3D91 0%, #146CE8 55%, #3B82F6 100%)",
            }}
          >
            <p className="text-xs font-semibold uppercase tracking-wider text-blue-100">
              {APP_SUPPLIER_PORTAL}
            </p>
            <h1 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">
              Welcome, {supplierName}
            </h1>
            <p className="mt-2 max-w-xl text-sm text-blue-50/95">
              Complete your onboarding to unlock RFQs, auctions, purchase orders, and finance.
            </p>
            <p className="mt-3 text-xs font-semibold uppercase tracking-wider text-blue-100/90">
              Estimated time · 10 minutes
            </p>
            <Link
              to="/supplier/profile"
              className="mt-4 inline-flex items-center gap-2 rounded-xl bg-white px-5 py-2.5 text-sm font-bold text-[#146CE8] shadow-lg no-underline"
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
      </SupplierPortalLayout>
    );
  }

  return (
    <UnlockedDashboard
      supplierName={supplierName}
      status={status || "Approved"}
      dashQuery={dashQuery}
      auctionsQuery={auctionsQuery}
      performanceQuery={performanceQuery}
      notificationsQuery={notificationsQuery}
    />
  );
}

/* ─── Unlocked enterprise dashboard ──────────────────────────────────────── */

function UnlockedDashboard({
  supplierName,
  status,
  dashQuery,
  auctionsQuery,
  performanceQuery,
  notificationsQuery,
}: {
  supplierName: string;
  status: string;
  dashQuery: ReturnType<typeof useQuery<Awaited<ReturnType<typeof getSupplierDashboardData>>>>;
  auctionsQuery: ReturnType<typeof useQuery<Awaited<ReturnType<typeof getSupplierAuctions>>>>;
  performanceQuery: ReturnType<
    typeof useQuery<Awaited<ReturnType<typeof getSupplierPerformance>>[string] | null>
  >;
  notificationsQuery: ReturnType<
    typeof useQuery<ReturnType<typeof getNotificationsForViewer>>
  >;
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
  // Use derived status so clock-started / just-forced Live auctions count
  // immediately (raw auction_status can lag as "Scheduled").
  const liveAuctions = (auctionsQuery.data ?? []).filter(
    (a) => deriveAuctionStatus(a) === "Live",
  ).length;

  const publishedRfqs = useMemo(() => rfqs.filter(isPublishedRfq), [rfqs]);
  // SQ list rows do not reliably include RFQ links — estimate awaiting from counts.
  const awaitingCount = Math.max(0, publishedRfqs.length - submittedCount);

  const urgentRfqs = useMemo(() => {
    return publishedRfqs
      .map((rfq) => ({ rfq, priority: rfqPriority(rfq) }))
      .sort((a, b) => {
        const rank = { Critical: 0, High: 1, Normal: 2 } as const;
        return rank[a.priority] - rank[b.priority];
      })
      .slice(0, 6);
  }, [publishedRfqs]);

  const pendingTasks = awaitingCount + pendingPaymentsCount + liveAuctions;

  const monthly = useMemo(
    () => buildMonthlyOverview(pos, quotations),
    [pos, quotations],
  );
  const activity = useMemo(
    () => buildActivity(rfqs, quotations, pos),
    [rfqs, quotations, pos],
  );

  const perf = performanceQuery.data;
  const responseRate =
    publishedRfqs.length > 0
      ? Math.min(100, Math.round((submittedCount / publishedRfqs.length) * 100))
      : null;
  const onTimePct =
    perf && perf.total_grns > 0
      ? Math.round((perf.on_time_deliveries / perf.total_grns) * 100)
      : perf?.delivery_score != null && perf.delivery_score >= 0
        ? Math.round(perf.delivery_score)
        : null;
  const acceptanceRate =
    submittedCount > 0
      ? Math.min(100, Math.round((activePOsCount / submittedCount) * 100))
      : null;
  const overallScore = (() => {
    const parts = [
      responseRate,
      onTimePct,
      acceptanceRate,
      perf && perf.reliability_score >= 0 ? Math.round(perf.reliability_score) : null,
    ].filter((n): n is number => typeof n === "number");
    if (parts.length === 0) return null;
    return Math.round(parts.reduce((a, b) => a + b, 0) / parts.length);
  })();

  const kpis: Array<{
    title: string;
    value: number;
    icon: LucideIcon;
    accent: string;
    to: string;
  }> = [
    {
      title: "Total RFQs",
      value: rfqs.length,
      icon: FileText,
      accent: "from-[#0B3D91] to-[#146CE8]",
      to: "/supplier/rfqs",
    },
    {
      title: "Awaiting Response",
      value: awaitingCount,
      icon: Inbox,
      accent: "from-amber-500 to-amber-600",
      to: "/supplier/rfqs",
    },
    {
      title: "Submitted Quotations",
      value: submittedCount,
      icon: Send,
      accent: "from-sky-500 to-sky-600",
      to: "/supplier/quotations",
    },
    {
      title: "Active Purchase Orders",
      value: activePOsCount,
      icon: Package,
      accent: "from-emerald-500 to-emerald-600",
      to: "/supplier/purchase-orders",
    },
    {
      title: "Pending Payments",
      value: pendingPaymentsCount,
      icon: Wallet,
      accent: "from-violet-500 to-violet-600",
      to: "/supplier/payments",
    },
    {
      title: "Live Auctions",
      value: liveAuctions,
      icon: Gavel,
      accent: "from-rose-500 to-rose-600",
      to: "/supplier/auctions",
    },
  ];

  const quickActions: Array<{ label: string; to: string; icon: LucideIcon; hint: string }> = [
    { label: "My RFQs", to: "/supplier/rfqs", icon: FileText, hint: "Respond to invitations" },
    { label: "Live Auctions", to: "/supplier/auctions", icon: Gavel, hint: "Place competitive bids" },
    { label: "Purchase Orders", to: "/supplier/purchase-orders", icon: Truck, hint: "Track active orders" },
    { label: "Payments", to: "/supplier/payments", icon: CreditCard, hint: "View remittances" },
    { label: "Quotations", to: "/supplier/quotations", icon: Send, hint: "Review submissions" },
    { label: "Profile", to: "/supplier/profile", icon: Sparkles, hint: "Company & documents" },
  ];

  return (
    <SupplierPortalLayout
      supplierName={supplierName}
      statusBadge={status}
      unlocked
    >
      <div className="mx-auto w-full max-w-[1400px] space-y-4 px-4 py-4 sm:px-5 lg:px-6 lg:py-5">
        {/* Welcome */}
        <section
          className="relative overflow-hidden rounded-2xl border border-slate-200/80 px-5 py-5 text-white shadow-sm sm:px-6 sm:py-6"
          style={{
            background:
              "linear-gradient(125deg, #0B3D91 0%, #146CE8 48%, #2563EB 100%)",
          }}
        >
          <div className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full bg-white/10 blur-2xl" />
          <div className="pointer-events-none absolute -bottom-20 right-24 h-40 w-40 rounded-full bg-sky-300/20 blur-2xl" />
          <div className="relative flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-blue-100">
                {APP_SUPPLIER_PORTAL}
              </p>
              <h1 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">
                Welcome, {supplierName}
              </h1>
              <p className="mt-1.5 max-w-2xl text-sm text-blue-50/95">
                Your procurement collaboration hub for RFQs, auctions, orders, and payments with{" "}
                {COMPANY_NAME}.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <div className="rounded-xl bg-white/15 px-3.5 py-2 ring-1 ring-inset ring-white/25 backdrop-blur-sm">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-blue-100">
                  Pending tasks
                </p>
                {dashQuery.isLoading || auctionsQuery.isLoading ? (
                  <Skeleton className="mt-1 h-7 w-10 bg-white/30" />
                ) : (
                  <p className="text-2xl font-bold tabular-nums">{pendingTasks}</p>
                )}
              </div>
              <div className="rounded-xl bg-white/15 px-3.5 py-2 ring-1 ring-inset ring-white/25 backdrop-blur-sm">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-blue-100">
                  Account status
                </p>
                <p className="mt-0.5 text-sm font-semibold">{status}</p>
              </div>
            </div>
          </div>
        </section>

        {/* KPIs */}
        <section className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          {dashQuery.isLoading || auctionsQuery.isLoading
            ? Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-[88px] rounded-xl" />
              ))
            : kpis.map((kpi) => {
                const Icon = kpi.icon;
                return (
                  <Link
                    key={kpi.title}
                    to={kpi.to}
                    className="group relative overflow-hidden rounded-xl border border-slate-200 bg-white p-3.5 shadow-sm no-underline transition hover:-translate-y-0.5 hover:border-sky-200 hover:shadow-md"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                          {kpi.title}
                        </p>
                        <p className="mt-1.5 text-2xl font-bold tabular-nums text-slate-900">
                          {kpi.value}
                        </p>
                      </div>
                      <div
                        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br ${kpi.accent} text-white shadow-sm`}
                      >
                        <Icon className="h-4 w-4" />
                      </div>
                    </div>
                  </Link>
                );
              })}
        </section>

        {/* Quick actions */}
        <section className="rounded-2xl border border-slate-200 bg-white p-3.5 shadow-sm sm:p-4">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-slate-900">Quick Actions</h2>
            <span className="text-[11px] text-slate-500">Jump to common workflows</span>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            {quickActions.map((qa) => {
              const Icon = qa.icon;
              return (
                <Link
                  key={qa.to}
                  to={qa.to}
                  className="group flex flex-col items-start gap-2 rounded-xl border border-slate-200 bg-gradient-to-b from-slate-50 to-white px-3 py-3 no-underline shadow-sm transition hover:-translate-y-0.5 hover:border-[#146CE8]/40 hover:shadow-md"
                >
                  <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#0B3D91]/10 text-[#0B3D91] transition group-hover:bg-[#146CE8] group-hover:text-white">
                    <Icon className="h-4 w-4" />
                  </span>
                  <span className="text-xs font-semibold text-slate-900">{qa.label}</span>
                  <span className="text-[10px] leading-snug text-slate-500">{qa.hint}</span>
                </Link>
              );
            })}
          </div>
        </section>

        {/* Urgent RFQs + Notifications */}
        <section className="grid gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(280px,1fr)]">
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
              <div>
                <h2 className="text-sm font-semibold text-slate-900">Urgent RFQs</h2>
                <p className="text-[11px] text-slate-500">
                  Published invitations needing your response
                </p>
              </div>
              <Link
                to="/supplier/rfqs"
                className="text-xs font-semibold text-[#146CE8] no-underline hover:underline"
              >
                View all
              </Link>
            </div>
            {dashQuery.isLoading ? (
              <TableSkeleton rows={4} columns={5} />
            ) : urgentRfqs.length === 0 ? (
              <div className="flex flex-col items-center justify-center px-4 py-10 text-center">
                <Inbox className="mb-2 h-8 w-8 text-slate-300" />
                <p className="text-sm font-medium text-slate-700">No urgent RFQs</p>
                <p className="mt-1 text-xs text-slate-500">
                  New invitations will appear here when published.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full text-left text-sm">
                  <thead className="bg-slate-50/80 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                    <tr>
                      <th className="px-4 py-2.5">RFQ Number</th>
                      <th className="px-3 py-2.5">Buyer</th>
                      <th className="px-3 py-2.5">Due Date</th>
                      <th className="px-3 py-2.5">Priority</th>
                      <th className="px-3 py-2.5">Status</th>
                      <th className="px-4 py-2.5 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {urgentRfqs.map(({ rfq, priority }) => (
                      <tr key={rfq.name} className="hover:bg-slate-50/70">
                        <td className="px-4 py-2.5 font-semibold text-slate-900">
                          {rfq.name}
                        </td>
                        <td className="px-3 py-2.5 text-slate-600">
                          {rfq.company || COMPANY_NAME}
                        </td>
                        <td className="px-3 py-2.5 tabular-nums text-slate-600">
                          {rfq.valid_till
                            ? formatDate(rfq.valid_till)
                            : rfq.transaction_date
                              ? formatDate(rfq.transaction_date)
                              : "—"}
                        </td>
                        <td className="px-3 py-2.5">
                          <span
                            className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ring-inset ${priorityClass(priority)}`}
                          >
                            {priority}
                          </span>
                        </td>
                        <td className="px-3 py-2.5">
                          <span
                            className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ring-inset ${statusTone(rfq.status)}`}
                          >
                            {rfq.status || "Open"}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          <Link
                            to={`/supplier/rfq/${encodeURIComponent(rfq.name)}`}
                            className="inline-flex items-center gap-1 rounded-lg bg-[#146CE8] px-2.5 py-1.5 text-xs font-semibold text-white no-underline shadow-sm transition hover:bg-[#0B3D91]"
                          >
                            Respond
                            <ArrowRight className="h-3 w-3" />
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
              <div className="flex items-center gap-2">
                <Bell className="h-4 w-4 text-[#146CE8]" />
                <h2 className="text-sm font-semibold text-slate-900">Notifications</h2>
              </div>
              <span className="text-[11px] text-slate-500">Procurement updates</span>
            </div>
            {notificationsQuery.isLoading ? (
              <div className="space-y-3 p-4">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-12 w-full rounded-lg" />
                ))}
              </div>
            ) : (notificationsQuery.data ?? []).length === 0 ? (
              <div className="px-4 py-10 text-center">
                <Bell className="mx-auto mb-2 h-7 w-7 text-slate-300" />
                <p className="text-sm font-medium text-slate-700">No recent updates</p>
                <p className="mt-1 text-xs text-slate-500">
                  RFQ, order, and payment alerts will show here.
                </p>
              </div>
            ) : (
              <ul className="divide-y divide-slate-100">
                {(notificationsQuery.data ?? []).map((n) => (
                  <li key={n.id}>
                    <Link
                      to={n.route_path || "/supplier/dashboard"}
                      className="flex items-start gap-3 px-4 py-3 no-underline transition hover:bg-slate-50"
                    >
                      <span
                        className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${
                          n.read_status ? "bg-slate-300" : "bg-[#146CE8]"
                        }`}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-slate-900">
                          {n.title}
                        </p>
                        <p className="mt-0.5 line-clamp-2 text-xs text-slate-500">
                          {n.description}
                        </p>
                        <p className="mt-1 text-[10px] text-slate-400">
                          {formatDateTime(n.created_at)}
                        </p>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        {/* Performance + Monthly chart */}
        <section className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
            <div className="mb-4 flex items-center justify-between gap-2">
              <div>
                <h2 className="text-sm font-semibold text-slate-900">Supplier Performance</h2>
                <p className="text-[11px] text-slate-500">
                  Scores derived from your portal activity &amp; ERP history
                </p>
              </div>
              <TrendingUp className="h-4 w-4 text-emerald-600" />
            </div>
            {dashQuery.isLoading || performanceQuery.isLoading ? (
              <div className="grid grid-cols-2 gap-3">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-20 rounded-xl" />
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                <ScoreTile label="Response Rate" value={responseRate} />
                <ScoreTile label="On-Time Delivery" value={onTimePct} />
                <ScoreTile label="Quote Acceptance Rate" value={acceptanceRate} />
                <ScoreTile
                  label="Overall Supplier Score"
                  value={overallScore}
                  emphasize
                />
              </div>
            )}
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
            <div className="mb-3 flex items-center justify-between gap-2">
              <div>
                <h2 className="text-sm font-semibold text-slate-900">
                  Monthly Business Overview
                </h2>
                <p className="text-[11px] text-slate-500">
                  Quotations submitted vs purchase orders (last 6 months)
                </p>
              </div>
            </div>
            {dashQuery.isLoading ? (
              <Skeleton className="h-[220px] w-full rounded-xl" />
            ) : (
              <div className="h-[220px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={monthly} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                    <XAxis
                      dataKey="month"
                      tick={{ fontSize: 11, fill: "#64748b" }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis
                      allowDecimals={false}
                      tick={{ fontSize: 11, fill: "#64748b" }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <Tooltip
                      contentStyle={{
                        fontSize: 12,
                        borderRadius: 8,
                        border: "1px solid #e2e8f0",
                      }}
                      formatter={(value, name) => {
                        if (name === "value") {
                          return [formatCurrency(Number(value)), "PO Value"];
                        }
                        return [value, name === "quotes" ? "Quotations" : "Orders"];
                      }}
                    />
                    <Legend
                      wrapperStyle={{ fontSize: 11 }}
                      formatter={(value) =>
                        value === "quotes"
                          ? "Quotations"
                          : value === "orders"
                            ? "Orders"
                            : value
                      }
                    />
                    <Bar dataKey="quotes" fill="#146CE8" radius={[4, 4, 0, 0]} maxBarSize={28} />
                    <Bar dataKey="orders" fill="#0B3D91" radius={[4, 4, 0, 0]} maxBarSize={28} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        </section>

        {/* Activity + Recent POs */}
        <section className="grid gap-4 xl:grid-cols-2">
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-900">Recent Activity</h2>
              {dashQuery.isFetching && (
                <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-400" />
              )}
            </div>
            {dashQuery.isLoading ? (
              <div className="space-y-3">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} className="h-10 w-full rounded-lg" />
                ))}
              </div>
            ) : activity.length === 0 ? (
              <p className="py-8 text-center text-sm text-slate-500">
                Activity will appear as you engage with RFQs and orders.
              </p>
            ) : (
              <ol className="relative space-y-0 border-l border-slate-200 pl-4">
                {activity.map((item) => (
                  <li key={item.id} className="relative pb-4 last:pb-0">
                    <span
                      className={`absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full ring-4 ring-white ${activityDot(item.tone)}`}
                    />
                    <p className="text-sm font-semibold text-slate-900">{item.title}</p>
                    <p className="text-xs text-slate-600">{item.detail}</p>
                    <p className="mt-0.5 text-[10px] text-slate-400">
                      {formatDateTime(item.at)}
                    </p>
                  </li>
                ))}
              </ol>
            )}
          </div>

          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
              <div>
                <h2 className="text-sm font-semibold text-slate-900">
                  Recent Purchase Orders
                </h2>
                <p className="text-[11px] text-slate-500">Latest orders from procurement</p>
              </div>
              <Link
                to="/supplier/purchase-orders"
                className="text-xs font-semibold text-[#146CE8] no-underline hover:underline"
              >
                View all
              </Link>
            </div>
            {dashQuery.isLoading ? (
              <TableSkeleton rows={4} columns={4} />
            ) : pos.length === 0 ? (
              <div className="px-4 py-10 text-center">
                <Package className="mx-auto mb-2 h-7 w-7 text-slate-300" />
                <p className="text-sm font-medium text-slate-700">No purchase orders yet</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full text-left text-sm">
                  <thead className="bg-slate-50/80 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                    <tr>
                      <th className="px-4 py-2.5">PO Number</th>
                      <th className="px-3 py-2.5">Date</th>
                      <th className="px-3 py-2.5">Amount</th>
                      <th className="px-4 py-2.5">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {pos.slice(0, 6).map((po) => (
                      <tr key={po.name} className="hover:bg-slate-50/70">
                        <td className="px-4 py-2.5">
                          <Link
                            to={`/supplier/po/${encodeURIComponent(po.name)}`}
                            className="font-semibold text-[#146CE8] no-underline hover:underline"
                          >
                            {po.name}
                          </Link>
                        </td>
                        <td className="px-3 py-2.5 tabular-nums text-slate-600">
                          {po.transaction_date ? formatDate(po.transaction_date) : "—"}
                        </td>
                        <td className="px-3 py-2.5 font-medium tabular-nums text-slate-900">
                          {formatCurrency(po.grand_total)}
                        </td>
                        <td className="px-4 py-2.5">
                          <span
                            className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ring-inset ${statusTone(po.status)}`}
                          >
                            {po.status || "—"}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </section>
      </div>
    </SupplierPortalLayout>
  );
}

function ScoreTile({
  label,
  value,
  emphasize,
}: {
  label: string;
  value: number | null;
  emphasize?: boolean;
}) {
  return (
    <div
      className={`rounded-xl border px-3.5 py-3 ${
        emphasize
          ? "border-[#146CE8]/30 bg-gradient-to-br from-[#0B3D91]/5 to-[#146CE8]/10"
          : "border-slate-200 bg-slate-50/60"
      }`}
    >
      <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
        {label}
      </p>
      <p
        className={`mt-1.5 text-2xl font-bold tabular-nums ${
          emphasize ? "text-[#0B3D91]" : "text-slate-900"
        }`}
      >
        {value == null ? "—" : `${value}%`}
      </p>
    </div>
  );
}
