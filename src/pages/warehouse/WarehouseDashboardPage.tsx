import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import type { LucideIcon } from "lucide-react";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Boxes,
  CheckCircle,
  ClipboardList,
  FileSearch,
  PackageCheck,
  PackagePlus,
  Split,
  Truck,
  TrendingUp,
} from "lucide-react";

import {
  forwardToProcurement,
  getInventorySummary,
  getIssuedMaterials,
  getPendingMaterialRequests,
  getWarehouseProcurementRequiredRequests,
  invalidateForwardCaches,
  selectProcurementRequiredRows,
  selectReadyToIssueRows,
} from "../../services/warehouseService";
import { getIncomingPurchaseOrders, getPurchaseReceipts } from "../../api/purchasing";
import { fetchProcurementQueue } from "../../api/materialRequestWorkflow";
import { syncMaterialRequestSlaBatch } from "../../api/slaIntegration";
import { useSlaVisible } from "../../hooks/useSlaVisible";
import SlaCountdownWidget from "../../components/sla/SlaCountdownWidget";
import ErrorState from "../../components/ErrorState";
import PageHeader from "../../components/PageHeader";
import { useAuthStore } from "../../store/authStore";
import { formatDate, formatDateTime } from "../../utils/format";

const PRIORITY_STYLES: Record<string, string> = {
  Urgent: "bg-rose-50 text-rose-700 border-rose-200",
  High: "bg-amber-50 text-amber-700 border-amber-200",
  Medium: "bg-blue-50 text-blue-700 border-blue-200",
  Low: "bg-slate-100 text-slate-600 border-slate-200",
};

interface ActivityEntry {
  id: string;
  kind: "issued" | "received" | "forwarded";
  label: string;
  subject: string;
  user: string;
  ts: string;
}

