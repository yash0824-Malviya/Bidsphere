import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  Ban,
  CheckCircle2,
  ClipboardList,
  FileEdit,
  FolderOpen,
  XCircle,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import PaginationBar from "../../components/PaginationBar";
import ReportChartCard, {
  REPORT_AXIS,
  REPORT_TOOLTIP,
} from "../../components/reports/ReportChartCard";
import ReportKpiGrid from "../../components/reports/ReportKpiGrid";
import ReportPageShell from "../../components/reports/ReportPageShell";
import EmptyState from "../../components/EmptyState";
import { TableSkeleton } from "../../components/Skeleton";
import { StatusBadge } from "../../components/ui";
import FilterBar, { FilterField } from "../../components/ui/FilterBar";
import { DASHBOARD_QUERY_OPTIONS } from "../../api/queryPresets";
import { useClientPagination } from "../../hooks/usePagination";
import type { ExportColumn } from "../../utils/export";
import {
  buildPoTrend,
  daysBetween,
  fetchReportPurchaseOrders,
  isCancelledPoStatus,
  isCompletedPoStatus,
  isDraftPoStatus,
  isOpenPoStatus,
  statusDistribution,
  type ReportPo,
} from "../../utils/reports/operationalReportData";

const PIE_COLORS = ["#94A3B8", "#1993FF", "#16A34A", "#D97706", "#DC2626", "#7C3AED"];

function isApproved(status?: string) {
  const s = (status || "").toLowerCase();
  return s.includes("to receive") || s === "to bill";
}

function isRejected(status?: string) {
  return (status || "").toLowerCase().includes("reject");
}

