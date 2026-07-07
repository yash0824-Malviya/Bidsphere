import { useLayoutEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  Activity,
  CheckCircle2,
  Clock,
  DollarSign,
  FileText,
  Server,
  Shield,
  ShoppingCart,
  Truck,
  Users,
  XCircle,
} from "lucide-react";

import { APP_NAME } from "../../config/branding";
import { getAdminKpis } from "../../api/admin";
import { getAuditTrail } from "../../api/auditTrail";
import { Skeleton } from "../../components/Skeleton";
import AdminIndirectApprovalPanel from "../../components/dashboard/AdminIndirectApprovalPanel";
import { useOptionalLayout } from "../../contexts/LayoutContext";
import { formatCurrencyCompact, formatDateTime } from "../../utils/format";

export default function AdminDashboardPage() {
  const layout = useOptionalLayout();
  useLayoutEffect(() => {
    layout?.registerPageHeader();
    return () => layout?.unregisterPageHeader();
  }, [layout]);

  const { data: kpis, isLoading } = useQuery({
    queryKey: ["admin-kpis"],
    queryFn: getAdminKpis,
    staleTime: 60_000,
  });

  const { data: activityData } = useQuery({
    queryKey: ["admin-recent-activity"],
    queryFn: () => getAuditTrail({ pageSize: 10 }),
    staleTime: 30_000,
  });

  const recentActivity = activityData?.entries ?? [];

  return (
    <div className="-mt-1">
      {/* Header */}
      <div className="mb-3 flex items-center gap-2.5">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-primary-500 to-primary-700 shadow-sm">
          <Shield className="h-4 w-4 text-white" />
        </div>
        <div>
          <h1 className="text-sm font-bold text-neutral-900">{APP_NAME} Administration Center</h1>
          <p className="text-[10px] text-neutral-500">Governance &middot; Monitoring &middot; Executive Visibility</p>
        </div>
      </div>

      {/* ── 1. Executive KPI Row ────────────────────────────────────────────── */}
      <SectionHeader title="Executive Overview" />
      {isLoading ? (
        <div className="mb-3 grid grid-cols-2 gap-2 lg:grid-cols-3 xl:grid-cols-6">
          {[1, 2, 3, 4, 5, 6].map((i) => <Skeleton key={i} className="h-[78px] rounded-lg" />)}
        </div>
      ) : (
        <div className="mb-3 grid grid-cols-2 gap-2 lg:grid-cols-3 xl:grid-cols-6">
          <KpiCard icon={Users} bg="bg-blue-50" iconBg="bg-blue-100" color="text-blue-600" label="Total Users" value={kpis?.totalUsers ?? 0} link="/admin/users" />
          <KpiCard icon={Truck} bg="bg-violet-50" iconBg="bg-violet-100" color="text-violet-600" label="Active Suppliers" value={kpis?.totalSuppliers ?? 0} link="/admin/suppliers" />
          <KpiCard icon={FileText} bg="bg-cyan-50" iconBg="bg-cyan-100" color="text-cyan-600" label="Open RFQs" value={kpis?.totalRFQs ?? 0} link="/admin/procurement" />
          <KpiCard icon={ShoppingCart} bg="bg-amber-50" iconBg="bg-amber-100" color="text-amber-600" label="Open POs" value={kpis?.totalPOs ?? 0} link="/admin/procurement" />
          <KpiCard icon={Clock} bg="bg-rose-50" iconBg="bg-rose-100" color="text-rose-600" label="Pending Approvals" value={kpis?.pendingApprovals ?? 0} />
          <KpiCard icon={DollarSign} bg="bg-emerald-50" iconBg="bg-emerald-100" color="text-emerald-600" label="Total Spend" value={formatCurrencyCompact(kpis?.totalSpend ?? 0)} link="/admin/budget" />
        </div>
      )}

      {/* ── 2. Approval Center ──────────────────────────────────────────────── */}
      <SectionHeader title="Approval Center" />
      <div className="mb-3 grid grid-cols-2 gap-2 lg:grid-cols-4">
        <ApprovalCard icon={FileText} label="RFQ Pending" count={kpis?.pendingApprovals ?? 0} iconBg="bg-blue-50" iconColor="text-blue-600" accentColor="border-blue-400" loading={isLoading} />
      </div>

      {/* ── Indirect Procurement approvals ──────────────────────────────────── */}
      <div className="mb-3">
        <AdminIndirectApprovalPanel />
      </div>

      <div className="grid gap-2.5 lg:grid-cols-[1fr_300px]">
        {/* ── Left column ─────────────────────────────────────────────────── */}
        <div className="space-y-2.5">
          {/* ── 3. Recent Activity Feed ──────────────────────────────────── */}
          <div>
            <SectionHeader title="Recent Activity" />
            {recentActivity.length === 0 ? (
              <div className="rounded-lg border border-neutral-200 bg-white py-10 text-center shadow-sm">
                <Activity className="mx-auto mb-2 h-6 w-6 text-neutral-300" />
                <p className="text-xs text-neutral-500">No recent activity logged</p>
              </div>
            ) : (
              <div className="rounded-lg border border-neutral-200 bg-white shadow-sm">
                <div className="divide-y divide-neutral-100">
                  {recentActivity.map((entry) => (
                    <div key={entry.name} className="flex items-start gap-2 px-2.5 py-1.5 hover:bg-neutral-50/60 transition-colors">
                      <ActivityDot action={entry.action} />
                      <div className="min-w-0 flex-1">
                        <p className="text-xs text-neutral-800 leading-snug">
                          <span className="font-semibold">{entry.fullName}</span>
                          {" "}
                          <span className="text-neutral-500">{entry.action}</span>
                        </p>
                        <div className="mt-0.5 flex items-center gap-2 flex-wrap">
                          {entry.doctype && (
                            <span className="rounded bg-neutral-100 px-1 py-px text-[9px] font-semibold text-neutral-500">
                              {entry.doctype}
                            </span>
                          )}
                          {entry.documentId !== "—" && (
                            <span className="font-mono text-[10px] text-primary-600">{entry.documentId}</span>
                          )}
                          <span className="text-[10px] text-neutral-400 tabular-nums">{formatDateTime(entry.timestamp)}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="border-t border-neutral-200 px-2.5 py-1.5 text-center">
                  <Link to="/admin/audit-trail" className="text-[10px] font-semibold text-primary-600 hover:text-primary-700 no-underline">
                    View Full Audit Trail →
                  </Link>
                </div>
              </div>
            )}
          </div>

          {/* ── 5. Spend Analytics ─────────────────────────────────────────── */}
          <div>
            <SectionHeader title="Spend Analytics" />
            <div className="rounded-lg border border-neutral-200 bg-white shadow-sm">
              <div className="px-2.5 py-2">
                <p className="text-[9px] font-bold uppercase tracking-wider text-neutral-400">Total Spend (submitted POs)</p>
                <p className="mt-0.5 text-lg font-bold tabular-nums text-neutral-900 leading-tight">{formatCurrencyCompact(kpis?.totalSpend ?? 0)}</p>
                <p className="mt-0.5 text-[10px] text-neutral-500">Across {kpis?.totalPOs ?? 0} purchase orders</p>
              </div>
              <div className="border-t border-neutral-200 px-2.5 py-1.5 text-center">
                <Link to="/admin/reports" className="text-[10px] font-semibold text-primary-600 hover:text-primary-700 no-underline">
                  View Full Reports →
                </Link>
              </div>
            </div>
          </div>
        </div>

        {/* ── Right column: System Health ──────────────────────────────────── */}
        <div>
          <SectionHeader title="System Health" />
          <div className="rounded-lg border border-neutral-200 bg-white px-3 py-6 text-center shadow-sm">
            <Server className="mx-auto mb-2 h-6 w-6 text-neutral-300" />
            <p className="text-xs text-neutral-500">
              Health monitoring will appear when integrations are configured.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── Sub-components ──────────────────────────────────────────────────────── */

function SectionHeader({ title }: { title: string }) {
  return <h2 className="mb-1 text-[9px] font-bold uppercase tracking-wider text-neutral-400">{title}</h2>;
}

function KpiCard({
  icon: Icon,
  bg: _bg,
  iconBg,
  color,
  label,
  value,
  link,
}: {
  icon: typeof Users;
  bg: string;
  iconBg: string;
  color: string;
  label: string;
  value: string | number;
  link?: string;
}) {
  const Inner = (
    <div className={`rounded-lg border border-neutral-200 bg-white px-3 py-2.5 shadow-sm transition hover:shadow-md`}>
      <div className={`mb-1.5 flex h-6 w-6 items-center justify-center rounded-md ${iconBg}`}>
        <Icon className={`h-3 w-3 ${color}`} />
      </div>
      <p className="text-lg font-bold tabular-nums text-neutral-900 leading-tight">{value}</p>
      <p className="text-[9px] font-medium uppercase tracking-wider text-neutral-500 mt-0.5">{label}</p>
    </div>
  );
  if (link) return <Link to={link} className="no-underline">{Inner}</Link>;
  return Inner;
}

function ApprovalCard({
  icon: Icon,
  label,
  count,
  iconBg,
  iconColor,
  accentColor,
  loading,
}: {
  icon: typeof FileText;
  label: string;
  count: number;
  iconBg: string;
  iconColor: string;
  accentColor: string;
  loading?: boolean;
}) {
  if (loading) {
    return <Skeleton className="h-[52px] rounded-lg" />;
  }
  return (
    <div className={`rounded-lg border-l-[3px] ${accentColor} border border-neutral-200 bg-white px-2.5 py-2 shadow-sm`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className={`flex h-6 w-6 items-center justify-center rounded-md ${iconBg}`}>
            <Icon className={`h-3 w-3 ${iconColor}`} />
          </div>
          <div>
            <p className="text-[9px] font-medium uppercase tracking-wider text-neutral-500">{label}</p>
            <p className="text-base font-bold tabular-nums text-neutral-900 leading-tight">{count}</p>
          </div>
        </div>
        {count > 0 && (
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-rose-100 text-[9px] font-bold text-rose-700">
            {count}
          </span>
        )}
      </div>
    </div>
  );
}

function ActivityDot({ action }: { action: string }) {
  const lower = action.toLowerCase();
  if (lower.includes("creat") || lower.includes("submit"))
    return <div className="mt-1 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-emerald-50"><CheckCircle2 className="h-3 w-3 text-emerald-600" /></div>;
  if (lower.includes("cancel") || lower.includes("delet") || lower.includes("reject"))
    return <div className="mt-1 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-red-50"><XCircle className="h-3 w-3 text-red-600" /></div>;
  if (lower.includes("login") || lower.includes("logout"))
    return <div className="mt-1 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-blue-50"><Users className="h-3 w-3 text-blue-600" /></div>;
  return <div className="mt-1 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-neutral-100"><Activity className="h-3 w-3 text-neutral-500" /></div>;
}
