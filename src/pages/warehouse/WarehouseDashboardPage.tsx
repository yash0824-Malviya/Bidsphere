import { useCallback, useEffect, useMemo, useRef } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import toast from "react-hot-toast";
import type { LucideIcon } from "lucide-react";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Boxes,
  CheckCircle,
  ClipboardCheck,
  ClipboardList,
  Clock,
  FileSearch,
  PackageCheck,
  PackagePlus,
  Split,
  Target,
  Timer,
  Truck,
} from "lucide-react";

import {
  getInventorySummary,
  getIssuedMaterials,
  getPendingMaterialRequests,
  getWarehouseProcurementRequiredRequests,
  selectProcurementRequiredRows,
  selectReadyToIssueRows,
} from "../../services/warehouseService";
import { getPurchaseReceipts } from "../../api/purchasing";
import { fetchProcurementQueue } from "../../api/materialRequestWorkflow";
import {
  countPendingDepartmentAcceptance,
  countPendingDepartmentAcceptanceAsync,
  countTodaysMaterialIssues,
  listAcceptedDepartmentReceipts,
  listPendingDepartmentReceipts,
  listPendingWarehouseReceipts,
} from "../../api/materialIssueReceipt";
import { syncMaterialRequestSlaBatch } from "../../api/slaIntegration";
import { useSlaVisible } from "../../hooks/useSlaVisible";
import SlaCountdownWidget from "../../components/sla/SlaCountdownWidget";
import ErrorState from "../../components/ErrorState";
import DashboardKpiCard, {
  DashboardKpiGrid,
} from "../../components/dashboard/DashboardKpiCard";
import { useAuthStore } from "../../store/authStore";
import { formatDateTime } from "../../utils/format";
import { toEnterpriseUserMessage } from "../../utils/enterpriseUserMessage";

const DASHBOARD_STALE_MS = 30_000;

function dashboardQueryOptions() {
  return {
    enabled: true as boolean,
    retry: 1 as const,
    retryDelay: 1_200,
    staleTime: DASHBOARD_STALE_MS,
    refetchOnWindowFocus: false as const,
  };
}

const PRIORITY_STYLES: Record<string, string> = {
  Urgent: "bg-rose-50 text-rose-700 border-rose-200",
  High: "bg-amber-50 text-amber-700 border-amber-200",
  Medium: "bg-blue-50 text-blue-700 border-blue-200",
  Low: "bg-slate-100 text-slate-600 border-slate-200",
};

const PRIMARY_ICON: Record<string, string> = {
  pending: "bg-[#EEF3FA] text-[#1F3A6D]",
  ready: "bg-emerald-50 text-emerald-700",
  procurement: "bg-orange-50 text-orange-700",
  lowStock: "bg-rose-50 text-rose-700",
};

interface ActivityEntry {
  id: string;
  kind: "issued" | "received" | "forwarded" | "accepted";
  label: string;
  subject: string;
  user: string;
  ts: string;
}

function timeGreeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good Morning";
  if (h < 17) return "Good Afternoon";
  return "Good Evening";
}

function requestedQtyTotal(
  items: { required_qty: number }[] | undefined,
): number {
  return (items ?? []).reduce((sum, i) => sum + (Number(i.required_qty) || 0), 0);
}