export default function PoStatusReportPage() {
  const [status, setStatus] = useState("");
  const [supplier, setSupplier] = useState("");

  const query = useQuery({
    queryKey: ["operational-report-po-status"],
    queryFn: async () => {
      const { rows } = await fetchReportPurchaseOrders();
      return { rows, fetchedAt: new Date().toISOString() };
    },
    ...DASHBOARD_QUERY_OPTIONS,
  });

  const allRows = query.data?.rows ?? [];
  const filtered = useMemo(() => {
    return allRows.filter((po) => {
      if (status && (po.status || "Draft") !== status) return false;
      if (supplier) {
        const s = po.supplier_name || po.supplier || "";
        if (s !== supplier) return false;
      }
      return true;
    });
  }, [allRows, status, supplier]);

  const kpis = useMemo(() => {
    const draft = filtered.filter((p) => isDraftPoStatus(p.status)).length;
    const open = filtered.filter((p) => isOpenPoStatus(p.status)).length;
    const approved = filtered.filter((p) => isApproved(p.status)).length;
    const completed = filtered.filter((p) =>
      isCompletedPoStatus(p.status),
    ).length;
    const rejected = filtered.filter((p) => isRejected(p.status)).length;
    const cancelled = filtered.filter((p) =>
      isCancelledPoStatus(p.status),
    ).length;
    return [
      { key: "draft", label: "Draft", value: String(draft), icon: FileEdit },
      {
        key: "open",
        label: "Open",
        value: String(open),
        icon: FolderOpen,
        tone: { bg: "bg-[#E8F4FF]", fg: "text-[#1993FF]" },
      },
      {
        key: "approved",
        label: "Approved",
        value: String(approved),
        icon: ClipboardList,
        tone: { bg: "bg-[#E0F2FE]", fg: "text-[#0284C7]" },
      },
      {
        key: "completed",
        label: "Completed",
        value: String(completed),
        icon: CheckCircle2,
        tone: { bg: "bg-[#DCFCE7]", fg: "text-[#16A34A]" },
      },
      {
        key: "rejected",
        label: "Rejected",
        value: String(rejected),
        icon: XCircle,
        tone: { bg: "bg-[#FFEDD5]", fg: "text-[#EA580C]" },
      },
      {
        key: "cancelled",
        label: "Cancelled",
        value: String(cancelled),
        icon: Ban,
        tone: { bg: "bg-[#FEE2E2]", fg: "text-[#DC2626]" },
      },
    ];
  }, [filtered]);

  const statuses = useMemo(() => statusDistribution(filtered), [filtered]);
  const trend = useMemo(() => buildPoTrend(filtered), [filtered]);
  const pipeline = useMemo(
    () =>
      kpis.map((k) => ({
        name: k.label,
        value: Number(k.value) || 0,
      })),
    [kpis],
  );

  const suppliers = useMemo(
    () =>
      Array.from(
        new Set(
          allRows.map((r) => r.supplier_name || r.supplier).filter(Boolean),
        ),
      ).sort(),
    [allRows],
  );
  const statusOpts = useMemo(
    () =>
      Array.from(new Set(allRows.map((r) => r.status || "Draft"))).sort(),
    [allRows],
  );

  const {
    currentPage,
    pageSize,
    setPage,
    setPageSize,
    totalRecords,
    totalPages,
    pageRows,
  } = useClientPagination(filtered, {
    defaultPageSize: 25,
    resetKey: `${status}|${supplier}`,
  });

  const exportColumns = useMemo<ExportColumn<ReportPo>[]>(
    () => [
      { id: "name", label: "PO Number", accessor: (r) => r.name },
      {
        id: "supplier",
        label: "Supplier",
        accessor: (r) => r.supplier_name || r.supplier || "",
      },
      { id: "status", label: "Current Status", accessor: (r) => r.status || "" },
      {
        id: "days",
        label: "Days Open",
        accessor: (r) =>
          daysBetween(r.transaction_date || r.creation || r.modified),
      },
      { id: "owner", label: "Owner", accessor: (r) => r.owner || "" },
    ],
    [],
  );

  return (
    <ReportPageShell
      title="PO Status Report"
      subtitle="Track Draft, Open, Approved and Completed Purchase Orders."
      lastUpdated={query.data?.fetchedAt}
      loading={query.isFetching}
      onRefresh={() => void query.refetch()}
      exportModule="PO Status Report"
      exportFilename="PO_Status_Report"
      exportColumns={exportColumns}
      exportRows={filtered}
      kpis={
        <ReportKpiGrid
          items={kpis}
          loading={query.isLoading}
          columnsClassName="grid-cols-2 md:grid-cols-3 xl:grid-cols-6"
        />
      }
      filters={
        <FilterBar>
          <div className="flex flex-wrap items-end gap-3">
            <FilterField label="Status">
              <select
                className="select-field"
                value={status}
                onChange={(e) => setStatus(e.target.value)}
              >
                <option value="">All</option>
                {statusOpts.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </FilterField>
            <FilterField label="Supplier">
              <select
                className="select-field"
                value={supplier}
                onChange={(e) => setSupplier(e.target.value)}
              >
                <option value="">All</option>
                {suppliers.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </FilterField>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => {
                setStatus("");
                setSupplier("");
              }}
            >
              Reset
            </button>
          </div>
        </FilterBar>
      }
      charts={
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
          <ReportChartCard
            title="Status Donut Chart"
            loading={query.isLoading}
            hasData={statuses.length > 0}
          >
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={statuses}
                  dataKey="value"
                  nameKey="name"
                  innerRadius={50}
                  outerRadius={85}
                >
                  {statuses.map((_, i) => (
                    <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip contentStyle={REPORT_TOOLTIP} />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </ReportChartCard>
          <ReportChartCard
            title="Monthly Trend"
            loading={query.isLoading}
            hasData={trend.some((t) => t.count > 0)}
          >
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={trend}>
                <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" />
                <XAxis dataKey="month" {...REPORT_AXIS} />
                <YAxis {...REPORT_AXIS} allowDecimals={false} />
                <Tooltip contentStyle={REPORT_TOOLTIP} />
                <Line
                  type="monotone"
                  dataKey="count"
                  stroke="#1993FF"
                  strokeWidth={2}
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </ReportChartCard>
          <ReportChartCard
            title="Pipeline Bar Chart"
            loading={query.isLoading}
            hasData={pipeline.some((p) => p.value > 0)}
          >
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={pipeline}>
                <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" />
                <XAxis dataKey="name" {...REPORT_AXIS} />
                <YAxis {...REPORT_AXIS} allowDecimals={false} />
                <Tooltip contentStyle={REPORT_TOOLTIP} />
                <Bar dataKey="value" fill="#7C3AED" radius={6} />
              </BarChart>
            </ResponsiveContainer>
          </ReportChartCard>
        </div>
      }
    >
      <section className="overflow-hidden rounded-2xl border border-[#E8EDF5] bg-white shadow-[0_1px_3px_rgba(15,23,42,0.04)]">
        <div className="overflow-x-auto">
          {query.isLoading ? (
            <div className="p-4">
              <TableSkeleton rows={8} columns={5} />
            </div>
          ) : pageRows.length === 0 ? (
            <EmptyState
              title="No purchase orders"
              description="No PO status records match the selected filters."
            />
          ) : (
            <table className="w-full min-w-[720px] text-left">
              <thead className="bg-[#F8FAFC]">
                <tr className="text-[10px] font-semibold uppercase tracking-wider text-neutral-400">
                  <th className="px-4 py-2.5">PO Number</th>
                  <th className="px-3 py-2.5">Supplier</th>
                  <th className="px-3 py-2.5">Current Status</th>
                  <th className="px-3 py-2.5">Days Open</th>
                  <th className="px-4 py-2.5">Owner</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F1F5F9]">
                {pageRows.map((po) => (
                  <tr key={po.name} className="text-[12px] hover:bg-[#F8FAFC]/80">
                    <td className="px-4 py-3 font-semibold text-primary-700">
                      <Link
                        to={`/p2p/purchase-orders/${encodeURIComponent(po.name)}`}
                        className="hover:underline"
                      >
                        {po.name}
                      </Link>
                    </td>
                    <td className="px-3 py-3">
                      {po.supplier_name || po.supplier || "—"}
                    </td>
                    <td className="px-3 py-3">
                      {po.status ? (
                        <StatusBadge status={po.status} size="sm" />
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-3 py-3 tabular-nums text-neutral-600">
                      {daysBetween(
                        po.transaction_date || po.creation || po.modified,
                      )}
                    </td>
                    <td className="px-4 py-3 text-neutral-600">
                      {po.owner || "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div className="border-t border-[#F1F5F9] px-3 py-2">
          <PaginationBar
            currentPage={currentPage}
            totalPages={totalPages}
            totalRecords={totalRecords}
            pageSize={pageSize}
            onPageChange={setPage}
            onPageSizeChange={setPageSize}
            recordLabel="orders"
          />
        </div>
      </section>
    </ReportPageShell>
  );
}