export default function WarehouseDashboardPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const role = user?.role;
  const canLoad = role === "warehouse" || role === "admin";
  const slaVisible = useSlaVisible();
  const [forwardingMr, setForwardingMr] = useState<string | null>(null);

  // All widgets fetch in parallel and share query keys with their detail pages
  // (React Query dedupes + caches — no duplicate ERPNext calls). Every query
  // refetches on window focus so the dashboard stays live after GRNs, issues,
  // RFQ creation, etc. performed elsewhere.
  const pendingQuery = useQuery({
    queryKey: ["warehouse", "pending-requests"],
    queryFn: getPendingMaterialRequests,
    enabled: canLoad,
    retry: false,
    refetchOnWindowFocus: true,
  });
  // Genuinely-persisted "Procurement Required" MRs (recorded via the detailed
  // review page) — concatenated with `pending` below so the queue covers both
  // the quick-action-inferred AND the detail-review-recorded shortages.
  const procurementRequiredPersistedQuery = useQuery({
    queryKey: ["warehouse", "procurement-required-persisted"],
    queryFn: getWarehouseProcurementRequiredRequests,
    enabled: canLoad,
    retry: false,
    refetchOnWindowFocus: true,
  });
  const inventoryQuery = useQuery({
    queryKey: ["warehouse", "inventory"],
    queryFn: getInventorySummary,
    enabled: canLoad,
    retry: false,
    refetchOnWindowFocus: true,
  });
  const issuedQuery = useQuery({
    queryKey: ["warehouse", "issued"],
    queryFn: () => getIssuedMaterials(),
    enabled: canLoad,
    retry: false,
    refetchOnWindowFocus: true,
  });
  // Shared key with WarehouseForwardedRequestsPage so the same ERPNext fetch is
  // reused (no duplicate call) — powers both the widget and the live count.
  const procurementQueueQuery = useQuery({
    queryKey: ["mr-procurement-queue", "warehouse"],
    queryFn: fetchProcurementQueue,
    enabled: canLoad,
    retry: false,
    refetchOnWindowFocus: true,
  });
  const incomingQuery = useQuery({
    queryKey: ["warehouse", "incoming-pos"],
    queryFn: getIncomingPurchaseOrders,
    enabled: canLoad,
    retry: false,
    refetchOnWindowFocus: true,
  });

  // Ensure SLA timers track the procurement-facing queue the warehouse manages.
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
    enabled: canLoad,
    retry: false,
    refetchOnWindowFocus: true,
  });

  // "Send to Procurement" — forwards a shortage MR, then invalidates every
  // dependent cache so the request disappears from the warehouse queue and
  // appears instantly in the Procurement queue/dashboard (single round-trip).
  const forwardMutation = useMutation({
    mutationFn: (mrName: string) =>
      forwardToProcurement(mrName, user?.email || user?.name),
    onMutate: (mrName: string) => setForwardingMr(mrName),
    onSettled: () => setForwardingMr(null),
    onSuccess: async (_res, mrName) => {
      toast.success(`${mrName} sent to Procurement.`);
      // Single source of truth = ERPNext. Invalidate every dependent cache,
      // then await refetch of the two queues this dashboard renders so the
      // forwarded MR leaves "Procurement Required" and the queue count updates
      // immediately — no page reload.
      // eslint-disable-next-line no-console
      console.log("[Warehouse] Refreshing list", { mr: mrName });
      invalidateForwardCaches(queryClient);
      await Promise.all([
        pendingQuery.refetch(),
        procurementRequiredPersistedQuery.refetch(),
        procurementQueueQuery.refetch(),
      ]);
    },
    onError: (err: unknown, mrName) =>
      toast.error(
        err instanceof Error
          ? err.message
          : `Could not send ${mrName} to Procurement.`
      ),
  });

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
    void incomingQuery.refetch();
    void recentGrnQuery.refetch();
  }, [
    pendingQuery,
    procurementRequiredPersistedQuery,
    inventoryQuery,
    issuedQuery,
    procurementQueueQuery,
    incomingQuery,
    recentGrnQuery,
  ]);

  /* ─── Derived data (live ERPNext) ─── */
  const todayIso = new Date().toISOString().slice(0, 10);
  const pending = pendingQuery.data ?? [];
  const inventory = inventoryQuery.data ?? [];
  const issued = issuedQuery.data ?? [];
  const incoming = incomingQuery.data ?? [];

  // Both queues are derived from the SAME `pending` dataset through the SAME
  // shared selectors used by the "View All" pages — so a card and its list page
  // can never show different records.
  const readyToIssueMRs = useMemo(
    () => selectReadyToIssueRows(pending),
    [pending]
  );
  const procurementRequiredMRs = useMemo(
    () =>
      selectProcurementRequiredRows([
        ...pending,
        ...(procurementRequiredPersistedQuery.data ?? []),
      ]),
    [pending, procurementRequiredPersistedQuery.data]
  );

  // Already-forwarded queue — kept only for the "MR Forwarded to Procurement"
  // activity feed and SLA sync (the widget above now shows pre-forward MRs).
  const forwardedQueue = procurementQueueQuery.data ?? [];

  const kpis = useMemo(() => {
    const partiallyIssued = pending.filter((mr) => {
      const items = mr.items ?? [];
      if (items.length === 0) return false;
      const anyAvailable = items.some((i) => i.available_qty > 0);
      const anyShort = items.some((i) => i.available_qty < i.required_qty);
      return anyAvailable && anyShort;
    }).length;
    return {
      pending: pending.length,
      // KPIs are the length of the EXACT arrays rendered by the widgets below.
      readyToIssue: readyToIssueMRs.length,
      issuedToday: issued.filter((s) => s.issue_date === todayIso).length,
      procurementRequired: procurementRequiredMRs.length,
      partiallyIssued,
      lowStock: inventory.filter((i) => i.status !== "In Stock").length,
    };
  }, [pending, issued, readyToIssueMRs, procurementRequiredMRs, inventory, todayIso]);

  const lowStockItems = useMemo(
    () => inventory.filter((i) => i.status !== "In Stock"),
    [inventory]
  );

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
    return entries
      .filter((e) => e.ts)
      .sort((a, b) => b.ts.localeCompare(a.ts))
      .slice(0, 8);
  }, [issued, recentGrnQuery.data, forwardedQueue]);

  if (allFailed) {
    return (
      <div className="p-4">
        <div className="rounded-2xl border border-slate-100 bg-white p-8 shadow-sm">
          <ErrorState
            title="Unable to load Warehouse data."
            description="We encountered an issue communicating with ERPNext. Please try again."
            onRetry={handleRetry}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Single primary title (the global header shows the breadcrumb above). */}
      <PageHeader
        title="Warehouse Dashboard"
        description="Manage inventory, issue stock, receive goods, and monitor warehouse operations."
      />

      {/* 1 · Quick Actions */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <QuickAction
          icon={PackagePlus}
          label="Goods Receipt"
          desc="Receive against a PO"
          accent="bg-primary-50 text-primary-600"
          to="/warehouse/inventory/create-grn"
        />
        <QuickAction
          icon={ClipboardList}
          label="Review Material Requests"
          desc="Check stock & decide"
          accent="bg-amber-50 text-amber-600"
          to="/warehouse/material-requests/pending"
        />
        <QuickAction
          icon={PackageCheck}
          label="Issue Items"
          desc="Issue available stock"
          accent="bg-emerald-50 text-emerald-600"
          to="/warehouse/issue-items"
        />
        <QuickAction
          icon={Truck}
          label="Procurement Required"
          desc="Shortages to sourcing"
          accent="bg-indigo-50 text-indigo-600"
          to="/warehouse/material-requests/forwarded"
        />
      </div>

      {/* 2 · KPI Cards */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        <KpiCard
          icon={ClipboardList}
          accent="bg-amber-50 text-amber-600"
          label="Pending Requests"
          value={kpis.pending}
          desc="Awaiting review"
          loading={pendingQuery.isLoading}
          to="/warehouse/material-requests/pending"
        />
        <KpiCard
          icon={CheckCircle}
          accent="bg-emerald-50 text-emerald-600"
          label="Ready to Issue"
          value={kpis.readyToIssue}
          desc="Requests fully in stock"
          loading={pendingQuery.isLoading}
          to="/warehouse/issue-items"
        />
        <KpiCard
          icon={TrendingUp}
          accent="bg-blue-50 text-blue-600"
          label="Issued Today"
          value={kpis.issuedToday}
          desc="Stock issued today"
          loading={issuedQuery.isLoading}
          to="/warehouse/material-requests/issued"
        />
        <KpiCard
          icon={FileSearch}
          accent="bg-indigo-50 text-indigo-600"
          label="Procurement Required"
          value={kpis.procurementRequired}
          desc="Shortages to send"
          loading={pendingQuery.isLoading || procurementRequiredPersistedQuery.isLoading}
          to="/warehouse/material-requests/forwarded"
        />
        <KpiCard
          icon={Split}
          accent="bg-orange-50 text-orange-600"
          label="Partially Issued"
          value={kpis.partiallyIssued}
          desc="Issue + procurement"
          loading={pendingQuery.isLoading}
          to="/warehouse/material-requests/pending"
        />
        <KpiCard
          icon={AlertTriangle}
          accent="bg-rose-50 text-rose-600"
          label="Low Stock Items"
          value={kpis.lowStock}
          desc="Low or out of stock"
          loading={inventoryQuery.isLoading}
          to="/warehouse/inventory/stock"
        />
      </div>

      {/* 2b · SLA countdowns for warehouse-owned stages */}
      <SlaCountdownWidget role="warehouse" title="Warehouse SLA Countdown" />

      {/* 3 · Today's Work Queue */}
      <div className="grid gap-4 lg:grid-cols-2">
        {/* Pending Material Requests */}
        <QueuePanel
          icon={ClipboardList}
          title="Pending Material Requests"
          to="/warehouse/material-requests/pending"
          loading={pendingQuery.isLoading}
          empty={pending.length === 0}
          emptyText="No material requests awaiting review."
        >
          <MiniTable head={["MR Number", "Department", "Priority", "Items", "Required", ""]}>
            {pending.slice(0, 5).map((mr) => (
              <tr key={mr.name} className="hover:bg-slate-50/60">
                <td className="py-2 pr-2 font-semibold text-slate-800">{mr.name}</td>
                <td className="py-2 px-2 text-slate-600">{mr.department}</td>
                <td className="py-2 px-2">
                  <span
                    className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold ${
                      PRIORITY_STYLES[mr.priority] ?? PRIORITY_STYLES.Low
                    }`}
                  >
                    {mr.priority}
                  </span>
                </td>
                <td className="py-2 px-2 tabular-nums text-slate-600">{mr.items_count}</td>
                <td className="py-2 px-2 text-slate-500">
                  {mr.required_date ? formatDate(mr.required_date) : "—"}
                </td>
                <td className="py-2 pl-2 text-right">
                  <RowButton onClick={() => navigate(`/warehouse/material-requests/review/${mr.name}`)}>
                    Review
                  </RowButton>
                </td>
              </tr>
            ))}
          </MiniTable>
        </QueuePanel>

        {/* Ready to Issue */}
        <QueuePanel
          icon={PackageCheck}
          title="Ready to Issue"
          to="/warehouse/issue-items"
          loading={pendingQuery.isLoading}
          empty={readyToIssueMRs.length === 0}
          emptyText="No material requests are ready for issue."
        >
          <MiniTable
            head={[
              "MR Number",
              "Department",
              "Warehouse",
              "Required Date",
              "Priority",
              "Items",
              "Ready Qty",
              "",
            ]}
          >
            {readyToIssueMRs.slice(0, 5).map((mr) => (
              <tr key={mr.name} className="hover:bg-slate-50/60">
                <td className="py-2 pr-2 font-semibold text-slate-800">{mr.name}</td>
                <td className="py-2 px-2 text-slate-600">{mr.department}</td>
                <td className="py-2 px-2 text-slate-600">{mr.warehouse}</td>
                <td className="py-2 px-2 text-slate-500">
                  {mr.requiredDate ? formatDate(mr.requiredDate) : "—"}
                </td>
                <td className="py-2 px-2">
                  <span
                    className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold ${
                      PRIORITY_STYLES[mr.priority] ?? PRIORITY_STYLES.Low
                    }`}
                  >
                    {mr.priority}
                  </span>
                </td>
                <td className="py-2 px-2 tabular-nums text-slate-600">
                  {mr.totalItems}
                </td>
                <td className="py-2 px-2 tabular-nums font-semibold text-emerald-700">
                  {mr.readyQty} {mr.uom}
                </td>
                <td className="py-2 pl-2 text-right">
                  <RowButton
                    tone="primary"
                    onClick={() =>
                      navigate(
                        `/warehouse/material-requests/review/${encodeURIComponent(mr.name)}`
                      )
                    }
                  >
                    Issue Now
                  </RowButton>
                </td>
              </tr>
            ))}
          </MiniTable>
        </QueuePanel>

        {/* Upcoming Goods Receipts */}
        <QueuePanel
          icon={PackagePlus}
          title="Upcoming Goods Receipts"
          to="/warehouse/inventory/create-grn"
          loading={incomingQuery.isLoading}
          empty={incoming.length === 0}
          emptyText="No purchase orders awaiting receipt."
        >
          <MiniTable head={["PO Number", "Supplier", "Expected", ""]}>
            {incoming.slice(0, 5).map((po) => (
              <tr key={po.name} className="hover:bg-slate-50/60">
                <td className="py-2 pr-2 font-semibold text-slate-800">{po.name}</td>
                <td className="py-2 px-2 text-slate-600">
                  {po.supplier_name ?? po.supplier ?? "—"}
                </td>
                <td className="py-2 px-2 text-slate-500">
                  {po.schedule_date ? formatDate(po.schedule_date) : "—"}
                </td>
                <td className="py-2 pl-2 text-right">
                  <RowButton
                    tone="primary"
                    onClick={() =>
                      navigate(
                        `/warehouse/inventory/create-grn?po=${encodeURIComponent(po.name)}`
                      )
                    }
                  >
                    Receive
                  </RowButton>
                </td>
              </tr>
            ))}
          </MiniTable>
        </QueuePanel>

        {/* Procurement Required */}
        <QueuePanel
          icon={Truck}
          title="Procurement Required"
          to="/warehouse/material-requests/forwarded"
          loading={pendingQuery.isLoading || procurementRequiredPersistedQuery.isLoading}
          empty={procurementRequiredMRs.length === 0}
          emptyText="No material requests awaiting procurement."
        >
          <MiniTable
            head={[
              "MR Number",
              "Department",
              "Required Date",
              "Priority",
              "Missing Items",
              "Required Qty",
              "",
            ]}
          >
            {procurementRequiredMRs.slice(0, 5).map((r) => (
              <tr key={r.name} className="hover:bg-slate-50/60">
                <td className="py-2 pr-2 font-semibold text-slate-800">{r.name}</td>
                <td className="py-2 px-2 text-slate-600">{r.department}</td>
                <td className="py-2 px-2 text-slate-500">
                  {r.requiredDate ? formatDate(r.requiredDate) : "—"}
                </td>
                <td className="py-2 px-2">
                  <span
                    className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold ${
                      PRIORITY_STYLES[r.priority] ?? PRIORITY_STYLES.Low
                    }`}
                  >
                    {r.priority}
                  </span>
                </td>
                <td className="py-2 px-2 tabular-nums text-slate-600">
                  {r.missingItems}
                </td>
                <td className="py-2 px-2 tabular-nums font-semibold text-orange-700">
                  {r.requiredQty} {r.uom}
                </td>
                <td className="py-2 pl-2 text-right">
                  <RowButton
                    tone="primary"
                    disabled={forwardMutation.isPending && forwardingMr === r.name}
                    onClick={() => forwardMutation.mutate(r.name)}
                  >
                    {forwardMutation.isPending && forwardingMr === r.name
                      ? "Sending…"
                      : "Send to Procurement"}
                  </RowButton>
                </td>
              </tr>
            ))}
          </MiniTable>
        </QueuePanel>
      </div>

      {/* 4 · Low Stock Alerts + 5 · Recent Activity */}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <QueuePanel
            icon={Boxes}
            title="Low Stock Alerts"
            to="/warehouse/inventory/stock"
            loading={inventoryQuery.isLoading}
            empty={lowStockItems.length === 0}
            emptyText="All stock levels are optimal."
          >
            <MiniTable
              head={["Item Code", "Item Name", "Available", "Reorder", "Warehouse"]}
            >
              {lowStockItems.slice(0, 8).map((item) => {
                const critical = item.status === "Out of Stock";
                return (
                  <tr
                    key={`${item.item_code}-${item.warehouse}`}
                    className={critical ? "bg-rose-50/50" : "hover:bg-slate-50/60"}
                  >
                    <td className="py-2 pr-2 font-mono text-xs font-semibold text-slate-700">
                      {item.item_code}
                    </td>
                    <td className="py-2 px-2 text-slate-700">{item.item_name}</td>
                    <td
                      className={`py-2 px-2 tabular-nums font-semibold ${
                        critical ? "text-rose-600" : "text-amber-600"
                      }`}
                    >
                      {item.available_qty} {item.uom}
                    </td>
                    <td className="py-2 px-2 tabular-nums text-slate-500">
                      {item.reorder_level}
                    </td>
                    <td className="py-2 px-2 text-slate-500">{item.warehouse}</td>
                  </tr>
                );
              })}
            </MiniTable>
          </QueuePanel>
        </div>

        <div className="flex h-full flex-col rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-2.5">
            <Activity className="h-4 w-4 text-slate-500" />
            <h2 className="text-sm font-bold text-slate-900">Recent Warehouse Activity</h2>
          </div>
          <div className="flex flex-1 flex-col px-4 py-3">
            {recentGrnQuery.isLoading || issuedQuery.isLoading ? (
              <div className="space-y-2">
                {[1, 2, 3, 4].map((n) => (
                  <div key={n} className="h-10 animate-pulse rounded-lg bg-slate-50" />
                ))}
              </div>
            ) : activity.length === 0 ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-2 py-6 text-center">
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-50 text-slate-400">
                  <Activity className="h-4 w-4" />
                </span>
                <p className="text-xs font-medium text-slate-400">
                  No recent warehouse activity.
                </p>
              </div>
            ) : (
              <ul className="space-y-3">
                {activity.map((a) => (
                  <li key={a.id} className="flex gap-3">
                    <span
                      className={`mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg ${ACTIVITY_META[a.kind].accent}`}
                    >
                      {(() => {
                        const Icon = ACTIVITY_META[a.kind].icon;
                        return <Icon className="h-3.5 w-3.5" />;
                      })()}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-semibold text-slate-800">
                        {a.label}{" "}
                        <span className="font-mono font-normal text-slate-500">{a.subject}</span>
                      </p>
                      <p className="text-[11px] text-slate-400">
                        {a.user} · {a.ts ? formatDateTime(a.ts) : "—"}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── Sub-components ─────────────────────────────────────────────────────── */

const ACTIVITY_META: Record<
  ActivityEntry["kind"],
  { icon: LucideIcon; accent: string }
> = {
  issued: { icon: PackageCheck, accent: "bg-emerald-50 text-emerald-600" },
  received: { icon: PackagePlus, accent: "bg-blue-50 text-blue-600" },
  forwarded: { icon: Truck, accent: "bg-indigo-50 text-indigo-600" },
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
    <Link
      to={to}
      className="group flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-3.5 shadow-sm transition-all hover:border-primary-200 hover:shadow-md no-underline"
    >
      <span
        className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg ${accent} transition group-hover:scale-105`}
      >
        <Icon className="h-5 w-5" />
      </span>
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold text-slate-900">{label}</p>
        <p className="truncate text-[11px] text-slate-500">{desc}</p>
      </div>
    </Link>
  );
}

function KpiCard({
  icon: Icon,
  accent,
  label,
  value,
  desc,
  loading,
  to,
}: {
  icon: LucideIcon;
  accent: string;
  label: string;
  value: number;
  desc: string;
  loading?: boolean;
  to: string;
}) {
  return (
    <Link
      to={to}
      className="group rounded-xl border border-slate-200 bg-white px-3.5 py-3 shadow-sm transition-all hover:border-primary-200 hover:shadow-md no-underline"
    >
      <div className="flex items-center justify-between gap-1">
        <span className="truncate text-[10px] font-semibold uppercase tracking-wide text-slate-400">
          {label}
        </span>
        <span className={`flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md ${accent}`}>
          <Icon className="h-3.5 w-3.5" />
        </span>
      </div>
      {loading ? (
        <div className="mt-2 h-7 w-12 animate-pulse rounded bg-slate-100" />
      ) : (
        <p className="mt-1.5 text-2xl font-bold leading-none tabular-nums text-slate-900">
          {value}
        </p>
      )}
      <p className="mt-1 truncate text-[11px] text-slate-500">{desc}</p>
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
  emptyIcon: EmptyIcon,
  children,
}: {
  icon: LucideIcon;
  title: string;
  to: string;
  loading?: boolean;
  empty?: boolean;
  emptyText: string;
  emptyIcon?: LucideIcon;
  children: React.ReactNode;
}) {
  const EmptyGlyph = EmptyIcon ?? Icon;
  return (
    <section className="flex h-full flex-col rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2.5">
        <div className="flex items-center gap-2">
          <Icon className="h-4 w-4 text-slate-500" />
          <h2 className="text-sm font-bold text-slate-900">{title}</h2>
        </div>
        <Link
          to={to}
          className="inline-flex items-center gap-1 text-xs font-semibold text-primary-600 no-underline hover:underline"
        >
          View all
          <ArrowRight className="h-3 w-3" />
        </Link>
      </div>
      <div className="flex flex-1 flex-col px-4 py-2">
        {loading ? (
          <div className="space-y-2 py-2">
            {[1, 2, 3].map((n) => (
              <div key={n} className="h-9 animate-pulse rounded-lg bg-slate-50" />
            ))}
          </div>
        ) : empty ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 py-6 text-center">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-50 text-slate-400">
              <EmptyGlyph className="h-4 w-4" />
            </span>
            <p className="text-xs font-medium text-slate-400">{emptyText}</p>
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
          <tr className="border-b border-slate-100 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
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
        <tbody className="divide-y divide-slate-50">{children}</tbody>
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
          ? "rounded-lg bg-primary-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-primary-700"
          : "rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-sm hover:bg-slate-50") +
        (disabled ? " cursor-not-allowed opacity-60" : "")
      }
    >
      {children}
    </button>
  );
}
