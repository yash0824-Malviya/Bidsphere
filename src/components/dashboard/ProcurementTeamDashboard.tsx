import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import type { LucideIcon } from "lucide-react";
import {
  CheckCircle2,
  ClipboardList,
  ListTodo,
  Package,
  ShoppingCart,
} from "lucide-react";

import { fetchProcurementTeamDashboardKpis } from "../../api/dashboard";
import type { Filter } from "../../api/erpnext";
import { getGrnList, getPurchaseOrders } from "../../api/purchasing";
import { DASHBOARD_QUERY_OPTIONS } from "../../api/queryPresets";
import { getDashboardConfig } from "../../config/dashboardRoles";
import { formatCurrency, formatDate, formatDateTime } from "../../utils/format";
import { StatusBadge } from "../ui";
import DashboardWidgetError from "./DashboardWidgetError";

const CARD_SHELL =
  "rounded-2xl border border-[#E8EDF5] bg-white shadow-[0_1px_3px_rgba(15,23,42,0.04)]";

const KPI_SHELL = `${CARD_SHELL} transition-[transform,box-shadow] duration-150 hover:-translate-y-0.5 hover:shadow-[0_4px_12px_rgba(15,23,42,0.07)]`;

const ICON_TONE: Record<string, { bg: string; fg: string }> = {
  newPo: { bg: "bg-[#E8F4FF]", fg: "text-[#1993FF]" },
  grn: { bg: "bg-[#EDE9FE]", fg: "text-[#7C3AED]" },
  completed: { bg: "bg-[#DCFCE7]", fg: "text-[#16A34A]" },
};

const PANEL_LIMIT = 6;

function poActionLabel(status?: string): "Review" | "View" {
  const s = (status || "").toLowerCase();
  if (!s || s === "draft" || s.includes("to receive") || s.includes("to bill")) {
    return "Review";
  }
  return "View";
}

function isDateOverdue(iso?: string | null): boolean {
  if (!iso) return false;
  const d = iso.slice(0, 10);
  const today = new Date();
  const todayStr = [
    today.getFullYear(),
    String(today.getMonth() + 1).padStart(2, "0"),
    String(today.getDate()).padStart(2, "0"),
  ].join("-");
  return d < todayStr;
}