export default function WarehouseDashboardPage() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const role = user?.role;
  const canLoad = role === "warehouse" || role === "admin";
  const slaVisible = useSlaVisible();
  const greetingName =
    user?.full_name?.trim() || "Warehouse Manager";

  const qOpts = dashboardQueryOptions();

  const pendingQuery = useQuery({
    queryKey: ["warehouse", "pending-requests"],
    queryFn: getPendingMaterialRequests,
    ...qOpts,
    enabled: canLoad,
  });
  const procurementRequiredPersistedQuery = useQuery({
    queryKey: ["warehouse", "procurement-required-persisted"],
    queryFn: getWarehouseProcurementRequiredRequests,
    ...qOpts,
    enabled: canLoad,
  });
  const inventoryQuery = useQuery({
    queryKey: ["warehouse", "inventory"],
    queryFn: getInventorySummary,
    ...qOpts,
    enabled: canLoad,
  });
  const issuedQuery = useQuery({
    queryKey: ["warehouse", "issued"],
    queryFn: () => getIssuedMaterials(),
    ...qOpts,
    enabled: canLoad,
  });
  const procurementQueueQuery = useQuery({
    queryKey: ["mr-procurement-queue", "warehouse", "dashboard"],
    queryFn: () => fetchProcurementQueue({ hydrateLimit: 25 }),
    ...qOpts,
    enabled: canLoad,
  });
  const receiptKpiQuery = useQuery({
    queryKey: ["material-issue-receipts", "warehouse", "kpi"],
    queryFn: async () => {
      const pendingDepartmentAcceptance =
        await countPendingDepartmentAcceptanceAsync();
      return {
        pendingDepartmentAcceptance,
        todaysIssues: countTodaysMaterialIssues(),
        pendingSignatures:
          listPendingWarehouseReceipts().length +
          listPendingDepartmentReceipts().length,
      };
    },
    ...qOpts,
    enabled: canLoad,
    staleTime: 0,
    refetchOnMount: "always",
  });
  const receiptKpiTick = receiptKpiQuery.dataUpdatedAt;

  useEffect(() => {
    if (!slaVisible) return;
    const queue = procurementQueueQuery.data;
    if (queue && queue.length > 0) void syncMaterialRequestSlaBatch(queue);
  }, [procurementQueueQuery.data, slaVisible]);

  const recentGrnQuery = useQuery({
    queryKey: ["warehouse", "recent-grn"],
    queryFn: () =>
      getPurchaseReceipts({
        fields: ["name", "owner", "posting_date", "creation", "status"],
        filters: [["docstatus", "=", 1]],
        order_by: "creation desc",
        limit_page_length: 10,
      }),
    ...qOpts,
    enabled: canLoad,
  });

  // Surface the first concrete dashboard failure with a specific message (once).
  const dashboardErrorToasted = useRef(false);
  useEffect(() => {
    const failures: Array<{ widget: string; error: unknown }> = [
      { widget: "Pending Material Requests", error: pendingQuery.error },
      { widget: "Inventory Summary", error: inventoryQuery.error },
      { widget: "Issued Materials", error: issuedQuery.error },
      { widget: "Procurement Queue", error: procurementQueueQuery.error },
      { widget: "Recent GRNs", error: recentGrnQuery.error },
      {
        widget: "Procurement Required",
        error: procurementRequiredPersistedQuery.error,
      },
    ].filter((f) => f.error != null);

    if (failures.length === 0) {
      dashboardErrorToasted.current = false;
      return;
    }

    // TEMP debug — remove once warehouse dashboard load is stable.
    // eslint-disable-next-line no-console
    console.error("[DashboardLoad] Warehouse Dashboard query failures", {
      failures: failures.map((f) => ({
        widget: f.widget,
        message:
          f.error instanceof Error ? f.error.message : String(f.error),
        error: f.error,
      })),
    });

    if (dashboardErrorToasted.current) return;
    dashboardErrorToasted.current = true;
    const first = failures[0]!;
    const detail = toEnterpriseUserMessage(
      first.error,
      `Could not load ${first.widget}. Please try again.`,
    );
    toast.error(`${first.widget}: ${detail}`, {
      id: "warehouse-dashboard-load",
      duration: 8_000,
    });
  }, [
    pendingQuery.error,
    inventoryQuery.error,
    issuedQuery.error,
    procurementQueueQuery.error,
    recentGrnQuery.error,
    procurementRequiredPersistedQuery.error,
  ]);

  const allFailed =
    canLoad &&
    pendingQuery.isError &&
    inventoryQuery.isError &&
    issuedQuery.isError &&
    procurementQueueQuery.isError;

  const handleRetry = useCallback(() => {
    void pendingQuery.refetch();
    void procurementRequiredPersistedQuery.refetch();
    void inventoryQuery.refetch();
    void issuedQuery.refetch();
    void procurementQueueQuery.refetch();
    void recentGrnQuery.refetch();
  }, [
    pendingQuery,
    procurementRequiredPersistedQuery,
    inventoryQuery,
    issuedQuery,
    procurementQueueQuery,
    recentGrnQuery,
  ]);

  const todayIso = new Date().toISOString().slice(0, 10);
  const pending = pendingQuery.data ?? [];
  const inventory = inventoryQuery.data ?? [];
  const issued = issuedQuery.data ?? [];

  const readyToIssueMRs = useMemo(
    () => selectReadyToIssueRows(pending),
    [pending],
  );
  const procurementRequiredMRs = useMemo(
    () =>
      selectProcurementRequiredRows([
        ...pending,
        ...(procurementRequiredPersistedQuery.data ?? []),
      ]),
    [pending, procurementRequiredPersistedQuery.data],
  );

  const forwardedQueue = procurementQueueQuery.data ?? [];

  const kpis = useMemo(() => {
    const partiallyIssuedPending = pending.filter((mr) => {
      const items = mr.items ?? [];
      if (items.length === 0) return false;
      const anyAvailable = items.some((i) => i.available_qty > 0);
      const anyShort = items.some((i) => i.available_qty < i.required_qty);
      return anyAvailable && anyShort;
    }).length;
    const issuedTodayRows = issued.filter((s) => s.issue_date === todayIso);
    const completedToday = issuedTodayRows.filter(
      (s) => s.status === "Fully Issued",
    ).length;
    const partialIssues = issued.filter(
      (s) => s.status === "Partially Issued",
    ).length;
    const pendingIssues = readyToIssueMRs.length;
    const successRate =
      issuedTodayRows.length === 0
        ? null
        : Math.round((completedToday / issuedTodayRows.length) * 100);
    const pendingSignatures =
      receiptKpiQuery.data?.pendingSignatures ??
      listPendingWarehouseReceipts().length +
        listPendingDepartmentReceipts().length;

    return {
      pending: pending.length,
      readyToIssue: readyToIssueMRs.length,
      issuedToday: issuedTodayRows.length,
      procurementRequired: procurementRequiredMRs.length,
      partiallyIssued: partiallyIssuedPending,
      lowStock: inventory.filter(
        (i) =>
          i.status === "Reorder Required" ||
          i.status === "Low Stock" ||
          i.status === "Out of Stock",
      ).length,
      todaysIssues: issuedTodayRows.length,
      pendingIssues,
      partialIssues,
      completedToday,
      issueSuccessRate: successRate,
      pendingSignatures,
      receiptsAwaitingConfirmation:
        receiptKpiQuery.data?.pendingDepartmentAcceptance ??
        countPendingDepartmentAcceptance(),
      todaysReceiptIssues:
        receiptKpiQuery.data?.todaysIssues ?? countTodaysMaterialIssues(),
    };
  }, [
    pending,
    issued,
    readyToIssueMRs,
    procurementRequiredMRs,
    inventory,
    todayIso,
    receiptKpiTick,
    receiptKpiQuery.data,
  ]);

  const lowStockItems = useMemo(
    () =>
      inventory.filter(
        (i) =>
          i.status === "Reorder Required" ||
          i.status === "Low Stock" ||
          i.status === "Out of Stock",
      ),
    [inventory],
  );

  const readyIssueLines = useMemo(() => {
    const byName = new Map(pending.map((m) => [m.name, m]));
    const lines: Array<{
      key: string;
      item: string;
      qty: number;
      uom: string;
      warehouse: string;
      mrName: string;
    }> = [];
    for (const row of readyToIssueMRs) {
      const mr = byName.get(row.name);
      const items = mr?.items ?? [];
      if (items.length === 0) {
        lines.push({
          key: row.name,
          item: row.name,
          qty: row.readyQty,
          uom: row.uom,
          warehouse: row.warehouse || "—",
          mrName: row.name,
        });
        continue;
      }
      for (const it of items) {
        lines.push({
          key: `${row.name}-${it.item_code}`,
          item: it.description || it.item_code,
          qty: it.required_qty,
          uom: it.uom,
          warehouse: it.warehouse || row.warehouse || "—",
          mrName: row.name,
        });
      }
    }
    return lines.slice(0, 6);
  }, [readyToIssueMRs, pending]);

  const activity = useMemo<ActivityEntry[]>(() => {
    const entries: ActivityEntry[] = [];
    for (const s of issued) {
      entries.push({
        id: `issue-${s.name}`,
        kind: "issued",
        label: "Material Issued",
        subject: s.mr_name || s.name,
        user: s.issued_by,
        ts: s.issued_at || s.issue_date,
      });
    }
    for (const g of recentGrnQuery.data ?? []) {
      entries.push({
        id: `grn-${g.name}`,
        kind: "received",
        label: "Goods Received",
        subject: g.name,
        user: (g as { owner?: string }).owner ?? "System",
        ts: (g as { creation?: string }).creation ?? g.posting_date ?? "",
      });
    }
    for (const mr of forwardedQueue) {
      const rec = mr as unknown as Record<string, unknown>;
      entries.push({
        id: `fwd-${mr.name}`,
        kind: "forwarded",
        label: "MR Forwarded to Procurement",
        subject: mr.name,
        user:
          (rec.custom_department as string) ||
          (rec.department as string) ||
          "Procurement",
        ts:
          (rec.modified as string)?.split("T")[0] ||
          (rec.transaction_date as string) ||
          "",
      });
    }
    for (const r of listAcceptedDepartmentReceipts()) {
      entries.push({
        id: `accept-${r.id || r.issue_number}`,
        kind: "accepted",
        label: "Department Acceptance",
        subject: r.issue_number || r.stock_entry || r.id,
        user: r.department_signature?.signer_name || r.department || "Department",
        ts: r.department_signed_at || r.created_at || "",
      });
    }
    return entries
      .filter((e) => e.ts)
      .sort((a, b) => b.ts.localeCompare(a.ts))
      .slice(0, 8);
  }, [issued, recentGrnQuery.data, forwardedQueue, receiptKpiTick]);

  if (allFailed) {
    return (
      <div className="p-4">
        <div className="rounded-2xl border border-slate-100 bg-white p-8 shadow-sm">
          <ErrorState
            title="Unable to load warehouse data"
            description="The requested information is temporarily unavailable. Please try again."
            onRetry={handleRetry}
          />
        </div>
      </div>
    );
  }

  const primaryKpis = [
    {
      key: "pending",
      label: "Pending Material Requests",
      value: kpis.pending,
      subtitle: "Awaiting warehouse review",
      icon: ClipboardList,
      to: "/warehouse/material-requests/pending",
      loading: pendingQuery.isLoading,
    },
    {
      key: "ready",
      label: "Ready to Issue",
      value: kpis.readyToIssue,
      subtitle: "Fully in stock",
      icon: PackageCheck,
      to: "/warehouse/issue-items",
      loading: pendingQuery.isLoading,
    },
    {
      key: "procurement",
      label: "Procurement Required",
      value: kpis.procurementRequired,
      subtitle: "Shortages to sourcing",
      icon: FileSearch,
      to: "/warehouse/material-requests/forwarded",
      loading:
        pendingQuery.isLoading || procurementRequiredPersistedQuery.isLoading,
    },
    {
      key: "lowStock",
      label: "Reorder Required",
      value: kpis.lowStock,
      subtitle: "At or below reorder level",
      icon: AlertTriangle,
      to: "/warehouse/inventory/stock",
      loading: inventoryQuery.isLoading,
    },
  ] as const;

  const analyticsKpis = [
    {
      label: "Today's Issues",
      value: kpis.todaysReceiptIssues || kpis.todaysIssues,
      subtitle: "Issues recorded today",
      icon: PackageCheck,
      tone: "bg-sky-50 text-sky-700",
      to: "/warehouse/material-requests/issued",
      loading: issuedQuery.isLoading,
    },
    {
      label: "Completed Today",
      value: kpis.completedToday,
      subtitle: "Fully issued today",
      icon: CheckCircle,
      tone: "bg-emerald-50 text-emerald-700",
      to: "/warehouse/material-requests/issued",
      loading: issuedQuery.isLoading,
    },
    {
      label: "Pending Acceptance",
      value: kpis.receiptsAwaitingConfirmation,
      subtitle: "Awaiting department",
      icon: ClipboardCheck,
      tone: "bg-violet-50 text-violet-700",
      to: "/warehouse/issue-items/pending-acceptance",
    },
    {
      label: "Average Issue Time",
      value: "—",
      subtitle: "Not available",
      icon: Timer,
      tone: "bg-slate-100 text-slate-600",
    },
    {
      label: "Inventory Accuracy",
      value: "—",
      subtitle: "Not available",
      icon: Target,
      tone: "bg-slate-100 text-slate-600",
    },
    {
      label: "Issue Success Rate",
      value:
        kpis.issueSuccessRate == null ? "—" : `${kpis.issueSuccessRate}%`,
      subtitle: "Full / today's issues",
      icon: Activity,
      tone: "bg-teal-50 text-teal-700",
      to: "/warehouse/material-requests/issued",
      loading: issuedQuery.isLoading,
    },
    {
      label: "Partially Issued",
      value: kpis.partiallyIssued,
      subtitle: "Issue + procurement",
      icon: Split,
      tone: "bg-orange-50 text-orange-700",
      to: "/warehouse/material-requests/pending",
      loading: pendingQuery.isLoading,
    },
    {
      label: "Pending Signatures",
      value: kpis.pendingSignatures,
      subtitle: "Warehouse or department",
      icon: ClipboardList,
      tone: "bg-amber-50 text-amber-700",
      to: "/warehouse/material-requests/issued",
    },
    {
      label: "Pending Issues",
      value: kpis.pendingIssues,
      subtitle: "Ready to issue now",
      icon: PackagePlus,
      tone: "bg-indigo-50 text-indigo-700",
      to: "/warehouse/issue-items",
      loading: pendingQuery.isLoading,
    },
    {
      label: "Partial Issues",
      value: kpis.partialIssues,
      subtitle: "History · partial",
      icon: Clock,
      tone: "bg-orange-50 text-orange-700",
      to: "/warehouse/material-requests/issued",
      loading: issuedQuery.isLoading,
    },
  ];

  return (
    <div className="wh-dash flex w-full flex-col gap-6 bg-[#F8FAFC] pb-2 font-[Inter,ui-sans-serif,system-ui,sans-serif]">
      {/* Hero */}
      <header className="wh-dash-hero">
        <div className="min-w-0">
          <h1>
            {timeGreeting()}, {greetingName}
          </h1>
          <p>Today&apos;s warehouse operations overview.</p>
        </div>
        <div className="wh-dash-hero-aside">
          <div className="wh-dash-summary">
            <p className="wh-dash-summary-title">Today&apos;s Summary</p>
            <ul>
              <li>
                <span>Pending Material Requests</span>
                <strong>{kpis.pending}</strong>
              </li>
              <li>
                <span>Ready to Issue</span>
                <strong>{kpis.readyToIssue}</strong>
              </li>
              <li>
                <span>Procurement Required</span>
                <strong>{kpis.procurementRequired}</strong>
              </li>
            </ul>
          </div>
          <div className="wh-dash-hero-actions">
            <Link
              to="/warehouse/material-requests/pending"
              className="wh-dash-btn-primary"
            >
              Review Requests
            </Link>
            <Link
              to="/warehouse/inventory/create-grn"
              className="wh-dash-btn-secondary"
            >
              Receive Goods
            </Link>
          </div>
        </div>
      </header>

      {/* Primary KPIs */}
      <div className="wh-primary-kpis">
        <DashboardKpiGrid columns={4}>
          {primaryKpis.map((c) => (
            <DashboardKpiCard
              key={c.key}
              label={c.label}
              value={c.value}
              subtitle={c.subtitle}
              icon={c.icon}
              iconClassName={PRIMARY_ICON[c.key]}
              loading={c.loading}
              to={c.to}
            />
          ))}
        </DashboardKpiGrid>
      </div>

      {/* Quick Actions */}
      <section>
        <div className="mb-3">
          <h2 className="text-[16px] font-semibold text-[#1E293B]">
            Quick Actions
          </h2>
          <p className="mt-0.5 text-[13px] text-[#64748B]">
            Common warehouse workflows
          </p>
        </div>
        <div className="wh-actions-grid">
          <QuickAction
            icon={PackagePlus}
            label="Receive Goods"
            desc="Receive against a purchase order"
            accent="bg-blue-50 text-blue-700"
            to="/warehouse/inventory/create-grn"
          />
          <QuickAction
            icon={ClipboardList}
            label="Review Material Requests"
            desc="Check stock and decide"
            accent="bg-[#EEF3FA] text-[#1F3A6D]"
            to="/warehouse/material-requests/pending"
          />
          <QuickAction
            icon={PackageCheck}
            label="Issue Materials"
            desc="Issue available stock"
            accent="bg-emerald-50 text-emerald-700"
            to="/warehouse/issue-items"
          />
          <QuickAction
            icon={Truck}
            label="Forward to Procurement"
            desc="Send shortages to sourcing"
            accent="bg-orange-50 text-orange-700"
            to="/warehouse/material-requests/forwarded"
          />
        </div>
      </section>

      {/* Main content */}
      <div className="grid gap-6 lg:grid-cols-2">
        <QueuePanel
          icon={ClipboardList}
          title="Pending Material Requests"
          to="/warehouse/material-requests/pending"
          loading={pendingQuery.isLoading}
          empty={pending.length === 0}
          emptyText="No material requests awaiting review."
        >
          <MiniTable
            head={["MR Number", "Department", "Priority", "Requested Qty", "Status", ""]}
          >
            {pending.slice(0, 5).map((mr) => {
              const qty = requestedQtyTotal(mr.items);
              const uom = mr.items?.[0]?.uom ?? "";
              return (
                <tr key={mr.name} className="hover:bg-[#F8FAFC]">
                  <td className="py-2.5 pr-2 font-semibold text-[#1E293B]">
                    {mr.name}
                  </td>
                  <td className="px-2 py-2.5 text-[#475569]">{mr.department}</td>
                  <td className="px-2 py-2.5">
                    <span
                      className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold ${
                        PRIORITY_STYLES[mr.priority] ?? PRIORITY_STYLES.Low
                      }`}
                    >
                      {mr.priority}
                    </span>
                  </td>
                  <td className="px-2 py-2.5 tabular-nums text-[#334155]">
                    {qty} {uom}
                  </td>
                  <td className="px-2 py-2.5 text-[#64748B]">{mr.status}</td>
                  <td className="py-2.5 pl-2 text-right">
                    <RowButton
                      onClick={() =>
                        navigate(
                          `/warehouse/material-requests/review/${mr.name}`,
                        )
                      }
                    >
                      Review
                    </RowButton>
                  </td>
                </tr>
              );
            })}
          </MiniTable>
        </QueuePanel>

        <QueuePanel
          icon={PackageCheck}
          title="Ready to Issue"
          to="/warehouse/issue-items"
          loading={pendingQuery.isLoading}
          empty={readyIssueLines.length === 0}
          emptyText="No material requests are ready for issue."
        >
          <MiniTable head={["Item", "Quantity", "Warehouse", ""]}>
            {readyIssueLines.map((line) => (
              <tr key={line.key} className="hover:bg-[#F8FAFC]">
                <td className="py-2.5 pr-2">
                  <p className="font-semibold text-[#1E293B]">{line.item}</p>
                  <p className="text-[11px] text-[#94A3B8]">{line.mrName}</p>
                </td>
                <td className="px-2 py-2.5 tabular-nums font-semibold text-emerald-700">
                  {line.qty} {line.uom}
                </td>
                <td className="px-2 py-2.5 text-[#475569]">{line.warehouse}</td>
                <td className="py-2.5 pl-2 text-right">
                  <RowButton
                    tone="primary"
                    onClick={() =>
                      navigate(
                        `/warehouse/material-requests/review/${encodeURIComponent(line.mrName)}`,
                      )
                    }
                  >
                    Issue
                  </RowButton>
                </td>
              </tr>
            ))}
          </MiniTable>
        </QueuePanel>
      </div>

      {/* Secondary */}
      <div className="grid gap-6 lg:grid-cols-2">
        <QueuePanel
          icon={Boxes}
          title="Reorder Required"
          to="/warehouse/inventory/stock"
          loading={inventoryQuery.isLoading}
          empty={lowStockItems.length === 0}
          emptyText="All stock levels are optimal."
        >
          <MiniTable
            head={["Item", "Remaining Stock", "Shortage", "Warehouse"]}
          >
            {lowStockItems.slice(0, 8).map((item) => {
              const remaining = Math.max(0, Number(item.available_qty) || 0);
              const shortage = Math.max(
                0,
                (Number(item.reorder_level) || 0) - remaining,
              );
              const critical = item.status === "Out of Stock";
              return (
                <tr
                  key={`${item.item_code}-${item.warehouse}`}
                  className={critical ? "bg-rose-50/40" : "hover:bg-[#F8FAFC]"}
                >
                  <td className="py-2.5 pr-2">
                    <p className="font-semibold text-[#1E293B]">
                      {item.item_name || item.item_code}
                    </p>
                    <p className="font-mono text-[11px] text-[#94A3B8]">
                      {item.item_code}
                    </p>
                  </td>
                  <td
                    className={`px-2 py-2.5 tabular-nums font-semibold ${
                      critical ? "text-rose-600" : "text-amber-600"
                    }`}
                  >
                    {remaining} {item.uom}
                  </td>
                  <td className="px-2 py-2.5 tabular-nums font-semibold text-rose-600">
                    {shortage} {item.uom}
                  </td>
                  <td className="px-2 py-2.5 text-[#64748B]">{item.warehouse}</td>
                </tr>
              );
            })}
          </MiniTable>
        </QueuePanel>

        <section className="wh-panel flex h-full flex-col">
          <div className="flex items-center gap-2 border-b border-[#F1F5F9] px-5 py-3.5">
            <Activity className="h-4 w-4 text-[#64748B]" />
            <h2 className="text-sm font-bold text-[#0F172A]">
              Recent Warehouse Activity
            </h2>
          </div>
          <div className="flex flex-1 flex-col px-5 py-4">
            {recentGrnQuery.isLoading || issuedQuery.isLoading ? (
              <div className="space-y-2">
                {[1, 2, 3, 4].map((n) => (
                  <div
                    key={n}
                    className="h-11 animate-pulse rounded-lg bg-[#F8FAFC]"
                  />
                ))}
              </div>
            ) : activity.length === 0 ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-2 py-8 text-center">
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[#F8FAFC] text-[#94A3B8]">
                  <Activity className="h-4 w-4" />
                </span>
                <p className="text-xs font-medium text-[#94A3B8]">
                  No recent warehouse activity.
                </p>
              </div>
            ) : (
              <ul className="space-y-3.5">
                {activity.map((a) => {
                  const meta = ACTIVITY_META[a.kind];
                  const Icon = meta.icon;
                  return (
                    <li key={a.id} className="flex gap-3">
                      <span
                        className={`mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg ${meta.accent}`}
                      >
                        <Icon className="h-3.5 w-3.5" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-semibold text-[#1E293B]">
                          {a.label}{" "}
                          <span className="font-mono font-normal text-[#64748B]">
                            {a.subject}
                          </span>
                        </p>
                        <p className="text-[11px] text-[#94A3B8]">
                          {a.user} · {a.ts ? formatDateTime(a.ts) : "—"}
                        </p>
                      </div>
                      <span
                        className={`mt-1 h-2 w-2 flex-shrink-0 rounded-full ${meta.dot}`}
                        title={meta.legend}
                      />
                    </li>
                  );
                })}
              </ul>
            )}
            <div className="mt-4 flex flex-wrap gap-3 border-t border-[#F1F5F9] pt-3 text-[10px] font-semibold uppercase tracking-wide text-[#94A3B8]">
              <span className="inline-flex items-center gap-1.5">
                <i className="h-2 w-2 rounded-full bg-blue-500" /> Goods Receipt
              </span>
              <span className="inline-flex items-center gap-1.5">
                <i className="h-2 w-2 rounded-full bg-emerald-500" /> Issue
              </span>
              <span className="inline-flex items-center gap-1.5">
                <i className="h-2 w-2 rounded-full bg-orange-500" /> Procurement
              </span>
              <span className="inline-flex items-center gap-1.5">
                <i className="h-2 w-2 rounded-full bg-violet-500" /> Acceptance
              </span>
            </div>
          </div>
        </section>
      </div>

      <SlaCountdownWidget role="warehouse" title="Warehouse SLA Countdown" />

      {/* Operational Analytics */}
      <section>
        <div className="mb-3">
          <h2 className="text-[16px] font-semibold text-[#1E293B]">
            Operational Analytics
          </h2>
          <p className="mt-0.5 text-[13px] text-[#64748B]">
            Secondary warehouse performance indicators
          </p>
        </div>
        <div className="wh-analytics-kpis">
          <DashboardKpiGrid columns={5}>
            {analyticsKpis.map((c) => (
              <DashboardKpiCard
                key={c.label}
                label={c.label}
                value={c.value}
                subtitle={c.subtitle}
                icon={c.icon}
                iconClassName={c.tone}
                loading={"loading" in c ? c.loading : undefined}
                to={"to" in c ? c.to : undefined}
              />
            ))}
          </DashboardKpiGrid>
        </div>
      </section>
    </div>
  );
}

/* ─── Sub-components ─────────────────────────────────────────────────────── */

const ACTIVITY_META: Record<
  ActivityEntry["kind"],
  { icon: LucideIcon; accent: string; dot: string; legend: string }
> = {
  received: {
    icon: PackagePlus,
    accent: "bg-blue-50 text-blue-600",
    dot: "bg-blue-500",
    legend: "Goods Receipt",
  },
  issued: {
    icon: PackageCheck,
    accent: "bg-emerald-50 text-emerald-600",
    dot: "bg-emerald-500",
    legend: "Issue",
  },
  forwarded: {
    icon: Truck,
    accent: "bg-orange-50 text-orange-600",
    dot: "bg-orange-500",
    legend: "Procurement",
  },
  accepted: {
    icon: ClipboardCheck,
    accent: "bg-violet-50 text-violet-600",
    dot: "bg-violet-500",
    legend: "Acceptance",
  },
};

function QuickAction({
  icon: Icon,
  label,
  desc,
  accent,
  to,
}: {
  icon: LucideIcon;
  label: string;
  desc: string;
  accent: string;
  to: string;
}) {
  return (
    <Link to={to} className="wh-action-card group">
      <span className={`wh-action-icon ${accent}`}>
        <Icon className="h-6 w-6" />
      </span>
      <div className="min-w-0">
        <p className="wh-action-label">{label}</p>
        <p className="wh-action-desc">{desc}</p>
      </div>
      <ArrowRight className="ml-auto h-4 w-4 text-[#94A3B8] transition group-hover:text-[#1F3A6D]" />
    </Link>
  );
}

function QueuePanel({
  icon: Icon,
  title,
  to,
  loading,
  empty,
  emptyText,
  children,
}: {
  icon: LucideIcon;
  title: string;
  to: string;
  loading?: boolean;
  empty?: boolean;
  emptyText: string;
  children: React.ReactNode;
}) {
  return (
    <section className="wh-panel flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-[#F1F5F9] px-5 py-3.5">
        <div className="flex items-center gap-2">
          <Icon className="h-4 w-4 text-[#64748B]" />
          <h2 className="text-sm font-bold text-[#0F172A]">{title}</h2>
        </div>
        <Link
          to={to}
          className="inline-flex items-center gap-1 text-xs font-semibold text-[#1F3A6D] no-underline hover:underline"
        >
          View all
          <ArrowRight className="h-3 w-3" />
        </Link>
      </div>
      <div className="flex flex-1 flex-col px-5 py-3">
        {loading ? (
          <div className="space-y-2 py-2">
            {[1, 2, 3].map((n) => (
              <div
                key={n}
                className="h-9 animate-pulse rounded-lg bg-[#F8FAFC]"
              />
            ))}
          </div>
        ) : empty ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 py-8 text-center">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[#F8FAFC] text-[#94A3B8]">
              <Icon className="h-4 w-4" />
            </span>
            <p className="text-xs font-medium text-[#94A3B8]">{emptyText}</p>
          </div>
        ) : (
          children
        )}
      </div>
    </section>
  );
}

function MiniTable({
  head,
  children,
}: {
  head: string[];
  children: React.ReactNode;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-[#F1F5F9] text-[10px] font-semibold uppercase tracking-wide text-[#94A3B8]">
            {head.map((h, i) => (
              <th
                key={h || `col-${i}`}
                className={`py-2 ${i === head.length - 1 ? "pl-2 text-right" : "px-2 first:pl-0"}`}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-[#F8FAFC]">{children}</tbody>
      </table>
    </div>
  );
}

function RowButton({
  children,
  onClick,
  tone = "default",
  disabled = false,
}: {
  children: React.ReactNode;
  onClick: () => void;
  tone?: "default" | "primary";
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={
        (tone === "primary"
          ? "rounded-lg bg-[#1F3A6D] px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-[#17315D]"
          : "rounded-lg border border-[#E2E8F0] bg-white px-3 py-1.5 text-xs font-semibold text-[#334155] shadow-sm hover:bg-[#F8FAFC]") +
        (disabled ? " cursor-not-allowed opacity-60" : "")
      }
    >
      {children}
    </button>
  );
}