function PanelCard({
  title,
  icon: Icon,
  to,
  readOnly,
  children,
}: {
  title: string;
  icon: LucideIcon;
  to: string;
  readOnly?: boolean;
  children: ReactNode;
}) {
  return (
    <section className={`${CARD_SHELL} flex h-full min-h-[220px] flex-col overflow-hidden`}>
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-[#F1F5F9] px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <Icon className="h-4 w-4 shrink-0 text-primary-600" />
          <h2 className="truncate text-[13px] font-semibold text-[#111827]">
            {title}
          </h2>
          {readOnly ? (
            <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-neutral-500">
              Read only
            </span>
          ) : null}
        </div>
        <Link
          to={to}
          className="shrink-0 text-[11px] font-semibold text-primary-600 hover:underline"
        >
          View All →
        </Link>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">{children}</div>
    </section>
  );
}

function EmptyState({
  icon: Icon,
  title,
  description,
}: {
  icon: LucideIcon;
  title: string;
  description?: string;
}) {
  return (
    <div className="flex h-full min-h-[160px] flex-col items-center justify-center px-6 py-10 text-center">
      <span className="mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-[#F1F5F9]">
        <Icon className="h-5 w-5 text-[#94A3B8]" />
      </span>
      <p className="text-[13px] font-semibold text-[#111827]">{title}</p>
      {description ? (
        <p className="mt-1 max-w-[240px] text-[12px] leading-relaxed text-[#64748B]">
          {description}
        </p>
      ) : null}
    </div>
  );
}

function Th({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <th
      className={`whitespace-nowrap px-4 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider text-neutral-400 ${className}`}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <td className={`px-4 py-3 text-[12px] text-neutral-700 ${className}`}>
      {children}
    </td>
  );
}

/**
 * Operational dashboard for Procurement Team.
 * PO create/manage + GRN monitor only — no invoices / vouchers / onboarding.
 */
export default function ProcurementTeamDashboard() {
  const config = getDashboardConfig("procurement_team");

  const kpisQuery = useQuery({
    queryKey: ["procurement-team-dashboard-kpis"],
    queryFn: () => fetchProcurementTeamDashboardKpis(),
    ...DASHBOARD_QUERY_OPTIONS,
  });

  const recentPosQuery = useQuery({
    queryKey: ["procurement-team-recent-pos"],
    queryFn: () =>
      getPurchaseOrders({
        fields: [
          "name",
          "supplier",
          "status",
          "transaction_date",
          "schedule_date",
          "grand_total",
          "currency",
          "per_received",
          "modified",
        ],
        limit_page_length: PANEL_LIMIT,
        order_by: "modified desc",
      }),
    ...DASHBOARD_QUERY_OPTIONS,
  });

  const grnsQuery = useQuery({
    queryKey: ["procurement-team-pending-grns"],
    queryFn: () =>
      getGrnList({
        filters: [["status", "=", "To Bill"]] as Filter[],
        limit: PANEL_LIMIT,
      }),
    ...DASHBOARD_QUERY_OPTIONS,
  });

  const kpis = kpisQuery.data;
  const recentPos = recentPosQuery.data ?? [];
  const grns = grnsQuery.data ?? [];

  const kpiCards: Array<{
    key: string;
    label: string;
    value: string;
    context: string;
    icon: LucideIcon;
    to: string;
  }> = [
    {
      key: "newPo",
      label: "New Purchase Orders",
      value: kpis ? kpis.newPurchaseOrders.toLocaleString() : "—",
      context: "Today's PO Count",
      icon: ShoppingCart,
      to: "/p2p/purchase-orders/create",
    },
    {
      key: "grn",
      label: "Pending GRNs",
      value: kpis ? kpis.pendingGrns.toLocaleString() : "—",
      context: "Warehouse Awaiting Receipt",
      icon: Package,
      to: "/p2p/grn",
    },
    {
      key: "completed",
      label: "Completed Purchase Orders",
      value: kpis ? kpis.completedPos.toLocaleString() : "—",
      context: "Closed This Month",
      icon: CheckCircle2,
      to: "/p2p/purchase-orders",
    },
  ];

  const tasks: Array<{ label: string; to: string }> = [];
  const draftPo = recentPos.find(
    (p) =>
      !p.status ||
      p.status === "Draft" ||
      String(p.status).toLowerCase() === "draft",
  );
  if (draftPo || (kpis?.newPurchaseOrders ?? 0) > 0) {
    tasks.push({
      label: draftPo
        ? `Create / review PO ${draftPo.name}`
        : "Create Purchase Order",
      to: draftPo
        ? `/p2p/purchase-orders/${encodeURIComponent(draftPo.name)}`
        : "/p2p/purchase-orders/create",
    });
  }
  if (grns.length > 0) {
    tasks.push({
      label: `Review pending GRN · ${grns[0].name}`,
      to: "/p2p/grn",
    });
  }

  type TimelineItem = {
    id: string;
    label: string;
    detail: string;
    at?: string;
    tone: string;
  };

  const timeline: TimelineItem[] = [];
  for (const po of recentPos.slice(0, 6)) {
    const st = (po.status || "").toLowerCase();
    let label = "PO Created";
    if (st.includes("completed") || st.includes("closed")) label = "PO Completed";
    else if ((po.per_received ?? 0) > 0) label = "Goods Received";
    timeline.push({
      id: `po-${po.name}`,
      label,
      detail: `${po.name} · ${po.supplier || "Supplier"}`,
      at: po.modified || po.transaction_date,
      tone: "bg-sky-500",
    });
  }
  for (const g of grns.slice(0, 3)) {
    timeline.push({
      id: `grn-${g.name}`,
      label: "GRN Pending",
      detail: `${g.name} · ${g.supplier_name || g.supplier || "Supplier"}`,
      at: g.modified || g.posting_date,
      tone: "bg-violet-500",
    });
  }
  timeline.sort((a, b) => (b.at || "").localeCompare(a.at || ""));

  return (
    <div className="flex w-full flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <h1 className="text-[22px] font-semibold tracking-tight text-[#111827]">
            {config.title}
          </h1>
          <p className="mt-1.5 max-w-2xl text-[13px] leading-relaxed text-[#64748B]">
            {config.subtitle}
          </p>
        </div>
        <span className="rounded-full border border-neutral-200 bg-white px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-neutral-600 shadow-sm">
          {config.statusLabel}
        </span>
      </div>

      {kpisQuery.isError ? (
        <DashboardWidgetError
          title="Unable to load operational KPIs"
          error={kpisQuery.error}
          onRetry={() => void kpisQuery.refetch()}
        />
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {kpiCards.map((c) => {
            const Icon = c.icon;
            const tone = ICON_TONE[c.key] ?? ICON_TONE.newPo;
            return (
              <Link
                key={c.key}
                to={c.to}
                className={`${KPI_SHELL} group flex h-full min-h-[128px] flex-col p-3.5 no-underline outline-none focus-visible:ring-2 focus-visible:ring-primary-300`}
              >
                <div className="flex items-start gap-2.5">
                  <span
                    className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${tone.bg}`}
                  >
                    <Icon className={`h-3.5 w-3.5 ${tone.fg}`} />
                  </span>
                  <p className="text-[12px] font-semibold leading-snug text-[#111827]">
                    {c.label}
                  </p>
                </div>
                <div className="mt-auto pt-3">
                  <p className="text-[24px] font-bold leading-none tracking-tight tabular-nums text-[#0F172A]">
                    {kpisQuery.isLoading && !kpis ? "—" : c.value}
                  </p>
                  <p className="mt-1.5 text-[11px] font-medium text-[#64748B]">
                    {c.context}
                  </p>
                </div>
              </Link>
            );
          })}
        </div>
      )}

      <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-12">
        <div className="flex flex-col gap-4 xl:col-span-8">
          <PanelCard
            title="Recent Purchase Orders"
            icon={ShoppingCart}
            to="/p2p/purchase-orders"
          >
            {recentPosQuery.isLoading ? (
              <EmptyState icon={ShoppingCart} title="Loading purchase orders…" />
            ) : recentPos.length === 0 ? (
              <EmptyState
                icon={ShoppingCart}
                title="No Purchase Orders"
                description="New purchase orders will appear here once created."
              />
            ) : (
              <table className="w-full min-w-[640px]">
                <thead className="sticky top-0 bg-[#F8FAFC]/95">
                  <tr>
                    <Th>PO Number</Th>
                    <Th>Supplier</Th>
                    <Th>Amount</Th>
                    <Th>Status</Th>
                    <Th>Expected Delivery</Th>
                    <Th className="text-right">Action</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#F1F5F9]">
                  {recentPos.map((po) => (
                    <tr key={po.name} className="hover:bg-[#F8FAFC]/80">
                      <Td className="font-semibold text-primary-700">
                        <Link
                          to={`/p2p/purchase-orders/${encodeURIComponent(po.name)}`}
                          className="hover:underline"
                        >
                          {po.name}
                        </Link>
                      </Td>
                      <Td className="max-w-[150px] truncate">
                        {po.supplier || "—"}
                      </Td>
                      <Td className="whitespace-nowrap font-semibold tabular-nums text-neutral-900">
                        {po.grand_total != null
                          ? formatCurrency(po.grand_total)
                          : "—"}
                      </Td>
                      <Td>
                        {po.status ? <StatusBadge status={po.status} /> : "—"}
                      </Td>
                      <Td className="whitespace-nowrap text-neutral-500">
                        {po.schedule_date
                          ? formatDate(po.schedule_date, "MMM d, yyyy")
                          : "—"}
                      </Td>
                      <Td className="text-right">
                        <Link
                          to={`/p2p/purchase-orders/${encodeURIComponent(po.name)}`}
                          className="text-[11px] font-semibold text-primary-600 hover:underline"
                        >
                          {poActionLabel(po.status)}
                        </Link>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </PanelCard>

          <PanelCard
            title="GRN Monitoring"
            icon={Package}
            to="/p2p/grn"
            readOnly
          >
            {grnsQuery.isLoading ? (
              <EmptyState icon={Package} title="Loading GRNs…" />
            ) : grns.length === 0 ? (
              <EmptyState
                icon={Package}
                title="No GRNs"
                description="Warehouse receipts awaiting monitoring will appear here."
              />
            ) : (
              <table className="w-full min-w-[560px]">
                <thead className="sticky top-0 bg-[#F8FAFC]/95">
                  <tr>
                    <Th>PO</Th>
                    <Th>Warehouse</Th>
                    <Th>Supplier</Th>
                    <Th>Expected Date</Th>
                    <Th>Status</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#F1F5F9]">
                  {grns.map((grn) => {
                    const overdue = isDateOverdue(grn.posting_date);
                    return (
                      <tr
                        key={grn.name}
                        className={
                          overdue
                            ? "bg-orange-50/40 hover:bg-orange-50/70"
                            : "hover:bg-[#F8FAFC]/80"
                        }
                      >
                        <Td className="font-medium text-neutral-800">
                          {grn.purchase_order || "—"}
                        </Td>
                        <Td className="max-w-[120px] truncate">
                          {grn.warehouse || grn.set_warehouse || "—"}
                        </Td>
                        <Td className="max-w-[140px] truncate">
                          {grn.supplier_name || grn.supplier || "—"}
                        </Td>
                        <Td className="whitespace-nowrap">
                          <div className="flex flex-col gap-1">
                            {overdue ? (
                              <span className="w-fit rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-red-700 ring-1 ring-red-200">
                                Overdue
                              </span>
                            ) : null}
                            <span
                              className={
                                overdue
                                  ? "text-[12px] font-medium text-orange-700"
                                  : "text-neutral-500"
                              }
                            >
                              {grn.posting_date
                                ? `Expected ${formatDate(grn.posting_date, "MMM d")}`
                                : "—"}
                            </span>
                          </div>
                        </Td>
                        <Td>
                          {grn.status ? (
                            <StatusBadge status={grn.status} />
                          ) : (
                            "—"
                          )}
                        </Td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </PanelCard>
        </div>

        <aside className="xl:col-span-4">
          <section
            className={`${CARD_SHELL} sticky top-4 flex min-h-[220px] flex-col overflow-hidden`}
          >
            <div className="flex items-center gap-2 border-b border-[#F1F5F9] px-4 py-3">
              <ListTodo className="h-4 w-4 text-primary-600" />
              <div>
                <h2 className="text-[13px] font-semibold text-[#111827]">
                  Today&apos;s Tasks
                </h2>
                <p className="mt-0.5 text-[11px] text-neutral-500">
                  Dynamic operational follow-ups
                </p>
              </div>
            </div>
            {tasks.length === 0 ? (
              <EmptyState
                icon={CheckCircle2}
                title="You're all caught up."
                description="No pending PO operations require attention right now."
              />
            ) : (
              <ul className="flex flex-col gap-1 p-3">
                {tasks.map((task) => (
                  <li key={task.label}>
                    <Link
                      to={task.to}
                      className="flex items-start gap-2.5 rounded-xl px-3 py-2.5 text-[13px] text-neutral-700 no-underline transition hover:bg-primary-50 hover:text-primary-800"
                    >
                      <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary-500" />
                      <span className="leading-snug">{task.label}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </aside>
      </div>

      <section className={`${CARD_SHELL} overflow-hidden`}>
        <div className="border-b border-[#F1F5F9] px-4 py-3">
          <h2 className="text-[13px] font-semibold text-[#111827]">
            Recent Activities
          </h2>
          <p className="mt-0.5 text-[11px] text-neutral-500">
            Purchase order operations timeline
          </p>
        </div>
        <div className="px-4 py-4">
          {timeline.length === 0 ? (
            <EmptyState
              icon={ClipboardList}
              title="No recent activity"
              description="PO and GRN events will appear here."
            />
          ) : (
            <ol className="relative space-y-0 border-l border-neutral-200 pl-4">
              {timeline.slice(0, 12).map((item) => (
                <li key={item.id} className="relative pb-4 last:pb-0">
                  <span
                    className={`absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full ring-4 ring-white ${item.tone}`}
                  />
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="text-[13px] font-semibold text-[#111827]">
                      {item.label}
                    </p>
                    <p className="text-[11px] text-neutral-400">
                      {item.at ? formatDateTime(item.at) : ""}
                    </p>
                  </div>
                  <p className="mt-0.5 text-[12px] text-neutral-500">
                    {item.detail}
                  </p>
                </li>
              ))}
            </ol>
          )}
        </div>
      </section>
    </div>
  );
}
